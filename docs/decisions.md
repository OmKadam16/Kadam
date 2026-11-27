# Kadam Decision Log

This log records decisions that shape the language and toolchain. A decision is
not final until its status says **Approved**. Proposals include alternatives and
trade-offs so the team can change course cheaply.

**Status values:** Proposed · Approved · Rejected · Superseded · Deferred

Language decisions released in a version are stable under the versioning policy
in the language specification, Appendix B.

---

## Decisions adopted for M0 (reversible)

These are project-management and scaffolding choices, not language semantics.
They can be changed without a language-version bump.

- **M0-1 — Documentation before compiler.** The specification, architecture,
  roadmap, and decision log precede implementation. Rationale: syntax mistakes
  are cheapest to fix before code exists.
- **M0-2 — Buildable skeleton only.** A version constant, a CLI that honestly
  reports "not implemented", and a smoke test exist so tooling is verified.
  No parser or emitter is stubbed with fake behavior.
- **M0-3 — Repository layout.** One npm package with compiler-shaped internal
  folders; no monorepo until the editor or language server justifies it.
- **M0-4 — Tooling baseline.** Node.js >= 22.18, TypeScript 5.9, Node's
  built-in test runner, npm. Zero runtime dependencies.
- **M0-5 — Examples are target syntax.** `examples/hello.kdm` and
  `examples/portfolio/` began as acceptance targets rather than compiling
  projects. They are now compiled fixtures, along with `examples/canonical/`
  (M5).

---

## Decisions requiring approval

### D-01 — Constrained template grammar, not general English

**Status:** Approved
**Blocks:** M1
**Recommendation:** Approve

**Decision.** Kadam recognizes a finite vocabulary and a finite table of
canonical sentence templates. Each line must match exactly one template. Zero
matches is a syntax error; multiple matches is a compiler defect. Unknown
English is rejected with a deterministic hint.

**Alternatives considered.**

1. A broad English grammar with many paraphrases. More natural, but the
   surface becomes effectively unbounded and hard to test.
2. A probabilistic parser or language model. Prohibited by the product and
   incompatible with determinism.
3. A conventional CSS-like syntax. Rejected: it abandons the product vision.

**Trade-offs.** Authors must learn canonical phrasings; the language will feel
stricter than English. In exchange, the compiler can prove what a sentence
means, error messages can be precise, and the editor can offer finite
completion.

**If rejected:** the specification, parser design, and testing strategy need a
new foundation. Do not start M1.

---

### D-02 — Braces, one statement per line, cosmetic indentation

**Status:** Approved
**Blocks:** M1
**Recommendation:** Approve

**Decision.** Blocks are delimited by `{` and `}` on their own lines. One
statement occupies one line. Indentation is not semantic. A single trailing
period on a statement is optional. Comments use `//`.

**Alternatives considered.**

1. Python-style indentation. Reads naturally, but copy/paste, editor
   formatting, and mixed tabs create ambiguous structure and poor diagnostics.
2. Free-form paragraphs. Makes one-sentence-per-property impossible to enforce.
3. Semicolons and inline blocks. Rejected as visibly code-like.

**Trade-offs.** Braces are the least English-like part of the language. They
buy unambiguous blocks, simple parsing, and stable editor behavior. The
optional trailing period softens the prose feel without ambiguity.

**If rejected:** the sample syntax in the product brief would need to change.

---

### D-03 — Element kind is declared in the first sentence

**Status:** Approved
**Blocks:** M1
**Recommendation:** Approve

**Decision.** An element header contains only its name. Its first body
statement declares the kind (`a button`, `an image`, and so on). The kind
sentence may include a width-by-height clause.

**Alternatives considered.**

1. Kind in the header: `button1 is a button { ... }` or `button button1 { ... }`.
2. Kind in a property: `button1 { kind is button }`.
3. No declaration; infer from statements. Rejected outright as guessing.

**Trade-offs.** The chosen form preserves the original `button1 { a button ... }`
example. The cost is that editor outline/completion must parse at least the
first body line to know the kind, and a malformed first line hides the kind
from quick tooling. Every element's kind is still explicit in source.

**If rejected:** update §4.4 and §5.1 of the spec. Heavily used examples and
fixtures change.

---

### D-04 — Case-insensitive keywords, lower-camel identifiers

**Status:** Approved
**Blocks:** M1
**Recommendation:** Approve

**Decision.** Keywords, kind words, units, and color names are
case-insensitive. Element names are case-sensitive lower camel case
(`[a-z][A-Za-z0-9]{0,63}`) and unique per file. Component names, when they
arrive, are Pascal case. Quoted text preserves case exactly. Words used by the
grammar, units, and CSS named colors are reserved identifiers.

**Alternatives considered.**

1. Fully case-sensitive grammar. More code-like and surprising at sentence
   starts (`The text says` would fail).
2. Case-insensitive identifiers. Encourages `Button1`/`button1` collisions and
   makes references harder to read.
3. Allow arbitrary identifier characters. Creates tokenization and
   natural-language slot conflicts.

**Trade-offs.** Natural reading at sentence starts, plus unambiguous
references. The reserved-word set is large because grammar words and color
names cannot be identifiers; authors need descriptive names rather than
`button`, which is good practice anyway.

**If rejected:** the lexer, reference resolution, and every example change.

---

### D-05 — Typed value vocabulary and `the text is ...` overloading

**Status:** Approved
**Blocks:** M1/M2
**Recommendation:** Approve

**Decision.** Values are typed and closed: lengths in `px`/`rem` (never bare
non-zero numbers), durations in `ms`/`s`, colors as CSS named colors or hex,
percentages only for hover scale. The sentence `the text is <value>` dispatches
to font size, color, weight, or alignment by the value's type. Other statements
avoid overloading.

**Alternatives considered.**

1. Distinct verbs for every text property (`the text size is`, `the text color
   is`, ...). Unambiguous but less natural and more templates.
2. Unitless numbers defaulting to pixels. Rejected: silent assumptions.
3. A curated brand palette only. More consistent but less familiar.
4. Full CSS units and color functions now. Larger surface and more validation
   before the core works.

**Trade-offs.** One deliberate overload keeps the prose natural and is safely
resolved because the value domains do not overlap. Supporting all CSS named
colors increases the reserved-word set but gives authors a familiar palette.
Not supporting `%` sizes keeps the model small; `full width` covers the common
case.

**If rejected:** §3.7, §3.8, and §6.7 change, along with the type registry.

---

### D-06 — Built-in visual defaults are part of the language

**Status:** Approved
**Blocks:** M2
**Recommendation:** Approve direction; tune values before M2

**Decision.** Kadam ships a documented design system: kind defaults, page
background/text/font defaults, shadows, radii, focus ring, transitions, and
breakpoints (language spec, Appendix A). Authors can override properties, but
there is no separate theme system in v0.1. Changing a default that changes
output requires a language version bump.

**Alternatives considered.**

1. No defaults; every visual property must be declared. Maximum control,
   extreme verbosity, and a poor first experience.
2. CSS-reset-only defaults. Minimal opinion, but cards, buttons, and fields
   would be visibly unstyled.
3. A theme file from day one. More flexible, but introduces tokens, scoping,
   and override rules before the core language is stable.
4. Import a CSS framework. Rejected: runtime dependency and imposed class
   model.

**Trade-offs.** The language embeds taste. Defaults make small programs
beautiful quickly and keep examples short, but changing them later is a
versioning event. Values such as the accent blue and shadow strengths should be
approved by design before M2.

**If rejected:** add a required minimal theme or require explicit styling. This
substantially changes golden tests and the example project.

---

### D-07 — No CSS cascade or inheritance

**Status:** Approved
**Blocks:** M2
**Recommendation:** Approve

**Decision.** Element styles are computed from kind defaults, page defaults
(typography only), explicit base statements, and the active responsive scope.
No selector cascade, specificity, `!important`, or container-level inheritance.
Duplicate properties in one scope are errors. Responsive overrides are the only
layered styling.

**Alternatives considered.**

1. CSS-like inheritance from containers. Familiar to web developers, but makes
   every computed value depend on ancestors and undermines local reasoning.
2. Allow later declarations to override earlier ones. Convenient, but hides
   mistakes and makes visual editing produce surprising files.
3. A full cascade with specificity. Rejected as an explicit non-goal.

**Trade-offs.** Some repetition is necessary (for example, a text color on
several children). In exchange, each element can be understood in isolation,
and a visual edit maps to exactly one statement. Page defaults cover the most
common repeated typography.

**If rejected:** the semantic model, duplicate rules, and editor editing model
change significantly.

---

### D-08 — Three fixed breakpoints in v0.1

**Status:** Approved — implemented in M3
**Blocks:** M3
**Recommendation:** Approve for v0.1; revisit later

**Decision.** The only responsive scopes are `phones` (<600px), `tablets`
(600–1023px), and `desktops` (>=1024px). They are mutually exclusive and
defined by the language version.

**Alternatives considered.**

1. Custom pixel ranges on every statement. Flexible, but overlap and precedence
   rules become hard to reason about.
2. Named project-defined breakpoints in the manifest. Better for design systems
   but adds project configuration and cross-file validation.
3. Container queries. Better component behavior, but a much larger design and
   browser-semantics surface.

**Trade-offs.** Three tiers cover common marketing and app layouts. They cannot
express unusual designs, and the pixel values are fixed until a version bump.
Custom ranges can be added additively later.

**If rejected:** responsive grammar and CSS emission must be redesigned before
M3.

---

### D-09 — Page titles are navigation identities

**Status:** Approved — implemented in M3
**Blocks:** M3
**Recommendation:** Approve for v0.1; consider stable IDs before 1.0

**Decision.** Pages declare a unique human title. `go to page "About"` resolves
that exact title to the route declared in `kadam.json`. Titles are
case-sensitive and unique across the project. Routes never appear in `.kdm`
source.

**Alternatives considered.**

1. Navigate by route (`go to page "/about"`). Stable but code-like and less
   readable.
2. Navigate by file path. Couples content to file organization.
3. Stable page IDs plus display titles (`page "About" as about`). More robust
   under renames, but adds syntax and a second identity.

**Trade-offs.** Titles read naturally and avoid exposing routing in source.
Renaming a title breaks inbound navigation until references are updated, and
duplicate titles are forbidden. This is acceptable for small v0.1 projects; a
stable-ID layer can be added before 1.0 if real projects suffer.

**If rejected:** navigation grammar, manifest validation, and the dependency
graph change.

---

### D-10 — Components are approved for M6

**Status:** Approved — M6 architecture
**Blocks:** M6
**Recommendation:** Approved with amendments (2026-11-08)

**Decision.** Components are an additive M6 feature, not part of the frozen
v0.1 page surface. The existing page language and generated output remain
unchanged. Each component lives in its own file, instances use the component
name as their kind, properties are named, and `{$name}` interpolation is
compile-time only. Slots and child injection were deferred in M6 and added
later as one unnamed plus any number of named slots per body or variant, with
optional component-authored fallback content (2026-11-09).

The detailed M6 decisions are recorded in D-19 through D-22.

**Alternatives considered.**

1. Positional arguments (`a PriceCard("Starter", "$9")`). Compact but
   code-like and easy to misorder.
2. Property-style parameters inside the component body. Ambiguous with local
   element properties.
3. Render functions, expressions, or arbitrary child slots now. Too much
   programming model before the UI core is stable.
4. No components until after the editor. Rejected: repeated UI would make real
   projects unmaintainable and distort the language design.

**Trade-offs.** Named bindings are readable and statically checkable, but
`{$name}` is the first non-English token in the language. It is confined to
quoted text and is purely compile-time. Component files and explicit manifest
entries add bookkeeping, but keep dependency ownership and diagnostics clear.

**If rejected:** design components differently before M6 implementation; do not
start component code against a different model.

---

### D-11 — Static multi-page output, per-page CSS, no SPA

**Status:** Approved
**Blocks:** M2/M3
**Recommendation:** Approve

**Decision.** Each route compiles to its own HTML document and page CSS. Shared
reset/kind defaults live in one base stylesheet. Navigation uses anchors.
JavaScript is emitted only for approved interactions. No client-side router,
hydration, or single-page shell.

**Alternatives considered.**

1. A single-page app with a router. Smoother transitions, but requires JS for
   basic navigation and undermines static hosting.
2. One global CSS bundle for all pages. Fewer requests, more unused CSS.
3. Inline critical CSS. Faster first paint, but violates the separate-output
   requirement and complicates editing.

**Trade-offs.** Multi-page output is portable, accessible, cache-friendly, and
easy to host. Page transitions are full reloads, and shared CSS is duplicated
per page only for page-specific rules. Bundling and minification can be added
later without changing semantics.

**If rejected:** the output contract, server routes, and runtime scope change.

---

### D-12 — Declarative interactions only; no expressions in v0.1

**Status:** Approved — implemented in M5
**Blocks:** M5
**Recommendation:** Approve

**Decision.** v0.1 interactions are navigation, external links, hover effects,
and entrance animations. There are no variables, conditions, event handler
bodies, or state. Show/hide/toggle remains deferred; it was not added to the
v0.1 surface, so no runtime was introduced.

**Alternatives considered.**

1. Embedded JavaScript escape hatch. Powerful but breaks analysis, security,
   and the language's purpose.
2. A general expression language now. Turns Kadam into an application language
   before the UI core is proven.
3. No interactions at all. Unrealistic for a UI language.

**Trade-offs.** The language stays analyzable and static. Real applications
eventually need state and data; that is a separate, major design decision (see
open questions). Deferring it is safer than inventing a half-language.

**If rejected:** define the execution and state model before M5. Expect a large
increase in scope.

---

### D-13 — Accessibility requirements are compiler errors

**Status:** Approved
**Blocks:** M2
**Recommendation:** Approve

**Decision.** Buttons and links require text, images require alt text or an
explicit decorative marker, fields require labels, focus rings are automatic,
hover is hover-device-only, and reduced motion is respected. Missing essentials
are errors, not warnings.

**Alternatives considered.**

1. Lint warnings only. Faster for prototyping, easy to ignore, and produces
   inaccessible sites by default.
2. No enforcement; leave accessibility to authors. Contradicts the product's
   "accessible by construction" goal.
3. Warnings that become errors in strict mode. More configuration surface than
   needed for v0.1.

**Trade-offs.** Authors cannot ship a quick inaccessible button or unlabeled
image. Some prototypes need placeholder content, which is healthy. Contrast
checking remains a future warning because it depends on rendered colors and
would be noisy early.

**If rejected:** remove required-content rules and golden accessibility tests.
The architecture and diagnostics remain the same.

---

### D-14 — One page per file; explicit project manifest

**Status:** Approved — implemented in M3
**Blocks:** M3
**Recommendation:** Approve

**Decision.** A v0.1 `.kdm` file contains exactly one page. A `kadam.json`
manifest lists page files and their routes explicitly. Routes are never
inferred from file names or titles. Components later get one component per
file.

**Alternatives considered.**

1. Multiple pages per file. Fewer files, but routes, diagnostics, and
   incremental invalidation become ambiguous.
2. Convention over configuration (`pages/*.kdm` becomes routes). Simple for
   demos, surprising for real projects and renames.
3. TOML/YAML manifest. Nicer comments, but adds parser work or a dependency;
   JSON is built in.

**Trade-offs.** Explicit files and routes are verbose but unambiguous and
incremental-friendly. One page per file keeps a page's source, route, and
diagnostics together. A future formatter or project generator can reduce
boilerplate.

**If rejected:** document structure, manifest schema, and the file graph
change.

---

### D-15 — Single package, zero runtime dependencies

**Status:** Approved
**Recommendation:** Approve for M0–M6

**Decision.** Keep core, compiler, server, and CLI in one npm package with
enforced internal boundaries. Use Node built-ins and TypeScript only. Split
into workspace packages when the editor or language server needs a smaller
dependency surface.

**Alternatives considered.**

1. Monorepo with separate packages now. Cleaner publishing, more tooling and
   version coordination before there is a consumer.
2. A bundler or framework for the compiler. Unnecessary for Node-targeted
   TypeScript.
3. A test framework dependency. Node's runner is sufficient.

**Trade-offs.** Lower overhead now, with mechanical extraction later. The
single package risks accidental cross-imports; the documented dependency rule
and a future import-boundary test mitigate that.

**If rejected:** set up workspaces before M1; expect slower iteration.

---

### D-16 — Naming, publication, and licensing

**Status:** Partially resolved — Apache-2.0 selected and the package is
prepared as `kadam`; publication remains pending
**Blocks:** public release, not M1
**Recommendation:** Publish and verify a clean install before announcing the
public release

**Decision.** The source is licensed under the [Apache License, Version 2.0](../LICENSE).
The npm package is prepared under the unscoped name `kadam`; the registry
currently returns 404, but availability is not a reservation and must be
confirmed at publish time. The CLI stays `kadam`. Domain ownership and final
publication details remain open.

**Trade-offs.** Apache-2.0 is permissive and includes an explicit patent grant,
which supports adoption and embedding in commercial toolchains. A copyleft
license would protect the commons but may deter commercial use. The package
name affects imports, documentation, and future scoped packages. None of this
changes language semantics, but the remaining naming and publication choices
are expensive to change after launch.

---

### D-17 — Development server serves immutable in-memory snapshots over HTTP and SSE

**Status:** Approved — implemented in M4
**Blocks:** M4
**Recommendation:** Approve

**Decision.** `kadam dev` is an adapter over `compileProject`. It compiles the
whole project into an immutable output snapshot, serves that snapshot from
memory with a native `node:http` server, and pushes updates over Server-Sent
Events. It never serves the source tree, never writes `dist/`, and never
re-implements parsing, analysis, lowering, or emission.

Rules that follow from the decision:

- A failed build keeps the last successful snapshot serving and reports
  diagnostics; the overlay is advisory and never replaces generated pages.
- HTML changes require a full reload. CSS-only swaps are allowed only when the
  output diff proves that HTML, routes, and assets are unchanged.
- Requests are resolved by lookup in the snapshot, never by filesystem path,
  which removes traversal from the serving surface.
- The server binds to loopback by default; remote binding requires an explicit
  `--host` and prints a warning.
- No client-side router, HMR runtime, WebSocket server, or new dependency is
  introduced. Generated sites remain static.
- Full-project compilation is the M4 behavior. Incremental compilation and
  content-hash caches require a separate proposal and a cold-vs-warm
  determinism guarantee.

**Alternatives considered.** Writing a temporary `dist` and serving from disk
(adds atomic-swap and path surface for no correctness gain); WebSockets
(bidirectional machinery for one-way events); a bundler/HMR runtime (violates
`D-15` and the static output model); polling-only watching (avoidable latency
and I/O).

**Trade-offs.** Memory holds the generated site, which is small for typical
projects; large media is explicitly out of scope. A full rebuild per change is
slower than a dependency graph, but it is the only option that keeps the
project-global route table and navigation guarantees while reusing the
compiler unchanged.

---

### D-18 — No client-side runtime in v0.1

**Status:** Approved — implemented in M5
**Blocks:** M5 and later language versions
**Recommendation:** Approve

**Decision.** Generated site output for language version 0.1 contains no
JavaScript. Internal and external navigation use anchors, hover uses CSS
transitions behind a hover-capability query, entrance motion uses CSS keyframes,
and text fields are native inputs. There is no script tag, inline handler,
client router, hydration step, or runtime bundle in generated output. The
development server's reload client is development-only and is not part of a
build.

This keeps the static-output contract in `D-11`, makes navigation work with
JavaScript disabled, and avoids a security surface that v0.1 does not need.

**Alternatives considered.**

1. Emit a tiny runtime for show/hide/toggle now. It would add state, event
   wiring, a script asset, and CSP concerns without a v0.1 language construct
   that needs it.
2. Emit progressive-enhancement JavaScript for hover and focus. CSS already
   provides both with less code and no failure mode.
3. Defer navigation to client-side routing. It breaks static hosting and
   ordinary browser navigation.

**If rejected:** a future language version must define state, events, the
runtime boundary, and its security model in a separate decision before any
JavaScript is emitted.

---

## Roadmap ordering

Approved with D-17: milestone **M4 is the development server and live
preview**; motion and declarative interactions moved to **M5**. D-12 is
approved and implemented, and D-18 records that v0.1 emits no client-side
runtime. Incremental compilation is deferred until a measured proposal exists.

---

## Open product and language questions

These are recorded now but do not block M1. Each needs its own decision record
before implementation. D-30 proposes an initial answer to the programming-model
question (item 1); it remains open until that decision is approved.

1. **Programming model.** Is Kadam only a declarative UI language, or will it
   eventually have variables, functions, conditions, loops, and data? If yes,
   what is the execution model and where does logic run?
2. **State and events.** Beyond navigation and visibility, what state exists?
   Local element state, page state, URL state, or a store? How is it typed?
3. **Data and backend.** Does Kadam fetch data? Does it define API endpoints,
   server actions, or only consume JSON? This determines the runtime and
   security model.
4. **Forms.** Submission target, validation, error display, and success states.
5. **Theming.** Design tokens, dark mode, `prefers-color-scheme`, brand themes,
   and whether pages or components can own tokens.
6. **Page identity.** Whether stable page IDs should replace titles as
   navigation references before 1.0.
7. **Components.** Slots, variants, defaults, component-level responsive
   behavior, and how the built-in library is versioned.
8. **Editor architecture.** DOM-based preview versus a custom renderer; how
   source patches are represented; multi-file undo semantics.
9. **VS Code scope.** Diagnostics/completion only, or full preview and visual
   editing inside VS Code.
10. **Browser support.** Evergreen only, or a defined compatibility matrix?
    This affects generated CSS features.
11. **Internationalization.** Authored text is English-shaped; will text
    catalogs and right-to-left layout be language features?
12. **Escape hatches.** Will advanced users ever write raw CSS/JS, and if so,
    how is it sandboxed, analyzed, and kept deterministic?
13. **Deployment.** Static hosting only, or first-class deploy targets and a
    `basePath` for subdirectory hosting?
14. **Accessibility target.** WCAG 2.2 AA is a reasonable goal; confirm and
    define which checks are errors versus warnings.
15. **Package and license.** See D-16.

---

## M3 resolutions

M3 required D-08, D-09, and D-14 to be settled before the project compiler
was built. All three are approved and implemented. This section records the
exact behavior so later milestones do not re-litigate it, and records the one
compatibility change (an opt-in `basePath`) against M2.

### D-08 — breakpoints as implemented

- Phones: `max-width: 599px`. Tablets: `min-width: 600px` and
  `max-width: 1023px`. Desktops: `min-width: 1024px`.
- The three scopes are mutually exclusive and fixed by the language version.
  `kadam.json` cannot define custom ranges.
- Page CSS emits base rules first, then one `@media` block per breakpoint in
  the fixed order phones → tablets → desktops, then hover and reduced-motion
  blocks. This ordering is unchanged from M2 and covered by tests.

### D-09 — titles as navigation identity, as implemented

- `go to page "About"` matches the `page "About"` title exactly and
  case-sensitively. There is no trimming, case folding, or fuzzy matching.
- Titles must be unique across the project (`KDM3011`).
- An optional manifest `title` must equal the page title; it never overrides it
  (`KDM4001`).
- Routes never appear in `.kdm` source. A resolved navigation target is emitted
  as a normalized root-relative URL (`/about/`), optionally prefixed by
  `basePath`.
- A target that does not exist in the project is `KDM3007`, not a broken link.

### D-14 — project organization, as implemented

- `kadam.json` is required for project builds and declares `name`, `pages`,
  and optionally `kadam`, `version`, `assets`, `outDir`, and `basePath`.
- Each `.kdm` file contains exactly one page; each source path and route is
  declared at most once.
- Routes are explicit; they are never inferred from file names or titles.
- Page, asset, `assets`, and `outDir` paths are contained to the project root,
  lexically and through `realpath` for symbolic links.
- Unknown manifest keys are errors. Manifest processing and output ordering are
  deterministic (declaration order for diagnostics, code-point path order for
  output).
- The full schema is documented in `docs/project-manifest.md`.

### Compatibility notes

- Single-file `kadam build page.kdm` keeps its M2 behavior: route `/`, slug
  `home`, output `index.html` plus `assets/kadam.css` and
  `assets/kadam.home.css`.
- M2 output is byte-identical for existing projects. No emitter or class-name
  rules changed.
- `basePath` is new and opt-in. The architecture document previously said
  subpath deployment was unsupported; that statement has been corrected. Root-
  relative URLs remain the default.
- The output directory is now replaced atomically as a set, instead of writing
  files in place, so failed builds cannot leave a mixed tree. Directories
  containing Kadam sources are refused rather than deleted.

---

## M6 resolutions

M6 required the component architecture proposal in `docs/components.md` to be
reviewed before implementation. It was approved with amendments on 2026-11-08.
These entries fix the implementation contract so later work does not re-litigate
file layout, expansion order, identity, or diagnostics.

### D-19 — Components are dedicated project files in an explicit catalog

**Status:** Approved — M6 architecture
**Blocks:** M6
**Recommendation:** Approve

**Decision.** Each component lives in exactly one `.kdm` file and is listed under
`components` in `kadam.json`. The catalog is project-global and is loaded only
in project mode; optional library namespaces were added later (D-24). Component
files contain exactly
one component and no page; page files contain no component. A page/component
unit mismatch is an error.

There is no automatic directory discovery. The explicit manifest list is the
dependency boundary: it is validated for project containment, duplicates, and
symlink escapes, and its order is not semantic. Component files are source, not
routes and not assets.

**Single-file amendment:** `kadam build page.kdm` has no component catalog. A
component instance in single-file mode is an unknown-component error; single
file builds do not scan a `components/` directory implicitly.

**Trade-off:** adding a component requires a manifest edit. This is accepted in
exchange for deterministic loading, reviewable dependencies, and no hidden
filesystem order.

### D-20 — Components expand before validation and lowering

**Status:** Approved — M6 architecture
**Blocks:** M6
**Recommendation:** Approve

**Decision.** Component instances expand into ordinary built-in `ElementNode`
trees before `validateDocument`, `analyzeDocument`, `lowerDocument`, and
emission. No component kind reaches `PageIR`; the existing HTML and CSS emitters
remain component-agnostic. The expanded site remains static HTML/CSS with no
client-side runtime.

Each default body and each named variant has exactly one root element. An
instance is replaced in place by that root; no wrapper element is invented.
Instances may contain only a component kind, optional static variant selection,
`with` property bindings, and child elements when the selected body declares a
content slot. Instance-level style overrides and per-slot parameters are
deferred; a body may declare one unnamed and any number of named slots, each
with optional fallback children used when the instance supplies none.

Expansion records the declaration span and the complete instance-origin chain.
Stable instance paths supply `data-kdm-id` values, form IDs, label targets, and
source-map locations. Component-scoped classes are shared across instances, and
the page CSS emits each component class once per page. Instance paths use
declared names, not counters, timestamps, or machine paths.

**Trade-off:** component CSS is shared by scoped class rather than emitted per
instance, so component styles are static across instances. Per-instance styling
is not part of M6.

### D-21 — Component interfaces use named properties and static variants

**Status:** Approved — M6 architecture
**Blocks:** M6
**Recommendation:** Approve

**Decision.** Component declarations use named, typed properties and optional
static defaults:

```kdm
component PriceCard takes a title as text, a price as text, a badge as text defaulting to "New" {
    ...
}
```

Instances use `with` bindings, and variants are selected statically:

```kdm
pricing1 {
    a PriceCard in the featured variant
    with a title of "Starter"
    with a price of "$9"
}
```

M6 supported `text` and `page` property types; later follow-ups added `url`,
`image`, `length`, and `color`. `text` is allowed only in text-bearing string
slots; `page` is allowed only in navigation targets and nested `page` bindings.
`url`, `image`, `length`, and `color` use the whole-value placeholder forms
recorded in D-25 through D-28.

A component has one default body and zero or more complete alternative variant
bodies. Every variant shares the same parameter interface and is validated even
when unused. `default` is reserved as a variant name. `{$name}` is the only
interpolation form, is one-pass, never evaluates code, and is escaped on
emission.

`component` and `takes` were already reserved. `as`, `with`, `variant`, and
`defaulting` are contextual words recognized only by the component grammar, so
existing v0.1 element names remain valid.

**Trade-off:** variants duplicate complete element bodies instead of adding a
style-overlay or selector language. This keeps expansion explicit and
cascade-free.

### D-22 — Component validation and diagnostics are strict and deterministic

**Status:** Approved — M6 architecture
**Blocks:** M6
**Recommendation:** Approve

**Decision.** All components and all variants validate, including unused ones.
Missing, unknown, duplicate, and mistyped properties fail deterministically;
cycles fail before expansion, including cycles in unused components. Expansion
depth and total expanded-element limits are compiler constants and produce
deterministic errors.

New diagnostics are allocated in the component ranges recorded in
`docs/components.md` (`KDM2012`, `KDM3020`–`KDM3034`, `KDM4007`, `KDM4008`).
Existing validation and accessibility codes still apply to expanded elements.
Declaration-origin diagnostics are deduplicated by source span, code, and
message before the existing 100-diagnostic cap. Instance-specific failures point
at the binding, with declaration locations as related spans.

Expansion is pure and atomic with the rest of `compileProject`: if any component
or page fails, no output files are produced. The same source, manifest, and
compiler version must produce byte-identical HTML/CSS; component tests include
repeated builds, manifest reorderings, source-map origins, CSS deduplication, and
a no-script production check.

**Trade-off:** a broken unused component fails the build. This is intentional:
component files are source code, not dormant fragments.

---

### D-23 — Content slots use one unnamed slot plus named slot groups

**Status:** Approved — implemented after M6.1
**Blocks:** —
**Recommendation:** Implemented

**Decision.** A component body or variant may declare one unnamed slot
(`a slot`) and any number of named slots (`a header slot`). Plain instance
children fill the unnamed slot; a named slot is filled by a child element whose
kind names that slot (`head1 { a header slot }`). The group emits no element.
Slot children are expanded in the caller's scope, so page content keeps page
identity, spans, IDs, and CSS; fallback children are component-authored and
expand in the component's scope. Declaration misuse is `KDM3033`; fill-group
misuse is `KDM3034`.

**Trade-off:** each named slot adds one group block at the call site. In
exchange, slot association is explicit and static, with no positional guessing.
Named slots do not change expansion order, identity, or emitter behavior.

---

### D-24 — Component libraries use optional manifest namespaces

**Status:** Approved — implemented (manifest namespaces and the qualifier)
**Blocks:** —
**Recommendation:** Implemented; external library roots and re-exports remain
deferred

**Decision (proposed).** A component manifest entry may be a string (project
namespace, current behaviour) or `{ "source": ..., "namespace": "ui" }`.
Pages and component bodies reference a library component with
`a Button from ui`. Unqualified names resolve only in the project namespace,
with no fallback search. Component-scoped CSS classes gain the namespace
segment so two components with the same declared name stay distinct.
`data-kdm-id` and form IDs remain instance-path based and unchanged.

Diagnostics: `KDM3035` duplicate namespace/name, `KDM3036` unknown namespace or
member, `KDM3037` qualifier on a project component, `KDM4009` malformed library
entry.

**Trade-off:** library membership is repeated per file in the manifest, but it
keeps every path explicit and reuses the existing containment and watch rules.
The full draft and remaining open questions live in
`docs/component-imports.md`. Implementation covers manifest namespaces, the
`from` qualifier, namespaced catalog keys, and namespace-scoped CSS classes;
external library roots and re-exports are still deferred.

---

### D-25 — URL component parameters

**Status:** Approved — implemented
**Blocks:** —
**Recommendation:** Implemented

**Decision.** A component parameter may be typed `url`. Its value is a quoted
absolute `http` or `https` URL, validated at the declaration default, at every
binding, and when passed through another `url` parameter. A `url` parameter may
be interpolated only into an external click target
(`when clicked, open "{$url}" in a new tab`) or another `url` binding. Page
files and component bodies reject placeholders everywhere else. Component
parameters and bindings are checked statically; no runtime validation is
emitted.

**Trade-off:** external links stay statically checked and need no client code.
Only outbound URLs are supported; relative asset URLs remain unsupported, while
image sources have their own parameter type in D-26. `length` and `color` were
added later as D-27 and D-28.

---

### D-26 — Image component parameters

**Status:** Approved — implemented
**Blocks:** —
**Recommendation:** Implemented

**Decision.** A component parameter may be typed `image`. Its value is a quoted
project-relative path to an image asset, using the same restrictions as an
image source: no absolute path, drive letter, URL scheme, query, fragment, or
`..`, and an image extension. An `image` parameter may be interpolated only
into an image source or another `image` binding. Page-owned image sources stay
literal. Because expansion runs before asset collection, the existing asset
existence and copy checks apply to the bound path with no new pipeline stage.

**Trade-off:** images are limited to project-relative files; external image
URLs and length placeholders in a kind's size clause remain unsupported. A
length parameter can still set width or height with a separate size statement.
`length` and `color` were added later as D-27 and D-28.

---

### D-27 — Length component parameters

**Status:** Approved — implemented
**Blocks:** —
**Recommendation:** Implemented

**Decision.** A component parameter may be typed `length`. Its value is a
quoted `px`/`rem` length or `0`. Inside a component body a length parameter is
written as a quoted placeholder in a whole length position, for example
`it has "{$gap}" gap between children`; it may fill padding/margin, layout gap,
width/height, type size, solid border width, custom corner radius, or a lift
distance. Length placeholders are not allowed in pages or in kind sentences.

Expansion replaces every reference with a parsed length. Because two instances
can bind different values while sharing a component class, elements from a body
that uses length parameters gain a deterministic class suffix derived from the
effective length bindings referenced by that body. Non-parameterized components
keep their existing classes.

**Trade-off:** the class suffix keeps static CSS and exact per-instance values
without inline styles or a runtime. It lengthens class names only for
parameterized components. `color` parameters were added later as D-28.

---

### D-28 — Color component parameters

**Status:** Approved — implemented
**Blocks:** —
**Recommendation:** Implemented

**Decision.** A component parameter may be typed `color`. Its value is a
quoted CSS named color or hex literal. Inside a component body a color
parameter is written as a quoted placeholder in a whole color position, for
example `has a "{$accent}" background`; it may fill solid backgrounds, gradient
endpoints, text color, solid border color, or hover background/text/border
colors. Color placeholders are not allowed in pages or page settings.

Expansion resolves the reference to a concrete color. Bodies using color or
length parameters keep a class suffix derived from the referenced style
bindings, so instances with different palettes do not share a conflicting CSS
rule while instances that differ only in text, page, URL, or image bindings
still share one.

**Trade-off:** no runtime or inline styles, and every value is statically
validated. `transparent`/`currentcolor` remain unavailable by design; color
expressions and palette tokens beyond named/hex remain deferred.

---

### D-29 — CLI-first distribution; remove the browser editor

**Status:** Approved — implemented
**Blocks:** M7
**Recommendation:** Implemented

**Decision.** Kadam is distributed and used through the `kadam` CLI. The
browser Studio, its host, the headless editor library, the browser-only source
entry, and the editor-only `/__kadam/studio-map` endpoint are removed. The
compiler and development server remain editor-independent. Installation is
provided by `install.sh` and a global npm-compatible CLI package. No GUI is a
prerequisite for any language or target feature.

**Trade-off:** losing the visual editing surface removes click-to-source and
the inspector. The full Studio implementation remains recoverable from commit
`010fc06`. In exchange, the repository has one distribution path and no UI
surface that can drift from the compiler.

---

### D-30 — v0.2 general-purpose core and declarative UI subset

**Status:** Approved — implemented in M7
**Blocks:** M7
**Recommendation:** Implemented; v0.1 UI surface unchanged

**Decision.** Add a typed, target-neutral core under the same `.kdm` language
family with one module per file. The core supports text, number, boolean,
immutable lists and records, typed functions, locals, `if`/`while`, `return`,
`output`, file read/write intrinsics, explicit effects, and reviewable source
spans. The v0.1 `page` and `component` surfaces remain unchanged and separate
from modules in this milestone.

Core declarations use English keywords and explicit expression operators. This
hybrid is deliberate: UI properties remain prose-like, while arithmetic and
nested calls must have unambiguous precedence. The core does not allow imports,
classes, first-class functions, collection mutation, async behavior, or
implicit target semantics in v0.2.

**Trade-off:** pages and modules are not yet interleaved. This avoids making
the web runtime the definition of the general-purpose core. The cost is a
larger migration later when UI behavior needs general-purpose functions.

---

### D-31 — Targets are adapters; external calls require typed bindings

**Status:** Approved — implemented for the TypeScript and Python core targets
**Blocks:** M7/M8
**Recommendation:** Implemented; further adapters follow the same contract

**Decision.** The core IR contains no HTML, CSS, TypeScript, Python, Rust, or
Java concepts. A target adapter declares a capability set, validates the IR
before emission, and either emits all required effects and external providers
or fails with a stable diagnostic. External declarations carry explicit target
provider metadata and effect names; the core compiler never invents a provider
or parses another language's source. A target is “supported” only after its
adapters pass shared conformance fixtures and execute generated output in the
native runtime.

**Trade-off:** bindings require explicit metadata and per-target integration.
The language cannot claim automatic compatibility with arbitrary packages.
That constraint is what makes compatibility testable instead of aspirational.

---

## Frontend track resolutions (F0)

Recorded with [the frontend plan](frontend-plan.md). D-32 and D-35 were
approved by the owner on 2026-11-24. Every `kadam 0.1` output stays
byte-identical.

### D-32 — The regular property sentence and the property table

**Status:** Approved 2026-11-24 — implemented behind `kadam 0.3`
**Blocks:** F1 and every later frontend phase

**Decision.** Add one canonical sentence, `the <property> is <value>`, backed
by a closed, typed table in `src/core/parser/properties.ts`. Each row names the
property as written in source, its value type and bounds, the kinds it applies
to, and the generated CSS property. The row drives matching, value checks,
kind capability (`KDM3003`), duplicate keys (`KDM3004`), responsive scopes, and
emission. A name that is not a row is not claimed and stays `KDM2001`. The
existing hand-written sentences (`has rounded corners`, `the text is 18px`)
remain as shorthands.

A row has one of two shapes. A **shorthand-backed** row (`build`) produces
exactly the AST node its existing sentence produces: `the text size is 18px`
and `the text is 18px` are the same node. Kind capability, duplicate keys,
responsive rules, component placeholders, and CSS output are therefore shared,
and the two spellings compile byte-identically (tested for every row). A
**native** row (`css`) exists only in the regular form and lowers to a
`property` statement.

The table has 15 rows: 13 shorthand-backed (`text size`, `text color`,
`text weight`, `text style`, `text alignment`, `font family`, `width`,
`height`, `padding`, `margin`, `gap`, `background color`, `corner radius`) and
2 native (`line height`, `letter spacing`). `kadam keywords --properties` lists
them. Shorthands whose values do not fit one regular value (`it is full width`,
gradients, borders, per-side spacing) keep only their shorthand for now.

**Alternatives considered.**

1. One hand-written template per property. Today's approach; it does not scale
   to the roughly 4x grammar growth F1–F3 need, and each template needs its own
   docs, tests, and overlap checks.
2. Arbitrary `the <css-property> is <css-value>` passthrough. Fast, but it is
   raw CSS in English clothing: no typing, no kind checks, no determinism
   guarantees beyond the string.

**Trade-off:** authors see two ways to set some properties once shorthands are
migrated. The shorthand stays primary in docs; the regular form exists so the
vocabulary can grow without a template per property.

### D-33 — Version gating for UI syntax

**Status:** Implemented (F0)
**Blocks:** F1

**Decision.** UI syntax added after 0.1 ships under `kadam 0.3`; `0.2` stays
the core-module version. Templates declare `since`. A newer template still
matches in an older file, but it is rejected with `KDM2013`, which names the
construct and the required version, instead of `KDM2001`. Files without a
directive use the manifest's `kadam` version, or `0.1` in single-file mode. When
the manifest declares a version, a file directive must match it (spec §4.1).
Tooling that passes no version sees the newest vocabulary.

### D-34 — Element names stay reserved; one bad name is one diagnostic

**Status:** Implemented (F0)

**Decision.** Grammar words and CSS color names remain invalid element names.
F4 will reference elements by name inside sentences (`flip isOpen of menu1`),
and allowing `text` or `open` as names would make those sentences ambiguous.
Instead, an invalid or malformed element header reports one `KDM2007`/`KDM2002`
with a concrete rename (`email` → `email1`), and the parser still opens the
block, so the body and closing brace are not misattributed to the parent.
`kadam keywords` prints the frozen reserved set, generated from the lexicon.

### D-37 — Frontend vocabulary is contextual, not reserved

**Status:** Implemented (F1)

**Decision.** Words introduced for `kadam 0.3` (`header`, `list`, `table`,
`row`, `form`, `plays`, `options`, ...) are matched by position, not added to
the reserved set. Reserving them would make existing `kadam 0.1` element names
such as `list1 {` or `table {` invalid, which breaks the promise that 0.1 files
keep compiling. D-34 still holds for the 0.1 vocabulary. Each new sentence is
anchored by its leading words (`the caption says`, `it plays`), and the
template-overlap test proves no line matches two templates.

### D-35 — Browser support matrix

**Status:** Approved 2026-11-24
**Blocks:** F2 (which CSS features may be emitted without fallbacks)

**Decision.** Generated output targets the latest two major versions of
Chrome, Edge, and Firefox, and Safari 16.4 or later on macOS and iOS. Within
that matrix the compiler may emit `clamp()`, `gap` for flexbox, `:focus-visible`,
`aspect-ratio`, `:has()`, container queries, and `dialog` without fallbacks.
Features outside the matrix (for example scroll-driven animations or the
`popover` attribute on older Safari) need either a documented fallback or an
explicit capability diagnostic. The matrix is part of the language version, so
changing it requires at least a minor version bump.

### D-38 — Theme colors and dark mode

**Status:** Approved 2026-11-25; implemented behind `kadam 0.3` (F3)
**Answers:** open question 5 (design tokens), for colors

**Decision.**

1. **Color tokens.** `the brand color is #FF0066` declares a named color. A
   name is one lower-case word that is not a reserved word or a CSS color
   name. It is used anywhere a color is accepted: `has a brand background`,
   `the text is brand`, `when hovered, the border turns brand`. An undeclared
   word in a color position stays the existing "expected a color" error.
2. **Where tokens live.** In a project theme file named by `kadam.json`
   (`"theme": "theme.kdm"`, a `theme { ... }` block), shared by every page, or
   in a page body, for that page only. A page token with the same name as a
   theme token replaces it on that page.
3. **Output.** Tokens are CSS custom properties (`--kdm-color-brand`) on
   `:root` in the page stylesheet, and uses are `var(--kdm-color-brand)`. The
   compiler still knows every value, so contrast checks (D-39) see through
   tokens.
4. **Dark mode follows the system.** `in dark mode, ...` is a scope like
   `on phones,`, emitted as `@media (prefers-color-scheme: dark)`. It works for
   element statements, for `the page background is` and `the page text is`,
   and for tokens (`in dark mode, the brand color is #FF4D8D`).
5. **Built-in dark palette.** `the page is dark when the system is dark` opts a
   page into dark versions of Kadam's own defaults (page, text, cards, fields,
   code blocks, dividers, badges, links) and sets `color-scheme: light dark`,
   so native form controls and scrollbars match. Colors the author wrote are
   never changed automatically; the author overrides them with `in dark mode,`.
   A user-facing toggle arrives with the F4 runtime.

**Deferred.** Spacing, radius, font, and shadow tokens. Color tokens are the
part dark mode needs; the others need a typed-scale design (`small`, `medium`,
`large` spacing) and are planned for F7 with completion support.

### D-39 — Contrast check severity

**Status:** Approved 2026-11-25; implemented as a warning (F3)
**Answers:** open question 14 (accessibility errors versus warnings)

**Decision.** When an element's text color and the background behind it are
both known at compile time (solid colors and tokens, through ancestors and
the page, in light and in dark mode), the compiler checks them against WCAG
2.2 AA: 4.5:1 for normal text, 3:1 for large text (24px and up, or 18.66px and
up when bold). In `kadam 0.3` a failure is warning `KDM3039`, which never
blocks a build. Pairs that are not known statically (gradients, background
images, semi-transparent colors) are not guessed at; the browser test suite
measures them. The plan is that the warning becomes an error in Kadam 1.0,
with an explicit per-element opt-out for decorative text.

### D-36 — Client runtime for `kadam 0.3`

**Status:** Approved 2026-11-25 (F4 step 2)
**Replaces:** D-18 for `kadam 0.3` files only. `kadam 0.1` output stays
JavaScript-free.

**Decision.**

1. **Only pages that need it get JavaScript.** A page whose elements use no
   state, events beyond plain links, or dialogs emits exactly what it does
   today: no script tag and no `.js` file (golden test). F4 step 1 features
   (expandable sections, in-page, email, phone, and download links, field
   errors) never need it.
2. **Generated, not shipped.** The compiler writes the runtime for each page
   from the features that page uses (tree-shaken by construction), as one
   external file `assets/kadam.<page>.js`, loaded with `<script type="module">`.
   No third-party code, no `eval`, no `new Function`, no inline handlers, and
   no `innerHTML`, so a strict Content Security Policy
   (`script-src 'self'`) works.
3. **HTML first.** The page is complete server-rendered HTML; the runtime
   attaches to elements by `data-kdm-id`. With JavaScript off, content stays
   readable and plain links still work; controls that need the runtime say so
   to assistive technology only once it has loaded.
4. **State is typed and local.** `it remembers isOpen, a boolean that starts as
   false` declares state on the element that owns it, checked with the v0.2
   type system. Effects (`show`, `hide`, `flip`, `set`, `open dialog`,
   `close the dialog`, `focus`) and bindings (`it is hidden unless isOpen is
   true`, `the text shows count`) name elements and state that the compiler
   resolves; an unknown name is a compile error, never a runtime one.
5. **Accessibility is generated.** Toggles get `aria-expanded` and
   `aria-controls`; dialogs use the native `dialog` element with `showModal()`
   (focus trap, Escape, focus return); text bound to state that changes is a
   polite live region.
6. **Size budget.** About 3 KB minified for a page that uses every step 2
   feature, checked in CI; output stays byte-identical across builds.

**Alternatives considered.**

1. A shared prebuilt runtime file: simpler, but every page pays for every
   feature and it versions separately from the compiler.
2. Inline `<script>` blocks: break strict CSP.
3. A framework (React, Alpine, htmx): a third-party runtime contradicts D-15
   and the size budget, and its semantics would leak into the language.
4. `popover` and invoker commands instead of a runtime for dialogs: not
   available in Safari 16.4 (D-35 matrix). They can replace parts of the
   runtime when the matrix moves.

---

### D-40 — Build-time data for `kadam 0.3` (F5 step 1)

**Status:** Implemented on 2026-11-25 under the user's go-ahead to keep
building F5; open to revision. Covers build-time data only. Runtime loading
(`it loads ... from "https://..."`) needs its own decision.

**Decision.**

1. **Data files are JSON, declared in `kadam.json`.** `"data": { "projects":
   "data/projects.json" }`. Each file is an array of at most 1000 flat records.
   A field is text, a number, or true/false, with one type across all records.
   A field may be missing or `null` in some records. Nested objects and arrays
   are errors (`KDM4010`). CSV waits until JSON is proven.
2. **A component repeats once per record.** `a ProjectCard for each project in
   projects`, with `with a title of the title of project` reading a field.
   Literal bindings and a variant may be mixed in. Only components repeat,
   because a component already names exactly what one record fills in.
3. **Expansion happens first, at build time.** Repeats become ordinary
   instances named `project1`, `project2`, … before component validation. Each
   one is checked like a hand-written instance, and the output is static HTML
   with no runtime. A missing or null field leaves the parameter to its
   default; a required parameter with no value is the usual component error.
4. **Names are checked before anything is generated.** An unknown data name
   (`KDM3042`), an unknown field or a wrong record name (`KDM3043`), and a
   generated name that clashes with an existing element (`KDM3044`) get
   suggestions. A true/false field cannot be shown as a value. A field read
   outside a repeat (`KDM3041`) and a repeat on a built-in kind (`KDM3040`)
   are errors. Repeats are allowed only on pages, not inside components.
5. **Determinism.** Data is just more source: records keep file order, numbers
   print with JavaScript's shortest round-trip form, and `kadam dev` watches
   data files.

6. **Filtering, sorting and limits (step 2).** `only where the <field> of
   <record> is [not] <value>` (typed against the field), `sorted by the
   <field> of <record> [from highest to lowest]` (stable, records without the
   field last, character-code order so builds never depend on the machine's
   locale), and `showing at most <n>`, applied in that order.

7. **Pages made from data (step 3).** `page "{the title of post}" for each
   post in posts {` with a `/posts/:slug` route in `kadam.json` builds one
   page per record. `{the <field> of <record>}` works in any quoted text of
   that page. Each page is checked like a hand-written one, and titles and
   routes must be unique.

8. **Markdown documents (step 4).** `it shows the document "content/x.md"`
   turns a strict CommonMark subset into ordinary Kadam elements before
   validation, so page rules apply. Unsupported syntax is an error, and raw
   HTML is never passed through. Inline code is a new span effect.
9. **Child content on repeated instances (step 5).** Children fill slots as
   for any instance, may read `{the <field> of <record>}`, and are renamed per
   instance.

**Not yet:** runtime data, which needs its own decision record.

---

### D-41 — Runtime data for `kadam 0.3` (F5 step 6)

**Status:** Approved by the user on 2026-11-25.

**Problem.** Build-time data (D-40) covers content that changes when the site
is rebuilt. Dashboards, shops and search need data that changes while the page
is open. That means network requests in the browser, which brings in security,
failure states and types the compiler cannot see at build time.

**Proposal.**

```kdm
catalog {
    a container
    it loads products from "https://api.example.com/products"
    each product has a name as text, a price as number, and a picture as url
    while loading, it shows loadingNote
    when there are none, it shows emptyNote
    when loading fails, it shows errorNote

    tile {
        a ProductCard for each product in products
        sorted by the price of product
        with a name of the name of product
        with a price of the price of product
    }
    loadingNote { ... }
    emptyNote { ... }
    errorNote { ... }
}
```

1. **The compiler never touches the network.** Requests run only in the page
   runtime (D-36). Builds stay deterministic and offline.
2. **Origins are declared.** A URL must be same-origin, or its origin must be
   listed in `kadam.json` as `"connect": ["https://api.example.com"]`
   (`KDM4001` otherwise). HTTPS is required except for `localhost`. `kadam dev`
   sends a matching `connect-src` CSP, so a request to an undeclared origin
   fails in development, not just in review.
3. **Requests are GET only, with no cookies by default.** The runtime uses
   `fetch(url, { credentials: "omit" })` and accepts only a JSON array (or
   `{ "items": [...] }`) of at most 1000 records and 2 MB. Sending data, auth
   headers and cookies belong to the backend boundary, which is a separate
   decision.
4. **The shape is declared and checked twice.** `each product has ...` (text,
   number, yes/no, url) types every field. At build time, every sentence that
   reads a field is checked against the shape, with the same errors and
   suggestions as D-40. At run time, each response is validated. A missing
   field or wrong type shows the error state; a partly valid list is never
   shown. A `url` field must be `http`, `https` or a same-site path, so a
   `javascript:` link from an API cannot reach the page.
5. **All three states are required.** A list without `while loading`,
   `when there are none` and `when loading fails` is a compile error. Each
   names an element in the same container, which the runtime shows and hides
   as the request goes. The loading element is a polite live region, so
   screen readers hear it.
6. **No HTML from data, ever.** The compiler emits each repeated component
   once as a `<template>`. The runtime clones it per record and fills values
   only with `textContent` and checked `setAttribute`: no `innerHTML`, no
   `eval`. `script-src 'self'` keeps working.
7. **The same list sentences work.** `only where`, `sorted by` and `showing
   at most` run in the runtime with the same meaning as at build time.
8. **Without JavaScript**, the error element is shown with a `noscript` rule.
   The author writes it to say that the content needs JavaScript or to link
   elsewhere.
9. **Loading.** Data loads once when the page opens. `when clicked, reload
   products` on a button loads it again. A new request cancels the previous
   one, so slow responses can never overwrite newer ones.
10. **Budget.** At most about 2 KB minified extra runtime for a page that
    loads data, tree-shaken like the rest of D-36.

**Tests.** Unit tests for the checks; Playwright tests against a local mock
server for loading, empty, error, wrong-shape, slow-then-fast ordering,
`javascript:` URL rejection, reload, keyboard use and the strict CSP. The
dashboard reference loads its table from the mock server.

**Not included (later decisions).** Sending data (forms to an API), auth
headers and cookies, polling and live updates, caching across pages, and
pagination. Pagination needs URL state (`?page=2`), the next F5 step.

**Alternatives considered.**

1. Fetching at build time: breaks determinism and offline builds, and is
   already covered by data files.
2. Allowing any origin: simpler, but one typo or injected URL could send
   requests anywhere. Declaring origins costs one manifest line.
3. Optional states with defaults: shorter, but a blank area on a slow network
   or a failed API is the most common real-world bug. Kadam makes it
   impossible.
4. A framework data layer (React Query, htmx): contradicts D-15 and the
   runtime budget.

### D-42 — Escape hatches for `kadam 0.3` (F6, open question 12)

**Status:** Approved by the user on 2026-11-25.

**Problem.** The grammar will never cover every CSS property or every piece
of existing code a team already has. Without a way out, one missing feature
blocks a whole page, and people leave the language. With an uncontrolled way
out (raw `<style>` or `<script>`), Kadam loses its guarantees: one meaning
per sentence, accessibility checks, a strict CSP and deterministic output.

**Proposal.** Four escape hatches, each one sentence, each visible in the
source and reported by tooling. No others.

```kdm
hero {
    a section
    the css "mask-image" is "url(assets/fade.svg)"
    it also uses the class "legacy-hero" from "styles/legacy.css"
    when clicked, call trackEvent with "hero"
}
external trackEvent from "./analytics.js" takes text and returns nothing
```

1. **One raw CSS declaration per sentence:** `the css "<property>" is
   "<value>"`, optionally after `on phones,`, `when hovered,` or `in dark
   mode,`. The property must be a known CSS property name, lowercase, and not
   a custom property. The value is checked by a small tokenizer: no `;`, `{`,
   `}`, `<`, `@`, `\`, `expression(`, or `url()` outside the project's own
   assets (`KDM3050`). A property Kadam already has a sentence for is an
   error that names the sentence (`KDM3051`), so the hatch never becomes a
   second way to say the same thing. The declaration lands in the element's
   own class, after Kadam's declarations, and never leaks to other elements.
2. **Existing stylesheet classes:** `it also uses the class "x" from
   "styles/legacy.css"`. The stylesheet must be a local file listed under
   `"stylesheets"` in `kadam.json`. It is copied to the output and linked
   once, before Kadam's CSS, so Kadam's own styles still win. The compiler
   checks that the class name appears in the file as a selector (a plain
   text search, not a CSS parser), so a typo is a compile error (`KDM3052`).
3. **Typed external functions** (from D-31): `external <name> from
   "<local .js file>" takes <types> and returns nothing`, then `when
   clicked, call <name> with <values>`. Arguments are type-checked against the
   declaration. The file is copied and loaded as an ES module with
   `script-src 'self'`, so it needs no CSP change. Kadam never reads, parses
   or bundles it. In 0.3 externals return nothing; reading a return value into
   state is a later step. A throwing function is caught and logged, so it
   cannot break Kadam's own handlers.
4. **Raw HTML is not included.** A sanitised raw HTML block would need an HTML
   parser and an allowlist the compiler maintains forever, and almost every
   real use (an embed, a widget) is better served by a custom element through
   D-43 or an external. Raw HTML stays out of 0.3. We revisit it only with a
   concrete case the other three hatches cannot cover.

**Visibility and control.**

- `kadam check` lists every escape hatch with its file and line in a
  summary ("3 escape hatches: 2 css, 1 external").
- `kadam check --strict` and `"strict": true` in `kadam.json` turn every hatch
  into an error (`KDM3053`), so a team can ban them.
- The accessibility and contrast checks still run. A raw `color` or
  `background` is not allowed through the hatch (rule 1 rejects them, because
  Kadam has sentences for both), so contrast checking keeps working.
- Output stays deterministic: hatches are copied text, never evaluated at
  build time.

**Tests.** Unit tests for each sentence, each rejection and the strict
mode; byte-identity for every existing example; a Playwright test that an
external is called with the right arguments under the strict CSP, and that a
throwing external leaves the page working.

**Alternatives considered.**

1. A raw `<style>` block: one sentence could restyle the whole page, which
   breaks "no cascade" (D-07) and makes checks meaningless.
2. Inline `<script>`: breaks the CSP from D-36.
3. No escape hatches: purest, but the first unsupported property blocks real
   work, and nobody adopts a language with a hard ceiling (F9 goal).

**Implementation notes (F6 step 1).** The `external` line sits directly inside
`page { }`, since a source file holds exactly one page. Raw css works after
breakpoints, custom scopes and `in dark mode,`; interaction states
(`when hovered,`) come later. `call "<phone number>"` stays a phone link; only
`call <name>` is an external.

---

### D-43 — Interop targets: fragments, Web Components and TypeScript declarations (F6)

**Status:** Approved by the user on 2026-11-25.

**Problem.** Today Kadam only builds whole sites. A team with an existing
React, Vue or plain HTML app cannot use one Kadam component without rewriting
everything, so the language can only win greenfield projects.

**Proposal.** Three outputs, built in this order. All of them reuse the
existing lowering; they differ only in how the result is wrapped.

1. **Fragments:** `kadam build --fragment pages/pricing.kdm` writes
   `pricing.html` (the page body only, no `<html>` or `<head>`), its scoped
   CSS and, if needed, its runtime. Class names are already prefixed per page
   (`kdm-pricing-…`), so they do not clash with the host page. The output
   lists the `<link>` and `<script type="module">` tags to add.
2. **Web Components (the primary interop target):** `kadam build --target
   web-components` turns every component in the catalog into a custom element.
   - **Names:** `ProductCard` becomes `<kadam-product-card>`. A
     `"elementPrefix"` in `kadam.json` can replace `kadam`.
   - **Attributes:** each parameter becomes an attribute (`name="Desk"
     price="120"`). Types are checked at run time the same way as runtime data
     (D-41): a bad `url` is replaced with nothing, and a missing required
     attribute shows nothing for that value. Changing an attribute re-renders
     the element.
   - **Slots:** Kadam's unnamed and named slots (D-23) become shadow DOM
     `<slot>` and `<slot name="…">`, with the same fallback content.
   - **Styles:** the component's CSS is placed in the shadow root through a
     constructed stylesheet, so host styles do not leak in and Kadam styles do
     not leak out. Theme tokens are CSS custom properties on `:host`, so the
     host page can override them.
   - **Events:** a component sentence `when clicked, tell the page "select"`
     (new, components only) dispatches `new CustomEvent("select", { bubbles:
     true, composed: true })`. That is the only way out of the component.
   - **Runtime:** one shared ES module, `kadam-elements.js`, defines all the
     elements. No framework, no innerHTML from attributes (values are set with
     `textContent` and checked `setAttribute`, as in D-41). Budget: about 3 KB
     minified for the element base, plus the D-36 runtime only if a component
     uses state.
   - **Accessibility:** the compiler's checks run on each component as today.
     Focus and labels work across the shadow boundary because only native
     elements are used inside.
3. **TypeScript declarations:** the same build writes `kadam-elements.d.ts`
   with `HTMLElementTagNameMap` entries, typed attributes and event maps, plus
   a `JSX.IntrinsicElements` block for React, so `tsc --strict` flags a
   misspelled attribute or a wrong event name.

**Not in this decision.** The native React target (`--target react`, `.tsx`
output) waits until Web Components pass the exit test; it may turn out to be
unnecessary. Importing design tokens from an existing CSS file is a small
follow-up after D-42 item 2.

**Exit (from the F6 plan).** The dashboard reference runs inside a minimal
Vite + React TypeScript app using the Web Components output, type-checks
under `tsc --strict`, and passes its interaction tests. The test app lives
under `test/interop/` and is not a dependency of the package (D-15 stays
intact).

**Alternatives considered.**

1. React first: covers one framework; Web Components work in all of them,
   including plain HTML and CMS pages.
2. Light DOM custom elements (no shadow root): simpler, but host CSS would
   restyle Kadam output, and Kadam's checks would no longer describe what
   users see.
3. One custom element per page instead of per component: too coarse to reuse
   inside an existing app.

### D-44 — The server boundary: pages call typed Kadam functions (after F6)

**Status:** Approved by the user on 2026-11-25.

**Problem.** A Kadam page can load JSON from a URL (D-41) and a form can post
to a URL, but what answers is written in another language, by hand, with
nothing checking that both sides agree on the data. A field renamed on the
server shows up as an error state in production. The plan's next step is the
backend: one project where the page and the server share types and the
compiler checks both.

**Proposal.** A project may name one `kadam 0.2` server module. Pages call its
functions by name; the compiler checks every call against the function's
types and generates the server and the wiring.

```json
{ "kadam": "0.3", "server": { "module": "server/shop.kdm", "target": "typescript" } }
```

```kdm
kadam 0.2

module shop {
    record Product {
        name as text
        price as number
        inStock as boolean
    }
    record Signup {
        email as text
        plan as text
    }
    function listProducts takes nothing and returns list of Product {
        return [Product { name: "Lamp", price: 40, inStock: true }]
    }
    function signUp takes signup as Signup and returns nothing {
        output "new signup: " + signup.email
    }
}
```

```kdm
catalog {
    a container
    it loads products from the server function listProducts
    while loading, it shows loadingNote
    when there are none, it shows emptyNote
    when loading fails, it shows errorNote
    tile {
        a ProductCard for each product in products
        with a name of the name of product
    }
}
signupForm {
    a form
    it sends to the server function signUp
    when it is sent, it shows thanksNote
    when sending fails, it shows sorryNote
    email { a text field ... }
    plan { a dropdown ... }
}
```

1. **Types come from the server.** A server load takes its shape from the
   function's return type, `list of <Record>` (KDM3060 otherwise), so there is
   no `each product has ...` sentence to keep in sync; writing one is an
   error. Record fields map to the D-41 types: `text`, `number`, `boolean`
   (true or false). Every list sentence (`only where`, `sorted by`, paging)
   and every component binding is checked against the record, with the same
   errors as today.
2. **Forms match a record.** A form that sends to a server function needs a
   function that takes one record and returns `nothing`. Each field of the
   record must be a control in the form with the same name, and each control
   must be a field (KDM3061, naming the missing or extra one). Types match
   controls: `text` for text fields, text areas and dropdowns, `boolean` for
   a checkbox. A `number` field in a form record waits for a number input. `it is required` stays a page
   rule; the server checks types again on every request.
3. **Two required states, like D-41.** `when it is sent, it shows X` and
   `when sending fails, it shows Y` are required. Without JavaScript the form
   still works: it posts normally and the server answers with the page and
   the sent or failed state shown.
4. **The generated server.** `kadam build` writes `server/` next to the site:
   the module compiled by its existing target adapter (D-31), plus a small
   generated HTTP layer using only the target's standard library (Node
   `http` for TypeScript, `wsgiref`-compatible WSGI for Python). It serves the
   static site and one route per called function under `/_kadam/` (`GET` for
   loads, returning JSON; `POST` for forms). Only functions a page calls are
   exposed; the rest of the module stays private.
5. **Security by default.** Same-origin only: requests must carry the
   `X-Kadam` header (sent by the runtime) or a same-origin `Origin`, so other
   sites cannot post forms on a user's behalf. Bodies are limited to 64 KB,
   parsed by type before the function runs (a bad body is a 400, never a
   call), and errors are logged on the server and answered with a fixed
   message, never a stack trace. Cookies, sessions and auth stay out of this
   decision.
6. **Development.** `kadam dev` builds the server module and runs it as a
   child process (Node runs the TypeScript output with type stripping; Python
   runs with the system `python3`), restarts it when the module changes, and
   sends `/_kadam/` requests to it. Live reload keeps working.
7. **The compiler still never runs code.** Building checks types across the
   page and the module and emits files; only `kadam dev` and the user's own
   deployment run the server.
8. **Deterministic and zero-dependency (D-15).** Same input, same files. The
   generated server needs nothing beyond the target's runtime.

**Steps.** (1) server data loading with TypeScript; (2) forms; (3) `kadam dev`
running the server; (4) the Python target. Each is tested end to end against
the generated server in a browser.

**Not included (later decisions).** Arguments to loads (filters sent to the
server), auth and sessions, databases (a server function can use an
`external` from D-31), streaming, and more than one server module.

**Alternatives considered.**

1. A separate API language (OpenAPI, GraphQL): another file to keep in sync,
   which is the problem this solves.
2. Generating only types for a hand-written server: still lets the handler
   disagree with the page at run time, and leaves HTTP, parsing and security
   to each project.
3. Server code inside page files: breaks the D-30 module/page separation and
   mixes code that runs in two places.

---

### D-45 — Translations: one page source, per-language text files (F8)

**Status:** Approved by the user on 2026-11-26.

**Problem.** A site in two languages today means copying every page file and
keeping the copies in step. The layout drifts, and a missed sentence is found
only by a reader.

**Proposal.** The manifest lists languages; each page is built once per
language, with its quoted text taken from a JSON file per language.

```json
{ "kadam": "0.3", "languages": { "default": "en", "others": ["fr", "ar"] },
  "translations": "translations" }
```

- The default language's text is the text in the `.kdm` files. Nothing new is
  written there.
- `kadam translations` writes `translations/fr.json` and `translations/ar.json`
  with every quoted string keyed by its element path
  (`"home/hero1/title1": "Ready when you are"`), keeping existing entries.
- Each other language is built under `/<language>/`, with `lang` set and, for
  a right-to-left language, `dir="rtl"` (6.30). Every page gets
  `<link rel="alternate" hreflang>` to its other versions.
- A missing entry is a warning (a new code), and the default text is used. An entry
  whose source text changed since it was written is a warning too (the file
  keeps the source text it translated). An entry for an element that no
  longer exists is an error.
- `a language switcher` is a new kind: a list of links to the same page in
  each language.

**Not included.** Translated routes (`/fr/a-propos`), plural rules and number
formatting, and translating text loaded at run time.

**Alternatives considered.**
1. One `.kdm` file per language: simple, but layout and text drift apart,
   which is the problem.
2. Keys in the source (`the text says @hero.title`): every sentence loses its
   readable default, and Kadam's point is that the file reads as the page.
3. Translating in the browser: needs JavaScript, flashes the wrong language,
   and search engines see one language.

---

### D-46 — The standard component library, shipped with the compiler (F8)

**Status:** Approved by the user on 2026-11-26.

**Problem.** Every project rebuilds the same cards, navigation bars, tabs,
accordions, pricing tables and footers. Components (D-19 to D-28) make them
reusable inside a project, but there is nothing to start from.

**Proposal.** The compiler ships a library of components written in Kadam,
read like any other component through a reserved `kadam` namespace (D-24).

```json
{ "components": [{ "library": "kadam", "use": ["Card", "NavBar", "Tabs", "PricingTable"] }] }
```

```kdm
plan1 {
    a PricingPlan from kadam in the featured variant
    with a name of "Pro"
    with a price of "$12"
    with a target of "Signup"
}
```

- The library lives in `library/*.kdm` in the package, versioned with the
  compiler. A project names the components it uses, so nothing is included
  by accident and nothing unused is built.
- `kadam explain Card` prints a component's parameters and slots.
  `kadam eject Card` copies its source into the project, under the project
  namespace, for anyone who wants to change it.
- Every library component passes axe, keyboard-only use, reduced motion, dark
  mode and the contrast check in the test suite.
- First set: Card, NavBar, Footer, Hero, FeatureGrid, PricingTable, Tabs,
  Accordion, Modal, Testimonial, Banner, Breadcrumbs.

**Not included.** A registry for third-party libraries (F9), and theming the
library beyond the D-38 theme colours.

**Implemented 2026-11-26** with twelve components (see `docs/components.md`).
`Tabs` and `Modal` wait for state inside components; `Breadcrumbs` is not
written yet. Building the library found and fixed a bug: component
parameters were not filled into 0.3 statements with quoted text (an
expandable section's title, a caption, a label).

**Alternatives considered.**
1. Templates copied by `kadam new`: projects can't receive fixes, and every
   project carries hundreds of copied lines.
2. A package registry now: needs hosting, trust and versioning decisions that
   belong to F9.

---

### D-47 — 3D models: a generated, self-hosted viewer (F8)

**Status:** Approved by the user on 2026-11-26.

**Problem.** Product pages want a model the reader can turn. Today that means
a third-party viewer script, which D-15 and D-36 rule out.

**Proposal.** A new kind, `a 3d model`, renders with a small WebGL viewer that
Kadam generates and serves from the site itself, loaded only on pages that use
it.

```kdm
shoe1 {
    a 3d model
    it shows "assets/shoe.glb"
    the poster is "assets/shoe.jpg"
    the description says "Running shoe, white and teal"
    it turns slowly
    the lighting is studio
}
```

- Only `.glb` (glTF 2.0, binary). The compiler checks the header and the size
  against the page budget.
- A poster and a description are required. The poster shows first and is
  what readers see without WebGL, without JavaScript or with reduced motion.
  The model loads only when it scrolls into view.
- Drag or arrow keys turn it, and the wheel or `+`/`-` zoom it. The element is
  focusable and announces its description.
- `it turns slowly` (stops with reduced motion), and `the lighting is studio,
  daylight or soft`.
- The viewer is written for Kadam (WebGL2, PBR shading of base colour,
  metal/roughness and normal maps), with no third-party code. The budget is
  under 30 kB gzipped.

**Not included.** Animations inside models, AR, other formats, and scenes
with more than one model.

**Alternatives considered.**
1. Vendoring `<model-viewer>` or three.js: proven, but a large third-party
   runtime (hundreds of kB) that Kadam would have to track for security.
2. CSS 3D only: tilt and flip already exist; it cannot show a real model.

---

### D-48 — Build-time image processing: responsive sizes and modern formats (F8)

**Status:** Approved by the user on 2026-11-26.

**Problem.** `it shows "assets/hero.jpg"` serves the file as it is. A 4 MB
photo is sent to a phone, and there is no AVIF or WebP. D-15 (zero
dependencies) rules out bundling an image library.

**Proposal.** `kadam build --images` resizes and re-encodes images with a tool
already installed on the machine, and writes `srcset` and `<picture>`.

- The tools are tried in order: `vips`, then `magick` (ImageMagick), then
  `sips` on macOS. Which one ran is printed. Without one, the build works as
  today and says so once.
- Each raster image gets widths 480, 960, 1440 and 1920 (never larger than
  the source), as AVIF and WebP with the original format as fallback, and
  `sizes` worked out from the element's layout width.
- A blur-up placeholder (a tiny inline WebP) is shown until the image loads,
  with `it loads with a blurred preview`.
- Results are cached in `.kadam/images/` by content hash, so a rebuild is
  fast and output stays deterministic for the same tool version.
- `kadam check` warns about an image wider than 2560 px or larger than 500 kB
  when `--images` is not used.

**Not included.** Art direction (different crops per screen), and image CDNs.

**Alternatives considered.**
1. Bundle `sharp` or a WASM encoder: breaks D-15, and adds 10 to 30 MB.
2. Leave it to a host's image service: fine for those who have one, but most
   static hosts do not.

---

### D-49 — Lottie animations (F8)

**Status:** Approved by the user on 2026-11-26.

**Problem.** Designers hand over animations as Lottie JSON. Playing one needs
a player, and the common one (`lottie-web`) is a 250 kB third-party runtime.

**Proposal.** `an animation` kind plays a Lottie file with a player Kadam
generates, covering the common subset: shape layers, fills, strokes, gradients,
transforms, trim paths and masks, rendered to SVG.

```kdm
loader1 {
    an animation
    it plays "assets/loading.json"
    the poster is "assets/loading.svg"
    the description says "Loading"
    it loops
}
```

- The compiler reads the file and refuses features outside the subset
  (expressions, images, text layers, 3D layers, effects) with the layer name,
  so nothing silently renders wrong.
- A poster and a description are required, or `it is decorative`. With
  reduced motion, the poster (or the first frame) shows. It plays once unless
  `it loops`, and `it plays when visible` starts it on scroll.
- The player budget is under 15 kB gzipped and loads only on pages that use it.

**Not included.** Interactivity (scrubbing on scroll, hover segments), and dotLottie.

**Alternatives considered.**
1. Vendoring `lottie-web`: full coverage, but large and third-party.
2. Converting to CSS keyframes at build time: no runtime, but only the
   simplest files convert, which surprises people.

---

### D-50 — kadam 0.4: pages written as paragraphs (before F9)

**Status:** Approved by the user on 2026-11-26 (with the plan that set its
four choices: fixes are offered, never guessed; 0.4 sits beside the block
form; the file name is the route; all four effect groups).

**Problem.** A block page is exact but long, and it does not read the way
people describe a page: "the logo top left, a Get Started button top right,
then a 200px gap, then a big heading". Reusable pieces need a manifest entry
and a file each, and creative motion means knowing many separate sentences.

**Proposal.** A file that starts with `kadam 0.4` is written as paragraphs.
Reading order is layout order. Each sentence that names a thing makes an
element; sentences that start with "It", "Its", "The background", "The
text" or "When" describe the thing just named, or the section they are in.
A line ending in `:` (`Hero section:`, `Nav bar:`, `Footer:`) opens a group
for the indented lines under it. `After that, a 50px gap.` spaces the next
element.

```kdm
kadam 0.4

Hero section:
    The background is a blue to white gradient from left to right.
    A big heading says "Meet Lumen, the most effective agent you can run."
    After that, a 50px gap.
    Small gray text, 18px, says "Lumen helps you get the most out of AI."
    After that, a 70px gap.
    A big black button called download says "Download for macOS".
```

- **One meaning, many orders.** Describing words belong to classes (size,
  colour, weight, length, alignment) and may come in any order. A word whose
  meaning depends on the kind (`18px` on a box) is an error with fixes.
- **Synonyms are vocabulary.** `pixels`, `grey`, `nav bar`, `colour`,
  `centred`, `that says` and others are documented spellings, not guesses.
- **The paragraph form is a front end.** It is translated to the block form,
  line for line, with every line mapped back to its sentence, and then
  parsed, checked and built exactly as a 0.3 file. `kadam explain --blocks
  page.kdm` prints the translation. A block (`name { ... }`) may appear
  in a paragraph page where exact control is wanted.
- **Fixes, never guesses.** An unknown sentence is an error with up to
  three fixes, worded as paragraph sentences and found deterministically
  (edit distance over the vocabulary plus a phrase table). `kadam fix`
  applies the fix you choose; the editor offers the same quick fixes.
- **File routes.** Without `pages` in `kadam.json` (or without `kadam.json`),
  `pages/home.kdm` (or `index.kdm`) is `/` and `pages/usage.kdm` is `/usage`;
  the page title is the file name unless the page says `The page is called
  "..."`. `components.kdm` at the project root is read automatically.
- **Fill in the blanks.** In `components.kdm`, `A PrimaryButton is a big black
  button with white text that says ___.` defines a component whose blanks
  are its parameters; `A PrimaryButton says "Sign up".` uses it, and
  `A PrimaryButton, but blue, says "Sign up".` overrides one thing.
  `without` removes what a kind has by default (`a card without a shadow`).
- **Effects.** Cursor (pixels, grain, glow, spotlight), button (sliding
  fill, shine, magnetic pull, drawn border, ripple), scroll and page (tilt
  on scroll, parallax, reveal, page enter and cross-page transitions) and
  text (typing, word by word, gradient text, scramble, highlight sweep), each
  one sentence, each off with reduced motion, cursor effects off on touch.
  They are available to block files too.

**Not included.** Free-form English that the compiler interprets; a sentence
is either in the language or an error with fixes.

**Alternatives considered.**
1. Applying the closest match automatically: faster to write, but a typo
   can change the page without anyone noticing (rejected by the user).
2. Replacing the block form: breaks every existing project and the
   byte-identity guarantee.
3. An AI step in the compiler: output would differ between runs and
   machines, and builds would need the network.

---

## Approval checklist

| ID | Decision | Blocks | Recommendation | Status |
| --- | --- | --- | --- | --- |
| D-01 | Template grammar | M1 | Approve | Approved |
| D-02 | Braces and line rules | M1 | Approve | Approved |
| D-03 | Kind-first sentence | M1 | Approve | Approved |
| D-04 | Case and identifiers | M1 | Approve | Approved |
| D-05 | Typed values and overloading | M1/M2 | Approve | Approved |
| D-06 | Built-in defaults | M2 | Approve direction | Approved |
| D-07 | No cascade | M2 | Approve | Approved |
| D-08 | Fixed breakpoints | M3 | Approve for v0.1 | Approved — implemented |
| D-09 | Titles as navigation | M3 | Approve for v0.1 | Approved — implemented |
| D-10 | Component direction | M6 | Approve with amendments | Approved — M6 architecture |
| D-11 | Static output model | M2/M3 | Approve | Approved |
| D-12 | Declarative interactions | M5 | Approve | Proposed |
| D-13 | Accessibility errors | M2 | Approve | Approved |
| D-14 | One page per file + manifest | M3 | Approve | Approved — implemented |
| D-15 | Single package, zero deps | M0–M6 | Approve | Approved |
| D-16 | Naming and license | Release | Resolve | Apache-2.0 selected; package prepared; publication pending |
| D-17 | Dev server: memory snapshots, HTTP, SSE | M4 | Approve | Approved — implemented |
| D-18 | No client-side runtime in v0.1 | M5+ | Approve | Approved — implemented |
| D-19 | Component files and explicit catalog | M6 | Approve | Approved — M6 architecture |
| D-20 | Component expansion boundary | M6 | Approve | Approved — M6 architecture |
| D-21 | Component interfaces and variants | M6 | Approve | Approved — M6 architecture |
| D-22 | Component validation and diagnostics | M6 | Approve | Approved — M6 architecture |
| D-23 | Content slots: unnamed, named, fallback | Post-M6.1 | Approve | Approved — implemented |
| D-24 | Component libraries use optional manifest namespaces | Post-M6.1 | Approve | Approved — implemented |
| D-25 | URL component parameters | Post-M6.1 | Approve | Approved — implemented |
| D-26 | Image component parameters | Post-M6.1 | Approve | Approved — implemented |
| D-27 | Length component parameters | Post-M6.1 | Approve | Approved — implemented |
| D-28 | Color component parameters | Post-M6.1 | Approve | Approved — implemented |
| D-29 | CLI-first distribution; remove the browser editor | M7 | Implemented | Approved — implemented |
| D-30 | v0.2 core + declarative UI subset | M7 | Review spec | Approved — implemented |
| D-31 | Target adapters and typed external bindings | M7/M8 | Review contract | Approved — implemented for TypeScript/Python core targets |
| D-32 | Regular property sentence + property table | F1 | Approve | Approved — implemented behind kadam 0.3 |
| D-33 | Version gating for UI syntax (`kadam 0.3`, KDM2013) | F1 | Implemented | Implemented |
| D-34 | Reserved element names; single-diagnostic recovery | F0 | Implemented | Implemented |
| D-35 | Browser support matrix | F2 | Approve | Approved |
| D-37 | Frontend vocabulary is contextual, not reserved | F1 | Implemented | Implemented |
| D-36 | Client runtime for kadam 0.3 (replaces D-18 for 0.3) | F4 step 2 | Approve | Approved |
| D-38 | Theme colors and dark mode | F3 | Approve | Approved — implemented behind kadam 0.3 |
| D-39 | Contrast check is a warning in 0.3 | F3 | Approve | Approved — implemented |
| D-40 | Build-time data files and data lists | F5 step 1 | Review | Implemented under the user's go-ahead |
| D-41 | Runtime data: declared origins, typed shapes, required loading/empty/error states | F5 step 6 | Approve | Approved |
| D-42 | Escape hatches: raw CSS declaration, existing classes, typed externals; no raw HTML; `--strict` bans them | F6 | Approve | Approved |
| D-43 | Interop: fragments, Web Components (primary), TypeScript declarations | F6 | Approve | Approved |
| D-44 | Server boundary: pages call typed functions in a kadam 0.2 server module; generated server | After F6 | Approve | Approved |
| D-45 | Translations: per-language text files, one page source, `/<language>/` builds | F8 | Approve | Approved |
| D-46 | Standard component library shipped with the compiler (`from kadam`) | F8 | Approve | Approved — implemented |
| D-47 | 3D models with a generated, self-hosted WebGL viewer | F8 | Approve | Approved |
| D-48 | Build-time images with an installed tool (vips, ImageMagick, sips) | F8 | Approve | Approved |
| D-49 | Lottie subset with a generated SVG player | F8 | Review scope | Approved |
| D-50 | kadam 0.4: pages written as paragraphs; fixes offered, never guessed; file routes; fill-in-the-blank components; effects | Before F9 | Approve | Approved — implemented |

Approving D-01 through D-05 is sufficient to begin M1. D-06 and D-13 are needed
before M2. D-08, D-09, and D-14 are needed before M3. D-10 and D-19 through
D-22 are approved for M6. D-23 through D-28 are post-M6.1 language follow-ups
and are implemented. D-29 through D-31 are implemented: the CLI is the only
distribution path, the v0.2 core lowers to a portable IR, and the TypeScript and
Python core adapters pass executable conformance tests.

---

### D-51 — Fonts: 150 built in, every free font one command away

**Status:** Approved by the user on 2026-11-26 (one-time add command; about
150 built-in families).

**Problem.** A page can use only the three system stacks (sans serif, serif,
monospace), or a font file listed by hand in `kadam.json`. Other languages
and design tools make a font one word away. Kadam should too, without
breaking the rule that builds never use the network (D-41).

**Proposal.** Four layers, looked up in this order:

1. **The project's `fonts/` folder.** Any `.woff2`, `.woff`, `.ttf` or `.otf`
   file is picked up with no `kadam.json` entry. The family is the file name
   before its style suffix (`Acme Sans-Bold.woff2` is "Acme Sans", weight
   700). Paid fonts are installed this way. `kadam.json` `fonts` keeps working.
2. **Built-in fonts.** About 150 of the most popular free families (Google
   Fonts popularity, through Fontsource, OFL and Apache licensed) ship in the
   package under `library/fonts/`. `The page font is Lora.` works with no
   setup. Variable fonts ship one file per alphabet and style; the page gets
   one `@font-face` per file with its `unicode-range`, so visitors download
   only the alphabets the page uses. Chinese, Japanese and Korean families are
   several megabytes each and are not built in; they come from layer 3.
3. **The catalog.** The package ships a list of every Fontsource family
   (about 2,100: name, category, weights, styles, alphabets, licence).
   `kadam fonts add "Bricolage Grotesque"` downloads that family once into
   `fonts/`, with its licence. That command is the only one that uses the
   network; builds stay offline and identical. `kadam fonts list [--category
   serif]` and `kadam fonts info Lora` read the catalog.
4. **System stacks.** `sans serif`, `serif`, `monospace` as today, plus
   `rounded`, `system` and `handwriting` stacks.

**Sentences.** `The page font is Lora.`, `The heading font is Playfair
Display.`, `The font is "Space Grotesk".` (quotes optional for a known
name), and in blocks `the font is "Lora"`. The fallback stack follows the
font's category (serif, sans serif, monospace, display, handwriting).
Only families the pages use are copied into the build.

**Fixes, never guesses.**
- An unknown name is `KDM3005` with up to three closest names as fixes.
- A catalog font that isn't installed is `KDM3005` with the exact
  `kadam fonts add` command.
- A weight the font does not have (`the text weight is 300` on a 400–700
  font) is a warning listing the weights it has.

**Not included.** Fetching fonts during a build; hot-linking Google's CDN
(it leaks visitors' addresses to a third party); subsetting fonts to the
characters a page uses (later); colour and icon fonts.

**Alternatives considered.**
1. Download during build: simplest to write, but builds need the network and
   change when the source changes.
2. Built-in set only: no network ever, but most families out of reach.
3. All 2,100 families in the package: several gigabytes.

**Implemented 2026-11-27.** 150 families (43 MB, `library/fonts/`), the
catalog of 2,095 families, `kadam fonts list|info|add`, the `fonts/` folder,
`the page font is "..."` and `the heading font is "..."` settings, single-file
builds, and the docs site's Fonts page. The `rounded`, `system` and
`handwriting` system stacks are not added; a handwriting font's fallback is a
handwriting stack.
