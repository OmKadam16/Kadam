// D-50: a portfolio written in loose paragraphs (test/fixtures/folio-site):
// pictures fit their boxes, circles are round, and it passes axe.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const root = fileURLToPath(new URL("../fixtures/folio-site", import.meta.url));
let site;
test.beforeAll(async () => {
  site = await serve(root);
});
test.afterAll(async () => {
  await new Promise((resolve) => site.server.close(resolve));
});

for (const width of [390, 1280]) {
  test(`nothing is wider than the screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/about/"]) {
      await page.goto(`${site.origin}${route}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), route).toBeLessThanOrEqual(0);
    }
    await page.goto(`${site.origin}/`);
    const photos = page.getByRole("button", { name: /^Open larger/ });
    await expect(photos).toHaveCount(4);
    const [first, second] = await Promise.all([photos.nth(0).boundingBox(), photos.nth(1).boundingBox()]);
    if (width === 1280) expect(Math.round(first.y)).toBe(Math.round(second.y));
    else expect(second.y).toBeGreaterThan(first.y + first.height - 1);
  });
}

test("a photo shaped like a circle is round", async ({ page }) => {
  await page.goto(`${site.origin}/about/`);
  const box = await page.getByRole("img", { name: "Photo of Mira smiling" }).boundingBox();
  expect(Math.round(box.width)).toBe(Math.round(box.height));
});

for (const scheme of ["light", "dark"]) {
  test(`passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const route of ["/", "/about/"]) {
      await page.goto(`${site.origin}${route}`);
      await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async () => {
        const results = await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
          resultTypes: ["violations"],
        });
        return results.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")) }));
      });
      expect(violations, `${route} (${scheme})`).toEqual([]);
    }
  });
}
