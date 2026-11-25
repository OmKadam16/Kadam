# Kadam Studio — M7 Architecture

**Status:** Implemented (M7.1 foundation). The Studio application, host APIs,
CodeMirror adapter, preview bridge, and inspector now exist under `studio/`.
This document remains the architecture record; later slices are identified in
§15 and are not claimed as complete.
**Applies to:** Kadam implementation 0.1 / language 0.1
**Depends on:** M0–M6. M6.1 component integration is complete. Component
instance/definition navigation and later Studio slices remain gated.
**Companion documents:** `docs/architecture.md`, `docs/dev-server.md`,
`docs/project-manifest.md`, `docs/components.md`, `docs/roadmap.md`,
`docs/decisions.md`

---

## 1. Executive decision

Kadam Studio will be a separate, local, browser-hosted application backed by a
small Node.js host process. It will consume the existing Kadam compiler and
development server; it will not contain a second compiler, renderer, or
language grammar.

The implemented shape is:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Studio browser UI (React + CodeMirror 6)                            │
│                                                                     │
│  toolbar / explorer / editor / preview iframe / inspector /         │
│  diagnostics / component browser / asset browser                   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ same-origin HTTP + SSE
┌───────────────────────────────▼─────────────────────────────────────┐
│ Studio host (Node.js, loopback only)                                │
│                                                                     │
│  /__studio/*        project, file, source-edit, check/build APIs    │
│  /__preview/*       reverse proxy to the existing Kadam dev server  │
│  /__kadam/*         existing dev-server SSE, status, client assets  │
│                                                                     │
│  project session root + path policy                                 │
│  source-document and version manager                                 │
│  preview lifecycle and source-overlay bridge                         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ uses public/compiler APIs
┌───────────────────────────────▼─────────────────────────────────────┐
│ Kadam compiler, core language services, existing dev server          │
│ No Studio imports. No duplicated parse/analyze/lower/emit pipeline.  │
└─────────────────────────────────────────────────────────────────────┘
```

The `.kdm` source remains authoritative. The preview is the **actual compiled
HTML/CSS** served by the existing development server. Generated HTML/CSS is
never opened as editable source.

---

## 2. Repository audit and milestone verification

The audit was performed against the working tree, not against previous status
reports.

### 2.1 Verification result

`npm run check` passes:

- TypeScript typecheck: pass.
- Build: pass.
- Test runner: **256/256 compiler tests pass** (146 at the M7 architecture review).
- Studio suite: **9/9 host integration tests pass**.
- Test files: 30 compiler test files plus 1 Studio test file.

A green suite proves the implemented surface is internally consistent. It does
not prove every roadmap milestone is complete.

### 2.2 Milestone status

| Milestone | Status | Evidence | Audit finding |
| --- | --- | --- | --- |
| M0 — Foundation and specification | Complete | `docs/language-spec.md`, `docs/architecture.md`, `docs/decisions.md`, build/test scripts | Documents and build scaffold exist. README and roadmap identify M7/M7.1 as current. |
| M1 — Lexer, parser, AST, diagnostics | Implemented | `src/core/lexer`, `src/core/parser`, `src/core/ast`, `src/core/source`, `src/core/diagnostics` | Parser tests, lexer tests, spans, diagnostic cap, and invalid-source coverage pass. |
| M2 — Semantics and static compiler | Implemented | `src/core/semantics`, `src/compiler/compile.ts`, `lower.ts`, `emit-html.ts`, `emit-css.ts` | Single-page compiler and golden tests pass. Studio consumes the same compiler; no duplicated pipeline exists. |
| M3 — Multi-page project compilation | Implemented | `src/compiler/project.ts`, `manifest.ts`, `routes.ts`, `test/project.test.mjs` | Manifest validation, routes, assets, basePath, determinism, and atomic writes have coverage. |
| M4 — Development server and live preview | Implemented | `src/server/`, `src/cli/dev-command.ts`, `test/dev-*.test.mjs` | Real loopback HTTP server, in-memory snapshots, watcher, SSE, last-good preview, path and Host checks pass. |
| M5 — Motion and declarative interactions | Implemented and approved | `src/core/parser/matchers-interaction.ts`, `src/compiler/lower.ts`, `src/compiler/emit-css.ts`, `docs/m5-compliance.md` | Hover, motion, reduced motion, external links, focus-visible, and accessibility rules are covered. |
| M6 — Reusable components | **Implemented (M6.1)** | `src/core/components/*`, `src/compiler/project.ts`, `test/components-project.test.mjs`, `examples/components/` | Component files are loaded from `kadam.json`, expanded after catalog validation, then validated, analyzed, and lowered as ordinary elements. Identity, form IDs, source-map origins, CSS deduplication, dev watch paths, and the acceptance example are covered by tests. |

### 2.3 Remaining M6.1 boundaries

M6.1 closed the blocking gap: `kadam.json` accepts `components`,
`compileProject()` loads and validates component files, expands every page
before analysis and lowering, and carries `componentOrigin` into `IrElement` and
`IrSourceMapping`. `DevSession.watchPaths` includes component sources, and
`examples/components/` is the acceptance project with CLI and dev-session tests.

What still does not exist:

1. Component-aware incremental re-emission: `kadam dev` rebuilds the whole
   project after any change.
2. A packaged component library beyond `examples/components/`.
3. External library roots and per-slot parameters.
4. Component instance/definition navigation or a component browser in Studio.
   The explorer does list component source files.

**Consequence for M7:** Studio may rely on stable component node IDs, classes,
form IDs, and `componentOrigin` for instance/definition navigation and source
maps. It must not assume incremental per-component re-emission, and it must not
build a component browser before the M7.1 application foundation lands. Those
features remain gated in §9 and §15.

### 2.4 Existing interfaces Studio must reuse

| Existing API | Location | Studio use |
| --- | --- | --- |
| `compileProject(options)` | `src/compiler/project.ts` | The only project compilation entry point. Supports `sourceOverrides` for unsaved buffers. |
| `ProjectCompileResult` | `src/compiler/project.ts` | Diagnostics, files, pages, manifest, sources, outDir. |
| `PageIR` and `IrSourceMapping` | `src/compiler/ir.ts` | Source mapping data for visual selection, exposed over HTTP by `/__kadam/studio-map`. |
| `DevSession` | `src/server/dev-session.ts` | Last-good snapshot, status, routes, serialized diagnostics, the build-bound studio source map, and in-memory source overrides. |
| `createDevServer` | `src/server/dev-server.ts` | Real preview server, request routing, SSE, injected dev client. |
| `planUpdate` | `src/server/update-plan.ts` | CSS-only vs. full reload decisions. |
| `resolveRequestPath` | `src/server/request.ts` | Safe output-snapshot lookup. |
| `parseText`, `parseSource`, `parseComponentText` | `src/core/parser` | Editor language services, outline, completion context, component discovery. |
| `BUILTIN_KIND_INFO`, template registry | `src/core/parser` | Capability tables, highlighting, completion, inspector descriptors. |
| `validateDocument`, `analyzeDocument` | `src/core` | Editor and source-edit validation. |
| `formatDiagnostics` | `src/core/diagnostics/format.ts` | CLI-style diagnostic text and tests. |

---

## 3. Product and technical constraints

1. `.kdm` is the source of truth; generated files are disposable.
2. The compiler remains deterministic, framework-independent, and zero-runtime
   dependency.
3. Studio is a separate application layer; `src/core` and `src/compiler` must
   never import Studio.
4. The preview must be the real compiled output, not an AST-specific renderer.
5. Source edits are exact text patches over spans; no whole-file reprinting.
6. Visual edits must produce valid Kadam or be rejected.
7. No AI, model, network service, or telemetry. The plain-English bar is a
   local deterministic grammar over existing source operations; it does not
   call or embed a model, and it cannot bypass compiler validation.
8. Production output contains no Studio client, source paths, source maps, or
   development-only metadata.
9. Local project access is confined to an explicitly opened project root.
10. No arbitrary command execution or arbitrary file access from project source
    or preview content.

---

## 4. Application and packaging architecture

### 4.1 Separate Studio package

The root repository is currently one private npm package whose runtime has no
dependencies. M7 should preserve that property for the compiler.

**Implemented:** a separate `studio/` package linked to the compiler with
`file:..`, with its own lockfile, TypeScript configurations, Vite build, and
browser/server entry points.

```text
studio/
  package.json
  package-lock.json
  tsconfig.json           browser typecheck
  tsconfig.host.json      Node host build
  vite.config.ts
  index.html
  src/
    host/                 Node host: project session, APIs, proxy, bridge
    shared/               JSON contract shared by host and browser
    web/                  React application shell
      components/         explorer, layers, editor, preview, inspector
      language/           CodeMirror lexer and diagnostic adapters
  test/                   Node host integration tests
```

The root `kadam` package remains the compiler/CLI/server package. Studio
depends on it; the dependency never points the other way. The Studio package is
private and is not part of the production website output.

### 4.2 Browser-hosted local application, not Electron first

**Decision:** browser-hosted local application with a Node host process.

Reasons:

- It reuses the existing Node compiler and development server directly.
- It avoids shipping Chromium/Electron or requiring a Rust toolchain.
- It keeps the dependency and security surface smaller for M7.
- It can later be wrapped by Electron or Tauri without changing the compiler,
  APIs, or browser UI.

Limitations accepted for M7.0:

- Opening a project initially uses a path field, recent-project list, or
  drag-and-drop of a directory. A native OS folder picker is deferred until a
  desktop wrapper is separately approved.
- The Studio process binds to loopback only. Remote sharing is out of scope.

### 4.3 Dependency set

These dependencies are installed and pinned in `studio/package.json` with a
committed Studio lockfile. The compiler package still has no runtime
dependencies.

| Dependency | Scope | Purpose | Licence / footprint |
| --- | --- | --- | --- |
| React + React DOM | Studio web only | Complex, stateful IDE shell, panels, inspector | MIT; moderate runtime bundle, build-time tree-shaken |
| CodeMirror 6 packages | Studio web only | Editor, state, view, language, commands, lint | MIT; modular and tree-shakable; no mandatory editor worker |
| Vite | Studio build/dev only | Browser build, dev server for the Studio shell | MIT; development/build dependency |
| TypeScript | build only | Strict typecheck for Studio | Apache-2.0 |
| `@vitejs/plugin-react` | Studio build only | React JSX transform for Vite | MIT; dev-only |
| Existing `kadam` package | runtime | Compiler, parser, server, diagnostics | in-repository |

No UI component library, icon package, state framework, or CSS framework is
used. Native CSS variables and small in-repository components keep the visual
identity intentional and the dependency surface controlled. Playwright is not
installed in M7.1; the current Studio suite is Node host integration tests.
Browser acceptance remains a later slice.

### 4.4 Compiler boundary enforcement

- No `src/**` compiler file imports anything under `studio/`.
- Studio imports only public exports from `src/index.ts` or explicit
  `kadam` package exports.
- If a needed compiler API is missing, it is added to `kadam` as a deliberate,
  tested API; Studio does not reach into private modules or reimplement it.
- No automated dependency-boundary test exists yet; the separate package and
  build boundary keep Studio out of the compiler.

---

## 5. Editor technology decision

### 5.1 Evaluation

**Monaco Editor**

- MIT, VS Code-derived, full-featured, excellent TypeScript/HTML/CSS language
  services.
- Excellent for users who need built-in IntelliSense and VS Code-grade
  navigation without custom work.
- Large footprint; npm package unpacked size is in the tens of megabytes and a
  deployed full editor is multi-megabyte depending on bundled languages.
- Requires careful worker and CSP configuration. Official documentation notes
  that Monaco is not supported in mobile browsers.
- Its built-in language services do not understand Kadam. A custom Monarch
  tokenizer plus providers would be needed anyway.
- VS Code extensions do not run in Monaco; its value is the editor experience,
  not extension reuse.

**CodeMirror 6**

- MIT, modular packages, tree-shakable; core plus selected extensions is small
  compared with Monaco (order-of-magnitude smaller, exact size to be measured
  in M7.1).
- No mandatory language worker. Good fit for a CSP-constrained local app and
  for a language whose analysis is already a pure TypeScript library.
- Transaction/annotation/change-mapping model is a strong fit for source edits
  initiated by the inspector while preserving a single undo history.
- Works on mobile and in ordinary browser layouts.
- `@codemirror/lint`, `@codemirror/search`, `@codemirror/autocomplete`,
  `@codemirror/commands`, `@codemirror/language`, and state/view packages cover
  the required editor surface.
- Custom language support is work, but Kadam is line-oriented and already has a
  deterministic lexer, parser, registry, and spans. We can expose those rather
  than write a second grammar.

### 5.2 Decision

**Use CodeMirror 6.**

Monaco's strongest feature is its built-in TypeScript/HTML/CSS language
intelligence, which is not useful for `.kdm`. Its cost is high for a local app
whose actual language services come from Kadam's own compiler. CodeMirror's
transaction model and smaller deployment footprint are better aligned with
Studio's source-editing and source-mapping requirements.

### 5.3 Language-service integration (no second grammar)

Studio must not implement an independent Kadam grammar or fuzzy completion
engine.

Implemented adapter layer:

```text
studio/src/web/language/
  kadam.ts          CodeMirror language, highlighting, and theme
  diagnostics.ts    core Diagnostic -> CodeMirror lint markers
```

The outline and cursor lookup remain in `src/editor/` and are served by the
Studio host rather than bundled into the browser language layer.

Rules:

- Highlighting uses the **core lexer's token kinds**, not a copied regex
  grammar. The adapter may map core token kinds to CodeMirror highlight tags.
- Completion candidates come from `docs/language-spec.md`'s implemented
  registry, `BUILTIN_KIND_INFO`, the component catalog (after M6.1), manifest
  page titles, and the current parse context.
- Hover text comes from the same registry/template metadata used by the parser.
- Diagnostics are the compiler's `Diagnostic` objects, converted to offsets.
  Studio does not invent a second diagnostic format or severity model.
- Full-file parsing on every keystroke is unnecessary for small Kadam files.
  Highlighting and diagnostics are debounced and incremental-friendly; the
  initial implementation may parse the current buffer off the editor's typing
  path and replace it with a cheaper viewport strategy if measurements require
  it.
- The editor must still work when a file is temporarily syntactically invalid:
  retain the last valid tokenization where possible, show diagnostics, and
  never guess semantics.

**Implemented foundation:** `src/editor/outline.ts` builds page and component
outlines directly from the core parser. It returns partial trees for incomplete
buffers, stable element paths, component variants, and source spans without
filesystem access. `outlineNodeAt()` and `outlinePathAt()` map a cursor offset to
the deepest node and its ancestor path. `toEditorDiagnostics()` converts core
diagnostics into file-filtered UTF-16 ranges with related locations. The
CodeMirror adapter in `studio/src/web/language/` derives highlighting from the
core lexer and maps compiler diagnostics to lint markers.

The core lexer and source modules are confirmed browser-compatible and exported
as the Node-free `src/browser.ts` entry. The parser is also free of Node imports
but is not part of the editor bundle. Studio imports the browser entry for
highlighting rather than defining a second grammar.

---

## 6. Studio host and same-origin preview

### 6.1 Why same-origin

The preview and Studio UI must interact for click-to-source, selection
highlighting, and route coordination. Making the preview a cross-origin iframe
would force a messaging protocol just to discover that an element was clicked,
and would make DOM-relative selection overlays fragile.

**Decision:** the Studio host serves the UI at `/`, the existing dev server's
output through a reverse proxy at `/__preview/`, and the existing dev protocol
at `/__kadam/`. The preview iframe and Studio page share an origin.

This does not change compiler output. The dev server is already designed to be
mounted under a `basePath`; Studio uses that existing option:

```text
Studio origin                       Existing dev server
  /                                  (not used)
  /__preview/*        ─────────────▶ basePath /__preview
  /__kadam/events     ─────────────▶ SSE
  /__kadam/status     ─────────────▶ status JSON
  /__kadam/client.*   ─────────────▶ development client
  /__studio/*         ─────────────▶ Studio host API
```

The proxy must:

- Preserve or deliberately rewrite the `Host` header to the loopback dev-server
  host so the existing Host allowlist continues to protect it.
- Stream SSE without buffering.
- Not expose the dev server on a public interface.
- Keep `/__kadam` at the origin root, matching the current client script.
- Add `frame-ancestors 'self'` or equivalent framing policy while preserving
  the existing content security policy for generated pages.
- Never serve the project source tree through the preview proxy.

### 6.2 Preview lifecycle

1. Studio starts `createDevServer` on `127.0.0.1` with an ephemeral port and
   `basePath: "/__preview"`.
2. The initial build is the real `compileProject` build. If it fails, the
   existing error shell or last-good snapshot behavior applies.
3. The Studio iframe loads `/__preview/`.
4. Studio subscribes to the existing `/__kadam/events` stream through the
   proxy, or to a Studio status stream derived from it.
5. A CSS-only update keeps the iframe and swaps the stylesheet links exactly as
   the existing dev client does. An HTML/asset/route change reloads the iframe.
6. A failed build leaves the iframe on the last successful snapshot. Studio
   shows the diagnostics panel and does not replace the preview with a new
   error page when a previous good snapshot exists.
7. Recovery reloads the iframe and clears resolved diagnostics.

### 6.3 Unsaved-buffer preview

`compileProject` accepts `sourceOverrides`, and `DevSession` now exposes
`setSourceOverrides(map)` and `clearSourceOverrides()`. Each subsequent build
passes the map to `compileProject`. The map is used exactly like a saved source;
it never writes to disk and never bypasses validation. The Studio host calls
these methods from its editor transactions.

- Disk watching remains responsible for external changes.
- Studio-triggered rebuilds use the current overlay plus disk sources.
- The build key includes the overlay content; repeated builds are deterministic.
- The existing snapshot/last-good/update-plan behavior is unchanged.
- The overlay only contains source files explicitly managed by Studio; no
  external paths.

This is the only way to offer live preview with unsaved files without a second
compiler or writing on every keystroke.

### 6.4 Selecting elements in the preview

The compiler already emits `data-kdm-id` on page elements. Studio will not add
source paths or line numbers to production HTML.

A **development-only bridge** is injected by the Studio proxy into preview
HTML, not by the compiler:

- It reads the nearest `[data-kdm-id]` under the pointer/click target.
- It posts a narrow message to the parent:
  `{type:"kadam-studio:select", nodeId, route, url}`. The parent uses its own
  current build ID and reads the selected element's source span from the
  existing Studio map.
- It accepts only a narrow highlight/clear message and validates
  `event.source === parent`, `event.origin`, and the message schema.
- It never accepts source paths, file text, arbitrary CSS, or HTML.
- It is not part of production output.

Because the iframe is same-origin, the bridge can be deliberately small and the
parent can draw a selection overlay above the iframe. The bridge remains the
trusted boundary so preview content is never assumed safe.

### 6.5 Device preview

Device sizes are viewport sizes, not new language breakpoints:

- Desktop 1440 × 900.
- Tablet 768 × 1024.
- Mobile 390 × 844.
- Custom width and height.

The iframe is resized to its true device width and height; the generated CSS
uses the existing fixed media queries at that viewport. Studio may apply a CSS
transform to the frame for display, but the transform is visual only. It does not change the iframe's layout viewport or media-query evaluation. The
preview occupies the right column and opens at 100%; Fit is available for
width-fit, and explicit zoom is available from 25% to 150%. Tall pages scroll
inside the preview stage rather than being reflowed to the column width.

---

## 7. Source mapping architecture

### 7.1 Existing data

`PageIR.sourceMap` already contains, for each lowered element:

```text
nodeId, name, kind, span, nameSpan
```

`emit-html` emits `data-kdm-id="<nodeId>"` on every generated element. Node IDs
are currently `<route-slug>-<element-name>`. The HTML is production-valid and
does not need a new attribute for Studio.

### 7.2 Dev-only source-map endpoint

The development server exposes the map to Studio at:

```text
GET /__kadam/studio-map?buildId=<id>
```

It returns a project-relative map:

```json
{
  "buildId": 12,
  "pages": [
    {
      "route": "/",
      "title": "Home",
      "sourceFile": "pages/home.kdm",
      "elements": [
        {
          "nodeId": "home-hero1",
          "name": "hero1",
          "kind": "card",
          "span": { "start": { "line": 3, "column": 1, "offset": 20 },
                    "end": { "line": 18, "column": 2, "offset": 240 } },
          "nameSpan": { "start": { "line": 3, "column": 1, "offset": 20 },
                        "end": { "line": 3, "column": 6, "offset": 25 } }
        }
      ]
    }
  ]
}
```

**Implemented:** `GET /__kadam/studio-map` in the M4 development server. The
optional `buildId` query is checked against the current build; a stale id
returns `409`, and before the first successful build it returns `503`. Studio
consumes the endpoint for click-to-source selection and discards stale maps.

Rules:

- Only available on the loopback dev server, never emitted into production
  files.
- File paths are project-relative; absolute paths never leave the process.
- The response includes the current `buildId`; Studio discards maps whose build
  no longer matches the selected preview.
- It is an additive server API, not a second compiler. It reads `PageIR`
  source maps already produced by lowering.
- The existing status/diagnostic serialization and 100-diagnostic cap remain in
  force.

### 7.3 Page element selection flow

1. User clicks `[data-kdm-id="home-button1"]` in the preview.
2. Bridge posts `nodeId` + route + build ID to Studio.
3. Studio ignores the message if `buildId` is stale.
4. Studio looks up the source map entry.
5. Studio opens `pages/home.kdm` and selects `nameSpan` or the statement span
   in CodeMirror.
6. Inspector resolves the AST element by its span/name, not by re-searching
   generated CSS classes.
7. If the element is gone after a rebuild, Studio clears the selection and
   reports that the source changed; it does not guess a replacement.

### 7.4 Component selection (blocked on M6.1)

Page-level selection is supported by current `IrSourceMapping`. Component
instances need more data than exists today.

The M6.1 compiler work must add a component-origin chain to the IR/source map,
including at least:

- component name and declaration span;
- selected variant;
- instance name/span at the call site;
- nested instance chain;
- expanded local element name/span;
- stable instance path used for `nodeId`, form IDs, and CSS class selection.

A component selection must resolve both:

- the **instance** source location and its `with` bindings;
- the **definition** source location and local element.

Until that exists, Studio must not show a component inspector or
instance/definition navigation. The component browser is gated in §15.

---

## 8. Source editing architecture

### 8.1 Principles

- `.kdm` source is the only edited artifact.
- Edits are minimal replacements over the current document.
- No full-file reprint, formatter-as-editor, or generated CSS mutation.
- A rejected visual edit leaves the previous valid source and preview intact.
- The editor owns undo/redo history; visual edits enter it as transactions,
  not as external file mutations that bypass history.

### 8.2 Document and version model

```text
SourceDocument
  path                 project-relative
  text                 normalized LF text used by the compiler
  version              monotonically increasing document version
  diskHash             SHA-256 of the last loaded saved text
  newline              original dominant line ending (LF or CRLF)
  bom                  whether the file originally had a BOM
  dirty                in-memory differs from saved source
```

The compiler normalizes CRLF/BOM today. Studio must not silently lose that
information:

- The editor works on normalized LF text and uses UTF-16 offsets, matching
  `Span.start.offset` and CodeMirror.
- On save, Studio re-applies the detected newline style and BOM.
- Mixed line endings are normalized on first save; this limitation is disclosed
  in the save confirmation and is covered by a test.
- Edits use offsets, never line/column alone. Lines/columns are presentation
  data and are derived from `SourceFile`.

### 8.3 Source transaction contract

```text
SourceEditRequest
  path
  baseVersion
  from                 UTF-16 offset
  to                   UTF-16 offset
  originalText         exact text expected at the range
  replacementText
  intent               "inspector" | "format" | "rename" | "create" | ...
```

Application rules:

1. Reject if the path is outside the project or not an allowed source type.
2. Reject if `baseVersion` does not match the current document.
3. Reject if the current text at `[from, to)` is not `originalText`.
4. Apply to a candidate document, never directly to the saved file.
5. Reparse and validate the candidate, plus the project where the change can
   affect it.
6. If validation fails, reject and keep the previous document/selection.
7. If valid, apply through the editor transaction with an intent annotation.
8. Mark dirty; preview uses the candidate overlay immediately.
9. Persist only on explicit Save or a separately approved auto-save policy.
10. Save atomically: write a sibling temporary file, fsync/close, rename over
    the original. Never write directly over a source file.

**Implemented:** `saveSourceDocument()` accepts only project-relative `.kdm`
files, rejects path escapes and non-regular files, compares normalized disk text
with the document's saved baseline, writes through a sibling temporary file, and
returns a conflict with the current disk text instead of overwriting an external
edit.

`baseVersion` + `originalText` is the stale-edit defense. An external edit
between selection and commit makes the edit fail rather than applying offsets
to the wrong text.

**Implemented foundation:** `src/editor/source-document.ts` covers the normalized
document model, version and range checks, exact replacement, dirty tracking,
UTF-16 offsets, and newline/BOM restoration. `src/editor/validate.ts` applies the
candidate through the real `compileProject` path using `sourceOverrides`, so a
failed project validation returns the unchanged document and diagnostics. The
source-document layer is pure and performs no I/O. `src/editor/save.ts` provides
an atomic, project-relative save with external-edit conflict detection; the
Studio host still owns save UX and conflict presentation.

### 8.4 Property-to-source mapping

The inspector must not rewrite a whole element. It locates the relevant
statement or insertion point from the AST:

| Inspector property | Source representation | Edit strategy |
| --- | --- | --- |
| Text | `TextStatement.valueSpan` | Replace quoted value |
| Width / height | `SizeStatement` or kind size | Replace value or insert canonical size statement |
| Background | `BackgroundStatement` | Replace color/value or whole statement for gradient/none |
| Border | `BorderStatement` | Replace width/color/whole statement |
| Corners | `CornersStatement` | Replace radius/mode |
| Typography | `TypographyStatement` | Replace property value |
| Padding/margin | `SpacingStatement` | Replace value/sides or insert |
| Visibility | `VisibilityStatement` | Insert/remove canonical statement |
| Hover | `HoverStatement` | Replace/insert hover statement |
| Motion | `MotionStatement` | Replace/insert motion statement |

**Implemented:** `insertSourceStatement()` appends to a page, component,
variant, or element body. It infers indentation from existing children, preserves
relative indentation in multi-line statements, and returns the exact
`SourceEditRequest`. `insertValidatedSourceStatement()` wraps the planner with
full-project compilation and returns the unchanged document plus diagnostics on
failure. Neither function writes the candidate.

`planElementTextEdit()` replaces an element's quoted text literal with proper
Kadam escaping; `setValidatedElementText()` compiles the resulting candidate
before accepting it. Both preserve surrounding source and comments.

`planElementBackgroundEdit()` replaces an existing background statement with a
canonical solid, none, or gradient form; colors are validated and normalized.
`setValidatedElementBackground()` compiles the candidate. Changing a gradient to
solid/none is rejected while a gradient-direction statement would remain.

`planElementBorderEdit()` and `planElementCornersEdit()` replace their existing
statements with canonical border and radius forms; when a statement is missing,
they insert it before the first child. Their validated wrappers compile the
candidate before acceptance.
| Image source/alt/decorative | image statements | Replace value or canonical statement |
| Field label/placeholder/type/required | field statements | Replace/insert |
| Link target | `ClickStatement.action` | Replace target span |
| Layout | `LayoutStatement` | Replace/insert container statement |

The exact span shape is verified in M7.2/M7.5 with tests; the architecture does
not assume a lossless CST. Existing AST spans are sufficient for exact text
replacement, and comments/trivia outside the replaced range are untouched.

### 8.5 Insertion and formatting

When a property has no statement:

- Determine the element's opening line and indentation from the source.
- Insert after the kind sentence (or after the last existing property, according
  to a documented canonical order) using the language's canonical template.
  The implemented `before-children` placement inserts immediately before the
  first child, preserving existing statements and comments above it.
- Use the same indentation style as the surrounding block; do not reformat the
  rest of the file.
- Preserve an optional terminal period convention from nearby statements.
- Insert exactly one statement; never duplicate a property.

If a safe one-to-one source mapping does not exist, the control is disabled and
explains why. Unsupported properties are not silently faked.

### 8.6 Validation before commit

The candidate buffer is validated with the real compiler in ascending order:

1. Lex/parse the changed file.
2. Structural validation.
3. Project-wide analysis when the change affects pages, navigation, components,
   or assets.
4. Component catalog validation (after M6.1).
5. Lowering dry run to catch emission-time invariants.

Studio must use the existing `sourceOverrides` path so no temporary file is
written for validation. If validation fails, the transaction is rejected and
the previous source remains; editor undo is not polluted with an invalid edit.

**Implemented:** `applyValidatedSourceEdit()` applies the exact patch, merges it
into the current source overrides, and compiles the whole project. It returns
the unchanged document plus compiler diagnostics when validation fails.

### 8.7 Undo and redo

**Implemented foundation:** `SourceHistory` stores committed text snapshots for
one document. Undo/redo restores a snapshot with a fresh document version and
recomputes dirty state against the current saved baseline; saving a clean buffer
updates that baseline without adding a history entry.

- Inspector edits are dispatched as CodeMirror transactions, so native undo and
  redo include them.
- The transaction carries a Studio annotation (`inspector`, property id) for
  diagnostics and tests, but does not depend on annotations surviving undo.
- If the file is not open, Studio opens it first and then applies the
  transaction.
- Undo of an inspector edit revalidates and updates the preview through the
  normal overlay pipeline.
- External disk changes create a conflict state; Studio does not silently undo
  or overwrite them.

### 8.8 File operations

- Create/rename/delete are project-session operations, not raw filesystem
  paths from the browser.
- Every operation resolves a project-relative path, checks containment
  lexically and through `realpath`, rejects symlinks that escape, and refuses
  generated output and hidden/unsafe directories.
- Deleting a source file or asset requires confirmation and a reference check.
- Renaming a page updates the manifest and reports unresolved navigation
  references; automatic cross-file reference rewriting is limited to cases
  covered by a tested source-edit operation.
- File writes use the same atomic temp+rename policy as builds.

---

## 9. Inspector architecture

### 9.1 Data source

The inspector is driven by both the AST and the IR:

- AST: authored statements, exact spans, element kind, component bindings.
- IR: effective computed styles, actions, accessibility, warnings, and source
  map identity.

It must not read `getComputedStyle` from the preview as source truth. Computed
browser values can reflect user-agent CSS and viewport differences and are not
the authored language model.

### 9.2 Descriptor model

```text
InspectorSection { id, label, properties[] }

InspectorProperty {
  id
  label
  value
  effectiveValue?      // typed computed value, display-only unless editable
  editable
  reasonIfReadOnly
  control              // text, number+unit, color, select, toggle
  statementRef?        // span/type for an existing source statement
  insertionTemplate?   // canonical insertion when absent
  validation           // allowed values/capabilities from compiler tables
}
```

Capabilities come from the language registry and element kind, not a hard-coded
second model. For example, a divider does not expose shadow; an image exposes
source/alt/decorative but not text; a field exposes label/placeholder/type.

### 9.3 Sections

- Element identity: name, kind, source file, instance/definition link when
  component-aware.
- Dimensions.
- Appearance.
- Typography.
- Interactions.
- Layout.
- Accessibility fields.
- Source statement references.

Unsupported or computed-only properties are shown as read-only with a clear
reason. No property is displayed if it cannot be derived from source or
semantics.

### 9.4 Visual editing boundary

The implemented inspector supports text, background, border, and corners. When
background, border, or corners are absent, the host inserts a canonical
statement and validates the result through the normal project compilation path.
The style API extends the same pattern to typography, font family, size,
spacing, layout, shadow, visibility, hover, motion, and gradient direction.

The Layers panel supports Figma-style drag reordering: a drop on the top or
bottom edge places a layer before or after a sibling, and a drop on a
container's middle nests it inside. The host extracts and reindents the source
block, rejects self/descendant destinations and non-container parents, then
compiles the whole project before accepting the move. The existing arrow
controls remain for click and keyboard use.

The plain-English bar and Layers panel reuse those same validated operations.
The bar's searchable command reference groups the supported grammar by property
family, filters across categories, aliases, descriptions, and examples, and
fills the input with a clicked example without applying it. The reference is
UI data over the same local parser; it cannot bypass compiler validation.
Other one-to-one source properties remain later work. Freeform canvas drag/drop
layout, arbitrary CSS, and arbitrary JavaScript are out of scope. A visual
change that cannot be represented in Kadam is not offered.

---

## 10. Project session, explorer, pages, and assets

### 10.1 Session root

A Studio process has one explicit project session selected by the user. The
session root is canonicalized once. No API accepts a new root except an explicit
open/create action.

The explorer displays:

- `kadam.json`
- declared pages
- declared components (after M6.1)
- assets allowed by the manifest/compiler
- optional documentation/readme files
- generated output only as a read-only status, never as editable source

It does not expose `.git`, `node_modules`, dotfiles, environment files, logs,
or arbitrary files outside the root.

### 10.2 Page management

- Page list comes from `kadam.json`, not filename inference.
- Routes come from the manifest and compiler normalization.
- New page creates a source file and a manifest entry using existing manifest
  conventions, then validates the whole project before committing.
- Rename updates the manifest; navigation references are updated only when the
  source-edit engine can prove the target and preserve formatting.
- Invalid routes are shown as compiler diagnostics.
- Preview route switching navigates the iframe to the proxy URL derived from the
  compiler route, never a guessed filename path.

### 10.3 Asset management

- Asset list is the compiler's supported asset set, not an arbitrary directory
  dump.
- Image preview is served from the compiled preview snapshot or a safe
  project-asset endpoint; SVG is treated as untrusted image content and never
  executed as HTML.
- Import uses a safe allowlist, size limits, and project containment.
- Rename/delete checks references found in the compiled project and source AST.
- Missing assets remain compiler diagnostics (`KDM4003`).
- No image optimization or transcoding in M7.

### 10.4 New project templates

Templates are real minimal Kadam projects with a valid manifest and only
supported syntax. Proposed templates:

1. Empty project.
2. Basic website.
3. Portfolio.
4. Landing page.
5. Multi-page website.
6. Component showcase (only after M6.1).

Creation flow:

1. Choose parent directory and a new project name through the host UI.
2. Create in a temporary sibling directory.
3. Compile/check it with the real compiler.
4. On success, atomically move it into place.
5. On failure, delete the temporary directory and report diagnostics.

Templates are data, not generated HTML/CSS. They are tested as projects.

---

## 11. Diagnostics and build APIs

### 11.1 Reuse the existing diagnostic model

Studio uses compiler `Diagnostic` objects and `SerializedDiagnostic` for the
wire format. It does not define a parallel error taxonomy.

The current serialized diagnostic has file, line, column, code, severity,
message, hint, and related locations. Studio needs end offsets for editor
underlines, so the serialization should be additively extended with
`endLine`, `endColumn`, and/or `startOffset`/`endOffset`. This is a wire-format
extension, not a new format. The 100-diagnostic cap remains unchanged.

### 11.2 Studio endpoints

```text
GET  /__studio/bootstrap
GET  /__studio/tree
GET  /__studio/status
GET  /__studio/file?path=...
GET  /__studio/outline?path=...
GET  /__studio/inspect?path=...&targetId=...|offset=...
POST /__studio/check                 compile validation, no writes
POST /__studio/edit                  version-checked exact source edit
POST /__studio/property              AST-backed text/background/border/corners
POST /__studio/style                 typed selector + canonical style statement
POST /__studio/layer                 add/move/reorder/delete a layer
POST /__studio/save                  atomic, conflict-checked save
POST /__studio/reload                discard the buffer for disk text
```

All implemented mutation endpoints require the loopback Host allowlist, reject
foreign `Origin` headers, validate JSON shape, and cap body size. A per-launch
session nonce remains a hardening follow-up; it is not a substitute for origin
checks. Preview content has no credentials and cannot call these APIs through
the bridge.

The preview proxy and `/__kadam/` endpoints remain read-only and separate.
Project creation, asset management, settings, and a public build writer remain
later slices.

### 11.3 Build and check

Studio's `/__studio/check` endpoint calls the existing compiler validation path
with the current overlay. A Studio build-to-disk endpoint is not implemented;
the following remains the intended shared-writer design.

- `check` calls the existing compiler validation path with the current overlay
  and returns diagnostics without writing.
- `build` uses the same compiler result and a shared atomic output writer
  extracted from the CLI. Studio must not reimplement the output-tree swap.
- Studio never writes into the project source directory when building.
- Build status is shown in the toolbar and diagnostics panel.

---

## 12. Security model

### 12.1 Local-only boundary

- Bind to `127.0.0.1` by default; remote binding is not part of M7.
- Validate the `Host` header and reject foreign origins.
- Require same-origin browser requests for Studio APIs.
- A per-launch session nonce is a follow-up hardening item; it does not replace
  origin checks or the Host allowlist.
- Do not expose environment variables, absolute paths, source maps, or server
  internals to preview content.

### 12.2 Filesystem protection

- Project root is selected explicitly and canonicalized.
- Every path is resolved under the root with `resolve` + `relative` checks.
- Reject absolute paths, `..`, NUL, drive-letter escapes, and backslash
  confusion.
- Resolve `realpath` and reject symlink escapes; do not follow symlinks during
  explorer traversal unless a future policy explicitly approves it.
- Allowlist source extensions and compiler-supported asset extensions.
- Reject writes to generated output, `.git`, `node_modules`, environment files,
  and the project root itself.
- Atomic writes and temporary-file cleanup.
- No shell execution from project content. No `eval`, dynamic import of project
  files, or user-authored server code.

### 12.3 Preview and messaging

- The preview is treated as untrusted even when it belongs to the current
  project.
- The dev-only bridge validates parent source, origin, and message schema; it
  ignores everything else.
- Studio never accepts a file path or source text from a preview message.
- Studio APIs are not callable by preview content merely because it shares an
  origin; the bridge has no API credentials and preview content has no Studio
  session nonce.
- Set a strict Studio CSP and a framing policy; do not add `unsafe-eval` or
  broad `unsafe-inline` allowances.

### 12.4 Save and conflict safety

- Version/hash precondition on every save and source edit.
- External changes are detected by disk hash before save.
- Dirty editor state is never silently overwritten.
- Failed validation never writes a source file.
- A failed build leaves the previous output and preview intact.

---

## 13. Performance and test strategy

### 13.1 Targets to measure, not assume

Provisional targets, to be confirmed with measurements:

- Studio shell becomes interactive without waiting for a build.
- Opening a typical project does not block the main thread on file enumeration.
- Keystrokes do not wait for compilation; parse/highlight/diagnostics are
  debounced.
- Preview updates use the existing M4 debounce and full-project compile
  pipeline; no second incremental compiler is introduced.
- Editor highlighting is viewport/debounce aware and does not degrade linearly
  with total project size.
- Explorer and diagnostics rendering remain responsive at 50 pages.
- Visual selection uses the current preview source map and does not force a
  full page reload.

Measure:

- cold open of small, multi-page, component, and 50-page synthetic projects;
- initial interactive time;
- typing latency with diagnostics enabled;
- time from source change to CSS update and to HTML reload;
- preview memory and DOM element count for representative pages;
- Studio host memory and API response times.

Do not add incremental compiler caches merely to improve Studio numbers; that
requires the separate measured proposal already required by D-17.

### 13.2 Test layers

**Unit (Node, no browser)**

- source transaction application, version mismatch, stale range, newline/BOM
  handling ✅ (implemented and tested);
- project validation through `sourceOverrides` and rejection on compile errors
  ✅ (implemented and tested);
- atomic save, newline/BOM preservation, path safety, and external-edit
  conflicts ✅ (implemented and tested);
- canonical insertion and body-indentation inference ✅ (implemented and
  tested);
- compiler-validated insertion with rejection diagnostics ✅ (implemented and
  tested);
- cursor-offset outline lookup and ancestor paths ✅ (implemented and tested);
- compiler diagnostic filtering and editor offset mapping ✅ (implemented and
  tested);
- exact element text replacement, escaping, and compiler validation ✅
  (implemented and tested);
- background statement replacement for solid/none/gradient forms ✅ (implemented
  and tested);
- border and corner-radius statement replacement and insertion ✅ (implemented
  and tested);
- snapshot undo/redo with saved-state preservation ✅ (implemented and tested);
- path guard and symlink/traversal rejection;
- source-map lookup and stale build handling;
- inspector descriptor generation for each kind/property;
- property-to-source edits and canonical insertions;
- diagnostic offset conversion;
- manifest/template project generation.

**Integration (Node)**

- Studio host API against a temporary project;
- overlay preview rebuild and last-good retention;
- same-origin/Host/Origin rejection;
- save atomicity and external-change conflict;
- build/check share the compiler result;
- preview proxy streaming.

**Browser (Playwright)**

- open project, tree, tabs, editing, unsaved state, save;
- syntax highlighting and diagnostics;
- CSS-only update preserves scroll/form state;
- HTML update reloads;
- failed build preserves last-good preview and recovers;
- select button/card/nested element, navigate to source, inspect values;
- change width/background/text/radius and verify exact source and preview;
- undo/redo visual edits;
- multi-page navigation and return;
- responsive viewport dimensions;
- component instance/definition selection (only after M6.1);
- keyboard shortcuts and command palette;
- security: traversal, foreign origin, untrusted postMessage, stale edit.

**Regression**

- `npm run check` remains green after every M7 slice.
- Existing compiler, CLI, parser, semantic, server, and component tests remain
  unchanged unless a documented API extension is required.
- Golden output remains byte-identical for projects without components.

### 13.3 Browser acceptance workflow

The M7.8 acceptance flow is the one specified in the M7 brief:

1. Launch Studio.
2. Open a real project.
3. Open a page.
4. Verify highlighting.
5. Change a button background in source.
6. Trigger the normal update.
7. Verify the preview.
8. Select the button in the preview.
9. Verify the source declaration is selected.
10. Verify inspector values.
11. Change width through the inspector.
12. Verify the exact `.kdm` edit.
13. Verify preview update.
14. Undo.
15. Verify source and preview revert.
16. Introduce a syntax error.
17. Verify diagnostics.
18. Verify last-good preview remains.
19. Fix the error.
20. Verify recovery.
21. Navigate to another page.
22. Return.
23. Verify project state consistency.

Also test keyboard navigation, responsive viewports, and a project with
components after M6.1.

---

## 14. Existing files likely to change in M7

This is an impact map, not an implementation commitment.

**Compiler/server (additive, must remain Studio-independent)**

- `src/compiler/project.ts`: overlay/component-aware pipeline after M6.1;
  shared project model/source maps.
- `src/compiler/ir.ts`: component origin chain after M6.1.
- `src/compiler/manifest.ts`: `components` key and loading after M6.1.
- `src/server/dev-session.ts`: retain `PageIR.sourceMap`, overlay source map,
  source map access.
- `src/server/dev-server.ts`: expose/add Studio source-map and overlay APIs
  without changing existing SSE behavior.
- `src/server/update-plan.ts`: unchanged unless new output metadata is added.
- `src/cli/main.ts`: extract a reusable atomic output writer for Studio build;
  CLI behavior unchanged.
- New import-boundary test.

**Studio application (implemented foundation)**

- `studio/` package, host, React shell, CodeMirror adapter, preview proxy and
  bridge, and host integration tests.
- `studio/README.md` and `docs/studio-architecture.md`.
- README and roadmap status updates.
- Still later: component/asset panels, tabbed buffers, completion/hover, browser
  acceptance tests, and a Studio build endpoint.

---

## 15. M7 implementation plan

### M6.1 — Component compiler integration (prerequisite)

**Goal:** make M6 real end to end before Studio exposes component features.

- Manifest `components` list with `KDM4007`/`KDM4008` validation.
- Load/parse component files; build catalog; validate against project pages.
- Add a component-aware page parse/validate path (or extend `parseSource`
  options) so unresolved component kinds are permitted only while the catalog
  is being applied. Expand after parsing and before semantic analysis and
  lowering, then validate the expanded built-in tree; fail all-or-nothing.
- Include component files in `DevSession` watch paths and compile inputs.
- Preserve stable component instance paths, origin chains, form IDs, CSS
  classes, and source maps.
- Add a real `examples/components/` acceptance project.
- Add manifest/project/compiler/golden tests and update docs.
- Gate: no component Studio UI until this passes.

### M7.1 — Application foundation

- Studio package/workspace and build pipeline.
- Local host, loopback security, project session/open, explorer, tabs.
- Theme, layout, toolbar; save/unsaved; diagnostics summary.
- Project templates and manifest-aware page tree (page-only; components hidden
  until M6.1).
- Tests for file operations, path safety, manifest truth.

### M7.2 — Editor and language services

- CodeMirror 6 integration.
- Core-lexer-derived highlighting, line numbers, folding, brackets,
  autocomplete, hover, search/replace, multi-cursor, go-to-line.
- Diagnostics underline/gutter and navigation.
- Save, undo/redo, external-change conflict handling, keyboard shortcuts.
- Language adaptation tests and browser tests.

### M7.3 — Preview and routing

- Same-origin Studio host with reverse proxy.
- Existing dev server + SSE + update planner.
- Unsaved overlay support with last-good preservation ✅ (`DevSession` hook implemented).
- Preview controls, device viewports, external browser open, route switching.
- Source-map endpoint exposing existing `PageIR.sourceMap` ✅ (implemented).
- Preview acceptance tests.

### M7.4 — Source mapping and visual selection

- Preview bridge protocol.
- Page element selection, source span navigation, outline/breadcrumb.
- Selection preservation across rebuilds by node ID; stale/removal handling.
- Page-only tests. Component selection remains gated on M6.1.

### M7.5 — Inspector and visual property editing

- Descriptor model and section UI.
- Read-only computed/default values.
- Editable properties with exact statement mappings.
- Candidate validation and versioned transaction model.
- Visual edit undo/redo and preview consistency.
- Rejection paths and unsupported-property explanations.

### M7.6 — Components and assets

- Component browser, definitions, parameters, variants, usage, instance/
  definition navigation after M6.1.
- Asset browser, preview, import, rename/delete, references, missing assets.
- Security tests for both.

### M7.7 — Polish and operations

- Command palette, full shortcut map, workspace preferences, light/dark theme.
- Accessibility pass.
- Performance measurements and 50-page synthetic project.
- Error states, empty states, loading states.
- Documentation updates and settings persistence.

### M7.8 — Release acceptance

- Full regression suite.
- Playwright browser acceptance.
- Security tests.
- Performance report.
- Documentation and completion report with known limitations.

### Current stop point

M7.1 is implemented. M7.2 is partially implemented: highlighting, diagnostics,
save, external-change conflicts, and keyboard save work; completion, hover,
folding, search/replace, tabs, and multi-cursor remain. M7.3 preview proxying,
unsaved overlays, device viewports, route switching, and last-good behavior are
implemented. M7.4 page element selection is implemented. M7.5 supports text,
background, border, and corner editing; the wider property model is not built.
M7.6 component instance navigation and the asset browser remain gated.

---

## 16. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| M6 compiler integration is incomplete | Component Studio features cannot work; false claims | Treat M6.1 as a blocking prerequisite; hide component UI until it passes. |
| Dev server source map exists, but overlay support is still absent | Unsaved preview needs a second pipeline if the overlay is not reused | Add additive server APIs that reuse `PageIR` and `compileProject`; no second compiler. |
| Same-origin proxy changes generated URLs or SSE | Preview mismatch, broken navigation | Use the existing `basePath`, proxy `/__kadam`, preserve Host allowlist, test all routes/assets. |
| Source spans are insufficient for complex insertions | Corrupt formatting or invalid source | Exact text patches, canonical insertion rules, full candidate validation, comments/trivia preservation tests. |
| CRLF/BOM normalization loses formatting | Save rewrites line endings | Detect and restore newline/BOM; disclose mixed-ending limitation; test. |
| Component node IDs collide | Wrong element selected | M6.1 instance paths and origin maps; selection tests with duplicate-looking components. |
| External file changes race with editing | Data loss | Version/hash preconditions; conflict UI; never silent overwrite. |
| CodeMirror language adapter becomes a second grammar | Drift, wrong completions | Derive tokens/completions from core lexer/registry; boundary tests compare accepted templates. |
| Browser app cannot use a native folder picker | Weak first-run UX | Path/recent/drag-drop in M7.1; desktop wrapper or picker decision later. |
| Studio dependencies leak into compiler | Violates architecture | Separate package and import-boundary test. |
| Full rebuild per keystroke is slow | Poor responsiveness | Debounce, overlay pipeline, measure; no premature incremental compiler. |
| Preview content sends hostile messages | XSS/API abuse | Narrow bridge schema, origin/source validation, no credentials, treat preview as untrusted. |

---

## 17. Recorded decisions

The M7.1 foundation implements these decisions:

1. **M6.1 first:** complete the component compiler integration and identity
   layer before Studio component features or a component browser.
2. **Separate Studio package:** keep the compiler package framework-free and add
   `studio/` as its own application package/workspace.
3. **Local browser application:** Node host + browser UI, loopback only, with
   native folder picking deferred.
4. **CodeMirror 6** as the editor, with core-lexer/registry language services.
5. **React + Vite** as the Studio UI/build stack, with no UI kit and no
   compiler runtime dependency. Playwright is deferred until browser acceptance
   work begins.
6. **Same-origin preview proxy** over the existing dev server plus a narrow
   development-only selection bridge.
7. **Dev-only source-map endpoint** over existing `PageIR.sourceMap`, with no
   source metadata added to production output. ✅ Implemented.
8. **Versioned source-edit transactions** applied as CodeMirror transactions,
   validated with the real compiler, with no whole-file rewrites. ✅ Implemented
   end to end through the host edit and property APIs.
9. **Additive dev-server APIs** for unsaved source overlays and source maps;
   no second preview compiler. ✅ Implemented.
10. **Page-only M7.1–M7.5:** page element selection is implemented; component
    selection and instance/definition navigation remain gated.

The source-document/edit foundation lives under `src/editor/`; the Studio host
and browser shell live under `studio/`. The later slices in §15 remain.
