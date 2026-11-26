// D-44 step 1: a page loads data from a Kadam server function, end to end:
// kadam build writes the site and the server, Node runs the generated server,
// and the browser talks only to it.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));
let TARGET = "typescript";

/** Build the fixture (optionally with a changed module) and run its server. */
async function start(changeModule = (text) => text, target = TARGET, extraArgs = []) {
  const project = mkdtempSync(join(tmpdir(), "kadam-server-project-"));
  cpSync(join(root, "test/fixtures/server-shop"), project, { recursive: true });
  const modulePath = join(project, "server/shop.kdm");
  writeFileSync(modulePath, changeModule(readFileSync(modulePath, "utf8")));
  const manifestPath = join(project, "kadam.json");
  writeFileSync(manifestPath, readFileSync(manifestPath, "utf8").replace('"target": "typescript"', `"target": "${target}"`));
  const out = mkdtempSync(join(tmpdir(), "kadam-server-"));
  const build = spawnSync(process.execPath, [join(root, "dist/cli/main.js"), "build", project, "-o", out, ...extraArgs], { encoding: "utf8" });
  if (build.status !== 0) throw new Error(build.stdout + build.stderr);
  const child = target === "python"
    ? spawn("python3", ["-u", join(out, "server/server.py")], { env: { ...process.env, PORT: "0" } })
    : spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", join(out, "server/server.ts")], { env: { ...process.env, PORT: "0" } });
  const origin = await new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /Kadam server: (http:\/\/[^/\s]+)/.exec(output);
      if (match) resolve(match[1]);
    });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("exit", () => reject(new Error(output)));
  });
  return { child, origin };
}

// Every test runs against both generated servers (D-44 step 4).
for (const target of ["typescript", "python"]) {
  test.describe(`${target} server`, () => {
    test.beforeEach(() => {
      TARGET = target;
    });
  test("the page shows records from the server function, filtered and sorted", async ({ page }) => {
    const { child, origin } = await start();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
    });
    const response = await page.goto(`${origin}/`);
    expect(response.headers()["content-security-policy"]).toContain("script-src 'self'");
    await expect(page.locator(".kdm-kind-card h2")).toHaveText(["Desk", "Shelf", "Lamp"]);
    await expect(page.getByText("250 USD")).toBeVisible();
    await expect(page.getByText("Loading products...")).toBeHidden();
    await expect(page.getByText("could not be loaded")).toBeHidden();

    // The server exposes only the called function and never its own files.
    const probe = await page.evaluate(async () => {
      const status = async (path, init) => (await fetch(path, init)).status;
      return {
        unknown: await status("/_kadam/secret"),
        post: await status("/_kadam/listProducts", { method: "POST" }),
        source: await status("/server/shop.ts"),
      };
    });
    expect(probe).toEqual({ unknown: 404, post: 405, source: 404 });
    expect(errors).toEqual([]);
    child.kill();
  });

  test("a failing server function shows the error state, and the server keeps running", async ({ page }) => {
    // Index 9 of a four-item list is a Kadam runtime failure.
    const { child, origin } = await start((text) => text.replace(/return \[(.*)\]\n/, "let all be [$1]\n        return [all[9]]\n"));
    let logged = "";
    child.stderr.on("data", (chunk) => { logged += chunk; });
    await page.goto(`${origin}/`);
    await expect(page.getByText("The products could not be loaded.")).toBeVisible();
    await expect(page.locator(".kdm-kind-card")).toHaveCount(0);
    const body = await page.evaluate(async () => (await fetch("/_kadam/listProducts")).text());
    expect(body).toBe('{"error":"the server function failed"}');
    await expect.poll(() => logged).toContain("the server function listProducts failed");
    child.kill();
  });

  // D-44 step 2: forms.

  test("a form sends a typed record to the server function and shows the sent state", async ({ page }) => {
    const { child, origin } = await start();
    let logged = "";
    child.stdout.on("data", (chunk) => { logged += chunk; });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/`);
    await expect(page.getByText("Thanks, you are signed up.")).toBeHidden();
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Seats").fill("3");
    await page.getByLabel("Plan").selectOption("Pro");
    await page.getByLabel("Send me news").check();
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Thanks, you are signed up.")).toBeVisible();
    await expect(page.getByText("Sorry, that did not work.")).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Thanks" })).toBeVisible();
    // The page stayed put and the form was cleared.
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByLabel("Email")).toHaveValue("");
    await expect.poll(() => logged).toContain("signup: ada@example.com (Pro)");
    // The number arrived as a number: seats * 2.
    await expect.poll(() => logged).toContain("signup: ada@example.com (Pro)\n6\n");
    // The browser's own checks still run first: an empty required field sends nothing.
    await page.getByRole("button", { name: "Sign up" }).click();
    expect(logged.match(/signup:/g)).toHaveLength(1);
    expect(errors).toEqual([]);
    child.kill();
  });

  test("a failing form function shows the failed state", async ({ page }) => {
    const { child, origin } = await start((text) => text.replace(/output "signup: "[^\n]*\n/, "let codes be [1]\n        output codes[5]\n"));
    await page.goto(`${origin}/`);
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Seats").fill("3");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("alert")).toHaveText("Sorry, that did not work. Try again.");
    await expect(page.getByText("Thanks, you are signed up.")).toBeHidden();
    child.kill();
  });

  test("under a base path, loads and forms reach the server", async ({ page }) => {
    const { child, origin } = await start((text) => text, TARGET, ["--base-path", "/shop"]);
    await page.goto(`${origin}/shop/`);
    await expect(page.locator(".kdm-kind-card h2")).toHaveText(["Desk", "Shelf", "Lamp"]);
    await page.getByLabel("Email").fill("base@example.com");
    await page.getByLabel("Seats").fill("2");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Thanks, you are signed up.")).toBeVisible();
    const outside = await page.evaluate(async () => [(await fetch("/_kadam/listProducts")).status, (await fetch("/index.html")).status]);
    expect(outside).toEqual([404, 404]);
    child.kill();
  });

  test("without JavaScript the form still sends, and the server shows the sent state", async ({ browser }) => {
    const { child, origin } = await start();
    let logged = "";
    child.stdout.on("data", (chunk) => { logged += chunk; });
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    await expect(page.getByText("Thanks, you are signed up.")).toBeHidden();
    await expect(page.getByText("Sorry, that did not work.")).toBeHidden();
    await page.getByLabel("Email").fill("grace@example.com");
    await page.getByLabel("Seats").fill("2");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Thanks, you are signed up.")).toBeVisible();
    await expect(page.getByText("Sorry, that did not work.")).toBeHidden();
    await expect.poll(() => logged).toContain("signup: grace@example.com (Free)\n4\n");
    await context.close();
    child.kill();
  });
  });
}
