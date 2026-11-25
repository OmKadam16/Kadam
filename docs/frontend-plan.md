# Kadam Frontend Plan — from static pages to a full UI language

**Status:** Approved (2026-11-24). F0 is implemented; F1 is next.
**Replaces as current priority:** the backend half of M8. The v0.2 core and its
TypeScript/Python adapters stay as they are (maintained, not extended) until
this plan reaches F6.
**Language version:** every syntax addition below ships under `kadam 0.3`.
`kadam 0.1` files keep compiling with byte-identical output.

---

## 1. Goal

Kadam should be able to describe any ordinary website or web-app front end
that people build today with HTML, CSS and TypeScript, and the generated
output must work alongside code people already have. Backend targets (Python,
Rust, Java) come after that.

"Full frontend language" means three things, in this order:

1. **Coverage:** the structure, layout and styling a designer expects can be
   written in Kadam without an escape hatch.
2. **Behaviour:** state, events, conditions, lists, forms and data, with a
   small, deterministic, generated client runtime.
3. **Interop:** Kadam UI can be embedded in, and can call into, existing
   HTML/CSS/TypeScript/React projects.

The principles in the README do not change. One sentence still matches exactly
one template, unknown sentences are still errors, there is still no model or
network access in the compiler, and output is still byte-identical.

## 2. Where we start (measured 2026-11-24)

- `npm run check`: 224/224 tests pass.
- A two-page landing site (nav, hero, cards, signup, motion, phone layout)
  compiles to clean static HTML/CSS.
- **5 of 70** everyday frontend probes compile (re-baselined as 66 checked-in probes at F0). The failures, grouped by
  phase, are listed in §11 and become the conformance checklist for this plan.

## 3. Acceptance benchmark

The plan is done when three reference projects build from Kadam source alone,
with no raw CSS/JS escape hatch, and pass their browser tests:

| Reference | Exercises |
| --- | --- |
| **Marketing site** | semantic sections, grid, responsive images, custom font, dark mode, contact form that submits |
| **Docs site** | header/sidebar/footer layout, sticky nav, mobile menu toggle, code blocks, tables, lists, page metadata, rendering pages from a data file |
| **App dashboard** | state, conditional UI, lists from fetched data, tabs, modal dialog, form validation, embedded inside an existing React app |

They live in `examples/reference/` and run in CI from F2 onward. Each one grows
as phases land.

## 4. One design decision to settle first: how the grammar grows

Getting from 12 kinds and about 60 templates to full coverage roughly
quadruples the grammar. Writing a hand-made template for every CSS-like
property (`the line height is`, `the letter spacing is`, ...) will not scale and
makes the language hard to learn.

**Proposal (decision D-32): a regular property sentence.** Add one canonical
form backed by a closed, typed property table:

```kdm
the <property> is <value>
the <property> is <value> on <side|corner>
```

- `property` comes from a fixed vocabulary, for example `line height`,
  `letter spacing`, `opacity`, `max width`, `overflow`, `aspect ratio`,
  `layer`, each with a declared value type (`length`, `number`, `percentage`,
  `color`, an enum). Unknown properties are `KDM2001` with a nearest-match
  hint.
- The existing hand-written templates (`has rounded corners`, `it centers its
  children`) remain as readable shorthands and lower to the same property.
  Setting a property both ways is a duplicate (`KDM3004`), as today.
- The property table is data in `src/core/parser/`. It generates matchers,
  `kadam keywords` output, reserved words, documentation tables and LSP
  completion from one source, so adding a property is one table row plus
  tests.
- The CI overlap test (risk register) runs against the generated templates.

Every later phase uses this mechanism. **F1 is blocked on D-32.**

## 5. Phases

Each phase ends with a tagged release and green reference fixtures. Sizes are
relative effort, not dates.

### F0 — Foundations (small) — implemented 2026-11-24

Fix what hurts every user before adding surface.

| Item | Result |
| --- | --- |
| Reserved-word names | Done (D-34). A bad or malformed element name is one `KDM2007`/`KDM2002` with a rename hint, and the block still opens, so nothing cascades. Names stay reserved because F4 sentences will reference elements by name. |
| `kadam keywords` | Done. `--colors`, `--core`, `--all`, `--json`; generated from the lexicon. |
| `kadam 0.3` directive | Done (D-33). Templates carry `since`; newer syntax in an older file is `KDM2013`, naming the construct. The manifest version is the default; a file directive must match it. |
| Browser support matrix | Approved (D-35): latest two Chrome, Edge and Firefox; Safari 16.4+. |
| Property table | Done and approved (D-32). 15 rows under `kadam 0.3`: 13 regular spellings of existing sentences (byte-identical output, shared duplicate keys) and 2 new (`line height`, `letter spacing`). |
| Probe suite | Done. 66 probes in `test/fixtures/frontend-probes/probes.json`; CI fails when a result changes; `npm run probes` prints coverage by phase (6/66 at F0). |

**Exit:** met. Every pre-existing test and golden output is unchanged, and
`kadam 0.1` and `kadam 0.3` builds of the same page are byte-identical (tested).

### F1 — Element catalogue and document structure (medium)

- ~~Move the existing shorthands onto the property table~~ — done with F0.
- **Landmarks:** `a header`, `a footer`, `a section` (requires a heading
  child or a label), `an article`, `a sidebar` (`aside`). Placement rules:
  header/footer at page level are emitted outside `<main>`, and the navigation
  bar moves into the header when one is present.
- **Headings:** keep `main`/`section`/`minor`, add `a small heading` (`h4`).
  Add an outline check: warn on skipped levels and error on more than one main
  heading.
- **Text:** line breaks via `then on a new line` or a multi-line string, and
  inline spans within text: `the text says "Read the [docs] now" where "docs"
  goes to page "Docs"` and `where "fast" is bold`. Spans are plain text plus
  a range annotation and are never parsed as markup.
- **Lists:** `a list`, `a numbered list`, `a list item`.
- **Tables:** `a table` with `a header row`/`a row`/`a cell`, a required
  caption, and scope attributes emitted automatically.
- **Media:** `a video` (source, poster, captions file required unless
  `it has no speech`), `an audio clip`, `an icon` (SVG file from assets,
  inlined, decorative or labelled), and `a code block` (monospace, preserved
  whitespace, no highlighting yet).
- **Form controls (static):** `a form`, `a text area`, `a checkbox`,
  `a radio group` with options, `a dropdown` with options, more field types
  (`phone numbers`, `dates`, `times`, `urls`, `search terms`), min/max length,
  and `it is disabled`.
- **Page metadata:** `the page description says`, `the page language is`,
  `the page icon is`, `the page share image is`, plus a manifest-level `siteUrl`
  for canonical URLs and an emitted `sitemap.xml`.

**Exit:** the docs-site skeleton and the marketing site's static content build
with correct landmarks, and an automated axe-core pass on the output reports
zero violations.

### F2 — Layout and sizing (medium)

- **Units:** `%`, `vw`, `vh`/`dvh`, `em`, and `between <length> and <length>`
  (emitted as `clamp()` with the viewport as the fluid axis), for size and
  text.
- **Constraints:** `it is at most 1200px wide`, `at least`, and
  `it keeps a 16:9 shape` (aspect ratio).
- **Flex completion:** `it wraps its children`,
  `it spreads its children apart` (space-between),
  `it spaces its children evenly`, and per-child rules: `it grows to fill the
  space`, `it does not shrink`, `it sits at the end`.
- **Grid:** `it arranges its children in 3 columns`, `in columns at least
  240px wide` (auto-fill/minmax), and `it spans 2 columns`. Responsive column
  counts via the existing `on phones,` prefix.
- **Positioning:** `it sticks to the top` (with offset),
  `it is pinned to the bottom right` (fixed), `it is placed over its parent`
  (absolute inside a positioned container, emitted automatically), and
  `the layer is 10`. Overlap rules are checked at compile time where possible.
- **Overflow:** `it scrolls vertically|horizontally`, `it hides overflow`.
- **Images:** `it fills its box` / `it fits inside its box` (object-fit), focal
  point, `it loads lazily` (default for images below the first screen), and
  generated `srcset` widths from the asset at build time (deterministic
  resize).
- **Custom breakpoints:** named in `kadam.json`
  (`"breakpoints": { "wide": 1440 }`), used as `on wide screens,`. The default
  three tiers stay. Container queries come as
  `when its parent is narrower than 400px,`.

**Exit:** all three reference layouts render correctly at 360/768/1280/1600px.
Playwright screenshot tests in CI compare against approved baselines.

### F3 — Styling, theming and states (medium)

- **Color:** `rgb()`/`hsl()` forms, `the opacity is 50%`, and named tokens.
- **Borders and corners:** dashed/dotted, per-side (`on the bottom`),
  per-corner radius, and outline.
- **Backgrounds:** multi-stop and radial gradients, angles, background images
  from assets with cover/contain/position, and a page-level gradient.
- **Typography:** underline/strike, case transform, line height, letter
  spacing, max line length (`the text is at most 65 characters wide`),
  truncation (`it shows at most 2 lines`), and **custom fonts** from local
  font files declared in the manifest. No remote fonts, which keeps builds
  network-free.
- **Shadows and effects:** colored and custom shadows, inset, blur, and
  rotate/translate transforms.
- **Design tokens** (open question 5): a `theme.kdm` file declaring colors,
  spacing scale, radii, fonts and shadows (`the brand color is #FF0066`),
  referenced by name (`has a brand background`). Emitted as CSS custom
  properties. Tokens are typed and unknown tokens are errors.
- **Dark mode:** `in dark mode, the brand color is #FF4D8D` in the theme, plus
  per-element `in dark mode,` overrides. The default follows
  `prefers-color-scheme`. A user toggle arrives in F4.
- **Interaction states:** `when focused,`, `when pressed,`, `when disabled,`,
  `when checked,` and `when invalid,`, using the same effect grammar as
  `when hovered,`. An author-defined focus style is allowed only if it passes
  a contrast and visibility check.
- **Motion:** `when it scrolls into view` entrances (CSS scroll-driven
  animation where the support matrix allows, otherwise deferred to the F4
  runtime), looping animations (`it pulses`, `it spins`) that are always
  disabled under reduced motion, and staggered children.
- **Contrast check:** text/background pairs whose colors are known statically
  are checked against WCAG AA. Failing is a warning in 0.3 and becomes an
  error in 1.0 (open question 14).

**Exit:** the marketing site is complete, including dark mode, with probe
coverage of at least 80% of §11 items F1–F3.

### F4 — Interactivity: state, events and the client runtime (large)

This is the biggest change, and it needs a decision (**D-36**) that replaces
D-18 for `kadam 0.3`.

**Step 1: native-first interactions, no JavaScript.** Ship everything that
HTML can do natively before any runtime exists:

- `an expandable section` → `details`/`summary` (accordions, FAQs).
- `a dialog`, opened with `when clicked, open dialog "signupDialog"` → `dialog`
  plus the `popover`/`command` attributes where the support matrix allows.
- `when clicked, go to "features"` → in-page anchors to an element name.
  Also `send an email to`, `call`, and `download`.
- Form submission to a URL: `when submitted, send it to
  "https://api.example.com/subscribe"` → plain `action`/`method`. Native
  validation messages via `the error says` and `when invalid,`.

**Step 2: a generated runtime for real state.** The runtime is emitted only
for pages that use state; static pages stay JavaScript-free.

- **State** is declared and typed in the element or page that owns it, reusing
  the v0.2 type system and checker (`src/v02/`):
  ```kdm
  menu1 {
      a container
      it remembers isOpen, a boolean that starts as false
      on phones, it is hidden unless isOpen is true
  }
  menuButton {
      a button
      the text says "Menu"
      when clicked, flip isOpen of menu1
  }
  ```
  This is the first real unification of the v0.1 UI grammar with the v0.2
  core, and it is the M8 goal reached from the frontend side.
- **Events:** clicked, changed, submitted, key pressed (`when the Escape key
  is pressed,`), page loaded, and scrolled into view.
- **Effects:** show/hide/flip, set state, add to/remove from a list, go to
  page, focus element, and call an external function (F6).
- **Bindings:** `the text shows count`, `it is hidden unless`,
  `it is disabled while saving is true`, and field values bound to state.
- **Conditions:** `when cartCount is 0, it shows emptyMessage`. Expressions
  come from the v0.2 core, limited to pure expressions with no effects.
- **Lists:** `for each product in products, show a ProductCard with ...`,
  where a component is instantiated per item and has a stable key.
- **Runtime contract:** generated, tree-shaken per page, about 3 KB as a
  starting budget, with no third-party dependencies. It ships as an external
  `.js` file (CSP-friendly, no inline handlers and no `eval`), and the page
  works first as server-rendered HTML that the runtime then attaches to.
  Output stays byte-identical.
- **Accessibility built in:** dialogs trap focus and restore it, toggles get
  `aria-expanded`/`aria-controls` automatically, and live regions are used
  for state-bound text that changes.
- **Dark-mode toggle** and persisted UI state (`it remembers ... across
  visits`, stored in localStorage) as an explicit opt-in.

**Exit:** the docs site's mobile menu, tabs, the dashboard's modal and form
validation all work, with Playwright interaction tests and keyboard-only
tests. A page with no state still emits zero JavaScript (golden test).

### F5 — Data (medium)

- **Build-time data:** `kadam.json` declares typed data files (JSON/CSV in the
  project), used for lists and for **generated pages**: one page per record
  (`/blog/:slug`) from a template page. This stays deterministic because it is
  just more source.
- **Runtime data:** `it loads products from "https://api.example.com/products"
  as a list of Product`, using typed shapes declared with v0.2 records. Loading,
  empty and error states are required, so a missing one is a compile error.
  Requests run in the client runtime, and the compiler itself never touches
  the network.
- **URL state:** query and route parameters readable as typed values.
- **Markdown content** (docs/blog): `a document that shows "content/intro.md"`
  rendered at build time by a built-in CommonMark subset, with no raw HTML
  pass-through.

**Exit:** the docs site renders all pages from data files, and the dashboard
loads, filters and paginates live data in tests against a local mock server.

### F6 — Interop with HTML, CSS, TypeScript and frameworks (large)

This is what makes Kadam usable *with* existing languages and not only instead
of them.

- **Embed mode:** `kadam build --fragment` emits an HTML fragment plus scoped
  CSS (and the runtime if needed) to drop into any existing page or CMS.
- **Web Components target (primary):** each Kadam component becomes a custom
  element (`<kadam-pricing-card plan="pro">`) with typed attributes, slots
  mapped to Kadam slots, and events dispatched as `CustomEvent`s. Custom
  elements work unchanged in plain HTML, React, Vue, Svelte and Angular, so
  this one adapter covers most frameworks.
- **TypeScript declarations:** a generated `.d.ts` for every component's
  props/events, plus JSX intrinsic-element typings, so a TypeScript app gets
  type errors when it misuses a Kadam component.
- **React adapter (second):** `--target react` emits `.tsx` components for
  teams that want native React output. It passes the same conformance suite
  as the Web Components target.
- **Calling existing code:** typed `external` functions (D-31) callable from
  event handlers:
  ```kdm
  external trackEvent from "./analytics.ts" takes text and returns nothing
  ```
  Kadam checks the call types against the declaration. It never reads or
  parses the TypeScript file.
- **Escape hatches** (open question 12), explicit and visible:
  `it also uses the class "legacy-hero" from "styles/legacy.css"` for existing
  stylesheets, and a `raw html` block limited to a sanitised allowlist with a
  warning. Both are reported by `kadam check --strict` so teams can ban them.
- **Using existing design systems:** import CSS custom properties from a
  tokens file as Kadam theme tokens.

**Exit:** the dashboard reference runs embedded inside a minimal Vite + React
TypeScript app using the Web Components output, type-checks under `tsc
--strict`, and passes its interaction tests.

### F7 — Tooling and developer experience (runs alongside F2–F6)

Moved forward from M9, because a larger frontend grammar is unusable without
it.

- **LSP:** diagnostics identical to the CLI, completion driven by the property
  table, hover docs, go-to-definition for components, pages and state.
- **`kadam format`:** canonical indentation and statement order.
- **`kadam explain KDM3005`:** offline error documentation.
- **`kadam new`:** project templates, built from the reference projects.
- **Dev server:** state-preserving reload for runtime pages and an overlay
  that links to the source line of a clicked element (`data-kdm-id` already
  exists).
- **Dogfooding:** the Kadam documentation site is written in Kadam.

## 6. After F6: back to the backend

Once F6 exits, resume the original M8/M9 sequence with the frontend as the
anchor:

1. **Server boundary:** form submissions and data loading can target a Kadam
   v0.2 module compiled to TypeScript or Python, with types shared end to end.
2. **More backends:** Python and TypeScript server adapters, then Rust/Java
   (M9).

## 7. Decisions needed

| ID | Decision | Needed before |
| --- | --- | --- |
| D-32 | Regular property sentence + property table (approved) | F1 |
| D-35 | Browser support matrix (approved) | F2 |
| — | Design tokens and theme file (open question 5) | F3 |
| D-36 | Client runtime for `kadam 0.3` (replaces D-18 for 0.3), state, events and security model | F4 step 2 |
| — | Data and network model (open question 3) | F5 |
| — | Escape-hatch policy (open question 12) | F6 |
| — | Web Components as primary interop target | F6 |
| — | Accessibility errors vs warnings, WCAG 2.2 AA (open question 14) | F3 |

## 8. Where the work lands in the code

| Area | Files |
| --- | --- |
| New kinds, templates, property table | `src/core/parser/kind.ts`, `registry.ts`, `matchers-*.ts`, `values.ts`, `src/core/lexer/lexicon.ts` |
| AST and validation | `src/core/ast/nodes.ts`, `src/core/parser/validate.ts`, `src/core/semantics/analyze.ts` |
| IR, defaults and emitters | `src/compiler/ir.ts`, `lower.ts`, `defaults.ts`, `emit-html.ts`, `emit-css.ts` |
| Runtime emitter (new) | `src/compiler/emit-js.ts`, `src/runtime/` (currently reserved) |
| State/expression reuse | `src/v02/` type checker and IR, exposed to the UI pipeline |
| Web Components / React targets (new) | `src/compiler/targets/` |
| Tests | `test/fixtures/frontend-probes/`, new `test/browser/` (Playwright, dev dependency only) |

The zero-runtime-dependency rule (D-15) still holds for the compiler package.
Playwright and axe-core are dev/CI dependencies only.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| The English grammar becomes too large to learn | Property table + LSP completion + `kadam keywords`; shorthands stay optional |
| The runtime grows into a framework | Size budget enforced in CI; no virtual DOM; features only through decision records |
| State breaks determinism | Runtime is generated code; output stays byte-identical; no runtime codegen |
| Interop promises everything | Web Components first; each extra target needs conformance tests before it is claimed |
| Escape hatches erode the language | Explicit syntax, `--strict` ban, usage reported in `kadam check` |
| v0.1 users broken | All additions are `kadam 0.3`; 0.1 golden outputs stay frozen |

## 10. Suggested order of work

```text
F0 ──► F1 ──► F2 ──► F3 ──► F4 ──► F5 ──► F6 ──► backend
              └──────── F7 tooling runs alongside ────────┘
```

F1–F3 are mostly table-driven additions and can move quickly once D-32 lands.
F4 is the hard one, and its decision record should be drafted during F2 so it
is approved by the time F3 ships.

## 11. Probe checklist (2026-11-24 baseline)

`✓` compiles today, `·` missing. The phase column says where it lands.

| Probe | Today | Phase |
| --- | --- | --- |
| 8-digit hex, `#555`, CSS named colors, `rem` text | ✓ | — |
| Escaped HTML in text | ✓ | — |
| Kinds: section, header, footer, list, table, video, icon, checkbox, dropdown, text area, form, badge | · | F1 |
| Kind: modal / dialog | · | F4 step 1 |
| Line breaks and inline bold/links in text | · | F1 |
| Field types: phone, date; min length; error message | · | F1 / F4 step 1 |
| `it is disabled` | · | F1 |
| Page description, language, icon | · | F1 |
| Grid, wrap, space-evenly | · | F2 |
| `%`, `vh`, `em`, `clamp()`, min/max width | · | F2 |
| Sticky / positioned / scroll overflow | · | F2 |
| Custom breakpoints | · | F2 |
| `rgb()`, opacity, dashed and per-side borders | · | F3 |
| Multi-stop gradient, background image | · | F3 |
| Underline, uppercase, line height, letter spacing, custom font | · | F3 |
| Dark mode, accent/brand tokens | · | F3 |
| `when focused`, `when pressed` | · | F3 |
| Rotate on hover, looping animation, scroll-triggered entrance | · | F3 |
| Clickable card, in-page anchor, `mailto:` | · | F4 step 1 |
| Show / hide / toggle another element | · | F4 step 2 |
| Raw CSS / script escape hatch | · | F6 (explicit, opt-in) |
