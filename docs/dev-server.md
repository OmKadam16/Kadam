# Kadam Development Server — M4 Architecture

**Status:** Implemented (D-17) — verified end-to-end in a real browser
**Implementation:** `src/server/`, `src/cli/dev-command.ts`, `src/cli/check-command.ts`
**Applies to:** implementation 0.1 / language 0.1
**Depends on:** M0–M3 (implemented; full suite green at M4 completion)
**Companion documents:** `docs/architecture.md`, `docs/roadmap.md`,
`docs/decisions.md`, `docs/project-manifest.md`

This document specifies `kadam dev`: a local server that compiles a Kadam
project in memory, serves the result, watches source and assets, and pushes
updates to a real browser. It is implemented in `src/server/`; this document
records the approved design, with implementation differences noted below.

---

## 1. What the current code already gives us

The server must be an adapter over the existing compiler, not a second
pipeline. These are the actual entry points it will use.

| Existing API | Location | What the server uses it for |
| --- | --- | --- |
| `compileProject(options): ProjectCompileResult` | `src/compiler/project.ts` | The only compilation call. Returns an in-memory output snapshot. |
| `ProjectCompileResult.files` | `src/compiler/project.ts` | `OutputFile[]` — `{ path, contents, kind }` for every HTML page, both CSS files per page, and each referenced asset. This *is* the serveable site. |
| `ProjectCompileResult.diagnostics` | `src/compiler/project.ts` | Overlay and terminal errors. |
| `ProjectCompileResult.sources` | `src/compiler/project.ts` | `SourceFile[]` for `formatDiagnostics`, including line excerpts. |
| `ProjectCompileResult.manifest` | `src/compiler/project.ts` | Route list for the 404 page; page source list for watching. |
| `ProjectCompileResult.pages` | `src/compiler/project.ts` | `PageIR[]` for route→output mapping and the development source map. |
| `formatDiagnostics(diagnostics, sources)` | `src/core/diagnostics/format.ts` | Terminal output, unchanged from `kadam build`. |
| `normalizeBasePath`, `normalizeRoute`, `routeUrl`, `pageCssHref`, `baseCssHref` | `src/compiler/routes.ts` | Route normalization; the server must not re-derive URL rules. |
| `emitHtml`, `emitBaseCss`, `emitPageCss` | `src/compiler/` | Never called by the server. Reached only through `compileProject`. |
| Atomic writer in `src/cli/main.ts` | `src/cli/main.ts` | **Not used by `dev`.** It remains the `build` path; the server serves memory. |

Two properties of the compiler shape the whole design:

1. **Compilation is pure and file-system read-only.** It reads the manifest,
   pages, and referenced assets; it writes nothing. `outDir` is only a returned
   string for the caller. The server can therefore compile freely without
   touching `dist/`.
2. **Failure returns `ok: false` with an empty `files` array**, and the project
   pipeline validates everything before emitting. A failed build can never
   produce a partial snapshot, which is exactly the "last successful preview"
   invariant the server needs.

Inspection also confirms what does *not* exist yet: no `dev` command (the CLI
reports it as planned), `src/server/` contains only a README, and there is no
watcher, SSE, or client code to reuse.

---

## 2. Architecture overview

```text
                 kadam dev --project ./MyWebsite
                              |
                              v
                    +--------------------+
                    |  CLI dev command   |  args, signals, browser open
                    +---------+----------+
                              | createDevServer()
                              v
   +---------------------------------------------------------------+
   | DevServer                                                     |
   |                                                               |
   |  +-------------+    compileProject()    +-------------------+ |
   |  | DevSession  | ----------------------> | compiler (M0–M3)  | |
   |  |             | <---------------------- | read-only, pure   | |
   |  | last-good   |   ok / diagnostics      +-------------------+ |
   |  | snapshot    |   files, sources                          |
   |  +------+------+                                            |
   |         | OutputSnapshot (Map<path, Buffer|string>)         |
   |         v                                                    |
   |  +-------------+      +-----------------+                     |
   |  | HTTP server | ---> | request router  |  snapshot lookup    |
   |  | node:http   |      | MIME, security  |  (never disk)       |
   |  +------+------+      +-----------------+                     |
   |         |                                                    |
   |         +---- /__kadam/events  (SSE hub)                     |
   |         +---- /__kadam/client.js, /__kadam/client.css        |
   |         +---- /__kadam/status  (JSON, testing/debug)         |
   |                                                               |
   |  +-------------+      fs.watch(project, recursive)          |
   |  | Watcher     | ---> debounce/filter ---> rebuild queue      |
   |  +-------------+                                             |
   +---------------------------------------------------------------+
                              |
                              v
                 Browser: page + EventSource client
                 reload | css swap | diagnostic overlay
```

### Core decisions

- **Compile to memory; serve from memory.** Requests are resolved against an
  immutable output map, never the filesystem. This makes traversal impossible
  by construction, avoids a temporary preview directory, and makes updates
  atomic: the new map replaces the old one only after a successful compile.
- **One compiler entry point.** `DevSession` calls `compileProject` and nothing
  else. No parsing, analysis, lowering, or emission is duplicated.
- **Full compile first, targeted delivery second.** Correctness comes from
  always running the real project pipeline; speed comes from debouncing,
  content hashing, and deciding *how much of the browser to update*.
- **Explicit source overlays, never hidden writes.** `DevSession`
  `setSourceOverrides()` passes project-relative in-memory sources to
  `compileProject`; a failed overlay keeps the last successful preview, and
  clearing it returns the next build to disk sources.
- **SSE, not WebSockets.** Updates are one-way and infrequent. `EventSource`
  reconnects automatically and needs no server framing code or dependency.
- **Native `node:http`.** No framework; the routing surface is about a dozen
  paths.

---

## 3. Module and file structure

```text
src/server/
  README.md              Updated module contract
  index.ts               Public exports: createDevServer, planUpdate,
                         resolveRequestPath, MIME helpers
  dev-server.ts          Lifecycle, HTTP wiring, SSE hub, security headers
  dev-session.ts         compileProject wrapper, snapshot, last-good,
                         build ids, source overrides, terminal logging,
                         rebuild queue
  watch.ts               Watcher interface, fs.watch implementation,
                         polling fallback, event filter, debouncer
  update-plan.ts         Pure diff: previous vs next snapshot -> none/css/reload
  request.ts             Pure request resolution: URL -> output file,
                         basePath stripping, MIME table, HTML injection
  client/
    client-script.ts     Exported string: browser client (EventSource, overlay)
    client-style.ts      Exported string: overlay stylesheet

src/cli/
  main.ts                Adds the `dev` dispatch branch (stays thin)
  dev-command.ts         `dev` argument parsing, signal handling, browser open,
                         port selection, terminal status output
```

**Why the browser client is a TypeScript string module.** The package ships
only `dist` (`"files": ["dist"]`), the build is `tsc` alone, and `lib` does not
include DOM types. A string constant keeps the build dependency-free and
guarantees the client exists next to the compiled server with no copy step.
The trade-off is that the client code is authored inside a template literal;
it is small (roughly 150 lines), covered by tests that compile it
(`new Function(source)` without executing) and assert it contains no
`innerHTML`, and is reviewed like any other source file.

**Dependency direction.** `server` imports `compiler` and `core`; `cli` imports
`server`. `compiler` and `core` never import `server`. This preserves the
existing dependency rule and keeps the future editor able to use the server.

---

## 4. Server lifecycle

### 4.1 Public API

```ts
interface DevServerOptions {
  readonly projectRoot: string;
  readonly host?: string;             // default "127.0.0.1"
  readonly port?: number;             // default 3000; 0 = ephemeral (tests)
  readonly strictPort?: boolean;      // busy explicit port is an error
  readonly basePath?: string;         // override manifest basePath
  readonly openBrowser?: boolean;     // opt-in; the CLI decides from TTY/CI
  readonly poll?: boolean;            // force polling watcher
  readonly watch?: boolean;           // default true; false for tests
  readonly logger?: (message: string) => void;
}

interface DevServer {
  readonly url: string;               // http://127.0.0.1:3000/
  readonly origin: string;
  readonly port: number;
  readonly host: string;
  readonly basePath: string;
  readonly closed: Promise<void>;
  getStatus(): DevStatus;             // current build state (for tests)
  rebuild(): BuildOutcome;            // synchronous full rebuild (tests)
  close(): Promise<void>;             // idempotent, graceful
}
```

`createDevServer` returns a promise that resolves once the server is listening
and the initial build has completed (success or failure). It never throws for
user source errors; those are state, not startup failures. It throws only for
unusable configuration (bad project root, port unavailable when explicitly
requested, listen failure).

### 4.2 Startup sequence

1. Resolve and validate `projectRoot` (must exist and be a directory).
2. Run `compileProject({ projectRoot, basePath })` **without** `outDir` use.
   The manifest load and full build happen here; there is no separate
   validation pass.
3. Create the session snapshot:
   - success → `current` map, `diagnostics = []`, `buildId = 1`;
   - failure → `current = null`, diagnostics retained, `buildId = 1`.
4. Bind the HTTP server (see port selection).
5. Start the watcher. The watch set is derived from the snapshot: manifest,
   every declared page source, every referenced asset. Watching starts after
   the first build so the set is accurate.
6. Print a banner: URL, project root, base path, watch mode, initial status.
7. Open the browser if enabled, after `listen`, detached, ignoring failure.
8. Register `SIGINT`/`SIGTERM` handlers **in the CLI only**, so embedding the
   server in another process never hijacks its signals.

### 4.3 Rebuild loop

```text
watch event(s)
   -> filter (relevant path?)
   -> debounce 75 ms trailing
   -> content-hash short-circuit (unchanged bytes -> stop)
   -> single-flight rebuild:
        if building: mark queued, return
        run compileProject
        on success: swap snapshot, assign buildId, plan update, broadcast
        on failure: keep snapshot, retain diagnostics, broadcast failure
   -> if queued: run once more with the latest files
```

Rebuilds are serialized. A burst of saves produces at most one pending rebuild,
and the trailing rebuild always reads the latest disk state.

### 4.4 Failure behavior

- **After a successful build:** the previous snapshot keeps serving. HTML, CSS,
  and assets continue to load; the browser shows an overlay. The terminal
  prints the diagnostics via `formatDiagnostics`.
- **On initial failure (no last-good):** HTML routes return `503` with a
  minimal static shell that loads the dev client; the client reads
  `/__kadam/status` and renders the overlay. There is no site to preserve yet,
  but the developer still gets an actionable page and live recovery.
- A failing rebuild never changes the served `buildId` or the snapshot.

### 4.5 Graceful shutdown

`close()` and the CLI signal handlers run one idempotent sequence:

1. Stop the watcher and cancel debounce timers.
2. Send a final `shutdown` SSE event so open tabs show "server stopped" instead
   of silently retrying.
3. End every SSE response.
4. `server.close()`; after 1 second call `server.closeAllConnections()` to
   release keep-alive sockets.
5. Resolve `close()`.

The CLI awaits `close()` and exits `0`. A second `Ctrl+C` exits immediately.

---

## 5. Request model and routing

### 5.1 Resolution is a pure function

```ts
type ResolvedRequest =
  | { kind: "file"; path: string }        // key in the output snapshot
  | { kind: "redirect"; location: string }
  | { kind: "not-found" }
  | { kind: "bad-request" };

function resolveRequestPath(
  urlPath: string,
  basePath: string,
  files: ReadonlySet<string>,
): ResolvedRequest;
```

The request path is never passed to `fs`. It is decoded **once**, validated,
and looked up in the snapshot map. This is the strongest traversal defense:
there is no filesystem call to exploit.

Rules:

| Request | Served |
| --- | --- |
| `/` (or `${basePath}/`) | `index.html` |
| `/about` | `301` to `/about/` |
| `/about/` | `about/index.html` |
| `/about/team/` | `about/team/index.html` |
| `/assets/kadam.css`, `/assets/logo.svg` | exact snapshot entry |
| `/__kadam/*` | internal endpoints, outside `basePath` |
| anything else | `404` |

- `basePath` is stripped before lookup. `/` redirects to `${basePath}/` when a
  base path is configured. Internal endpoints stay at the origin root so the
  injected client URL is constant.
- Reject before lookup: NUL bytes, backslashes, `..` segments, double-encoded
  separators, malformed percent-encoding (`400`).
- Query strings are ignored for file lookup; only same-origin GET/HEAD is
  served. Other methods get `405` with `Allow: GET, HEAD`; request bodies are
  not read.

### 5.2 MIME and headers

A fixed table keyed by the same extension allowlist the compiler enforces:
`html`, `css`, `js`, `png`, `jpg`, `jpeg`, `webp`, `avif`, `gif`, `svg`,
`woff`, `woff2`. Text types get `; charset=utf-8`.

Every response:

```text
Cache-Control: no-store
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'self'; img-src 'self' data:;
  style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'
```

No CORS headers, no directory listings, and no source maps are emitted.

### 5.3 HTML injection

Served HTML is the compiler's string plus exactly one tag before `</body>`:

```html
<script src="/__kadam/client.js" defer></script>
```

The snapshot stays byte-identical to a `kadam build` output; injection happens
in the response builder only. A golden test asserts "served HTML with the
injection removed equals the build output".

### 5.4 Multi-page behavior

All routes exist because all pages are in `files`. Navigation is ordinary
anchors, unchanged from production. The 404 page lists known routes as links
(rendered from manifest titles with `escapeText`), which is safe and useful
when a developer mistypes a URL.

### 5.4a Server functions (D-44 step 3)

When `kadam.json` names a server module, the dev server runs the generated
server as a child process on a free local port (`server/server.ts` with
`node --experimental-strip-types`, or `server/server.py` with `python3 -u`,
which `KADAM_PYTHON` can replace), from a temporary copy
of the server files and built pages. Requests under `/_kadam/` (loads and
form posts) are forwarded to it with their original `Host` and `Origin`, so
the generated server's same-site check sees the dev origin. Its output is
logged with a `[server]` prefix.

- The server module is watched like any other input. A build that changes the
  generated server code restarts the child; a page-only edit just rewrites
  the pages it may answer with.
- A build that fails keeps the last good server running, like the last good
  pages.
- Without a server module, `/_kadam/` answers `503`. The generated server's
  own files are never served as site files.

### 5.4b Error overlay

The overlay opens only when a build fails with errors, and lists only the
errors. Warnings (such as contrast) never open it: the terminal prints them and
the browser console gets a one-line summary. The overlay loads its own
stylesheet, so it is styled on every page.

### 5.4c Where an element is written

`/__kadam/source` returns, for every `data-kdm-id` in the last good build,
the element's name, kind, project-relative file, absolute path, line and
column (of its name), and its component if it came from one. The client uses
it for Alt-click (Option-click): a panel shows the location with Copy and
Open in editor (`vscode://file/...`).

### 5.5 Port selection

- Default `3000`; `--port <n>` sets it explicitly; `--port 0` is allowed and
  reports the assigned port.
- If the default port is busy, try up to 10 consecutive ports and print the
  chosen one. If an explicit port is busy, fail with a clear message rather
  than silently moving.
- Bind to `127.0.0.1` by default. `--host` is required to bind elsewhere and
  prints a warning that the preview is network-visible.

### 5.6 Browser opening

After a successful listen, run the platform opener detached, with stdio
ignored: `open` on macOS, `xdg-open` on Linux, `cmd /c start "" <url>` on
Windows. Skip when `--no-open`, when `CI` is set, or when stdout is not a TTY.
Failures are logged at debug level and never fail the command.

---

## 6. File-watching design

### 6.1 Strategy

Use one recursive `fs.watch(projectRoot, { recursive: true })`. Node 22
supports recursive watching on macOS, Windows, and Linux. One watcher is
simpler than per-file handles and survives editors that save by
write-temp-then-rename.

Fallback: if `fs.watch` throws or emits an error (network filesystems, exotic
platforms), switch to stat polling every 300 ms over the watch set, comparing
`mtimeMs` and `size`. `--poll` forces this mode. A periodic rescan (every 30 s)
also reconciles missed events; it is cheap and bounded by the watch set.

### 6.2 What is watched

Derived from the last successful manifest load, so no glob dependency:

- `kadam.json`;
- every page source declared in the manifest;
- every component source declared in the manifest;
- every asset referenced by the last successful build.

If the manifest is missing or invalid, fall back to all `.kdm` files under the
project plus `kadam.json`, so a developer can create or fix the manifest and
see the preview recover.

Ignored paths: `outDir` and any staging directory (`.*.kadam-stage-*`),
`node_modules`, `.git`, dot-directories, temporary editor files
(`*.swp`, `*~`, `.#*`, `*.kadam-tmp`).

### 6.3 Filtering, debouncing, and hashing

1. A pure `isRelevantChange(path, watchSet)` filter runs first; unrelated
   events never wake the compiler.
2. Trailing debounce of 75 ms coalesces save bursts (an editor often produces
   several events).
3. Before compiling, hash the changed files' current bytes and compare with the
   last observed hashes. A save with identical content is a no-op — this also
   prevents rebuild loops from tools that rewrite files.
4. The watcher emits a set of changed paths, which the session uses for logging
   and for the update plan.

The watcher is behind an interface:

```ts
interface WatchBackend {
  update(paths: readonly string[]): void;
  close(): void;
}
```

`createDevServer` accepts a factory so tests can inject a fake backend and emit
events synchronously, without sleeps.

---

## 7. Build orchestration, incrementality, and dependency tracking

### 7.1 What M4 compiles

Every relevant change runs the full `compileProject`. This is deliberate:

- The project symbol table (titles, routes, navigation) is global; a one-line
  title change can alter links on every page.
- `compileProject` validates before emitting, so a full run is the only way to
  guarantee the snapshot is a faithful build.
- The compiler is small and pure. Initial measurements on the portfolio project
  are single-digit milliseconds; the target for M4 is **under 100 ms for a
  50-page project**, instrumented and reported on every rebuild. If this target
  is missed, see §7.4.

### 7.2 Safe work the server *does* skip

- **Unchanged-content events:** skipped entirely by hash (no compile).
- **Irrelevant paths:** filtered before scheduling.
- **Asset byte changes:** still recompile (a deleted asset must surface
  `KDM4003`), but the update planner sees identical HTML/CSS and sends a
  targeted reload rather than a full navigation where possible.
- **No disk writes:** nothing is emitted to `dist/`; the atomic writer is not
  involved. Snapshot replacement is a single reference assignment.

### 7.3 Dependency table (for update classification)

| Change | Outputs that can change | Browser update |
| --- | --- | --- |
| Page style statement | that page's CSS (possibly HTML attributes for image size) | CSS swap if HTML identical, else reload |
| Page text / structure | that page's HTML + CSS | reload |
| Page title | all pages that navigate to it (hrefs), title tag | reload |
| Page route (manifest) | output paths and all inbound links | reload |
| Manifest pages/assets/basePath | everything | reload |
| Referenced asset bytes | none in compiler output | reload (image/font refresh) |
| Asset added/removed/renamed | HTML `src` or a diagnostic | reload / overlay |

### 7.4 Incremental compilation (deferred, gated)

If §7.1's target is missed, the next step is **not** a second compiler. It is
an additive, optional cache on the existing pipeline:

```ts
interface ProjectCompileCache {
  parse: Map<string, { hash: string; source: SourceFile; document: DocumentNode;
                       diagnostics: readonly Diagnostic[] }>;
}
```

`compileProject` would accept `cache?: ProjectCompileCache`, key parse entries
by content hash plus compiler version, and keep all analysis, lowering, and
emission unchanged. The invariant is testable: a warm build must be
byte-identical to a cold build for every fixture. This requires a small,
reviewed compiler change and is explicitly **out of M4.1**; it only happens
with a measurement that justifies it.

---

## 8. Live-update protocol

### 8.1 Transport

Server-Sent Events at `GET /__kadam/events`:

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

- `retry: 1000` on connect.
- Heartbeat comment (`: ping\n\n`) every 15 seconds.
- Maximum 32 concurrent clients; beyond that, `503`.
- `id:` is the build number, so reconnects are observable in tests.

Why not WebSockets: no client-to-server messages exist, `EventSource`
reconnects by itself, and SSE is plain HTTP that works through every proxy and
needs no handshake, framing, or dependency. If M7's editor later needs
bidirectional traffic, that is a separate endpoint and decision.

### 8.2 Events

```ts
interface StatusPayload {
  buildId: number;
  phase: "success" | "failure" | "building";
  served: "current" | "last-success" | "none";
  changed: "none" | "css" | "reload";
  diagnostics: SerializedDiagnostic[];   // capped at 100
  routes: { route: string; title: string }[];
  compileMs: number;
}
```

| Event | Payload | Client action |
| --- | --- | --- |
| `status` | `StatusPayload` | Render/clear overlay, update tab title dot |
| `css` | `{ buildId, hrefs: string[] }` | Swap `<link href>` with `?kadam=<buildId>` |
| `reload` | `{ buildId, reason }` | `location.reload()` |
| `shutdown` | `{}` | Show "dev server stopped" banner, stop retrying |

Initial state is delivered immediately on connect (no separate fetch needed),
and `/__kadam/status` exposes the same JSON for tests and debugging.

`SerializedDiagnostic` contains only `code`, `severity`, `message`, `file`
(project-relative), `line`, `column`, `hint`, and related locations. No source
text, environment data, or absolute paths.

### 8.3 Update planning

A pure function makes the decision, unit-tested without a server:

```ts
type PlannedUpdate =
  | { kind: "none" }
  | { kind: "css"; hrefs: string[] }
  | { kind: "reload"; reason: "html" | "routes" | "assets" | "first-build" };

function planUpdate(
  previous: OutputSnapshot | null,
  next: OutputSnapshot,
  changedPaths: readonly string[],
): PlannedUpdate;
```

Rules, in order:

1. No previous successful snapshot → `none` (the initial page is already the
   new build) unless a client is connected after a failure, in which case
   `reload`.
2. Any HTML path added, removed, or changed → `reload("html")`. This covers
   titles, navigation hrefs, structure, and image URLs.
3. Only `assets/*.css` contents differ, same set otherwise → `css` with the
   changed hrefs. This is the common style-edit path.
4. Asset bytes only → `reload("assets")` (the DOM is unchanged but images and
   fonts must refresh).
5. Identical output → `none` (e.g. a whitespace-only edit that lowers to the
   same bytes).

CSS-only updates preserve scroll position, focus, and form input, and avoid a
white flash. The client swaps `href` values rather than editing stylesheet
text, so the browser re-fetches from the same snapshot and no build state leaks
into the page.

### 8.4 Client behavior

The client (about 150 lines, no framework) does four things:

1. Open `EventSource("/__kadam/events")`; on `error`, show a subtle
   "reconnecting" badge and let the browser retry.
2. Apply `css` / `reload` / `shutdown` actions.
3. Render and clear the diagnostic overlay.
4. Set `document.title` to prefix `● ` while errors are present, restoring the
   original title on success.

It is served from the server string, contains no user data, and makes no
network requests other than the SSE stream and stylesheet swaps.

---

## 9. Error-overlay design

### 9.1 Appearance and content

A fixed panel, bottom-left, `position: fixed`, high `z-index`, maximum height
60vh, scrollable, with the page still visible and interactive behind it.

```text
+--------------------------------------------------------------+
| 3 errors · last successful preview is still shown      [x]   |
|--------------------------------------------------------------|
| KDM3009  a button requires text                  home.kdm:12 |
|   add the text says "..." as a statement in button1          |
|--------------------------------------------------------------|
| KDM3007  unknown page reference "Abut"          home.kdm:18  |
|   use the exact title of a page in the project               |
+--------------------------------------------------------------+
```

- At most 100 diagnostics: 99 real diagnostics followed by a `KDM9003`
  summary. The same capped list is printed in the terminal.
- Clicking a location copies `file:line:column` to the clipboard (M4 does not
  launch an editor; that is M7).
- A dismiss button hides the panel until the next failure; errors still appear
  in the terminal and the title dot remains.
- On a successful rebuild, the overlay is removed automatically.

### 9.2 Safety

- The overlay is built with `document.createElement` and `textContent` only.
  Diagnostic messages and hints are never interpolated into HTML. A test
  asserts the client source contains no `innerHTML`.
- Styles come from `/__kadam/client.css`, so the CSP can keep `style-src
  'self'` with no `'unsafe-inline'`; visibility is toggled with classes, not
  style attributes.
- The panel uses `role="alert"`, `aria-live="polite"`, and moves focus to the
  panel on appearance; dismissing returns focus to the previously focused
  element.
- No source excerpts are sent to the browser. The terminal, which is local,
  still uses the existing `formatDiagnostics` with source lines and carets.

### 9.3 Initial failure

With no last-good snapshot, HTML routes return `503` and a static shell:

```html
<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Kadam — build failed</title>
<link rel="stylesheet" href="/__kadam/client.css"></head>
<body><main id="kadam-empty"></main>
<script src="/__kadam/client.js" defer></script></body></html>
```

The client connects, receives `status` with `served: "none"`, and shows the
overlay plus a "no successful build yet" note.

---

## 10. Security model

| Threat | Mitigation |
| --- | --- |
| Directory traversal | Requests never touch the filesystem. Pure lookup in the output snapshot; reject NUL, backslash, `..`, malformed encoding before lookup. |
| Source or secret disclosure | Only snapshot entries for HTML, CSS,   and referenced assets are serveable. `kadam.json`, `.kdm`, `.env`, dotfiles, source maps, and `node_modules` are not in the snapshot and return 404 by construction. |
| Symlink escape | Compiler-side asset/page containment already uses `realpath`; the server performs no disk reads, so serving cannot follow a link. |
| Network exposure | Binds `127.0.0.1` by default. Remote binding requires `--host` and prints a warning. |
| DNS rebinding | Validate the `Host` header against loopback names (`127.0.0.1`, `localhost`, `[::1]`) or the explicitly bound host; otherwise `403`. |
| HTML injection in overlay | DOM `textContent` only; static client markup; no `innerHTML`; CSP blocks inline script. |
| Malicious diagnostic content | Diagnostics originate from the local compiler and are still treated as untrusted text; payload is capped and stripped to the documented fields. |
| Cross-origin use | No CORS headers; same-origin client only; `connect-src 'self'`. |
| Request abuse | GET/HEAD only, `405` otherwise; no request bodies; URL length cap; SSE client cap; no directory listing. |
| Environment leakage | The server never reads `.env`, never serializes `process.env`, and logs only project-relative paths. |

Non-goals: authentication, multi-user access, and remote preview. The dev
server is a local tool; exposing it to a network is an explicit opt-in with a
warning, not a supported deployment mode.

---

## 11. Performance

| Concern | Approach |
| --- | --- |
| Rebuild cost | Full `compileProject` per relevant change; instrumented `compileMs` in status and logs. Target < 100 ms at 50 pages. |
| Save bursts | 75 ms trailing debounce + single-flight queue + trailing rebuild. |
| Redundant builds | Content-hash short-circuit for unchanged saves. |
| Asset I/O | Assets are read through the existing compiler. If profiling shows asset reads dominate, add an optional asset cache (path + mtime + size) *inside the dev session*, keyed only for unchanged files; no compiler change. |
| Browser work | CSS-only swap for style edits; full reload only when HTML, routes, or assets require it. |
| Memory | Snapshot holds all HTML/CSS and referenced assets. Typical projects are small; warn when a single asset exceeds 8 MiB or the snapshot exceeds 64 MiB. Large media streaming is out of scope. |
| Watcher overhead | One recursive watcher, pure filter, bounded periodic rescan. |
| Startup | One compile before `listen`; no disk output, no dependency graph construction beyond the manifest. |

Correctness rules that override performance:

- Never serve a snapshot from a failed compile.
- Never apply a partial output map.
- Never skip the compiler based on an assumption about which page changed
  unless the output diff proves the change is asset-only or CSS-only.

---

## 12. Testing strategy

All tests use the Node built-in runner and no new dependencies.

### 12.1 Pure unit tests

- `resolveRequestPath`: root, nested, trailing slash redirect, base path,
  exact files, query strings, `%2e%2e`, `%2f`, `%5c`, NUL, malformed encoding,
  unknown paths.
- MIME table completeness and charset rules.
- HTML injection: exactly one script tag before `</body>`; snapshot unchanged.
- `planUpdate`: first build; HTML change; CSS-only; asset bytes; identical
  output; route-set change.
- Watcher filter and hash short-circuit.

### 12.2 Session tests (no HTTP)

Temp project fixtures (reusing the M3 helper patterns) plus:

- initial success snapshot and `buildId`;
- syntax error keeps the previous snapshot and sets `served: "last-success"`;
- fixing the error restores a new snapshot;
- manifest change adds a route;
- deleted asset produces `KDM4003` while the old site keeps serving;
- diagnostics payload contains relative paths only.

### 12.3 HTTP integration tests

- Start on `port: 0`, `watch: false`, `openBrowser: false`.
- Fetch `/`, `/about/`, CSS, SVG: status, content type, bytes equal build.
- 404 for `/kadam.json`, `/pages/home.kdm`, `/.env`, `/../`, `/%2e%2e/`,
  `/node_modules/...`; 403 for a foreign `Host`.
- 405 for `POST`.
- SSE: read the stream, assert the initial `status`, then edit a file through a
  fake watcher and assert `reload` or `css` with a higher `buildId`.
- Error then recovery: assert overlay payload, old HTML still 200, then
  `reload` after the fix.
- Shutdown: `close()` ends streams, releases the port, and is idempotent.

### 12.4 CLI tests

- `kadam dev --project <tmp> --port 0 --no-open` prints a URL; a request
  succeeds; `SIGINT` exits `0`.
- Explicit busy port exits non-zero with a clear message; default busy port
  advances to the next one.
- `kadam dev` on a project with an initial error still starts and serves the
  overlay shell with `503`.

### 12.5 Determinism and parity

- Dev-served HTML stripped of the injected tag equals `kadam build` output for
  `examples/portfolio`.
- Two identical rebuilds produce the same output hash and no spurious event.
- The existing suite must keep passing; `dev` is additive.

### 12.6 Manual browser smoke checklist

Documented in the server README: start the portfolio, edit a style (no reload
flash), edit text (reload), break a template (overlay, page intact), fix it
(overlay clears), stop with `Ctrl+C` (tab shows stopped).

---

## 13. Dependency analysis

**Zero new runtime dependencies.** Every capability maps to a Node built-in or
a browser built-in.

| Need | Built-in | Why not a dependency |
| --- | --- | --- |
| HTTP server | `node:http` | The route table is ~12 paths; Express adds no value. |
| Live updates | SSE over `node:http`; `EventSource` in the browser | WebSockets need `ws` or hand-written framing for traffic that is one-way. |
| File watching | `fs.watch` recursive + stat polling fallback | `chokidar` is the main candidate; rejected because Node 22 covers recursive watch and a polling fallback is ~40 lines. |
| MIME types | 12-entry table | `mime`/`mime-types` for a closed allowlist is unnecessary. |
| Browser opening | `child_process` + platform commands | `open` is a convenience wrapper around three commands. |
| Hashing | `node:crypto` | Built-in. |
| SSE client | `EventSource` | Native, auto-reconnecting. |
| HTML escaping | existing `escapeText`/`escapeAttribute` | Already implemented and tested. |
| Diagnostics | existing `formatDiagnostics` | Reused verbatim. |

Dev dependencies are unchanged. The "no bundler, no framework" constraint from
D-15 holds.

---

## 14. Decisions and open questions

### Decision D-17 — Dev server serves compiled output from memory over HTTP + SSE

**Status:** Approved and implemented

- The dev server is an adapter over `compileProject`; it never re-implements
  compilation.
- It serves an in-memory snapshot, never the source tree or an output
  directory.
- Live updates use Server-Sent Events; no WebSocket server, no client-side
  router, no HMR runtime.
- A failed build preserves the last successful snapshot; the overlay is
  advisory, not a generated page replacement.
- Full reload is the default; CSS-only swap is allowed only when the output
  diff proves HTML, routes, and assets are unchanged.

**Alternatives considered:** write to a temp `dist` and serve from disk
(slower, introduces atomic-swap complexity and a path surface); WebSockets
(bidirectional machinery for one-way events); a bundler/HMR runtime (violates
D-15 and the static-output model); polling only (latency and wasted I/O).

### Milestone numbering (resolved)

The development server is **M4**. Motion and declarative interactions moved to
**M5**, and incremental compilation is deferred until a measured proposal
exists. `docs/roadmap.md` and `docs/decisions.md` were updated together so the
repository has a single source of truth.

### Other implementation decisions

- **Port default:** 3000 (approved), with `--port 0` for tests.
- **CSS-only update scope:** swapping stylesheet `href`s is conservative and
  reliable. True CSS in-place patching is rejected for now.
- **Terminal UI:** plain line output in M4; no progress spinner or TUI.

---

## 15. Ordered implementation plan

Each step is independently testable and leaves the build green.

| # | Work | Exit criterion |
| --- | --- | --- |
| 0 | Approve this document, D-17, and the milestone numbering | Decision recorded in `docs/decisions.md` |
| 1 | `request.ts`: pure path resolver, MIME table, header builder, HTML injection + unit tests | Traversal, base path, redirects, and MIME table fully covered |
| 2 | `update-plan.ts` + `dev-session.ts`: snapshot, last-good, build ids, diffing + tests | Error preserves old snapshot; CSS/reload classification correct |
| 3 | SSE hub + `client-script.ts` / `client-style.ts` + status endpoint | Raw SSE client receives initial status; client source compiles and has no `innerHTML` |
| 4 | `watch.ts`: recursive watcher, filter, debounce, hash short-circuit, polling fallback + tests | Fake backend drives rebuilds deterministically; one real-fs test passes |
| 5 | `dev-server.ts`: lifecycle, routing, security headers, Host check, shutdown + integration tests | Fetch matrix, 404/403/405, SSE reload, and graceful close all pass |
| 6 | CLI `dev` command: args, port selection, banner, browser open, signals + CLI tests | `kadam dev` runs, reloads on save, exits cleanly on `Ctrl+C` |
| 7 | Performance pass: instrument `compileMs`, measure 1/50/200 pages, decide §7.4 cache | Documented numbers; cache added only if the target is missed |
| 8 | Docs: update `src/server/README.md`, `docs/architecture.md`, README, roadmap; manual checklist | Docs match behavior; `npm run check` green with new tests |

### Acceptance criterion for M4

A developer runs `kadam dev` in a multi-page project, edits
`pages/home.kdm` in a text editor, and sees the browser update:
style-only edits without a full reload, content edits with a reload, a readable
overlay during a syntax error with the last good page still visible, automatic
recovery after the fix, working navigation between pages, and a clean exit on
`Ctrl+C` — with the existing test suite still passing (110 tests at M4
completion) and no new dependencies.

---

## Appendix A — CLI surface

```text
kadam dev [project] [options]

  -p, --project <dir>    Project directory containing kadam.json (default: .)
      --port <n>         Port to listen on (default: 3000; 0 picks any free port)
      --host <host>      Interface to bind (default: 127.0.0.1)
  -b, --base-path <p>    Override the manifest base path
      --no-open          Do not open a browser
      --poll             Force polling file watching

Status: development server and live preview (M4). No JavaScript runtime is
generated for the site itself.
```

## Appendix B — Internal endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/__kadam/events` | GET | SSE stream (`status`, `css`, `reload`, `shutdown`) |
| `/__kadam/status` | GET | Current build JSON for tests and debugging |
| `/__kadam/client.js` | GET | Dev client script |
| `/__kadam/client.css` | GET | Overlay stylesheet |

Internal endpoints are excluded from `basePath`, are same-origin only, and
return `404` for any other subpath.
