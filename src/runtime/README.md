# Runtime module

Small, dependency-free browser runtime used only when declarative interactions
cannot be expressed with static HTML/CSS. The generated production JavaScript
is emitted separately from `.kdm` source and from generated CSS.

v0.1 aims to need no runtime at all: navigation compiles to anchors, hover is
CSS, entrance motion is CSS, and fields are native inputs. The runtime becomes
necessary for later stateful actions such as show/hide/toggle.

Constraints:

- No framework and no third-party runtime dependencies.
- No user-authored JavaScript.
- Respect `prefers-reduced-motion` and keyboard navigation.
- Must be testable without a browser where possible.
