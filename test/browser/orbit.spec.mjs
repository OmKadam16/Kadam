// D-50: a whole site written in loose, natural paragraphs (test/fixtures/orbit-site).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const root = fileURLToPath(new URL("../fixtures/orbit-site", import.meta.url));
let site;
test.beforeAll(async () => {
  site = await serve(root);
});
test.afterAll(async () => {
  await new Promise((resolve) => site.server.close(resolve));
});

test("things on the right sit together; columns stack on phones; centered text is centered", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${site.origin}/`);
  const pricing = await page.getByRole("link", { name: "Pricing" }).first().boundingBox();
  const signUp = await page.getByRole("button", { name: "Sign up" }).boundingBox();
  expect(signUp.x - (pricing.x + pricing.width)).toBeLessThan(40);
  expect(signUp.x + signUp.width).toBeGreaterThan(1200);
  const cards = ["Fast", "Calm", "Private"].map((name) => page.getByRole("heading", { name, exact: true }));
  const desktop = await Promise.all(cards.map((card) => card.boundingBox()));
  expect(new Set(desktop.map((box) => Math.round(box.y))).size).toBe(1);
  await page.setViewportSize({ width: 390, height: 900 });
  const phone = await Promise.all(cards.map((card) => card.boundingBox()));
  expect(phone[1].y).toBeGreaterThan(phone[0].y + phone[0].height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(await page.getByRole("heading", { level: 1 }).evaluate((node) => getComputedStyle(node).textAlign)).toBe("center");
});

for (const [width, scheme] of [[390, "light"], [1280, "light"], [1280, "dark"]]) {
  test(`passes axe at ${width}px (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/pricing/"]) {
      await page.goto(`${site.origin}${route}`);
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
