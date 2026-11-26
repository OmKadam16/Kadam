// F5 step 6 (D-41): runtime data in a real browser, against a mock API.
import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

const PRODUCTS = [
  { name: "Lamp", category: "lighting", price: 40, link: "https://example.com/lamp", inStock: true },
  { name: "Desk", category: "furniture", price: 250, link: "https://example.com/desk", inStock: true },
  { name: "Chair", category: "furniture", price: 120, link: "/chair", inStock: false },
  { name: "Shelf", category: "furniture", price: 90, link: "https://example.com/shelf", inStock: true },
];
const MORE = [
  ...PRODUCTS,
  { name: "Sconce", category: "lighting", price: 75, link: "https://example.com/sconce", inStock: true },
  { name: "Stool", category: "furniture", price: 60, link: "https://example.com/stool", inStock: true },
];

async function open(page, api, query = "") {
  const shop = await serve("shop", { csp: true, api });
  const errors = [];
  page.on("console", (message) => {
    // Resource 404s (favicon.ico) and the mocked 500 are not script errors.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${shop.origin}/${query}`);
  return { shop, errors };
}
const close = (shop) => new Promise((resolve) => {
  shop.server.close(resolve);
  shop.server.closeAllConnections();
});
const cards = (page) => page.locator(".kdm-kind-card h2");

test.describe("runtime data", () => {
  test("loads, filters, sorts, and fills cards with text only", async ({ page }) => {
    // Long enough that the loading state is still up when the page has rendered, even on a busy machine.
    const { shop, errors } = await open(page, () => ({ body: PRODUCTS, delay: 1500 }));
    await expect(page.getByText("Loading products...")).toBeVisible();
    await expect(page.locator(".kdm-home-catalog, [data-kdm-id='home-catalog']").first()).toHaveAttribute("aria-busy", "true");
    await expect(cards(page)).toHaveText(["Desk", "Shelf", "Lamp"]);
    await expect(page.getByText("Loading products...")).toBeHidden();
    await expect(page.getByText("250 USD")).toBeVisible();
    await expect(page.getByRole("link", { name: "View Desk" })).toHaveAttribute("href", "https://example.com/desk");
    await expect(page.locator("[aria-busy]")).toHaveCount(0);
    await expect(page.getByText("Nothing is in stock")).toBeHidden();
    await expect(page.getByText("could not be loaded")).toBeHidden();
    expect(errors).toEqual([]);
    await close(shop);
  });

  test("an empty list shows the empty state", async ({ page }) => {
    const { shop } = await open(page, () => ({ body: PRODUCTS.map((p) => ({ ...p, inStock: false })) }));
    await expect(page.getByText("Nothing is in stock right now.")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await close(shop);
  });

  for (const [label, answer] of [
    ["a server error", { status: 500, body: "oops" }],
    ["invalid JSON", { body: "[{" }],
    ["a wrong field type", { body: [{ ...PRODUCTS[0], price: "40" }] }],
    ["a missing field", { body: [{ name: "Lamp", price: 1, inStock: true }] }],
    ["a javascript: link", { body: [{ ...PRODUCTS[0], link: "javascript:alert(1)" }] }],
  ]) {
    test(`${label} shows the error state and no cards`, async ({ page }) => {
      const { shop, errors } = await open(page, () => answer);
      await expect(page.getByText("Products could not be loaded. Try again later.")).toBeVisible();
      await expect(cards(page)).toHaveCount(0);
      await expect(page.getByText("Loading products...")).toBeHidden();
      expect(errors).toEqual([]);
      await close(shop);
    });
  }

  test("HTML in data stays text", async ({ page }) => {
    const { shop } = await open(page, () => ({ body: [{ ...PRODUCTS[0], name: '<img src=x onerror="window.hacked=1">' }] }));
    await expect(cards(page)).toHaveText(['<img src=x onerror="window.hacked=1">']);
    expect(await page.evaluate(() => window.hacked)).toBeUndefined();
    expect(await page.locator(".kdm-kind-card img").count()).toBe(0);
    await close(shop);
  });

  test("reload loads again, and a slow old response never wins", async ({ page }) => {
    // Request 1 is slow and stale; request 2 answers at once.
    const { shop } = await open(page, (_, count) =>
      count === 1 ? { body: [PRODUCTS[0]], delay: 1200 } : { body: [PRODUCTS[1], PRODUCTS[3]] },
    );
    await page.getByRole("button", { name: "Reload products" }).click();
    await expect(cards(page)).toHaveText(["Desk", "Shelf"]);
    await page.waitForTimeout(1500);
    await expect(cards(page)).toHaveText(["Desk", "Shelf"]);
    // Keyboard reload replaces the cards instead of adding to them.
    await page.getByRole("button", { name: "Reload products" }).focus();
    await page.keyboard.press("Enter");
    await expect(cards(page)).toHaveText(["Desk", "Shelf"]);
    await close(shop);
  });
});

test.describe("state kept in the address", () => {
  test("category buttons filter without loading again, and the address follows", async ({ page }) => {
    let calls = 0;
    const { shop, errors } = await open(page, () => {
      calls += 1;
      return { body: MORE };
    });
    // Five in stock, three per page, most expensive first.
    await expect(cards(page)).toHaveText(["Desk", "Shelf", "Sconce"]);
    await page.getByRole("button", { name: "Lighting" }).click();
    await expect(cards(page)).toHaveText(["Sconce", "Lamp"]);
    await expect(page).toHaveURL(/\?category=lighting$/);
    await page.getByRole("button", { name: "All" }).click();
    await expect(cards(page)).toHaveText(["Desk", "Shelf", "Sconce"]);
    await expect(page).toHaveURL(new RegExp(`${shop.origin}/$`));
    expect(calls).toBe(1);
    expect(errors).toEqual([]);
    await close(shop);
  });

  test("pages move through the list, and the address keeps the page", async ({ page }) => {
    const { shop } = await open(page, () => ({ body: MORE }));
    await expect(cards(page)).toHaveText(["Desk", "Shelf", "Sconce"]);
    await expect(page.locator("[data-kdm-id='home-pageLabel']")).toHaveText("1");
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(cards(page)).toHaveText(["Stool", "Lamp"]);
    await expect(page).toHaveURL(/\?page=2$/);
    await expect(page.locator("[data-kdm-id='home-pageLabel']")).toHaveText("2");
    await page.getByRole("button", { name: "First page" }).click();
    await expect(cards(page)).toHaveText(["Desk", "Shelf", "Sconce"]);
    await expect(page).toHaveURL(new RegExp(`${shop.origin}/$`));
    await close(shop);
  });

  test("opening an address restores its state; bad values fall back", async ({ page }) => {
    const { shop } = await open(page, () => ({ body: MORE }), "?category=lighting&page=1");
    await expect(cards(page)).toHaveText(["Sconce", "Lamp"]);
    await page.goto(`${shop.origin}/?page=2`);
    await expect(cards(page)).toHaveText(["Stool", "Lamp"]);
    await expect(page.locator("[data-kdm-id='home-pageLabel']")).toHaveText("2");
    // Past the last page there is nothing to show.
    await page.goto(`${shop.origin}/?category=furniture&page=2`);
    await expect(page.getByText("Nothing is in stock right now.")).toBeVisible();
    await page.goto(`${shop.origin}/?page=abc`);
    await expect(cards(page)).toHaveText(["Desk", "Shelf", "Sconce"]);
    await expect(page.locator("[data-kdm-id='home-pageLabel']")).toHaveText("1");
    await close(shop);
  });
});

test.describe("runtime data without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("shows the error state, not a loading message forever", async ({ page }) => {
    const shop = await serve("shop", { api: () => ({ body: PRODUCTS }) });
    await page.goto(shop.origin);
    await expect(page.getByText("Products could not be loaded. Try again later.")).toBeVisible();
    await expect(page.getByText("Loading products...")).toBeHidden();
    await expect(page.getByText("Nothing is in stock right now.")).toBeHidden();
    await close(shop);
  });
});
