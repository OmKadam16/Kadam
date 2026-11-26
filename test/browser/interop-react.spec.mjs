// F6 exit (D-43): Kadam web components inside a Vite + React TypeScript app.
// The app lives in test/interop/react-app with its own packages; run
// `npm install` there once. Without them this test is skipped, not failed.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const app = fileURLToPath(new URL("../interop/react-app", import.meta.url));
const installed = existsSync(join(app, "node_modules", "vite")) && existsSync(join(app, "node_modules", "@types", "react"));

test.skip(!installed, "run npm install in test/interop/react-app to enable the React interop test");

test.describe.configure({ timeout: 120_000 });

test("the React app type-checks, builds, and drives Kadam elements", async ({ page }) => {
  // Builds the elements with the Kadam CLI, runs tsc --strict with the real React types, then vite build.
  const build = spawnSync("npm", ["run", "build"], { cwd: app, encoding: "utf8" });
  expect(build.status, build.stdout + build.stderr).toBe(0);

  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://x").pathname;
    const file = join(app, "dist", path === "/" ? "index.html" : path);
    if (!file.startsWith(join(app, "dist")) || !existsSync(file)) return response.writeHead(404).end();
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "content-security-policy": "script-src 'self'" });
    response.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);

  const panel = page.locator("kadam-panel");
  await expect(panel.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await expect(page.getByText("React content in the slot")).toBeVisible();
  await expect(page.getByText("React footer")).toBeVisible();

  // React state flows into the element's attributes.
  await page.getByLabel("Panel title").fill("Typed in React");
  await expect(panel.getByRole("heading", { name: "Typed in React" })).toBeVisible();
  await page.getByRole("button", { name: "Toggle compact" }).click();
  await expect(panel.getByRole("heading", { level: 3, name: "Typed in React" })).toBeVisible();
  await page.getByRole("button", { name: "Toggle compact" }).click();

  // The element's event flows back into React through onpick.
  await panel.getByRole("button", { name: "Pick" }).click();
  await panel.getByRole("button", { name: "Pick" }).click();
  await expect(page.locator("#picks")).toHaveText("Picked 2 times");

  // A list of elements rendered by React from data.
  await expect(page.locator("kadam-product-card")).toHaveCount(2);
  await expect(page.locator("kadam-product-card").first().getByRole("link", { name: "View Lamp" })).toHaveAttribute("href", "https://example.com/lamp");
  await expect(page.locator("kadam-product-card").nth(1).getByText("250 USD")).toBeVisible();

  // Keyboard: the Pick button inside the shadow root is reachable and works.
  await panel.getByRole("button", { name: "Pick" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#picks")).toHaveText("Picked 3 times");
  expect(errors).toEqual([]);
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
});
