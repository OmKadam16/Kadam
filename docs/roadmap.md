# Kadam Roadmap

**Current milestone:** M7 — visual editor alpha (M7.1 foundation implemented)

The roadmap is ordered by dependency, not by feature appeal. Each milestone has
an exit criterion that is objectively testable. No milestone starts before the
language decisions it depends on are approved.

---

## Guiding sequence

```text
M0  Specification and foundation          (complete)
M1  Lexer, parser, AST, diagnostics
M2  Semantics + static HTML/CSS compiler
M3  Layout, responsive design, multi-page projects
M4  Development server + live preview
M5  Motion and declarative interactions   (complete)
M6  Reusable components (+ library seed)  (complete, M6.1)
M7  Visual editor alpha + source mapping       (M7.1 foundation implemented)
M8  Two-way editing + VS Code integration
```

The compiler never waits for the editor. The editor is always a client of an
already working headless toolchain.

---

## M0 — Foundation and specification ✅

**Goal:** make the language and architecture reviewable before implementation.

Deliverables:

- Repository scaffold, TypeScript build, test runner, CLI stub.
- Language specification with syntax, semantics, defaults, and diagnostics.
- Compiler architecture and module boundaries.
- Roadmap and decision log.
- Target example projects, including the smallest M2 fixture (`examples/hello.kdm`).

**Exit criteria:**

- `npm run check` passes.
- Every major language decision has a recorded trade-off.
- No compiler or editor implementation is claimed.

---

## M1 — Language front end ✅

**Goal:** deterministic source-to-AST pipeline with production-quality
diagnostics.

Scope:

- Source manager, spans, line maps, UTF-8/LF normalization.
- Lexer for all v0.1 tokens, trivia, and limits.
- Template registry and hand-written line-oriented parser.
- AST node types and JSON serialization.
- Syntax error recovery and deterministic suggestions.
- Template-overlap test proving one match per canonical line.
- Valid/invalid fixtures from the specification.
- `kadam parse` internal command (or `check --ast`) for debugging.
- Front-end structural checks required by the language surface: unknown kinds,
  statement capability, duplicate names and properties, and value combinations.
- No HTML/CSS emission yet. Project-wide semantics (required content,
  navigation targets, duplicate titles, assets) remain in later milestones.

**Exit criteria:**

- All valid fixtures parse; every invalid fixture reports the expected code,
  line, and column.
- Every statement template matches exactly one registry entry.
- Parser never crashes on arbitrary input; fuzzing begins.
- ASTs expose spans for every node.

**Depends on:** approval of `D-01` through `D-05`.

---

## M2 — Semantic analysis and static compiler ✅

**Goal:** compile the core language to semantic HTML and separate CSS for a
single page.

Scope:

- Page, element, and kind symbol tables.
- Capability tables and type checking.
- Required-content and accessibility rules.
- IR lowering with defaults and precedence.
- HTML and CSS emitters.
- Base stylesheet and built-in design tokens (Appendix A).
- Deterministic class names and `data-kdm-id`.
- `kadam build` and `kadam check` for a single file or minimal project.
- Golden output for `examples/hello.kdm`, the single-page core fixture.
- No JavaScript, motion, hover, or responsive rules yet.

**Exit criteria:**

- `examples/hello.kdm` compiles to valid HTML/CSS with no errors.
- Golden output is byte-identical across two builds.
- Every semantic/typed error code implemented in M2 has at least one test.
- Generated HTML passes an accessibility smoke test for the kinds implemented in
  M2 (heading and button text).

**Depends on:** M1, approval of `D-06` and `D-13`.

---

## M3 — Layout, responsive behavior, and multi-page projects ✅

**Goal:** build a real static site from a project manifest.

Scope:

- Page settings and page-default typography.
- Container/card/navigation layout statements.
- Spacing and size behavior.
- Three fixed breakpoints and responsive overrides.
- Manifest loading, route validation, and multi-page output.
- Internal navigation by page title.
- Static link resolution and route generation.
- A reduced multi-page fixture covering page settings, layout, spacing,
  responsive statements, and navigation becomes a required build fixture.
- Deterministic CSS ordering across breakpoints.

**Exit criteria:**

- The reduced multi-page fixture builds and navigates between pages without
  JavaScript; it covers all three breakpoints.
- Responsive golden tests cover phones/tablets/desktops.
- Duplicate titles, unknown references, and duplicate routes fail with the
  documented codes.
- Output remains byte-identical across machines.

**Depends on:** M2, approval of `D-08`, `D-09`, `D-14`.

---

## M4 — Development server and live preview ✅

**Goal:** edit `.kdm` files and see the result in a real browser with no manual
build step, without changing the static output model.

Scope:

- `kadam dev`: an in-memory adapter over the existing `compileProject`
  pipeline; no duplicated compilation logic.
- Native Node.js HTTP server bound to `127.0.0.1` by default.
- Recursive file watching with debounce, relevance filtering, and a polling
  fallback.
- Server-Sent Events for build status, CSS-only swaps, full reloads, and
  shutdown.
- Diagnostic overlay that preserves the last successful preview and clears
  automatically after a fix.
- `kadam check`: validation without output or a server.
- No new runtime dependencies.

**Exit criteria:**

- Editing a page updates the connected browser automatically.
- Style-only edits swap CSS without a full reload; HTML changes reload.
- A syntax error shows an overlay while the last good page keeps serving, and
  recovery is automatic.
- Loopback binding, Host validation, traversal rejection, and source/secret
  non-exposure tests pass.
- `kadam check` writes nothing, modifies nothing, and exits nonzero on errors.
- Development output is byte-identical to `kadam build` apart from the injected
  client tag.
- Full build and check suites remain green.

Incremental compilation and content-hash caches are deliberately deferred; a
separate measured proposal is required before changing `compileProject`.

**Depends on:** M3, approval of `D-17`.

---

## M5 — Motion and declarative interactions ✅ Approved

**Goal:** cover the remaining v0.1 visual surface and add behavior that needs a
runtime only where unavoidable.

Scope:

- Hover effects and transitions, emitted behind the hover media query.
- Entrance animations and reduced-motion handling.
- External links in new tabs.
- Focus-visible policy.
- Text fields, images, dividers, shadows, gradients.
- JS emitter and a minimal runtime for show/hide/toggle only if `D-12` is
  amended to elevate those actions into the v0.1 surface.
- Interaction and accessibility tests.
- `examples/portfolio/` and the canonical example become required build
  fixtures.

**Exit criteria:**

- Hover and motion produce no layout shift.
- `prefers-reduced-motion` removes all authored motion.
- Navigation works with JavaScript disabled.
- Runtime JavaScript, if emitted, is a single external module with no inline
  code and passes the CSP smoke test.
- The full v0.1 language surface in the specification is implemented. Stateful
  actions remain out of scope unless `D-12` changes.
- The portfolio example builds with zero diagnostics and deterministic output.

**Depends on:** M4, approval of `D-12`.

**Implementation notes (M5 complete):**

- Hover transitions cover every supported kind, stay behind the hover media
  query, and never change layout. Text-field transitions target the native
  input.
- Entrance fade and slide animations use transform and opacity only.
  `prefers-reduced-motion: reduce` disables animations and hover transitions.
- External links use `target="_blank"` with `rel="noopener noreferrer"`;
  internal navigation remains ordinary same-tab anchors.
- Interactive elements receive the automatic `:focus-visible` ring.
- Divider shadow is rejected (`KDM3003`), and a hover background is rejected
  when any responsive scope uses a gradient (`KDM3015`).
- The 64-level nesting limit (`KDM2011`) and the 100-diagnostic cap (`KDM9003`)
  are enforced.
- `examples/canonical/` was added as the exact §16.1 fixture with the required
  `About` page; it builds deterministically alongside `examples/portfolio/`.
- D-12 is approved and implemented. D-18 records that v0.1 emits no JavaScript;
  stateful actions remain out of scope.

---

## M6 — Reusable components ✅

**Goal:** eliminate repeated UI structure without introducing general logic.

**Status:** implemented in M6.1 and exercised by `examples/components/`.
Components live in their own manifest-listed files and expand at compile time,
so `PageIR`, HTML, and CSS never contain a component kind. The dev server
watches component files and rebuilds the project when one changes.

Scope:

- Component files, declarations, typed parameters, instances.
- Parameter validation and compile-time interpolation.
- Scoped class names and stable instance node IDs.
- Cross-file dependency tracking for incremental builds.
- First built-in component library seed (buttons, cards, navigation patterns
  expressed in Kadam itself).
- Component diagnostics and golden tests.

**Exit criteria:**

- The component syntax proposal (`D-10`) is approved and implemented.
- Missing, unknown, duplicate, and mistyped parameters fail deterministically.
- The example project uses at least one component without duplicated styles.

**Deferred from the original scope:** component-aware incremental re-emission
(`kadam dev` rebuilds the whole project deterministically) and a packaged
component library beyond `examples/components/`.

**Depends on:** M5, approval of `D-10`.

---

## M7 — Visual editor alpha

**Goal:** inspect and modify an existing project through a visual surface while
the source remains authoritative.

**Implementation note:** the M7.1 Studio foundation is implemented in
`studio/`. It includes a React + CodeMirror 6 browser shell, a loopback Node
host with project bootstrap/tree/file/outline/inspect/check/edit/property/
save/reload APIs, a same-origin `/__preview/` proxy over the existing dev
server, a development-only selection bridge, click-to-source, device preview,
diagnostics, and inspector editing for text, background, border, and corners.
Seven host integration tests cover the APIs, unsaved preview, save conflicts,
proxy streaming, and security boundaries. Component instance/definition
navigation, the asset browser, completion/hover, tabs, and Playwright browser
acceptance remain later slices.

Scope:

- Browser-based editor shell.
- Outline/inspector driven by the AST.
- Click-to-source using `data-kdm-id` and the node map.
- One-way visual editing: changes produce minimal source patches.
- Live preview through the development server.
- Diagnostic display and file navigation.
- No arbitrary canvas, undo stack, or multi-user features yet.

**Exit criteria:**

- Selecting a preview element opens its source location.
- Editing a supported property updates the `.kdm` file and preview.
- Comments and formatting outside the edited span are preserved.
- Compiler remains fully usable through the CLI without the editor.
- Editor cannot load or compile files outside the project root.

**Depends on:** M5, stable spans and source patching from M1.

---

## M8 — Two-way editing and VS Code integration

**Goal:** make Kadam usable in both custom and standard development
environments.

Scope:

- Direct source edits update preview and inspector.
- Undo/redo and conflict handling based on source offsets.
- Language Server Protocol foundation: diagnostics, completion of templates,
  hover documentation, go-to-definition for pages.
- VS Code extension shell using the language server.
- Packaging and installation documentation.

**Exit criteria:**

- Source and visual edits can alternate without corrupting the file.
- LSP diagnostics match CLI diagnostics for the same source.
- Completion suggests only canonical templates.
- Extension can be installed from a local package and used on the example
  project.

**Depends on:** M7, public AST/diagnostic API stability.

---

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| English surface grows without bound | Parser complexity, ambiguity | Canonical templates only; CI overlap test; reject synonyms |
| Built-in defaults are contested | Visual output churn | Approve Appendix A before M2; version default changes |
| Page titles as references | Broken links on rename | Clear diagnostics; consider stable page IDs before 1.0 |
| Two-way editing loses formatting | Editor trust | Spans/trivia from M1; minimal text patches; CST escape hatch |
| Incremental cache hides bugs | Wrong output | Cold-build comparison in CI; hash keys, no mtimes |
| Scope creeps into app framework | Unbounded design | Defer state/data/forms; require decision records |
| Accessibility promised but not tested | User harm | Required-content rules and automated smoke tests from M2 |
| Component design is rushed | Breaking syntax | Keep provisional until M6; separate approval |
| Dev server becomes a bundler | Dependency creep | SSE + native HTTP only; no HMR requirement |
| TypeScript/tooling churn | Maintenance | Single package, pinned dev deps, Node built-in tests |

---

## Definition of done for language v0.1

Kadam 0.1 is complete when:

1. Every construct in `docs/language-spec.md` is implemented and tested.
2. The portfolio example builds with zero diagnostics.
3. Output is deterministic and JavaScript-free unless an approved interaction
   requires it.
4. Errors carry stable codes and correct spans.
5. CLI build/check/dev work without the editor installed.
6. The compiler has no AI, network, or model dependency.
7. Security, accessibility, and incremental-build checks pass.

---

## Recommended next step

1. Review and approve or amend decisions `D-01` through `D-14` in
   `docs/decisions.md`.
2. Freeze the v0.1 template table.
3. Start M1: source manager → lexer → parser → AST → diagnostics, using the
   specification fixtures as the acceptance suite.

Do not begin M2 code generation until the front end can prove deterministic
parsing and precise diagnostics. The compiler's credibility depends on that
foundation.
