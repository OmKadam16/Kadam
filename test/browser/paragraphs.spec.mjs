// D-50: the Lumen page, written as paragraphs, lays out as described, passes
// axe in light and dark, and works by keyboard.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const root = fileURLToPath(new URL("../../examples/paragraphs/lumen", import.meta.url));

let site;
test.beforeAll(async () => {
  site = await serve(root);
});
test.afterAll(async () => {
  await new Promise((resolve) => site.server.close(resolve));
});

test("the gaps in the paragraphs are the gaps on the page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${site.origin}/`);
  const box = async (name) => page.locator(`[data-kdm-id="home-${name}"]`).boundingBox();
  const nav = await box("nav1");
  const logo = await box("logo1");
  const start = await box("button1");
  // The logo is on the left and Get Started on the right of the nav bar.
  expect(logo.x).toBeLessThan(nav.x + 40);
  expect(start.x + start.width).toBeGreaterThan(nav.x + nav.width - 40);
  const hero = await box("hero1");
  const heading = await box("heading1");
  const lead = await box("text1");
  const download = await page.getByRole("button", { name: "Download for macOS" }).boundingBox();
  expect(Math.round(heading.y - hero.y)).toBeGreaterThanOrEqual(200);
  expect(Math.round(lead.y - (heading.y + heading.height))).toBe(50);
  expect(Math.round(download.y - (lead.y + lead.height))).toBe(70);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meet Lumen, the most effective agent you can run.");
  expect(await page.locator('[data-kdm-id="home-text1"]').evaluate((node) => getComputedStyle(node).fontSize)).toBe("18px");
});

for (const [width, scheme] of [[360, "light"], [1280, "light"], [1280, "dark"]]) {
  test(`passes axe and fits at ${width}px (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/pricing/"]) {
      await page.goto(`${site.origin}${route}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${route} scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
      await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async () => {
        const results = await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
          resultTypes: ["violations"],
        });
        return results.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")) }));
      });
      expect(violations, `${route} at ${width}px (${scheme})`).toEqual([]);
    }
  });
}

test("every button is reachable by keyboard", async ({ page }) => {
  await page.goto(`${site.origin}/`);
  const focused = [];
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press("Tab");
    focused.push(await page.evaluate(() => document.activeElement?.textContent?.trim()));
  }
  expect(focused).toContain("Get Started");
  expect(focused).toContain("Download for macOS");
});
