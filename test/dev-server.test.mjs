import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createDevServer } from "../dist/server/dev-server.js";
import { compileProject } from "../dist/compiler/project.js";
import {
  HOME_PAGE,
  standardProject,
  writeProjectFile,
} from "./helpers/dev-project.mjs";

async function startServer(t, projectRoot, options = {}) {
  const server = await createDevServer({
    projectRoot,
    host: "127.0.0.1",
    port: 0,
    openBrowser: false,
    watch: false,
    logger: () => {},
    ...options,
  });
  t.after(async () => {
    await server.close();
  });
  return server;
}

function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = options.headers ?? {};
    const requestOptions = {
      method: options.method ?? "GET",
      headers,
    };
    if (headers.host !== undefined) requestOptions.setHost = false;

    const req = request(url, requestOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          bytes,
          body: bytes.toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("request timed out")));
    req.end();
  });
}

function openSse(url) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { headers: { accept: "text/event-stream", connection: "keep-alive" } },
      (res) => {
        let buffer = "";
        const queue = [];
        let waiter = null;

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          let index;
          while ((index = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const event = parseEvent(frame);
            if (event === null) continue;
            if (waiter !== null) {
              const current = waiter;
              waiter = null;
              current(event);
            } else {
              queue.push(event);
            }
          }
        });
        res.on("error", () => {});

        resolve({
          nextEvent(timeoutMs = 5000) {
            if (queue.length > 0) return Promise.resolve(queue.shift());
            return new Promise((resolveEvent, rejectEvent) => {
              const timer = setTimeout(() => {
                waiter = null;
                rejectEvent(new Error("timed out waiting for an SSE event"));
              }, timeoutMs);
              waiter = (event) => {
                clearTimeout(timer);
                resolveEvent(event);
              };
            });
          },
          close() {
            req.destroy();
          },
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function parseEvent(frame) {
  let event = "message";
  let id;
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
    else if (line.startsWith("id:")) id = Number(line.slice(3).trim());
  }
  if (data === "") return null;
  return { event, id, data: JSON.parse(data) };
}

test("serves every route, stylesheet, and asset with correct MIME types", async (t) => {
  const projectRoot = standardProject();
  writeFileSync(join(projectRoot, ".env"), "SECRET_TOKEN=do-not-leak\n", "utf8");
  const server = await startServer(t, projectRoot);

  const home = await httpGet(`${server.origin}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers["content-type"], /text\/html/);
  assert.match(home.body, /<title>Home<\/title>/);
  assert.equal(home.body.match(/__kadam\/client\.js/g)?.length, 1);

  const about = await httpGet(`${server.origin}/about/`);
  assert.equal(about.status, 200);
  assert.match(about.body, /<title>About<\/title>/);
  assert.match(about.body, /href="\/"/);

  const redirect = await httpGet(`${server.origin}/about`);
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, "/about/");

  const css = await httpGet(`${server.origin}/assets/kadam.home.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers["content-type"], /text\/css/);
  assert.match(css.body, /body \{/);

  const head = await httpGet(`${server.origin}/`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.bytes.length, 0);
  assert.ok(Number(head.headers["content-length"]) > 0);
});

test("development HTML matches build output apart from the client tag", async (t) => {
  const projectRoot = standardProject();
  const built = compileProject({ projectRoot });
  assert.equal(built.ok, true);
  const expected = built.files.find((file) => file.path === "index.html");
  assert.equal(typeof expected.contents, "string");

  const server = await startServer(t, projectRoot);
  const served = await httpGet(`${server.origin}/`);
  assert.equal(
    served.body.replace(
      '<script src="/__kadam/client.js" defer></script>\n',
      "",
    ),
    expected.contents,
  );
});

test("the studio map is build-bound and exposes project-relative spans", async (t) => {
  const projectRoot = standardProject();
  const server = await startServer(t, projectRoot);

  const response = await httpGet(`${server.origin}/__kadam/studio-map?buildId=1`);
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.equal(response.headers["cache-control"], "no-store");

  const map = JSON.parse(response.body);
  assert.equal(map.buildId, 1);
  assert.equal(map.pages.length, 2);
  const home = map.pages.find((page) => page.route === "/");
  assert.equal(home.sourceFile, "pages/home.kdm");
  assert.equal(home.elements[0].nodeId, "home-headline1");
  assert.equal(home.elements[0].span.start.line, 4);
  assert.equal(home.elements[0].nameSpan.start.column, 5);
  assert.ok(!response.body.includes(projectRoot));

  const stale = await httpGet(`${server.origin}/__kadam/studio-map?buildId=99`);
  assert.equal(stale.status, 409);
  assert.equal(JSON.parse(stale.body).buildId, 1);

  const head = await httpGet(`${server.origin}/__kadam/studio-map`, {
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(head.bytes.length, 0);
  assert.ok(Number(head.headers["content-length"]) > 0);
});

test("sources, manifests, environment files, and traversal are not exposed", async (t) => {
  const projectRoot = standardProject();
  writeFileSync(join(projectRoot, ".env"), "SECRET_TOKEN=do-not-leak\n", "utf8");
  const server = await startServer(t, projectRoot);

  for (const path of [
    "/kadam.json",
    "/pages/home.kdm",
    "/.env",
    "/node_modules/pkg/index.js",
    "/../kadam.json",
    "/%2e%2e/kadam.json",
    "/assets/%2e%2e/../kadam.json",
  ]) {
    const response = await httpGet(`${server.origin}${path}`);
    assert.ok(
      response.status === 400 || response.status === 404,
      `${path} returned ${response.status}`,
    );
    assert.doesNotMatch(response.body, /SECRET_TOKEN/);
    assert.doesNotMatch(response.body, /"pages"/);
  }
});

test("foreign Host headers are rejected and non-GET methods are not served", async (t) => {
  const projectRoot = standardProject();
  const server = await startServer(t, projectRoot);

  const forbidden = await httpGet(`${server.origin}/`, {
    headers: { host: "evil.example" },
  });
  assert.equal(forbidden.status, 403);

  const loopback = await httpGet(`${server.origin}/`, {
    headers: { host: `127.0.0.1:${server.port}` },
  });
  assert.equal(loopback.status, 200);

  const posted = await httpGet(`${server.origin}/`, { method: "POST" });
  assert.equal(posted.status, 405);
  assert.equal(posted.headers.allow, "GET, HEAD");
});

test("SSE reports status and reloads after an HTML edit", async (t) => {
  const projectRoot = standardProject();
  const server = await startServer(t, projectRoot);
  const sse = await openSse(`${server.origin}/__kadam/events`);
  t.after(() => sse.close());

  const initial = await sse.nextEvent();
  assert.equal(initial.event, "status");
  assert.equal(initial.data.phase, "success");
  assert.equal(initial.data.served, "current");
  assert.equal(initial.data.buildId, 1);

  writeProjectFile(
    projectRoot,
    "pages/home.kdm",
    HOME_PAGE.replace('"Home page"', '"Home page updated"'),
  );
  await server.rebuild();

  const status = await sse.nextEvent();
  const reload = await sse.nextEvent();
  assert.equal(status.event, "status");
  assert.equal(status.data.buildId, 2);
  assert.equal(reload.event, "reload");
  assert.equal(reload.data.reason, "html");

  const page = await httpGet(`${server.origin}/`);
  assert.match(page.body, /Home page updated/);
});

test("a style-only edit sends a CSS event and leaves HTML byte-identical", async (t) => {
  const projectRoot = standardProject();
  const server = await startServer(t, projectRoot);
  const sse = await openSse(`${server.origin}/__kadam/events`);
  t.after(() => sse.close());
  await sse.nextEvent();

  const before = (await httpGet(`${server.origin}/`)).body;

  writeProjectFile(
    projectRoot,
    "pages/home.kdm",
    HOME_PAGE.replace("the text is 40px", "the text is 44px"),
  );
  await server.rebuild();

  const status = await sse.nextEvent();
  const css = await sse.nextEvent();
  assert.equal(status.event, "status");
  assert.equal(status.data.changed, "css");
  assert.equal(css.event, "css");
  assert.deepEqual(css.data.hrefs, ["/assets/kadam.home.css"]);

  const after = (await httpGet(`${server.origin}/`)).body;
  assert.equal(after, before);
  const stylesheet = await httpGet(`${server.origin}/assets/kadam.home.css`);
  assert.match(stylesheet.body, /font-size: 44px;/);
});

test("a failed build keeps serving the last good page and recovery reloads", async (t) => {
  const projectRoot = standardProject();
  const server = await startServer(t, projectRoot);
  const sse = await openSse(`${server.origin}/__kadam/events`);
  t.after(() => sse.close());
  await sse.nextEvent();

  const good = (await httpGet(`${server.origin}/`)).body;

  writeProjectFile(
    projectRoot,
    "pages/home.kdm",
    `kadam 0.1

page "Home" {
    headline1 {
        a main heading
    }
}
`,
  );
  await server.rebuild();

  const failure = await sse.nextEvent();
  assert.equal(failure.event, "status");
  assert.equal(failure.data.phase, "failure");
  assert.equal(failure.data.served, "last-success");
  assert.equal(failure.data.diagnostics[0].code, "KDM3009");

  const during = await httpGet(`${server.origin}/`);
  assert.equal(during.status, 200);
  assert.equal(during.body, good);

  writeProjectFile(
    projectRoot,
    "pages/home.kdm",
    HOME_PAGE.replace('"Home page"', '"Home page fixed"'),
  );
  await server.rebuild();

  const recovered = await sse.nextEvent();
  const reload = await sse.nextEvent();
  assert.equal(recovered.data.phase, "success");
  assert.equal(recovered.data.served, "current");
  assert.equal(reload.event, "reload");
  assert.match((await httpGet(`${server.origin}/`)).body, /Home page fixed/);
});

test("an initial build failure serves the overlay shell and recovers", async (t) => {
  const projectRoot = standardProject();
  writeProjectFile(
    projectRoot,
    "pages/home.kdm",
    `kadam 0.1

page "Home" {
    broken1 {
        a button
    }
}
`,
  );

  const server = await startServer(t, projectRoot);
  const failed = await httpGet(`${server.origin}/`);
  assert.equal(failed.status, 503);
  assert.match(failed.body, /__kadam\/client\.js/);

  const status = JSON.parse(
    (await httpGet(`${server.origin}/__kadam/status`)).body,
  );
  assert.equal(status.phase, "failure");
  assert.equal(status.served, "none");

  const missingMap = await httpGet(`${server.origin}/__kadam/studio-map`);
  assert.equal(missingMap.status, 503);

  writeProjectFile(projectRoot, "pages/home.kdm", HOME_PAGE);
  await server.rebuild();
  const recovered = await httpGet(`${server.origin}/`);
  assert.equal(recovered.status, 200);
  assert.match(recovered.body, /<title>Home<\/title>/);

  const recoveredMap = await httpGet(`${server.origin}/__kadam/studio-map`);
  assert.equal(recoveredMap.status, 200);
  assert.equal(JSON.parse(recoveredMap.body).buildId, 1);
});

test("basePath prefixes pages and navigation while internal endpoints stay at the origin", async (t) => {
  const projectRoot = standardProject({ basePath: "/site" });
  const server = await startServer(t, projectRoot);

  assert.ok(server.url.endsWith("/site/"));

  const rootRedirect = await httpGet(`${server.origin}/`);
  assert.equal(rootRedirect.status, 301);
  assert.equal(rootRedirect.headers.location, "/site/");

  const home = await httpGet(`${server.origin}/site/`);
  assert.equal(home.status, 200);
  assert.match(home.body, /href="\/site\/about\/"/);
  assert.match(home.body, /href="\/site\/assets\/kadam\.css"/);

  const about = await httpGet(`${server.origin}/site/about/`);
  assert.equal(about.status, 200);

  assert.equal((await httpGet(`${server.origin}/about/`)).status, 404);
  assert.equal(
    (await httpGet(`${server.origin}/__kadam/status`)).status,
    200,
  );
});

test("port conflicts are reported and default ports advance", async (t) => {
  const projectRoot = standardProject();
  const first = await startServer(t, projectRoot);

  await assert.rejects(
    () =>
      createDevServer({
        projectRoot,
        port: first.port,
        strictPort: true,
        openBrowser: false,
        watch: false,
        logger: () => {},
      }),
    (error) => {
      assert.equal(error.code, "EADDRINUSE");
      return true;
    },
  );

  const second = await createDevServer({
    projectRoot,
    port: first.port,
    strictPort: false,
    openBrowser: false,
    watch: false,
    logger: () => {},
  });
  t.after(async () => {
    await second.close();
  });
  assert.notEqual(second.port, first.port);
  assert.equal(second.getStatus().phase, "success");
});

test("shutdown is graceful, idempotent, and releases the port", async (t) => {
  const projectRoot = standardProject();
  const server = await createDevServer({
    projectRoot,
    port: 0,
    openBrowser: false,
    watch: false,
    logger: () => {},
  });
  const port = server.port;
  const sse = await openSse(`${server.origin}/__kadam/events`);
  await sse.nextEvent();

  await server.close();
  const shutdown = await sse.nextEvent();
  assert.equal(shutdown.event, "shutdown");
  sse.close();

  await server.closed;
  await server.close();

  const replacement = await createDevServer({
    projectRoot,
    port,
    strictPort: true,
    openBrowser: false,
    watch: false,
    logger: () => {},
  });
  t.after(async () => {
    await replacement.close();
  });
  assert.equal(replacement.port, port);
});
