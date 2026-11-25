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

Approving D-01 through D-05 is sufficient to begin M1. D-06 and D-13 are needed
before M2. D-08, D-09, and D-14 are needed before M3. D-10 and D-19 through
D-22 are approved for M6. D-23 through D-28 are post-M6.1 language follow-ups
and are implemented. D-29 through D-31 are implemented: the CLI is the only
distribution path, the v0.2 core lowers to a portable IR, and the TypeScript and
Python core adapters pass executable conformance tests.
