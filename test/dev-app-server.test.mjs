import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDevServer } from "../dist/server/dev-server.js";

// D-44 step 3: kadam dev runs the server module and sends /_kadam/ requests to it.

function copyFixture(target = "typescript") {
  const root = mkdtempSync(join(tmpdir(), "kadam-dev-app-"));
  cpSync("test/fixtures/server-shop", root, { recursive: true });
  const manifest = join(root, "kadam.json");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"target": "typescript"', `"target": "${target}"`));
  return root;
}

async function start(t, root) {
  const lines = [];
  const server = await createDevServer({ projectRoot: root, host: "127.0.0.1", port: 0, openBrowser: false, watch: false, logger: (line) => lines.push(line) });
  t.after(() => server.close());
  return { server, lines };
}

const names = async (origin) => (await (await fetch(`${origin}/_kadam/listProducts`)).json()).map((product) => product.name);

test("kadam dev answers server loads and forms through the generated server", async (t) => {
  const { server, lines } = await start(t, copyFixture());
  assert.deepEqual(await names(server.origin), ["Lamp", "Desk", "Chair", "Shelf"]);
  const sent = await fetch(`${server.origin}/_kadam/signUp?form=home-signupForm`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-kadam": "1", origin: server.origin },
    body: "address=dev%40example.com&plan=Pro",
  });
  assert.equal(sent.status, 200);
  assert.deepEqual(await sent.json(), { ok: true });
  // The other site check sees the dev server's own host.
  const foreign = await fetch(`${server.origin}/_kadam/signUp?form=home-signupForm`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" }, body: "address=x&plan=y",
  });
  assert.equal(foreign.status, 403);
  // Server output is logged, and the server's own files are not served as the site.
  for (let i = 0; i < 50 && !lines.some((line) => line.includes("signup: dev@example.com (Pro)")); i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.ok(lines.includes("[server] signup: dev@example.com (Pro)"), lines.join("\n"));
  assert.equal((await fetch(`${server.origin}/server/server.ts`)).status, 404);
  assert.equal((await fetch(`${server.origin}/`)).status, 200);
});

test("editing the server module restarts the server with the new code", async (t) => {
  const root = copyFixture();
  const { server } = await start(t, root);
  assert.equal((await names(server.origin))[0], "Lamp");
  const module = join(root, "server", "shop.kdm");
  writeFileSync(module, readFileSync(module, "utf8").replace('name: "Lamp"', 'name: "Torch"'));
  const outcome = server.rebuild();
  assert.equal(outcome.ok, true);
  assert.equal((await names(server.origin))[0], "Torch");
  // A broken module keeps the last good server running and reports the error.
  writeFileSync(module, readFileSync(module, "utf8").replace("price as number", "price as money"));
  const broken = server.rebuild();
  assert.equal(broken.ok, false);
  assert.ok(broken.diagnostics.some((d) => d.code.startsWith("KDM5")));
  assert.equal((await names(server.origin))[0], "Torch");
});

test("a project without a server module answers /_kadam/ with 503", async (t) => {
  const { server } = await start(t, "examples/reference/shop");
  const answer = await fetch(`${server.origin}/_kadam/listProducts`);
  assert.equal(answer.status, 503);
});

test("the server module is watched as an input", async (t) => {
  const { server } = await start(t, copyFixture());
  void server;
  const { DevSession } = await import("../dist/server/dev-session.js");
  const session = new DevSession({ projectRoot: "test/fixtures/server-shop" });
  session.build();
  assert.ok(session.watchPaths.includes("server/shop.kdm"));
  assert.ok(!session.watchPaths.some((path) => path.startsWith("server/") && path.endsWith(".ts")));
  assert.ok(!session.snapshot.files.has("server/server.ts"));
});

test("kadam dev runs a python server module the same way", async (t) => {
  const root = copyFixture("python");
  const { server, lines } = await start(t, root);
  assert.deepEqual(await names(server.origin), ["Lamp", "Desk", "Chair", "Shelf"]);
  const sent = await fetch(`${server.origin}/_kadam/signUp?form=home-signupForm`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-kadam": "1", origin: server.origin },
    body: "address=py%40example.com&plan=Free&news=on",
  });
  assert.deepEqual(await sent.json(), { ok: true });
  for (let i = 0; i < 50 && !lines.includes("[server] signup: py@example.com (Free)"); i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.ok(lines.includes("[server] signup: py@example.com (Free)"), lines.join("\n"));
  const module = join(root, "server", "shop.kdm");
  writeFileSync(module, readFileSync(module, "utf8").replace('name: "Lamp"', 'name: "Torch"'));
  assert.equal(server.rebuild().ok, true);
  assert.equal((await names(server.origin))[0], "Torch");
});
