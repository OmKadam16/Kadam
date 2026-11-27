// D-50: a page built from a data file with paragraphs (test/fixtures/shop-prose-site).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const root = fileURLToPath(new URL("../fixtures/shop-prose-site", import.meta.url));
let site;
test.beforeAll(async () => {
  site = await serve(root);
});
test.afterAll(async () => {
  await new Promise((resolve) => site.server.close(resolve));
});

for (const [width, scheme] of [[390, "light"], [1280, "light"], [1280, "dark"]]) {
  test(`the product grid fits and passes axe at ${width}px (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${site.origin}/`);
    await expect(page.getByRole("heading", { name: "Mug" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const results = await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
        resultTypes: ["violations"],
      });
      return results.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")) }));
    });
    expect(violations).toEqual([]);
  });
}
