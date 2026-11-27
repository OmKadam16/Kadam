// D-50: menus, dialogs and questions written in paragraphs
// (test/fixtures/interactive-site), referred to by their words.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const root = fileURLToPath(new URL("../fixtures/interactive-site", import.meta.url));
let site;
test.beforeAll(async () => {
  site = await serve(root, { csp: true });
});
test.afterAll(async () => {
  await new Promise((resolve) => site.server.close(resolve));
});

test("the menu button toggles the menu", async ({ page }) => {
  await page.goto(`${site.origin}/`);
  const button = page.getByRole("button", { name: "Menu" });
  const pricing = page.getByRole("link", { name: "Pricing" });
  await expect(pricing).toBeHidden();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.click();
  await expect(pricing).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await button.click();
  await expect(pricing).toBeHidden();
});

test("the waitlist dialog opens, closes, and gives focus back", async ({ page }) => {
  await page.goto(`${site.origin}/`);
  const open = page.getByRole("button", { name: "Join the waitlist" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Join the waitlist" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("We will email you when Orbit opens.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a question opens to its answer, by keyboard too", async ({ page }) => {
  await page.goto(`${site.origin}/`);
  const question = page.locator("details", { hasText: "Is Orbit free?" });
  await expect(question.getByText("The basic plan is free forever.")).toBeHidden();
  await question.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(question.getByText("The basic plan is free forever.")).toBeVisible();
});

for (const scheme of ["light", "dark"]) {
  test(`passes axe (${scheme})`, async ({ browser }) => {
    // The page's policy forbids inline scripts, so axe runs in a context that may add one.
    const context = await browser.newContext({ bypassCSP: true, colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(`${site.origin}/`);
    await page.getByRole("button", { name: "Menu" }).click();
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const results = await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
        resultTypes: ["violations"],
      });
      return results.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")) }));
    });
    expect(violations).toEqual([]);
    await context.close();
  });
}
