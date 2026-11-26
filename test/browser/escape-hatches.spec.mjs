// F6 (D-42): escape hatches in a real browser, under the strict CSP.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

function project() {
  const root = mkdtempSync(join(tmpdir(), "kadam-f6-browser-"));
  mkdirSync(join(root, "pages"));
  mkdirSync(join(root, "styles"));
  writeFileSync(join(root, "analytics.js"), [
    "export function track(name, count) { document.body.dataset.tracked = `${name}:${count}`; }",
    'export function broken() { throw new Error("broken on purpose"); }',
    "",
  ].join("\n"));
  writeFileSync(join(root, "styles", "legacy.css"), ".legacy-note { letter-spacing: 3px; }\n");
  writeFileSync(join(root, "pages", "home.kdm"), [
    "kadam 0.3",
    "",
    'page "Home" {',
    '    external track from "analytics.js" takes text and a number and returns nothing',
    '    external broken from "analytics.js" takes nothing and returns nothing',
    "    box {",
    "        a container",
    "        it remembers clicks, a number that starts as 0",
    '        the css "clip-path" is "inset(0 round 8px)"',
    "        note {",
    "            a paragraph",
    '            the text says "Legacy"',
    '            it also uses the class "legacy-note" from "styles/legacy.css"',
    "        }",
    "        count {",
    "            a paragraph",
    "            the text shows clicks",
    "        }",
    "        trackButton {",
    "            a button",
    '            the text says "Track"',
    '            when clicked, add 1 to clicks and call track with "hero", clicks',
    "        }",
    "        breakButton {",
    "            a button",
    '            the text says "Break"',
    "            when clicked, call broken and add 10 to clicks",
    "        }",
    "    }",
    "}",
    "",
  ].join("\n"));
  writeFileSync(join(root, "kadam.json"), JSON.stringify({
    kadam: "0.3", name: "f6", pages: [{ source: "pages/home.kdm", route: "/" }], stylesheets: ["styles/legacy.css"],
  }));
  return root;
}

const close = (site) => new Promise((resolve) => {
  site.server.close(resolve);
  site.server.closeAllConnections();
});

test("externals run with typed values, and a throwing one leaves the page working", async ({ page }) => {
  const site = await serve(project(), { csp: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Resource 404s (favicon.ico) are not script errors.
  page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text()); });
  await page.goto(`${site.origin}/`);

  await page.getByRole("button", { name: "Track" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-tracked", "hero:1");
  await page.getByRole("button", { name: "Track" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-tracked", "hero:2");

  await page.getByRole("button", { name: "Break" }).click();
  await expect(page.getByText("12")).toBeVisible();
  await expect.poll(() => errors.some((text) => text.startsWith("kadam: broken failed"))).toBe(true);
  // Kadam's own handlers still work after the failure.
  await page.getByRole("button", { name: "Track" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-tracked", "hero:13");
  // No CSP violation and no uncaught error.
  expect(errors.filter((text) => !text.startsWith("kadam: broken failed"))).toEqual([]);

  // The raw css and the stylesheet class both apply.
  expect(await page.locator("[data-kdm-id='home-box']").evaluate((node) => getComputedStyle(node).clipPath)).toContain("inset");
  expect(await page.getByText("Legacy").evaluate((node) => getComputedStyle(node).letterSpacing)).toBe("3px");
  await close(site);
});
