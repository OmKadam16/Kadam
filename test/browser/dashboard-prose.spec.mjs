// D-50: a dashboard and a docs page written in loose paragraphs
// (test/fixtures/dashboard-site).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const root = fileURLToPath(new URL("../fixtures/dashboard-site", import.meta.url));
let site;
test.beforeAll(async () => {
  site = await serve(root);
});
test.afterAll(async () => {
  await new Promise((resolve) => site.server.close(resolve));
});

test("the sidebar sits beside the main area, which takes the rest", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${site.origin}/`);
  const sidebar = await page.locator("aside").boundingBox();
  const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
  expect(Math.round(sidebar.width)).toBe(220);
  expect(heading.x).toBeGreaterThan(sidebar.x + sidebar.width);
  expect(Math.round(heading.y)).toBeLessThan(sidebar.y + sidebar.height);
  await expect(page.getByRole("table", { name: "Recent orders" })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(3);
});

for (const [width, scheme] of [[390, "light"], [1280, "light"], [1280, "dark"]]) {
  test(`passes axe and fits at ${width}px (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/docs/"]) {
      await page.goto(`${site.origin}${route}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), route).toBeLessThanOrEqual(0);
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
