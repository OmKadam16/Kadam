// F6 (D-43): Kadam components as custom elements in a plain host page.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

import { compileWebComponents } from "../../dist/compiler/web-components.js";

const project = fileURLToPath(new URL("../fixtures/web-components", import.meta.url));

const HOST = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Host</title>
  <style>h2 { color: rgb(255, 0, 0); } p { font-size: 40px; }</style>
  <script type="module" src="/kadam-elements.js"></script>
</head>
<body>
  <h2 class="host-heading">Host heading</h2>
  <kadam-panel id="one" title="Hello">
    <p>Slotted body</p>
  </kadam-panel>
  <kadam-panel id="two" title="Second" variant="compact"></kadam-panel>
  <kadam-panel id="three" title="Third"><p slot="footer">Custom footer</p></kadam-panel>
</body>
</html>
`;

async function serve() {
  const result = compileWebComponents({ projectRoot: project });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));
  const files = new Map(result.files.map((file) => [`/${file.path}`, file.contents]));
  files.set("/", HOST);
  const server = createServer((request, response) => {
    const body = files.get(new URL(request.url, "http://x").pathname);
    if (body === undefined) return response.writeHead(404).end();
    response.writeHead(200, {
      "content-type": request.url.endsWith(".js") ? "text/javascript" : "text/html",
      "content-security-policy": "script-src 'self'",
    });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test("components work as custom elements, isolated from the host page", async ({ page }) => {
  const site = await serve();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });
  await page.goto(`${site.origin}/`);
  const one = page.locator("#one");

  // Attributes fill text; the host's h2 rule does not reach inside.
  await expect(one.getByRole("heading", { name: "Hello" })).toBeVisible();
  expect(await one.locator("h2").evaluate((node) => getComputedStyle(node).color)).not.toBe("rgb(255, 0, 0)");
  expect(await one.locator(".kdm-kind-card").evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(230, 244, 241)");
  await expect(one.getByRole("link", { name: "More about Hello" })).toHaveAttribute("href", "https://example.com");

  // The unnamed slot shows the children; the footer slot shows its fallback.
  await expect(page.getByText("Slotted body")).toBeVisible();
  await expect(one.getByText("Default footer")).toBeVisible();
  await expect(page.locator("#three").getByText("Custom footer")).toBeVisible();
  await expect(page.locator("#three").getByText("Default footer")).toBeHidden();

  // A variant attribute picks the variant.
  await expect(page.locator("#two").getByRole("heading", { level: 3, name: "Second" })).toBeVisible();

  // Changing an attribute re-renders; an unsafe url is dropped.
  await one.evaluate((node) => node.setAttribute("title", "Changed"));
  await expect(one.getByRole("heading", { name: "Changed" })).toBeVisible();
  await one.evaluate((node) => node.setAttribute("link", "javascript:alert(1)"));
  await expect(one.locator("a")).toHaveText("More about Changed");
  expect(await one.locator("a").getAttribute("href")).toBeNull();
  await one.evaluate((node) => node.setAttribute("title", "<img src=x onerror=alert(1)>"));
  await expect(one.locator("h2")).toHaveText("<img src=x onerror=alert(1)>");
  expect(await one.evaluate((node) => node.shadowRoot.querySelectorAll("img").length)).toBe(0);

  // tell the page dispatches a DOM event from the element.
  const picked = await page.evaluate(() => new Promise((resolve) => {
    document.addEventListener("pick", (event) => resolve(event.target.id), { once: true });
    document.querySelector("#one").shadowRoot.querySelector("button").click();
  }));
  expect(picked).toBe("one");
  await page.locator("#one").getByRole("button", { name: "Pick" }).focus();
  expect(errors).toEqual([]);
  await new Promise((resolve) => {
    site.server.close(resolve);
    site.server.closeAllConnections();
  });
});
