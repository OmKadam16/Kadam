# Component example

This is the M6.1 acceptance project. It compiles with zero diagnostics and
exercises the component surface end to end:

- `components/Button.kdm` — a default body plus an `outline` variant, with a
  required `text` parameter and a `page` parameter.
- `components/ExternalLink.kdm` — a `text` label and an absolute `url`
  parameter used as an external link target.
- `components/PriceCard.kdm` — a required `text` title and price, defaulted
  `badge`, `image`, `length`, and `color` parameters, a `featured` variant, a
  decorative image whose source comes from the `image` binding, a price size
  that uses the `length` binding, and a badge accent that uses the `color`
  binding.
- `components/NavLink.kdm` — a `text` label and a `page` target.
- `components/Navigation.kdm` — a `navigation bar` that nests three `NavLink`
  instances.
- `components/FormField.kdm` — a text field with a defaulted placeholder.
- `components/Panel.kdm` — a titled frame with one content slot and fallback
  content for instances that supply no children.
- `libs/ui/Tag.kdm` — a library component in the `ui` namespace, referenced as
  `a Tag from ui`.

The pages reuse the same components across three routes:

- `pages/home.kdm` — three `PriceCard` instances (one featured), two `FormField`
  instances with distinct label/input IDs, and a `Button`.
- `pages/about.kdm` — a `Panel` filled with a page-owned paragraph, an
  `ExternalLink` with a `url` binding, plus the `outline` variant of `Button`.
- `pages/services.kdm` — cross-page reuse of `PriceCard` and `FormField`, a
  `Panel` that renders its fallback because no children are supplied, and a
  namespaced `Tag` from the `ui` library.

`assets/kadam-mark.svg` is copied once even though several instances reference
it.

## Build and preview

```bash
# Validate the project without writing output
node dist/cli/main.js check --project examples/components

# Build static output into examples/components/dist
node dist/cli/main.js build --project examples/components

# Edit with live reload at http://127.0.0.1:3000/
node dist/cli/main.js dev --project examples/components
```

The build is deterministic: two consecutive builds produce byte-identical
files. Generated HTML contains no `<script>` element and no component markup —
instances are expanded into ordinary elements before lowering.
