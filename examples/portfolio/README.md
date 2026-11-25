# Example project

This is the full acceptance project for the Kadam compiler. It is compiled with
zero diagnostics by the test suite and is the canonical fixture for the M5
motion surface: hover effects, entrance animations, reduced-motion handling, and
the complete responsive layout. Earlier milestones use `examples/hello.kdm` and
reduced fixtures.

Structure:

- `kadam.json` — explicit page and route manifest.
- `pages/home.kdm` — landing page.
- `pages/about.kdm` — second page with an image and a text field.
- `assets/kadam-mark.svg` — local asset referenced by the About page.

The project intentionally exercises page settings, containers, cards, headings,
paragraphs, buttons, links, navigation, a text field, an image, a divider,
gradients, borders, shadows, hover effects, entrance motion, and all three
responsive tiers. `kadam build examples/portfolio` succeeds with zero
diagnostics and deterministic output.
