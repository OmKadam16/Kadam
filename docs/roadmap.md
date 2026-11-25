# Kadam Roadmap

**Current milestone:** M8 — target adapters and interop (in progress; Studio removed)
**Core specification:** [`docs/language-v0.2.md`](language-v0.2.md) (implemented)
**Target contract:** [`docs/multi-target.md`](multi-target.md) (implemented for the TypeScript and Python core targets)
**Proposed priority:** [`docs/frontend-plan.md`](frontend-plan.md) — make Kadam a full frontend language (phases F0–F7) before extending backend targets

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
M7  General-purpose core + portable IR     (complete)
M8  Target adapters + interop             (in progress; TypeScript/Python core done)
M9  Broader targets + external tooling    (planned)
```

The compiler is CLI-first. No browser editor is required at any milestone, and
no target may change the language's core semantics.

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

## M7 — General-purpose language core (complete)

**Goal:** evolve the existing declarative compiler into a typed, target-neutral
core while preserving the working static-web target.

**Specification:** [`docs/language-v0.2.md`](language-v0.2.md), implemented in
`src/v02/` and exercised by `test/v02.test.mjs`.

**Design constraint:** the browser editor has been removed. M7 is a language and
compiler milestone, not a GUI milestone.

Scope:

- Approve the v0.2 language spec for values, types, expressions, functions,
  control flow, state, modules, errors, and effects.
- Preserve the declarative UI subset as one layer of the language rather than
  the whole language.
- Define a portable core IR that contains no HTML, CSS, Python, TypeScript, or
  framework-specific concepts.
- Add explicit capability declarations so a target can reject unsupported
  effects before emission.
- Define `external` declarations and typed bindings for calling existing native
  packages without embedding another language's parser.
- Keep diagnostics, deterministic output, and source spans as hard requirements.

**Exit criteria:**

- A pure core program can be parsed, validated, and lowered to the portable IR.
- The current UI examples still compile with byte-identical output through the
  existing UI path; UI integration with the core remains deferred.
- Every semantic rule is documented and has deterministic tests.
- No target-specific syntax or framework names appear in the core IR.
- `npm run check` remains green, and the CLI still works without any GUI.

**Depends on:** M6, approval of the v0.2 language decisions.

---

## M8 — Target adapters and interop (in progress)

**Goal:** make the target-neutral core useful in real projects by shipping the
first two adapters and a reliable installation path.

**Contract:** [`docs/multi-target.md`](multi-target.md), implemented for the
TypeScript and Python core targets. The declarative web target remains on the
separate v0.1 HTML/CSS pipeline; unifying the two is still pending.

Scope:

- A stable target-adapter interface with capability checks, deterministic
  emission, and conformance fixtures.
- **TypeScript/Web adapter:** HTML/CSS plus TypeScript or React/Next-compatible
  output where the program needs a client layer.
- **Python adapter:** backend programs with Python-native modules, errors, and
  packaging.
- Generated bindings for approved `external` declarations. Kadam does not
  parse Python, TypeScript, Rust, or Java source.
- `install.sh` plus a publishable npm package exposing the `kadam` command.
- Per-target integration tests that execute the generated output.

**Exit criteria:**

- The same portable program compiles to TypeScript/Web and Python.
- Both generated programs pass the shared conformance fixtures for their
  declared capabilities.
- Python and TypeScript outputs run with their native runtimes and no Kadam
  runtime is required beyond generated support files.
- Binding calls have compile-time type checks and runtime failure tests.
- A clean machine can install the CLI with the documented bash command.

**Depends on:** M7, approved binding decisions, public IR stability.

---

## M9 — Broader targets and external tooling (planned)

**Goal:** extend the adapter matrix without changing core semantics.

Scope:

- Rust and Java adapters after the M8 adapter contract is stable.
- Language Server Protocol diagnostics, completion, and hover documentation.
- Optional VS Code integration as a separate client.
- Target capability reporting and a versioned support matrix.

**Exit criteria:**

- New adapters pass the same core conformance suite.
- LSP diagnostics match CLI diagnostics for the same source.
- Unsupported target features fail with an explicit capability diagnostic.
- No editor or target is required to use the compiler.

**Depends on:** M8, stable public AST/diagnostic APIs.

---

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| English surface grows without bound | Parser complexity, ambiguity | Canonical templates only; CI overlap test; reject synonyms |
| Built-in defaults are contested | Visual output churn | Approve Appendix A before M2; version default changes |
| Page titles as references | Broken links on rename | Clear diagnostics; consider stable page IDs before 1.0 |
| "Compatible with every language" becomes an unbounded promise | Unshippable scope and false claims | Treat targets as explicit adapters with conformance tests; publish a supported matrix |
| Backend semantics bolted onto a UI grammar | Incoherent language | Approve the typed v0.2 core before writing Python or TypeScript emitters |
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
5. CLI build/check/dev work without any editor or GUI installed.
6. The compiler has no AI, network, or model dependency.
7. Security, accessibility, and incremental-build checks pass.

---

## Recommended next step

1. Unify the v0.1 page/component surface with the v0.2 core IR so the web target
   can consume both forms without changing page output.
2. Publish the prepared `kadam` package and verify a clean global install;
   D-16's package name is selected provisionally and publication remains
   pending. The TypeScript and Python core adapters already pass executable
   conformance tests.
3. Add target-specific integration fixtures before claiming support for another
   host language.

"Compatible with everything" is not a design; a tested adapter matrix is.
