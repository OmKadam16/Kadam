// D-50: every effect works, stays out of the way of reduced motion and touch,
// and leaves the full text in the page.
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

const root = fileURLToPath(new URL("../fixtures/effects-site", import.meta.url));
let site;
test.beforeAll(async () => {
  site = await serve(root, { csp: true });
});
test.afterAll(async () => {
  await new Promise((resolve) => site.server.close(resolve));
});

const sweep = async (page, x, y) => {
  for (let i = 0; i < 20; i += 1) await page.mouse.move(x + i * 12, y + (i % 4) * 6);
};

test("cursor, button and text effects run with motion allowed", async ({ browser }) => {
  const page = await browser.newPage({ reducedMotion: "no-preference", viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${site.origin}/`);
    // Pixels pop out around the cursor, and clean themselves up.
    await sweep(page, 300, 220);
    await expect.poll(() => page.locator(".kdm-cursor-pixel").count()).toBeGreaterThan(0);
    await expect(page.locator(".kdm-cursor-layer")).toHaveAttribute("aria-hidden", "true");
    await expect.poll(() => page.locator(".kdm-cursor-pixel").count(), { timeout: 3000 }).toBe(0);
    // The glow layer shows while the cursor is over its section.
    const glow = page.locator('[data-kdm-id="home-glow1"]');
    await sweep(page, 500, 480);
    await expect(glow).toHaveAttribute("data-kdm-cursor", "");
    expect(await glow.evaluate((node) => getComputedStyle(node, "::after").opacity)).toBe("1");
    // Word by word: one span per word, all of the text present.
    await expect(page.getByRole("heading", { name: "Meet Lumen." })).toBeVisible();
    expect(await page.locator('[data-kdm-id="home-heading1"] .kdm-word').count()).toBe(2);
    // Scramble ends on the real text.
    await expect(page.getByRole("heading", { name: "Cards" })).toHaveText("Cards");
    // The fill slides in on hover, and the ripple appears on press.
    const download = page.getByRole("button", { name: "Download" });
    await download.hover();
    await expect.poll(() => download.evaluate((node) => getComputedStyle(node, "::before").transform)).toBe("none");
    await download.dispatchEvent("pointerdown", { clientX: 100, clientY: 170, bubbles: true });
    await expect(download.locator(".kdm-ripple")).toHaveCount(1);
    // The magnetic button leans toward the cursor.
    const shine = page.getByRole("button", { name: "Shine" });
    const box = await shine.boundingBox();
    await page.mouse.move(box.x + box.width - 2, box.y + 2);
    await expect.poll(() => shine.evaluate((node) => node.style.translate)).not.toBe("");
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

test("with reduced motion, nothing moves and all the text is there", async ({ page }) => {
  // The suite runs with reduced motion on.
  await page.goto(`${site.origin}/`);
  await sweep(page, 300, 220);
  expect(await page.locator(".kdm-cursor-pixel").count()).toBe(0);
  await expect(page.getByRole("heading", { name: "Cards" })).toHaveText("Cards");
  for (const selector of ['[data-kdm-id="home-heading1"] .kdm-word', '[data-kdm-id="home-text2"]', ".kdm-highlight", "body"]) {
    expect(await page.locator(selector).first().evaluate((node) => getComputedStyle(node).animationName), selector).toBe("none");
  }
  await expect(page.locator('[data-kdm-id="home-text2"]')).toHaveText("Grain, glow and spotlight follow the cursor.");
});

test("on a touch screen the cursor effects stay off", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, reducedMotion: "no-preference", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(`${site.origin}/`);
    await page.touchscreen.tap(200, 220);
    await sweep(page, 100, 220);
    expect(await page.locator(".kdm-cursor-pixel").count()).toBe(0);
    expect(await page.locator('[data-kdm-id="home-glow1"]').getAttribute("data-kdm-cursor")).toBeNull();
  } finally {
    await context.close();
  }
});
