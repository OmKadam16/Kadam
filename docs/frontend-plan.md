# Kadam Frontend Plan — from static pages to a full UI language

**Status:** Approved (2026-11-24). F0–F3 are implemented (D-38 and D-39 approved 2026-11-25); F4 is next. F8 (rich visuals and immersive UI) is recorded for later.
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

### F1 — Element catalogue and document structure (medium) — implemented 2026-11-24

All F1 syntax is `kadam 0.3`; `kadam 0.1` output stays byte-identical. The
normative description is spec §6.15.

| Item | Result |
| --- | --- |
| Shorthands on the property table | Done with F0. |
| Landmarks | `a header`, `a footer`, `a section` (labelled by its first heading, which it requires), `an article`, `a sidebar`. A page-level header and footer are emitted outside `<main>`. |
| Headings | `a small heading` (`h4`). A 0.3 page has at most one main heading (error); skipped levels are the compiler's first **warning**, which never blocks output. |
| Text | `\n` is a line break. Inline spans are separate sentences (`the words "docs" go to page "Docs"`, `are bold`, `are italic`, `open "..." in a new tab`), checked to appear exactly once and never overlap. The plan's single-line `where ...` form was dropped: one sentence per span reads better and keeps lines short. |
| Lists, tables | `a list`, `a numbered list`, `a list item`; `a table` with a required caption, `a header row` (`th scope="col"`), `a row`, `a cell`. Parent/child rules are enforced. |
| Media | `a video` (captions required unless `it has no speech`; optional poster), `an audio clip`, `an icon`, `a code block`. **Changed from the plan:** icons are emitted as `<img>`, not inlined SVG. Inlining would mean reading and sanitising SVG markup, which is not worth the risk yet. |
| Form controls | `a form` with `it sends to "https://..."` (pulled forward from F4 step 1 because a form with no destination is meaningless), `a text area`, `a checkbox`, `a dropdown`, `a radio group`, five more field types, character limits, `it is disabled`, `it submits the form`. Controls on 0.3 pages are named after their element. |
| Page metadata | Description, language, icon, share image; manifest `siteUrl` adds canonical and Open Graph URLs and `sitemap.xml`. |
| Reference projects | `examples/reference/marketing` and `examples/reference/docs`. |
| Accessibility | `test/accessibility.test.mjs` runs axe-core (WCAG 2.x A/AA plus best practices) over both reference projects with **zero violations**. Colour contrast cannot be measured in jsdom; it moves to the F2 browser tests. |
| Probes | 26/66 compile (20/20 F1). `a badge` was never in F1's scope and moved to F3. |

**Exit:** met.

### F2 — Layout and sizing (medium) — implemented 2026-11-25

All F2 syntax is `kadam 0.3`; `kadam 0.1` output stays byte-identical (all 37
example output files compared against the F1 compiler). The normative
description is spec §6.16.

| Item | Result |
| --- | --- |
| Units | `em`, `vw`, `vh`, `dvh` everywhere a length is accepted, written directly after the number; `%` for sizes and limits. A 0.1 file gets one `KDM2013` per new unit. |
| Fluid text | `the text is between 1rem and 2.5rem` becomes `clamp()` from a 360px to a 1280px viewport. Same property as `the text is 18px`. |
| Constraints | `it is at most 1200px wide`, `at least`, both axes. **Changed from the plan:** the shape is `it keeps a 16 by 9 shape` (and `a square shape`), because `:` is not a Kadam token. |
| Flex | `it wraps its children`, `it spreads its children apart`, `it spaces its children evenly`; per-child `it grows to fill the space`, `it does not shrink`, `it sits at the end` (logical margins, so it is ready for right-to-left in F8). |
| Grid | `in 3 columns`, `in columns at least 240px wide` (**auto-fit**, not auto-fill, so a short row stretches instead of leaving empty columns), `it spans 2 columns` / `all columns`. Responsive column counts work; a scope may switch a grid back to a row or column. A grid in a column stretches to the full width. |
| Positioning | `it sticks to the top`, `it is pinned 24px from the bottom right`, `it is placed over its parent` / `at the top right of its parent` (the parent is positioned automatically), and `the layer is 10` (a property-table row for every kind). Two elements pinned to the same spot is warning `KDM3038`. |
| Overflow | `it scrolls vertically|horizontally` (the container becomes keyboard-focusable), `it hides overflow`. |
| Images | `it fills its box` / `it fits inside its box`, `it keeps the top right in view`, `it loads lazily` / `right away`. On 0.3 pages every image after the first loads lazily by default. **Deferred to F8:** generated `srcset` widths need build-time image processing, which conflicts with zero dependencies (D-15) and needs its own decision. |
| Breakpoints | `"breakpoints": { "wide": 1440 }` in `kadam.json` and `on wide screens,` (min-width). Container conditions: `when its parent is narrower than 400px,` / `wider than`; the parent becomes a query container and fills its slot, because size containment would otherwise collapse it. |
| Reference projects | New `examples/reference/dashboard` (sticky header, auto-fit stat cards, a 3/2/1-column panel grid with spans, a custom wide breakpoint, a container condition, a scroll region, and a pinned help button). |
| Browser tests | `npm run test:browser` (Playwright, dev only, uses the installed Chrome). All three reference projects render at 360/768/1280/1600px against approved screenshot baselines (per platform), with a no-sideways-scroll check, and pass axe **including colour contrast** in a real browser. This found one F1 bug, now fixed: a code block scrolled sideways but could not be focused by keyboard. |
| Probes | 39/66 compile (13/13 F2). |

**Exit:** met for the reference layouts on macOS. There is no CI workflow in
the repository yet, so the baselines are approved locally; Linux baselines
will be generated when CI is added.

### F3 — Styling, theming and states (medium) — implemented 2026-11-25

All F3 syntax is `kadam 0.3`; `kadam 0.1` output stays byte-identical (all 43
example output files compared against the F2 compiler). The normative
description is spec §6.17. Two decisions were drafted for it: **D-38** (theme
colors and dark mode) and **D-39** (contrast check severity). Both were
approved on 2026-11-25 and are implemented as written.

| Item | Result |
| --- | --- |
| Color | `rgb()`, `rgba()`, `hsl()`, `hsla()` (converted to hex at compile time), `the opacity is 50%`. |
| Borders and corners | Dashed and dotted, per side (`on the bottom`), per corner (`on the top right`), outline. |
| Backgrounds | 2 to 8 color and radial gradients, angles (`the gradient goes at 135deg`), background images with cover/contain/repeat and focus. **Changed:** the plan's page-level gradient is covered by theme colors instead (`the page background is paper` plus a gradient on the first section), because a body gradient would not follow dark mode. |
| Typography | Underline, strike-through, case, `at most 65 characters wide`, `it shows at most 2 lines`, and custom fonts from local files in `kadam.json` (`@font-face`, `font-display: swap`; no remote fonts). |
| Shadows and effects | Colored, inner, and custom shadows; blur and backdrop blur; rotate, move, scale (`10deg` is a new angle unit). |
| Design tokens (D-38) | **Color tokens only**: `the brand color is #4F46E5` in a page or a `theme.kdm` file, used anywhere a color is, emitted as CSS custom properties. **Deferred to F7:** spacing, radius, font, and shadow tokens, which need a typed scale and editor completion to be pleasant. |
| Dark mode (D-38) | `in dark mode, ...` for element statements, page colors, and theme colors; `the page is dark when the system is dark` for a built-in dark palette of Kadam's defaults. It follows `prefers-color-scheme`; the toggle arrives with F4. |
| Interaction states | `when focused`, `pressed`, `disabled`, `checked`, `invalid`, and `when hovered, it rotates by`, with the hover effect grammar and merged transitions. The built-in focus ring always stays, so an author focus style can only add to it; that makes the plan's separate visibility check unnecessary. |
| Motion | Scroll entrances (CSS scroll-driven, progressive: browsers without it show the element at once), loops (`spins`, `pulses`, `bounces`, `floats`), and staggered children. All of it is off under reduced motion. |
| Contrast check (D-39) | Static WCAG AA check through ancestors, the page, theme colors, and dark mode. Warning `KDM3039`. It immediately found a real dark-mode problem in the marketing site (white text on the lighter dark-mode brand color, 2.98:1). |
| Badge | `a badge`, moved here from F1. |
| Reference projects | The marketing site has a theme file, dark mode, a gradient hero with a badge and fluid heading, staggered entrance, brand button with shadow and states, and themed lines. Browser tests add dark-mode screenshots and a dark-mode axe run. |
| Probes | 56/66 compile; F1–F3 are 52/52 (exit asked for 80%). |

**Exit:** met.

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

### F8 — Rich visuals and immersive UI (later; after F3 and F4)

The long-term goal is that Kadam can build both calm static pages and
immersive ones: a hero video behind the headline, images with effects, 3D
objects you can turn, and scroll-driven scenes. All of it stays plain English
and compiles to standard HTML, CSS and (where needed) the F4 runtime.

- **Image effects:** any image can take effects in the same sentence style:
  ```kdm
  heroImage {
      an image
      it shows "assets/hero.jpg"
      it is blurred by 4px
      it is grayscale, and in color on hover
      it has a dark overlay at 40%
      it is shaped like a circle
      it zooms in slowly on hover
  }
  ```
  Filters (blur, grayscale, sepia, brightness, contrast, saturation), color
  and gradient overlays, masks and shapes (circle, rounded, blob, custom SVG
  mask), blend modes, duotone, and slow pan/zoom (Ken Burns). Pure CSS where
  possible, so no runtime is needed.
- **Background and hero video:** `it plays "assets/loop.mp4" in the
  background`, muted, looping, `playsinline`, with a required poster and an
  automatic pause control (WCAG 2.2.2). Reduced-motion users see the poster.
- **Scroll and motion:** parallax layers, scroll-linked reveal and progress
  (CSS scroll-driven animations first, runtime fallback), sticky scroll
  scenes, and page transitions. Every motion has a reduced-motion fallback.
- **3D:** CSS 3D first (tilt on hover, perspective, flip cards), then real 3D
  models: `a 3d model that shows "assets/shoe.glb"` with orbit, auto-rotate,
  lighting presets and a poster image. The model viewer is a generated,
  self-hosted module loaded only on pages that use it.
- **Generative backgrounds:** gradient meshes, noise, particles and simple
  shader backgrounds from a fixed preset list, plus Lottie animations.
- **Galleries:** grid and masonry galleries, carousels with keyboard and swipe
  support, and a lightbox.
- **Built-in named icons:** `it shows the icon "arrow right"` from a bundled,
  tree-shaken icon set, so simple icons do not need an SVG file each.
- **Image optimisation:** responsive `srcset`, AVIF/WebP and blur-up
  placeholders generated at build time (needs an image-processing decision,
  see D-15).
- **Standard component library:** ready-made cards, navigation bars, modals,
  tabs, accordions, pricing tables and footers written in Kadam itself and
  importable like any other component.
- **Privacy-safe embeds:** maps and video-site embeds that load only after a
  click (facade pattern), so no third-party request happens on page load.
- **Right-to-left languages and translations:** logical properties
  everywhere (already used from F2 on), `the page direction is right to left`,
  and per-language text files.

**Constraints:** no third-party runtime code without a decision record; every
effect has a reduced-motion fallback; media requires a poster and alt text;
each page has a performance budget (JavaScript and media size) checked by
`kadam check`; 3D and shader features degrade to the poster image when WebGL
is unavailable.

**Exit:** an immersive reference page (video hero, image effects, a 3D
product viewer and a scroll scene) passes axe, works keyboard-only, meets its
performance budget, and shows the poster fallbacks with reduced motion on.

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
| D-38 | Theme colors and dark mode (open question 5; approved, implemented) | F3 |
| D-36 | Client runtime for `kadam 0.3` (replaces D-18 for 0.3), state, events and security model | F4 step 2 |
| — | Data and network model (open question 3) | F5 |
| — | Escape-hatch policy (open question 12) | F6 |
| — | Web Components as primary interop target | F6 |
| D-39 | Contrast check is a warning in 0.3 (open question 14; approved, implemented) | F3 |
| — | 3D model viewer and shader backgrounds: self-hosted module, size budget | F8 |
| — | Build-time image processing (srcset, AVIF) vs zero dependencies (D-15) | F8 |

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
                            F3 + F4 ──► F8 rich visuals and immersive UI
```

F8 can start as soon as F3 (effects) and F4 (runtime) exit; its CSS-only
parts (image filters, overlays, shapes, CSS 3D tilt) could even start after
F3. Decisions made in F2 and F3 keep it possible: logical CSS properties,
layering (`the layer is`), and media posters are designed with F8 in mind.

F1–F3 are mostly table-driven additions and can move quickly once D-32 lands.
F4 is the hard one, and its decision record should be drafted during F2 so it
is approved by the time F3 ships.

## 11. Probe checklist (updated 2026-11-25)

`✓` compiles today (56/66 probes), `·` missing. The phase column says where it lands.

| Probe | Today | Phase |
| --- | --- | --- |
| 8-digit hex, `#555`, CSS named colors, `rem` text | ✓ | — |
| Escaped HTML in text | ✓ | — |
| Kinds: section, header, footer, list, table, video, icon, checkbox, dropdown, text area, form, badge | ✓ | F1 |
| Kind: modal / dialog | · | F4 step 1 |
| Line breaks and inline bold/links in text | ✓ | F1 |
| Field types: phone, date; min length; error message | ✓ except the error message (F4 step 1) | F1 / F4 step 1 |
| `it is disabled` | ✓ | F1 |
| Page description, language, icon | ✓ | F1 |
| Grid, wrap, space-evenly | ✓ | F2 |
| `%`, `vh`, `em`, `clamp()`, min/max width | ✓ | F2 |
| Sticky / positioned / scroll overflow | ✓ | F2 |
| Custom breakpoints | ✓ | F2 |
| `rgb()`, opacity, dashed and per-side borders | ✓ | F3 |
| Multi-stop gradient, background image | ✓ | F3 |
| Underline, uppercase, line height, letter spacing, custom font | ✓ | F3 |
| Dark mode, accent/brand tokens | ✓ | F3 |
| `when focused`, `when pressed` | ✓ | F3 |
| Rotate on hover, looping animation, scroll-triggered entrance | ✓ | F3 |
| Clickable card, in-page anchor, `mailto:` | · | F4 step 1 |
| Show / hide / toggle another element | · | F4 step 2 |
| Raw CSS / script escape hatch | · | F6 (explicit, opt-in) |
