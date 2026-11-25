# M5 Specification Compliance

This matrix is the final audit of the v0.1 surface for milestone M5. It records
what the specification requires, where it is implemented, what proves it, and
whether any behavior was missing before this audit. The audit was performed
against `docs/language-spec.md` at language version 0.1.

Status values:

- **Implemented** — the behavior exists and is covered by an automated test.
- **Verified** — the behavior exists, is covered by an automated test, and was
  also exercised in a browser during M5 acceptance.
- **Deferred by v0.1** — the specification explicitly excludes it.

## Matrix

| Requirement | Status | Implementation | Test coverage | Audit notes |
| --- | --- | --- | --- | --- |
| Language version directive and version mismatch | Implemented | `src/core/parser/parser.ts`, `src/compiler/project.ts`, `src/compiler/manifest.ts` | `test/parser.test.mjs`, `test/project.test.mjs`, `test/cli.test.mjs` | `kadam 0.1` is required when present; unsupported versions are `KDM4004`. |
| One page per file and top-level placement | Implemented | `src/core/parser/parser.ts` | `test/parser.test.mjs` | Multiple or misplaced pages are `KDM2008`; content outside a page is `KDM2006`. |
| Page settings | Implemented | `src/core/parser/registry.ts`, `src/compiler/lower.ts`, `src/compiler/emit-css.ts` | `test/parser.test.mjs`, `test/compiler.test.mjs` | Background, text, and font settings are single-valued and emitted on `body` and `.kdm-page`. |
| Built-in kinds and defaults | Implemented | `src/core/parser/kind.ts`, `src/compiler/defaults.ts`, `src/compiler/emit-css.ts`, `src/compiler/emit-html.ts` | `test/parser.test.mjs`, `test/compiler.test.mjs` | All twelve built-in kinds (thirteen declarations including the decorative image variant) compile to semantic HTML. |
| Kind-first element structure | Implemented | `src/core/parser/parser.ts`, `src/core/parser/validate.ts` | `test/parser.test.mjs` | Missing, duplicate, and late kind sentences are reported precisely. |
| Leaf and container nesting | Implemented | `src/core/parser/validate.ts` | `test/parser.test.mjs` | Leaf children are `KDM3010`; every level is validated recursively. |
| Nesting depth limit | Implemented | `src/core/parser/parser.ts` | `test/parser.test.mjs` | The 65th nested element reports `KDM2011`; the documented limit is 64. |
| Size, background, gradient direction | Implemented | `src/core/parser/matchers-appearance.ts`, `src/compiler/lower.ts`, `src/compiler/emit-css.ts` | `test/compiler.test.mjs`, `test/project.test.mjs` | Gradients are two-stop linear gradients with the documented default direction. |
| Border, corners, shadow | Implemented | `src/core/parser/matchers-appearance.ts`, `src/compiler/lower.ts`, `src/compiler/emit-css.ts` | `test/compiler.test.mjs`, `test/motion.test.mjs` | Shadow tokens are fixed; a divider incorrectly accepted shadow before this audit and now reports `KDM3003`. |
| Typography and font families | Implemented | `src/core/parser/matchers-appearance.ts`, `src/compiler/emit-css.ts` | `test/parser.test.mjs`, `test/compiler.test.mjs` | Text fields apply input typography to the native input and wrapper font family to the label. |
| Spacing and layout | Implemented | `src/core/parser/matchers-appearance.ts`, `src/compiler/lower.ts`, `src/compiler/emit-css.ts` | `test/parser.test.mjs`, `test/compiler.test.mjs` | Container-only layout is enforced with `KDM3003`. |
| Visibility | Implemented | `src/core/parser/matchers-appearance.ts`, `src/compiler/emit-css.ts` | `test/parser.test.mjs`, `test/compiler.test.mjs` | Base and responsive visibility emit `display: none`. |
| Images, descriptions, decorative alt | Implemented | `src/core/semantics/analyze.ts`, `src/compiler/lower.ts`, `src/compiler/emit-html.ts`, `src/compiler/project.ts` | `test/compiler.test.mjs`, `test/project.test.mjs` | Missing source/alt is `KDM3009`; description plus decorative is `KDM3005`; only decorative images emit `alt=""`. |
| Text fields | Implemented | `src/core/semantics/analyze.ts`, `src/compiler/lower.ts`, `src/compiler/emit-html.ts` | `test/compiler.test.mjs`, `test/motion.test.mjs` | Native input, associated visible label, type, placeholder, and requiredness are emitted. |
| Divider capabilities | Implemented | `src/core/parser/validate.ts`, `src/compiler/emit-css.ts` | `test/parser.test.mjs`, `test/compiler.test.mjs` | Solid/absent background and margin are allowed; gradients, border, corners, padding, text, layout, hover, and shadow are rejected. |
| Responsive breakpoints and scopes | Implemented | `src/core/parser/parser.ts`, `src/core/parser/registry.ts`, `src/core/parser/validate.ts`, `src/compiler/lower.ts`, `src/compiler/emit-css.ts` | `test/parser.test.mjs`, `test/compiler.test.mjs`, `test/project.test.mjs` | Fixed phone/tablet/desktop queries; content and interaction statements are `KDM3013`. |
| Hover effects and transitions | Verified | `src/core/parser/matchers-interaction.ts`, `src/compiler/lower.ts`, `src/compiler/emit-css.ts` | `test/motion.test.mjs`, `test/parser.test.mjs` | Background, text, border, lift, and scale work on every kind except divider; rules are behind the hover-capability query and do not change layout. |
| Hover accessibility constraints | Implemented | `src/core/parser/validate.ts` | `test/parser.test.mjs` | Text hover is text-bearing only; hover border requires an effective base border, including the text-field default unless explicitly removed; hover background is `KDM3015` when any scope uses a gradient. |
| Entrance animations | Verified | `src/core/parser/matchers-interaction.ts`, `src/compiler/lower.ts`, `src/compiler/emit-css.ts` | `test/motion.test.mjs`, `test/compiler.test.mjs` | Fade and four slide directions use transform/opacity only and run once. |
| Reduced motion | Implemented | `src/compiler/emit-css.ts` | `test/motion.test.mjs` | Entrance animations become `animation: none`; hover transitions become `transition: none`, including the native field input. |
| External navigation | Verified | `src/core/parser/matchers-interaction.ts`, `src/compiler/emit-html.ts` | `test/compiler.test.mjs` (including all-kinds) | Absolute HTTP(S) only; generated anchors use `target="_blank"` and `rel="noopener noreferrer"`. |
| Internal navigation | Verified | `src/core/semantics/analyze.ts`, `src/compiler/lower.ts`, `src/compiler/emit-html.ts` | `test/compiler.test.mjs`, `test/project.test.mjs`, `test/dev-server.test.mjs` | Titles resolve to routes; links are ordinary anchors and work without JavaScript. |
| Focus-visible policy | Verified | `src/compiler/emit-css.ts`, `src/compiler/emit-html.ts` | `test/compiler.test.mjs` | Buttons, links, and native fields receive a 2px accent outline with 2px offset. |
| Keyboard and no-JavaScript operation | Verified | `src/compiler/emit-html.ts`, `src/compiler/emit-css.ts` | `test/compiler.test.mjs`, `test/dev-server.test.mjs` | Buttons are native, links are anchors, fields are native inputs, and the generated page contains no script. |
| Page title identity and duplicate titles | Implemented | `src/core/semantics/analyze.ts`, `src/compiler/project.ts` | `test/project.test.mjs` | Titles are case-sensitive and unique; unknown targets are `KDM3007`; duplicates are `KDM3011`. |
| Manifest, routes, assets, base path | Implemented | `src/compiler/manifest.ts`, `src/compiler/project.ts`, `src/compiler/routes.ts` | `test/project.test.mjs`, `test/dev-server.test.mjs` | Unknown keys and traversal fail; referenced assets are copied once; output is path-sorted. |
| Deterministic output | Implemented | `src/compiler/project.ts` | `test/build.test.mjs`, `test/compiler.test.mjs`, `test/project.test.mjs`, `test/motion.test.mjs` | Repeated single-file, portfolio, and canonical builds are byte-identical. |
| Diagnostic format, sorting, and cap | Implemented | `src/core/diagnostics/diagnostic.ts`, `src/core/diagnostics/format.ts` | `test/parser.test.mjs`, `test/build.test.mjs`, `test/dev-session.test.mjs` | Diagnostics are stable and sorted; reporting stops at 99 real diagnostics plus a `KDM9003` summary as the 100th. |
| Source size and line limits | Implemented | `src/core/source/source-file.ts` | `test/lexer.test.mjs` | Files over 1 MiB or lines over 4096 code points report `KDM1005`. |
| Canonical example fixture | Implemented | `examples/canonical/` | `test/compiler.test.mjs`, `test/parser.test.mjs` | The exact §16.1 page plus its required `About` page now builds with zero diagnostics and deterministic output. |
| Portfolio fixture | Implemented | `examples/portfolio/` | `test/motion.test.mjs`, `test/project.test.mjs`, `test/cli.test.mjs` | Builds with hover, entrance motion, reduced motion, and deterministic assets. |
| Development server and `kadam check` | Verified | `src/server/`, `src/cli/` | `test/dev-*.test.mjs`, `test/cli.test.mjs` | M4 behavior is unchanged; checked again after M5 changes. |
| Client-side runtime | Deferred by v0.1 | `src/runtime/README.md`, `docs/decisions.md` D-18 | Static-output tests above, production `<script>` check | Generated site output emits no JavaScript. The dev server injects its own reload client only in development. Show/hide/toggle and state require a future approved language decision. |

## Confirmed gaps found and fixed

1. **Divider shadow.** `shadow` was grouped with always-allowed statements, so
   a divider accepted `has a soft shadow` in base and responsive scopes. The
   validator now rejects it with `KDM3003`, matching §6.13 and Appendix A.5.
2. **Responsive gradient hover.** A hover background was validated only against
   the base background. A responsive gradient could therefore activate under a
   global hover color, violating §7.1 and §9.4. Validation now rejects the
   combination when any scope uses a gradient.
3. **Nesting depth.** The documented 64-level limit had no parser enforcement.
   Depth 65 now reports `KDM2011`.
4. **Diagnostic cap.** The documented 100-diagnostic limit was not enforced.
   Reporting now stops at 99 real diagnostics plus a deterministic `KDM9003`
   summary.
5. **Text-field border default.** Hover-border validation counted the kind
   default even after `has no border` or a zero-width border was authored. The
   explicit declaration now removes the default and reports `KDM3014`.
6. **Acceptance coverage.** External-link attributes, focus-visible selectors,
   hover across every supported kind, and the canonical fixture had no direct
   assertions. All now have focused tests.

## Approval

M5 was approved by the project owner on 2026-11-08 after this audit. Approval
covers the v0.1 surface and does not start M6.

## Remaining product limitations (explicitly out of v0.1)

- No stateful interactions, show/hide/toggle, form submission, expressions, or
  client-side runtime. See D-18.
- Hover is a progressive enhancement; non-interactive elements are not made
  focusable solely to trigger a hover style.
- Contrast checking is not automated; it depends on rendered colors.
- Image loading strategy, cropping, and responsive art direction are deferred.
- Components, multi-target emission, and incremental compilation belong to
  later milestones.
