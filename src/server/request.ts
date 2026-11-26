import { escapeAttribute, escapeText } from "../compiler/emit-html.js";
import { normalizeBasePath, routeUrl } from "../compiler/routes.js";

/** Origin-root prefix for development-only endpoints. Never under basePath. */
export const DEV_PREFIX = "/__kadam";

const MIME_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  woff: "font/woff",
  woff2: "font/woff2",
};

export function contentTypeFor(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return null;
  return MIME_TYPES[path.slice(dot + 1).toLowerCase()] ?? null;
}

export type ResolvedRequest =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "redirect"; readonly location: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "bad-request" };

/**
 * Resolve a URL path to an entry in the compiled output snapshot.
 *
 * This function never touches the filesystem. Traversal is therefore a pure
 * validation problem: a path can only name something the compiler emitted.
 */
export function resolveRequestPath(
  requestPath: string,
  basePath: string,
  files: ReadonlySet<string>,
): ResolvedRequest {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return { kind: "bad-request" };
  }

  if (decoded.includes("\0") || decoded.includes("\\")) {
    return { kind: "bad-request" };
  }

  const base = normalizeBasePath(basePath);
  if (base !== "") {
    if (decoded === "/") return { kind: "redirect", location: `${base}/` };
    if (decoded === base) return { kind: "redirect", location: `${base}/` };
    if (!decoded.startsWith(`${base}/`)) return { kind: "not-found" };
    decoded = decoded.slice(base.length);
    if (decoded === "") decoded = "/";
  }

  const segments = decoded
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) return { kind: "bad-request" };

  const joined = segments.join("/");
  if (joined === "") {
    return files.has("index.html")
      ? { kind: "file", path: "index.html" }
      : { kind: "not-found" };
  }

  const withIndex = `${joined}/index.html`;
  if (files.has(withIndex)) {
    if (!decoded.endsWith("/")) {
      return { kind: "redirect", location: `${base}/${joined}/` };
    }
    return { kind: "file", path: withIndex };
  }

  if (files.has(joined)) return { kind: "file", path: joined };

  return { kind: "not-found" };
}

/** Inject exactly one development client tag without mutating compiler output. */
export function injectClientScript(html: string): string {
  const tag = `<script src="${DEV_PREFIX}/client.js" defer></script>`;
  const index = html.lastIndexOf("</body>");
  if (index === -1) return `${html}${html.endsWith("\n") ? "" : "\n"}${tag}\n`;
  return `${html.slice(0, index)}${tag}\n${html.slice(index)}`;
}

export interface RouteSummary {
  readonly route: string;
  readonly title: string;
}

/** Minimal, injection-free 404 document. */
export function renderNotFound(
  routes: readonly RouteSummary[],
  basePath: string,
): string {
  const items = routes
    .map(
      (route) =>
        `    <li><a href="${escapeAttribute(
          routeUrl(route.route, basePath),
        )}">${escapeText(route.title)}</a></li>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>404 — Kadam dev server</title>
  <link rel="stylesheet" href="${DEV_PREFIX}/client.css">
</head>
<body>
  <main class="kadam-static">
    <h1>Not found</h1>
    <p>No generated page or asset matches this URL.</p>
    <ul>
${items}
    </ul>
  </main>
</body>
</html>
`;
}

/** Shell served when the initial build failed and there is no preview yet. */
export function renderErrorShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kadam — build failed</title>
  <link rel="stylesheet" href="${DEV_PREFIX}/client.css">
</head>
<body>
  <main class="kadam-static">
    <h1>No successful build yet</h1>
    <p>Fix the errors shown below; the preview appears automatically.</p>
  </main>
  <script src="${DEV_PREFIX}/client.js" defer></script>
</body>
</html>
`;
}

/**
 * F7: in development only, a page runtime keeps its state across live
 * reloads. Right after the runtime creates its state, it takes back the
 * values saved before the reload (same keys, same types); the dev client
 * asks it to save them just before reloading. Build output is unchanged.
 */
export function injectStateKeeper(js: string): string {
  const marker = /^const state = new Map\(.*\);$/m;
  const found = marker.exec(js);
  if (found === null) return js;
  const keeper = [
    found[0],
    "// kadam dev: keep state across live reloads.",
    'const kadamDevKey = "kadam-dev-state:" + location.pathname;',
    "try {",
    "  const saved = JSON.parse(sessionStorage.getItem(kadamDevKey) || \"null\");",
    "  sessionStorage.removeItem(kadamDevKey);",
    "  if (Array.isArray(saved)) for (const [key, value] of saved) if (state.has(key) && typeof value === typeof state.get(key)) state.set(key, value);",
    "} catch {}",
    'addEventListener("kadam:before-reload", () => {',
    "  try { sessionStorage.setItem(kadamDevKey, JSON.stringify([...state])); } catch {}",
    "});",
  ].join("\n");
  return js.replace(found[0], keeper);
}
