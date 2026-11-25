import { createServer } from "node:http";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

import { compileProject } from "../../dist/compiler/project.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain" };

/** Compile a reference project in memory and serve it on a free port. */
export async function serve(name, { csp = false } = {}) {
  const result = compileProject({ projectRoot: `${root}examples/reference/${name}` });
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join("\n"));
  const files = new Map(result.files.map((file) => [`/${file.path}`, file.contents]));
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://x").pathname;
    const key = files.has(path) ? path : `${path.replace(/\/$/, "")}/index.html`;
    const body = files.get(key);
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    // With csp, a strict policy: the runtime must work without inline scripts or eval (D-36).
    response.writeHead(200, {
      "content-type": TYPES[extname(key)] ?? "application/octet-stream",
      ...(csp ? { "content-security-policy": "script-src 'self'" } : {}),
    });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const routes = result.files
    .filter((file) => file.path.endsWith("index.html"))
    .map((file) => `/${file.path.replace(/index\.html$/, "")}`)
    .sort();
  return { server, origin: `http://127.0.0.1:${server.address().port}`, routes };
}

