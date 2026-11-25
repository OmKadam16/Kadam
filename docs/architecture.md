# Kadam Compiler Architecture

**Status:** proposed
**Applies to:** language 0.1 / implementation 0.1
**Companion documents:** `docs/language-spec.md`, `docs/roadmap.md`,
`docs/decisions.md`

This document describes how a `.kdm` page or project becomes a static web page.
It records module boundaries, data contracts, and determinism requirements for
the v0.1 UI compiler. The repository is CLI-only; a browser editor is not part
of this architecture.

The separate `kadam 0.2` core has its own lexer, parser, type checker, portable
IR, and TypeScript/Python emitters under `src/v02/`. That pipeline is documented
in [`language-v0.2.md`](language-v0.2.md) and
[`multi-target.md`](multi-target.md); it does not share page IR or HTML/CSS
emission.

---

## 1. Constraints

The architecture is driven by these non-negotiable constraints:

1. `.kdm` is the source of truth; generated output is disposable.
2. Parsing and analysis are deterministic and contain no AI or network access.
3. HTML, CSS, and JavaScript are emitted as separate files.
4. The repository is CLI-only; no browser editor is bundled or required.
5. Incremental recompilation must be possible from the first release.
6. Every diagnostic identifies file, line, column, and a stable code.
7. The implementation uses TypeScript and Node.js built-ins, with no runtime
   dependencies.
8. Do not build a UI or the full language before the core pipeline is proven.

---

## 2. System context

```text
┌─────────────────────────────────────────────────────────────────┐
│ Kadam repository                                                │
│                                                                 │
│  kadam.json + .kdm files + assets                               │
│            │                                                    │
│            ▼                                                    │
│  ┌──────────────────────┐        ┌─────────────────────────┐   │
│  │ core                 │        │ compiler                │   │
│  │ lexer → parser → AST │───────▶│ lowering → IR → emitters│   │
│  │ semantics/type check │        │ project graph + cache   │   │
│  └──────────┬───────────┘        └────────────┬────────────┘   │
│             │ diagnostics/AST                  │ files          │
│             ▼                                  ▼                │
│  ┌──────────────────────┐        ┌─────────────────────────┐   │
│  │ server (dev only)    │        │ runtime (browser, only  │   │
│  │ watch, SSE, overlay  │        │ when interactions need  │   │
│  └──────────┬───────────┘        │ JavaScript)             │   │
│             │                    └─────────────────────────┘   │
│             ▼                                                   │
│  ┌──────────────────────┐                                       │
│  │ CLI                  │                                       │
│  └──────────────────────┘                                       │
│                                                                 │
│  ┌──────────────────────┐                                       │
│  │ editor (future)      │  consumes core/compiler/server APIs   │
│  └──────────────────────┘  never imported by them               │
└─────────────────────────────────────────────────────────────────┘
```

The compiler itself is an in-process library. The CLI and development server
are adapters around it. The editor is another adapter.

---

## 3. Module layout

```text
src/
  core/                    Language front end; no file-system or network I/O
    source/                SourceFile, spans, line maps, in-memory overrides
    lexer/                 Text → tokens (including comments/trivia)
    parser/                Tokens → AST via the template table
    ast/                   JSON-serializable node definitions
    semantics/             Symbols, kind registry, references, required content
    types/                 Value domains and capability checks
    diagnostics/           Codes, severities, formatting, suggestions
  compiler/                Front end consumer and code generation
    project/               kadam.json, route map, file graph, cache
    ir/                    Backend-neutral page/style/interaction model
    passes/                Defaulting, canonical ordering, validation
    emit-html/             Semantic HTML emitter
    emit-css/              Deterministic CSS emitter
    emit-js/               Runtime module emitter (future)
  runtime/                 Browser runtime, if and when needed
  server/                  Dev server, watcher, SSE live reload
  cli/                     Argument parsing and command orchestration
  index.ts                 Public Node API for future clients
```

### 3.1 Dependency rule

Imports point inward:

```text
server ──▶ compiler ──▶ core
   │           │
   └───────────┴──────────▶ public API
cli ─────────────────────▶ compiler, server, core
runtime  (no compile-time imports from the toolchain)
```

No module in `core` or `compiler` may import `server` or `cli`. There is still
no automated import-boundary test; it remains a review rule.

### 3.2 Why one package

The repository is a single npm package with internal folders, not a monorepo.
At M0 this minimizes tooling and dependency noise. The dependency graph above
is already package-shaped, so extracting `@kadam/core`, `@kadam/compiler`, and
`@kadam/server` later is mechanical. The decision is recorded as `D-15` and
should be revisited when the editor or LSP ships.

---

## 4. Compiler pipeline

### 4.1 Stage 1 — Project loading

Inputs: project directory, `kadam.json`, source files, assets, and optional
in-memory source overrides.

Responsibilities:

- Validate and parse the manifest.
- Resolve page files relative to the project root.
- Reject paths outside the root, including symlink escapes.
- Build the route map and validate route syntax and uniqueness.
- Read sources as UTF-8 and normalize line endings.
- Sort files by project-relative path using code-point order.
- Verify the manifest language version against the compiler.

Output: a `LoadedProject` containing source files, manifest data, and asset
metadata. Missing or invalid input produces `KDM4xxx` diagnostics.

### 4.2 Stage 2 — Lexing

The lexer is generic and line-aware. It emits tokens with full spans and
preserves trivia (comments and blank-line information) in a side channel. It
does not know whether `blue` is a color or `button` is a kind; that is the
parser's job.

Token categories: identifier, string, number, length, duration, percentage,
hex color, word, punctuation, newline, comment, EOF.

Numeric and unit folding happens here so that `160px` and `160 px` are one
length token with the same value. Invalid escapes, malformed units, and
unterminated strings become `KDM1xxx`.

### 4.3 Stage 3 — Parsing

Kadam is line-oriented. The parser:

1. Splits input into logical lines while respecting strings and comments.
2. Recognizes version, page header, element headers, and closing braces.
3. Enforces that page and element blocks are properly nested.
4. Matches each statement against the **template registry** from the language
   specification.
5. Enforces that the kind sentence is first and appears once.
6. Builds an AST with a span on every node and preserves source offsets for
   later editor patching.
7. Recovers at statement and block boundaries to report multiple independent
   errors, but never guesses an interpretation.

The parser is hand-written and table-driven. It does not use a general NLP
library, grammar inference, or an LLM. A PEG parser is unnecessary because
statements are single lines and blocks are brace-delimited.

If one line matches multiple templates, that is a compiler defect (`KDM9001`),
detected by a CI test that enumerates the registry. If a line matches none, the
parser emits `KDM2001` and up to three deterministic suggestions.

Output: `ParsedFile { ast, tokens, diagnostics }`.

### 4.4 Stage 4 — Semantic analysis

Semantic analysis is a set of passes over the project, not a single traversal:

1. **Page symbols:** collect titles, routes, and files; detect duplicates.
2. **Element symbols:** collect names per page, detect duplicates.
3. **Kind resolution:** validate every kind sentence against the registry in
   §5.2 of the language spec.
4. **Structure:** enforce leaf/container rules and nesting limits.
5. **References:** resolve navigation targets by page title.
6. **Required content:** button/link text, heading/paragraph text, image
   source + alt/decorative, field label, link action.
7. **Assets:** resolve image sources inside the project, verify existence and
   extension.
8. **Statement capability:** reject appearance/event/motion statements that do
   not apply to the kind (`KDM3003`).

The result is a `SemanticModel` containing resolved symbols and diagnostics.
No generated markup or CSS exists at this stage.

### 4.5 Stage 5 — Type checking

Type checking validates every statement slot after names are resolved:

- lengths and durations: syntax, non-negative bounds, non-zero durations;
- colors: named-color table and hex well-formedness;
- percentages: hover scale range;
- text and URLs: non-empty and scheme rules;
- responsive scopes: allowed statement families;
- duplicates: property scopes and side expansion;
- event rules: hover-border base requirement, gradient-background hover
  restriction, click targets.

Type checking is separate from symbol resolution so that editor tooling can
re-run it cheaply on an unsaved buffer with a known symbol table.

### 4.6 Stage 6 — IR lowering

The intermediate representation is backend-neutral. It resolves defaults and
scopes, but contains no HTML tags or CSS syntax.

```text
PageIR
  route, outputPath, title, sourceFile, sourceMap
  elements: ElementIR[]
  pageStyle: { background, text, font }
  assets: AssetRef[]
  diagnostics

ElementIR
  nodeId, sourceSpan, name, kind
  tagRole             // semantic role, not an HTML string
  children[]
  computedStyle       // typed properties after defaults/precedence
  responsive[]        // per-breakpoint overrides, already validated
  hover[]             // typed effect list
  motion?             // entrance animation
  action?             // navigation/external
  content?            // text, label, placeholder, alt, source
```

Lowering applies the precedence order from the language specification:
responsive override → base declaration → page default → kind default. It also
assigns stable node IDs and class names from route slug + element name. The root
route `/` has slug `home`; other routes join their path segments with `-`.

### 4.7 Stage 7 — HTML emission

The HTML emitter maps semantic roles to tags and produces one document per
route. It is responsible for:

- escaping text and attributes;
- deterministic attribute order;
- label/input association and generated IDs;
- anchor-vs-button selection for navigation;
- `data-kdm-id` attributes for tooling;
- image width/height attributes when explicitly sized;
- referencing the correct page CSS and JS files.

It emits no inline styles and no inline scripts.

### 4.8 Stage 8 — CSS emission

The CSS emitter consumes `computedStyle` and emits:

- a shared base stylesheet (reset, tokens, kind defaults);
- one page stylesheet with class rules in deterministic source order;
- responsive blocks in fixed phone/tablet/desktop order;
- hover rules inside the hover-capability media query;
- a reduced-motion block when motion is used;
- focus-visible rules for interactive elements.

Class names are ASCII-safe and derived only from the route slug and element
name. No CSS is generated from file modification times or hash salts.

### 4.9 Stage 9 — JS emission (future)

v0.1 emits no JavaScript. The stage exists for later declarative actions that
cannot be handled by HTML/CSS. When it is implemented, output is an external ES
module with no imports, no eval, and no framework. It consumes a typed action
list from the IR, never raw source text.

### 4.10 Stage 10 — Output

Writes are atomic per file and happen only if the project has zero errors.
Stable output layout:

```text
dist/
  index.html                  route /
  about/index.html            route /about
  assets/
    kadam.css                 shared reset + kind defaults
    kadam.home.css            page styles for route /
    kadam.about.css           page styles for route /about
    kadam.manifest.json       plan, node map, hashes (no timestamps)
    ...copied project assets
```

Routes map to directory-style output so static hosts can serve clean URLs
without runtime rewrites. Internal links, stylesheet URLs, and asset URLs are
root-relative with a trailing slash except for `/`. Deployment under a URL
subpath is supported with the `basePath` manifest property or the
`--base-path` CLI flag, which prefixes every generated URL. No host-specific
configuration or client-side router is required.

The compiler never writes into the source directory. A project build stages the
entire output tree in a sibling directory and swaps it into place with renames,
so a failed build leaves the previous output untouched and stale files from an
earlier build do not survive. Because the output directory is replaced as a
unit, the writer refuses a directory that is the project root, is an ancestor
of the project, contains `kadam.json` or a `.kdm` file, or contains symbolic
links. Per-file ownership tracking (`kadam.manifest.json`) is deferred to the
incremental milestone.

---

## 5. Data contracts

These are proposed TypeScript shapes, not final implementation code. All
syntax nodes are plain JSON-serializable data so the editor and server can
exchange them without sharing classes.

### 5.1 Source and spans

```ts
interface SourceFile {
  readonly path: string;        // project-relative, "/"-separated
  readonly text: string;        // normalized UTF-8 text, LF line endings
}

interface Position {
  readonly offset: number;      // UTF-16 code unit offset
  readonly line: number;        // 1-based
  readonly column: number;      // 1-based, in code points
}

interface Span {
  readonly file: string;
  readonly start: Position;
  readonly end: Position;
}
```

Every token, AST node, diagnostic, and IR node carries a span. Spans are the
foundation of editor integration and must not be added later as an
afterthought.

### 5.2 Diagnostics

```ts
type Severity = "error" | "warning" | "info";

interface Diagnostic {
  readonly code: string;        // "KDM3003"
  readonly severity: Severity;
  readonly message: string;
  readonly span: Span;
  readonly hint?: string;
  readonly related?: ReadonlyArray<{ span: Span; message: string }>;
}
```

Warnings and info are reserved in v0.1; the compiler emits errors only. The
shape supports future contrast warnings and deprecations without changing the
transport.

### 5.3 AST

```ts
interface PageNode {
  readonly type: "page";
  readonly title: string;
  readonly settings: PageSettingNode[];
  readonly elements: ElementNode[];
  readonly span: Span;
}

interface ElementNode {
  readonly type: "element";
  readonly name: string;
  readonly kind: KindNode;
  readonly statements: StatementNode[];
  readonly children: ElementNode[];
  readonly span: Span;
}
```

Statement nodes are discriminated unions (`size`, `background`, `border`,
`typography`, `hover`, `click`, `animation`, `responsive`, and so on). The AST
preserves source text and trivia for the editor but contains no resolved
colors, computed styles, or generated names. Those belong to semantic analysis
and IR.

### 5.4 Manifest

```ts
interface KadamManifest {
  readonly kadam?: string;                   // "0.1" when present
  readonly name: string;
  readonly version?: string;
  readonly pages: ReadonlyArray<{
    readonly source: string;                 // project-relative .kdm path
    readonly route: string;                  // starts with "/"
    readonly title?: string;                 // must equal the page title
  }>;
  readonly assets?: string;                  // default "assets"
  readonly outDir?: string;                  // default "dist", project-relative
  readonly basePath?: string;                // deployment prefix, e.g. "/site"
}
```

See [`docs/project-manifest.md`](project-manifest.md) for the schema,
validation rules, output layout, and asset pipeline.

Validation rules: at least one page; unique files and routes; routes start
with `/`, contain no `..`, query, or hash; every file exists and contains one
page; asset directory, if present, is inside the project. Unknown manifest
keys are errors so typos are not ignored.

### 5.5 Compile result

```ts
interface CompileOptions {
  readonly projectRoot: string;
  readonly outDir?: string;
  readonly write: boolean;
  readonly sourceOverrides?: ReadonlyMap<string, string>; // editor buffers
  readonly signal?: AbortSignal;
}

interface CompileResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly files: readonly OutputFile[];
  readonly graph: ProjectGraphSnapshot;
}
```

`sourceOverrides` is how the future editor analyzes unsaved files without
writing to disk. The compiler does not care whether a source came from a file
or a buffer.

---

## 6. Incremental compilation

The first implementation may rebuild the whole project. The architecture must
still make incrementality possible without rewriting every stage.

### 6.1 Pure stages

Each stage is a pure function of explicit inputs plus a context:

```text
lex(SourceFile, limits)                         -> LexResult
parse(tokens, templateRegistry, version)        -> ParseResult
analyze(projectSymbols, ParsedFile[])           -> SemanticModel
typecheck(SemanticModel, typeTables)             -> TypedModel
lower(TypedModel, defaults, route)               -> PageIR
emit(PageIR, emitterOptions)                     -> OutputFile[]
```

I/O is confined to project loading, asset reading, writing, and watching.
This keeps stages testable and lets the editor run them on in-memory buffers.

### 6.2 Cache keys

- Parse cache: hash(source bytes) + parser/template version.
- Analysis cache: hash(parse AST) + fingerprints of referenced pages,
  components, assets, and language registry.
- Emission cache: hash(IR) + emitter version + output options.
- Asset copy cache: hash(asset bytes) + output path.

Hashes are content hashes, never mtimes. A cache hit and a cold build must
produce identical bytes; cache correctness is covered by tests.

### 6.3 Dependency graph

Nodes: manifest, page files, components (future), assets, and page symbols.

Edges include:

- page → its source file;
- page → every page title it navigates to (a title rename invalidates inbound
  navigation);
- page → every asset it references;
- component instance → component declaration and parameter types;
- page → page-level defaults and shared registry version.

When a file changes, only its parse is invalidated. When its page title or
exported symbols change, dependent pages are re-analyzed. When only a style
changes, only that page's IR and CSS/HTML are re-emitted.

### 6.4 Failure behavior

- A failed build never overwrites previously successful output files.
- The development server keeps the last successful output and overlays
  diagnostics.
- A cache write is atomic (temporary file + rename).
- Caches can be deleted at any time; a cold build is always correct.

Incremental compilation is scheduled for M5, after the full pipeline and its
golden tests exist. Building caches before the pipeline is stable would hide
bugs rather than save time.

---

## 7. Development server and live preview

`kadam dev` composes the compiler and a Node `http` server. It introduces no
language rules and no framework.

Responsibilities:

- Compile on startup; report diagnostics in the terminal.
- Serve pages at their manifest routes:
  `/` → `dist/index.html`, `/about` → `dist/about/index.html`.
- Serve generated CSS/JS and copied assets with correct MIME types and caching
  disabled in development.
- Watch `.kdm`, `kadam.json`, and asset files. Debounce bursts (for example,
  50 ms), then request an incremental rebuild.
- Expose server-sent events at `/__kadam/events` for reload, diagnostic, and
  status messages. SSE avoids adding a WebSocket dependency.
- Inject a tiny development-only client script that reconnects and reloads, or
  displays an error overlay. The script is not part of production output.
- Bind to `127.0.0.1` by default; a `--host` option is an explicit opt-in.
- Reject path traversal, symlink escapes, and requests outside the output root.
- Report compile duration and affected files in the terminal.

The server holds no editor-specific logic. A future preview pane can connect
to the same SSE endpoint and receive the same diagnostics JSON. Hot module
replacement is explicitly not a goal; full-page reload is sufficient and
predictable.

---

## 8. Editor boundary

The browser editor was removed in the CLI-first reset. The repository contains
no editor host, browser UI, embedded source editor, or editor-only server API.
The compiler and development server remain independent of any future external
language tooling.

---

## 9. Runtime boundary

v0.1 has no browser runtime. The `runtime/` folder exists for later stateful
actions (show/hide/toggle, menus, and similar) and is emitted only when the IR
contains actions that require it.

Runtime rules:

- Declarative action list, no eval and no user code.
- No framework, no third-party dependency.
- Keyboard and focus behavior are handled explicitly.
- The runtime is an external module, compatible with a strict CSP.
- Missing JavaScript must degrade to a readable static page where possible.

The runtime never parses `.kdm` and never contains language rules.

---

## 10. Testing strategy

Use the Node.js built-in test runner. No test framework dependency.

### 10.1 Unit tests

- Lexer: every token type, escapes, units, comments, line endings, spans.
- Parser: every canonical template, optional terminal period, block errors,
  kind-first enforcement, recovery.
- Template registry: prove every fixture line matches exactly one template;
  ensure new templates do not overlap.
- Semantics: symbols, duplicates, references, required content, leaf rules.
- Types: every value domain and boundary, responsive restrictions, hover
  constraints.
- Emitters: deterministic class names, escaping, attribute order, CSS order.

### 10.2 Golden tests

- `examples/portfolio/` compiles to a checked-in expected `dist/` tree.
- The canonical example in the language spec is a fixture.
- Generated files are compared byte-for-byte.
- Snapshot updates are explicit (`npm run test:update` later), reviewed like
  source changes.

### 10.3 Invalid fixtures

Each invalid fixture declares its expected diagnostic code, line, and column.
The test fails if the compiler emits a different code, misses an error, or
emits an extra error. This prevents accidental acceptance of malformed English.

### 10.4 Determinism

Every golden project is compiled twice in different temporary directories and
with different time zones/locales where practical. Output trees must be
identical. The compiler should be tested with randomized file discovery input
to prove sorting is stable.

### 10.5 Integration

- `kadam build` produces the expected tree and exit code.
- `kadam check` writes nothing and reports diagnostics.
- `kadam dev` serves routes, emits SSE events, and recovers from a failed
  rebuild.
- No compiler test may access the network.

Fuzzing the lexer/parser for crashes is planned after M1. A crash on arbitrary
input is always a bug, but it must never produce guessed output.

---

## 11. Security and safety

Kadam is a compiler for local source, but generated pages are deployed to the
web. The following rules are part of the architecture:

- **No network during compilation.** No package fetching, font fetching,
  telemetry, or model calls. This also protects determinism.
- **Escaping by default.** All text and attribute values are escaped for their
  context. Raw HTML is not part of the language.
- **Path containment.** Source, assets, and output paths are resolved and
  checked against the project root. Absolute paths, `..`, and symlink escapes
  are rejected.
- **URL restrictions.** Only absolute `http`/`https` URLs in click actions.
  New-tab links use `noopener noreferrer`.
- **No user JavaScript or inline scripts.** Later runtime output is an external
  ES module, compatible with a strict CSP.
- **Output ownership.** The writer only deletes files listed in its own
  manifest, never arbitrary files in `dist/`.
- **Resource limits.** File size, line length, nesting depth, and diagnostic
  count are bounded to prevent pathological input from exhausting memory.
- **Local dev server.** Bound to loopback by default, with traversal checks and
  no directory listing outside generated output.
- **Dependency policy.** No runtime dependencies; dev dependencies are
  reviewed and pinned. The language toolchain must not depend on a model or a
  remote service.

A future component registry or package manager will need a separate supply
chain and trust design. It is not in scope for v0.1.

---

## 12. Performance

Correctness and determinism come first; performance targets are provisional
until the first end-to-end build:

- Lexing/parsing should be linear in source size.
- A cold build of 50 pages should stay under one second on a modern laptop.
- Incremental changes should re-emit only affected pages and shared files.
- The dev server should reload within 150 ms of a saved change for small
  projects.

No premature optimizer is planned. CSS deduplication, minification, asset
hashing, and compression are output optimizations for a later milestone and
must never change semantics. If added, they require determinism tests and an
option to disable them.

---

## 13. Public API and evolution

`src/index.ts` is the intended stable entry point for Node consumers. It will
expose:

```ts
compileProject(options: CompileOptions): Promise<CompileResult>
checkProject(options: CompileOptions): Promise<CompileResult>
```

The AST and diagnostics formats are versioned alongside the language. Breaking
API changes follow semantic versioning of the implementation. Internal modules
under `src/core` and `src/compiler` are not public until they are explicitly
exported.

Future extraction path:

1. M5–M6: keep one package, add cache and dev server.
2. M7: extract `@kadam/core` if the editor needs a smaller dependency surface.
3. M8: add `@kadam/language-server` consuming the same core.
4. Later: publish CLI, editor, and component library independently.

This preserves the option to split without paying monorepo costs now.

---

## 14. Explicit non-goals for the first implementation

- No LLM, NLP model, prompt parser, or semantic similarity matching.
- No React/Vue/Svelte runtime or component framework in generated output.
- No user-authored CSS/JS/HTML.
- No general-purpose expression language.
- No hot module replacement.
- No visual editor or browser GUI in the repository.
- No plugin system, package registry, or cloud renderer at M0.
- No premature caching before the uncached pipeline is correct.

If a requirement needs one of these, it must go through the decision log first.
