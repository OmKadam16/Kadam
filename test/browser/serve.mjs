import { createServer } from "node:http";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

import { compileProject } from "../../dist/compiler/project.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain" };

/** Compile a reference project in memory and serve it on a free port. */
/**
 * `api(path, count)` (kadam 0.3, D-41) answers /api/ requests: it returns
 * { status, body, delay } or undefined for a 404. `count` is the request number.
 */
/**
 * `host` (F6, D-43) builds fragments and serves `host` at /, with the first
 * fragment's head tags at <!--head--> and its markup at <!--fragment-->.
 */
export async function serve(name, { csp = false, api = null, port = 0, host = null } = {}) {
  let requests = 0;
  // An absolute path serves that project instead of a reference one.
  const result = compileProject({ projectRoot: name.startsWith("/") ? name : `${root}examples/reference/${name}`, fragment: host !== null });
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join("\n"));
  const files = new Map(result.files.map((file) => [`/${file.path}`, file.contents]));
  if (host !== null) {
    const fragment = String(result.files.find((file) => file.path.startsWith("fragments/")).contents);
    const tags = fragment.split("-->")[0].split("\n").slice(2).map((line) => line.trim()).filter(Boolean).join("\n");
    files.set("/index.html", host.replace("<!--head-->", tags).replace("<!--fragment-->", fragment.split("-->\n")[1]));
  }
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://x").pathname;
    if (api !== null && path.startsWith("/api/")) {
      requests += 1;
      const answer = await api(path, requests);
      if (answer === undefined) {
        response.writeHead(404).end();
        return;
      }
      if (answer.delay) await new Promise((resolve) => setTimeout(resolve, answer.delay));
      response.writeHead(answer.status ?? 200, { "content-type": "application/json" });
      response.end(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body));
      return;
    }
    const key = files.has(path) ? path : `${path.replace(/\/$/, "")}/index.html`;
    const body = files.get(key);
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    // With csp, a strict policy: the runtime must work without inline scripts or eval (D-36).
    response.writeHead(200, {
      "content-type": TYPES[extname(key)] ?? "application/octet-stream",
      ...(csp ? { "content-security-policy": "script-src 'self'; connect-src 'self'" } : {}),
    });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const routes = result.files
    .filter((file) => file.path.endsWith("index.html"))
    .map((file) => `/${file.path.replace(/index\.html$/, "")}`)
    .sort();
  return { server, origin: `http://127.0.0.1:${server.address().port}`, routes };
}

