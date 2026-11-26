// F8: background video plays unless motion is reduced, and can be paused.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

const media = fileURLToPath(new URL("../fixtures/media", import.meta.url));

function project() {
  const root = mkdtempSync(join(tmpdir(), "kadam-f8-"));
  mkdirSync(join(root, "pages"));
  cpSync(media, join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "pages", "home.kdm"), [
    "kadam 0.3", "", 'page "Home" {',
    "    hero {", "        a section", "        it is 60vh tall", "        it has 48px padding",
    "        backdrop {", "            a video", '            it plays "assets/loop.mp4"', '            the poster is "assets/poster.png"',
    "            it plays in the background", "            it is placed over its parent", "            it fills its box", "        }",
    "        title {", "            a main heading", '            the text says "Over the video"', "        }",
    "    }", "}", "",
  ].join("\n"));
  writeFileSync(join(root, "kadam.json"), JSON.stringify({ kadam: "0.3", name: "f8", pages: [{ source: "pages/home.kdm", route: "/" }] }));
  return root;
}

const close = (site) => new Promise((resolve) => {
  site.server.close(resolve);
  site.server.closeAllConnections();
});

test("a background video plays, is decorative, and the button pauses and resumes it", async ({ browser }) => {
  // The suite runs with reduced motion on; this test needs motion allowed.
  const page = await browser.newPage({ reducedMotion: "no-preference" });
  const site = await serve(project(), { csp: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${site.origin}/`);
    const video = page.locator("video");
    await expect(video).toHaveAttribute("aria-hidden", "true");
    expect(await video.getAttribute("controls")).toBeNull();
    expect(await video.getAttribute("autoplay")).toBeNull();
    await expect.poll(() => video.evaluate((node) => node.paused)).toBe(false);
    const toggle = page.getByRole("button", { name: "Pause the background video" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect.poll(() => video.evaluate((node) => node.paused)).toBe(true);
    await expect(page.getByRole("button", { name: "Play the background video" })).toHaveText("Play");
    await page.getByRole("button", { name: "Play the background video" }).click();
    await expect.poll(() => video.evaluate((node) => node.paused)).toBe(false);
    await expect(page.getByRole("heading", { name: "Over the video" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await close(site);
  }
});

test("with reduced motion the poster stays, and with JavaScript off nothing moves", async ({ browser }) => {
  const site = await serve(project(), { csp: true });
  try {
    const reduced = await browser.newPage({ reducedMotion: "reduce" });
    await reduced.goto(`${site.origin}/`);
    await expect(reduced.getByRole("button", { name: "Play the background video" })).toBeVisible();
    await reduced.waitForTimeout(500);
    expect(await reduced.locator("video").evaluate((node) => node.paused)).toBe(true);
    await reduced.close();
    const context = await browser.newContext({ javaScriptEnabled: false });
    const plain = await context.newPage();
    await plain.goto(`${site.origin}/`);
    await plain.waitForTimeout(500);
    expect(await plain.locator("video").evaluate((node) => node.paused)).toBe(true);
    await expect(plain.locator(".kdm-video-toggle")).toBeHidden();
    await context.close();
  } finally {
    await close(site);
  }
});

function galleryProject() {
  const root = mkdtempSync(join(tmpdir(), "kadam-f8-gallery-"));
  mkdirSync(join(root, "pages"));
  cpSync(media, join(root, "assets"), { recursive: true });
  const pictures = [1, 2, 3, 4, 5, 6].map((n) => [
    `        pic${n} {`, "            an image", '            it shows "assets/poster.png"', `            the description says "Picture ${n}"`,
    `            it is ${n % 2 === 0 ? 120 : 200}px tall`, "            it opens larger when clicked", "        }",
  ].join("\n"));
  writeFileSync(join(root, "pages", "home.kdm"), [
    "kadam 0.3", "", 'page "Home" {',
    "    bar1 {", "        a container", "        it is pinned to the top", "        it is full width", "        it is 4px tall",
    "        has a #2747C9 background", "        it shows how far the page has scrolled", "    }",
    "    gallery {", "        a container", "        it is 900px wide", "        it arranges its children in 3 masonry columns", "        it has 12px gap between children",
    ...pictures, "    }",
    "    spacer {", "        a container", "        it is 2000px tall", "    }",
    "}", "",
  ].join("\n"));
  writeFileSync(join(root, "kadam.json"), JSON.stringify({ kadam: "0.3", name: "f8-gallery", pages: [{ source: "pages/home.kdm", route: "/" }] }));
  return root;
}

test("a lightbox opens from a click or the keyboard and closes three ways, returning focus", async ({ page }) => {
  const site = await serve(galleryProject(), { csp: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${site.origin}/`);
    const opener = page.getByRole("button", { name: "Open larger: Picture 1" });
    const dialog = page.getByRole("dialog", { name: "Picture 1" });
    await opener.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await opener.click();
    await page.mouse.click(5, 300);
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await close(site);
  }
});

test("masonry makes real columns, and the progress bar grows as the page scrolls", async ({ page }) => {
  const site = await serve(galleryProject(), { csp: true });
  try {
    await page.goto(`${site.origin}/`);
    const lefts = await page.locator("[data-kdm-lightbox-open]").evaluateAll((nodes) => [...new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().left)))]);
    expect(lefts.length).toBe(3);
    const width = () => page.locator("[data-kdm-id='home-bar1']").evaluate((node) => node.getBoundingClientRect().width);
    const before = await width();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(width).toBeGreaterThan(before + 100);
  } finally {
    await close(site);
  }
});
