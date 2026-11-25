import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const PROJECTS = ["marketing", "docs", "dashboard"];
const WIDTHS = [360, 768, 1280, 1600];
for (const name of PROJECTS) {
  test.describe(`${name} reference`, () => {
    let site;
    test.beforeAll(async () => {
      site = await serve(name);
    });
    test.afterAll(async () => {
      await new Promise((resolve) => site.server.close(resolve));
    });

    for (const width of WIDTHS) {
      test(`renders at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        for (const route of site.routes) {
          await page.goto(`${site.origin}${route}`);
          // Nothing may be wider than the viewport.
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, `${route} scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
          const slug = route === "/" ? "home" : route.replaceAll("/", "-").replace(/^-|-$/g, "");
          await expect(page).toHaveScreenshot(`${name}-${slug}-${width}.png`, { fullPage: true });
        }
      });
    }

    // F3 exit: the marketing site in dark mode (D-38), screenshots and axe.
    if (name === "marketing") {
      for (const width of [360, 1280]) {
        test(`renders in dark mode at ${width}px`, async ({ page }) => {
          await page.emulateMedia({ colorScheme: "dark" });
          await page.setViewportSize({ width, height: 900 });
          for (const route of site.routes) {
            await page.goto(`${site.origin}${route}`);
            const slug = route === "/" ? "home" : route.replaceAll("/", "-").replace(/^-|-$/g, "");
            await expect(page).toHaveScreenshot(`${name}-${slug}-${width}-dark.png`, { fullPage: true });
          }
        });
      }
    }

    for (const [width, scheme] of [[360, "light"], [1280, "light"], [1280, "dark"]]) {
      test(`passes axe with color contrast at ${width}px (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });
        for (const route of site.routes) {
          await page.goto(`${site.origin}${route}`);
          await page.addScriptTag({ content: axeSource });
          const violations = await page.evaluate(async () => {
            const results = await window.axe.run(document, {
              runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
              resultTypes: ["violations"],
            });
            return results.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")) }));
          });
          expect(violations, `${name}${route} at ${width}px (${scheme})`).toEqual([]);
        }
      });
    }
  });
}
