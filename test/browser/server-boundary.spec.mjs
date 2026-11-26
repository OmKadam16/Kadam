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

/** Build the fixture (optionally with a changed module) and run its server. */
async function start(changeModule = (text) => text) {
  const project = mkdtempSync(join(tmpdir(), "kadam-server-project-"));
  cpSync(join(root, "test/fixtures/server-shop"), project, { recursive: true });
  const modulePath = join(project, "server/shop.kdm");
  writeFileSync(modulePath, changeModule(readFileSync(modulePath, "utf8")));
  const out = mkdtempSync(join(tmpdir(), "kadam-server-"));
  const build = spawnSync(process.execPath, [join(root, "dist/cli/main.js"), "build", project, "-o", out], { encoding: "utf8" });
  if (build.status !== 0) throw new Error(build.stdout + build.stderr);
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", join(out, "server/server.ts")], { env: { ...process.env, PORT: "0" } });
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
