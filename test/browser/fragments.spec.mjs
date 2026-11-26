// F6 (D-43): a Kadam fragment inside an existing page.
import { expect, test } from "@playwright/test";

import { serve } from "./serve.mjs";

const HOST = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Host shop</title>
  <style>
    body { background: rgb(20, 20, 20); color: rgb(240, 240, 240); margin: 40px; font-family: serif; }
    .host-box { width: 100px; padding: 10px; border: 5px solid; }
  </style>
  <!--head-->
</head>
<body>
  <h1 class="host-title">The host page</h1>
  <div class="host-box">Host box</div>
  <button class="host-button">Host button</button>
  <section id="kadam-here"><!--fragment--></section>
</body>
</html>
`;

const PRODUCTS = [
  { name: "Lamp", category: "lighting", price: 40, link: "https://example.com/lamp", inStock: true },
  { name: "Desk", category: "furniture", price: 250, link: "https://example.com/desk", inStock: true },
];

test("a fragment works inside a host page and leaves the host's styles alone", async ({ page }) => {
  const site = await serve("shop", { csp: true, host: HOST, api: () => ({ body: PRODUCTS }) });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });
  await page.goto(`${site.origin}/`);

  // Kadam works: data loads into cards, and the filter buttons run.
  await expect(page.locator(".kdm-kind-card h2")).toHaveText(["Desk", "Lamp"]);
  await page.getByRole("button", { name: "Lighting" }).click();
  await expect(page.locator(".kdm-kind-card h2")).toHaveText(["Lamp"]);

  // The host keeps its own page background, margin, font and box model.
  const host = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const box = document.querySelector(".host-box");
    return {
      background: body.backgroundColor,
      margin: body.margin,
      font: body.fontFamily,
      boxWidth: box.getBoundingClientRect().width,
      titleColor: getComputedStyle(document.querySelector(".host-title")).color,
    };
  });
  expect(host).toEqual({ background: "rgb(20, 20, 20)", margin: "40px", font: "serif", boxWidth: 130, titleColor: "rgb(240, 240, 240)" });

  // The page background and text color from the Kadam page apply to the fragment only.
  const wrapper = page.locator(".kdm-fragment");
  expect(await wrapper.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(249, 250, 251)");
  expect(errors).toEqual([]);
  await new Promise((resolve) => {
    site.server.close(resolve);
    site.server.closeAllConnections();
  });
});
