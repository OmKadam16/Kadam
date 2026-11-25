# Server module

Development-only HTTP server and live-reload transport. It composes the
compiler and a file watcher; it contains no language rules and writes no build
output.

## Responsibilities

- Serve the manifest routes, generated CSS, and referenced assets from an
  immutable in-memory snapshot produced by `compileProject`.
- Watch manifest, page, and asset files; debounce and coalesce changes.
- Stream build status, CSS updates, reloads, and shutdown over Server-Sent
  Events.
- Preserve the last successful snapshot when a rebuild fails.
- Serve a development-only element-to-source map keyed by build id.
- Accept in-memory source overrides for unsaved previews without writing files.
- Bind to `127.0.0.1` by default and resolve requests only against the snapshot.
- Serve the development client, which renders a diagnostic overlay using DOM
  text nodes only.

## Module map

```text
dev-server.ts    lifecycle, HTTP routing, SSE hub, security headers
dev-session.ts   compileProject wrapper, last-good snapshot, build ids,
                 studio source map
watch.ts         recursive fs.watch + polling fallback, filtering, debounce
update-plan.ts   pure snapshot hash and none/css/reload decision
request.ts       pure URL resolution, MIME table, injection, static documents
client/          browser client and overlay stylesheet as string modules
```

## Entry points

```ts
import { createDevServer } from "./index.js";

const server = await createDevServer({ projectRoot: "./MyWebsite" });
console.log(server.url);
await server.closed;
```

`createDevServer` compiles once before listening. `server.rebuild()` recompiles
and broadcasts; tests use it to avoid watcher timing. `server.close()` is
idempotent. `GET /__kadam/studio-map` returns the current build's
project-relative source map; an optional `buildId` query must match the current
build (`409` otherwise).

`DevSession.setSourceOverrides(map)` replaces the in-memory source overlay for
subsequent builds; `clearSourceOverrides()` returns to disk sources. Overrides
never write to disk and keep the last successful snapshot when they fail.

## Security invariants

- A request path is never passed to the filesystem. The server looks it up in
  the snapshot map.
- Only generated HTML, generated CSS, and referenced assets exist in the
  snapshot. Manifest, `.kdm`, `.env`, dotfiles, source maps, and
  `node_modules` therefore 404 by construction.
- `Host` must be loopback or the explicitly bound host; remote binding is an
  opt-in `--host`.
- GET and HEAD only; strict CSP, `no-store`, and `nosniff` on every response.
- Traversal encodings, NUL bytes, backslashes, and malformed encoding are
  rejected before lookup.
- Diagnostics sent to the browser contain project-relative paths and messages
  only; source excerpts stay in the local terminal.

## Testing

- `test/dev-request.test.mjs` — pure resolver, MIME, injection.
- `test/dev-update.test.mjs` — pure update planning.
- `test/dev-session.test.mjs` — last-good snapshots, diagnostics, source-map
  retention, and in-memory source overrides.
- `test/dev-server.test.mjs` — HTTP, SSE, security, shutdown, ports, and the
  studio map endpoint.
- `test/dev-cli.test.mjs` — `kadam dev` and `kadam check` end to end.
- `test/dev-performance.test.mjs` — 50-page rebuild measurement.

The module docs live in `docs/dev-server.md`.
