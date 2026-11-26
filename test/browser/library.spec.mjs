// D-46: every standard library component passes axe in light and dark, fits
// small screens, and works by keyboard.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const root = fileURLToPath(new URL("../fixtures/library-site", import.meta.url));

let site;
test.beforeAll(async () => {
  site = await serve(root);
});
test.afterAll(async () => {
  await new Promise((resolve) => site.server.close(resolve));
});

for (const [width, scheme] of [[360, "light"], [1280, "light"], [360, "dark"], [1280, "dark"]]) {
  test(`library components pass axe and fit at ${width}px (${scheme})`, async ({ page }) => {
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

test("library components work by keyboard", async ({ page }) => {
  await page.goto(`${site.origin}/pricing/`);
  const closed = page.locator("details", { hasText: "Is there a free trial?" });
  await expect(closed).not.toHaveAttribute("open", "");
  await expect(page.locator("details", { hasText: "Can I change plans?" })).toHaveAttribute("open", "");
  await closed.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(closed).toHaveAttribute("open", "");
  await expect(closed.getByText("The Basic plan is free.")).toBeVisible();
  await page.goto(`${site.origin}/`);
  // The hero's action is a real link to the page it names.
  await page.getByRole("link", { name: "See pricing" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/pricing\/$/);
});
