// F4 step 1 interactions in a real browser: native HTML only, keyboard first.
import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

test.describe("native interactions", () => {
  let docs;
  let marketing;
  test.beforeAll(async () => {
    docs = await serve("docs");
    marketing = await serve("marketing");
  });
  test.afterAll(async () => {
    await new Promise((resolve) => docs.server.close(resolve));
    await new Promise((resolve) => marketing.server.close(resolve));
  });

  test("an expandable section opens and closes from the keyboard", async ({ page }) => {
    await page.goto(docs.origin);
    const question = page.locator("summary", { hasText: "Does a Kadam page need JavaScript?" });
    const details = page.locator("details", { has: question });
    await expect(details).not.toHaveAttribute("open", "");
    await question.focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(page.getByText("No. Static pages, including these questions")).toBeVisible();
    await page.keyboard.press("Space");
    await expect(details).not.toHaveAttribute("open", "");
    // The first question starts open.
    await expect(page.getByText("Yes. Kadam is open source")).toBeVisible();
  });

  test("an in-page link moves to its target", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto(docs.origin);
    await page.getByRole("link", { name: "Questions" }).click();
    await expect(page).toHaveURL(/#intro-faq$|#home-faq$/);
    await expect(page.getByRole("heading", { name: "Questions" })).toBeInViewport();
  });

  test("a field error appears only after the user enters something invalid", async ({ page }) => {
    await page.goto(marketing.origin);
    const error = page.getByText("Enter an email address such as you@example.com");
    await expect(error).toBeHidden();
    const field = page.getByLabel("Email", { exact: true });
    await field.fill("not-an-email");
    await field.blur();
    await expect(error).toBeVisible();
    await field.fill("you@example.com");
    await field.blur();
    await expect(error).toBeHidden();
  });

  test("pages with only native interactions ship no JavaScript", async ({ page }) => {
    const scripts = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.push(request.url());
    });
    await page.goto(marketing.origin);
    expect(scripts).toEqual([]);
    expect(await page.locator("script").count()).toBe(0);
  });
});

// F4 step 2 (D-36): the generated runtime, under script-src 'self'.
test.describe("runtime interactions", () => {
  let docs;
  let dashboard;
  const errors = [];
  test.beforeAll(async () => {
    docs = await serve("docs", { csp: true });
    dashboard = await serve("dashboard", { csp: true });
  });
  test.afterAll(async () => {
    await new Promise((resolve) => docs.server.close(resolve));
    await new Promise((resolve) => dashboard.server.close(resolve));
  });
  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  });
  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test("the docs guides menu opens and closes on phones", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(docs.origin);
    const toggle = page.getByRole("button", { name: "Guides" });
    const guides = page.getByRole("complementary");
    await expect(guides).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-controls", "home-sideNav");
    await toggle.click();
    await expect(guides).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Escape closes it from the toggle and from inside the menu.
    await page.keyboard.press("Escape");
    await expect(guides).toBeHidden();
    await toggle.press("Enter");
    await expect(guides).toBeVisible();
    await page.getByRole("link", { name: "Questions" }).focus();
    await page.keyboard.press("Escape");
    await expect(guides).toBeHidden();
  });

  test("the guides are always shown on wider screens, and the toggle is hidden", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(docs.origin);
    await expect(page.getByRole("complementary")).toBeVisible();
    await expect(page.getByRole("button", { name: "Guides" })).toBeHidden();
  });

  test("the invite dialog is modal, keyboard operable, and returns focus", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(dashboard.origin);
    const invite = page.getByRole("button", { name: "Invite" });
    const dialog = page.getByRole("dialog", { name: "Invite a teammate" });
    await expect(dialog).toBeHidden();
    await invite.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((node) => node.matches(":modal"))).toBe(true);
    await expect(page).toHaveScreenshot("dashboard-dialog-1280.png", { fullPage: false });
    // Escape closes the native dialog and focus goes back to the opener.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(invite).toBeFocused();
    await invite.click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(invite).toBeFocused();
  });
});

test.describe("with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });
  let docs;
  let dashboard;
  test.beforeAll(async () => {
    docs = await serve("docs");
    dashboard = await serve("dashboard");
  });
  test.afterAll(async () => {
    await new Promise((resolve) => docs.server.close(resolve));
    await new Promise((resolve) => dashboard.server.close(resolve));
  });

  test("content the runtime would hide stays readable", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(docs.origin);
    await expect(page.getByRole("link", { name: "Questions" })).toBeVisible();
    await page.goto(dashboard.origin);
    await expect(page.getByText("They get an email with a link to join this workspace.")).toBeVisible();
  });
});
