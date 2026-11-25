# M6 — Reusable Components Architecture

**Status:** Approved with amendments on 2026-11-08. Implemented in M6.1.

**Scope:** M6 introduces compile-time reusable components to Kadam. Components are
native Kadam declarations, expanded before the existing normalized IR is built.
The generated site remains static HTML and CSS with no client-side runtime.

**Review outcome:** The architecture was approved with the amendments recorded
in `docs/decisions.md` as D-10 and D-19–D-22. M6.1 implements the design below;
the staged plan and its phases live in
[the M6.1 implementation plan](m6.1-implementation-plan.md).

---

## Implementation status (M6.1)

Shipped:

- one component per `.kdm` file, listed under `components` in `kadam.json`;
- `takes` parameters typed `text`, `page`, `url`, `image`, `length`, and `color`, with literal defaults;
- instances with `with` bindings and static `in the <variant> variant` selection;
- nested components with one-pass interpolation, cycle detection, and
  depth/element limits;
- optional library namespaces and the `a Button from ui` qualifier;
- one unnamed content slot and any number of named slots per body or variant,
  each with optional component-authored fallback content, filled by
  caller-owned child elements;
- expansion before validation, analysis, and lowering, all-or-nothing;
- stable instance paths for `data-kdm-id`, component-scoped classes, unique form
  IDs, and `componentOrigin` on IR elements and source-map entries;
- page CSS deduplicated by component class;
- component sources in `kadam dev` watch paths;
- `examples/components/` as the acceptance fixture.

Not implemented yet:

- a packaged component library beyond the example project;
- component-aware incremental re-emission (`kadam dev` rebuilds the project);
- a visual component browser or other GUI tooling.

Single-file builds (`kadam build page.kdm`) have no catalog, so a component
instance there is still an unknown component (`KDM3022`).

---

## 1. Summary

A project may declare reusable components once and instantiate them on any page.
A component owns a small element tree and a typed parameter list. An instance
supplies named property values and optionally selects a variant.

The central architectural decision is:

> Components are **expanded into ordinary page elements before validation,
> semantic analysis, lowering, and emission**.

No component node reaches `PageIR`. The HTML and CSS emitters continue to see the
same `ElementNode` shape they see today. This preserves existing v0.1 output,
diagnostics, accessibility checks, and determinism without adding a runtime or a
second emitter.

The expansion is purely compile-time. Given the same project bytes and compiler
version, an expanded component produces byte-identical HTML and CSS to the
equivalent hand-written elements, apart from stable identity attributes and
component-scoped class names.

---

## 2. Existing pipeline and insertion boundary

The current project pipeline is:

```text
kadam.json
  -> read and parse pages
  -> validateDocument (structure and typed statements)
  -> analyzeDocument (project-wide semantics and accessibility)
  -> lowerDocument (PageIR)
  -> emitHtml / emitPageCss
```

Relevant current structures:

- `DocumentNode` contains exactly one `PageNode` in `src/core/ast/nodes.ts`.
- `ElementNode` stores a `KindNode`, statements, children, and source spans.
- `ComponentKindReference` already exists in the AST but is rejected in 0.1.
- `parseSource()` owns page-only state: one page, one element-name map, one
  element stack.
- `validateDocument()` and `analyzeDocument()` assume built-in kinds only.
- `lowerDocument()` assigns `nodeId` and `className` from the page slug and
  element name, then the emitters consume `PageIR`.
- `compileProject()` reads every page and asset before emitting any output, so a
  failed build writes nothing.

M6 inserts the new stages like this:

```text
kadam.json (pages + components)
  -> parse page files and component files
  -> build component catalog
  -> validate component declarations and the component graph
  -> expand page component instances
  -> validateDocument(expanded page)
  -> analyzeDocument(expanded page)
  -> lowerDocument(expanded page)
  -> emitHtml / emitPageCss
```

The expansion pass is pure and lives outside the parser and emitters. It takes:

- a parsed page,
- the project component catalog,
- the project page-title table.

It returns an ordinary `PageNode` whose elements contain only built-in kinds,
plus component-origin metadata for source maps and stable identity.

The existing `ComponentKindReference` remains in the AST for the parser. The
lowering and emission types do **not** gain a component kind.

---

## 3. Where components live

Three approaches were evaluated.

### A. Declarations inside page files

A page file could contain both a page and component declarations.

Rejected:

- A component used by several pages would have an arbitrary owning page.
- Page-local name scopes would become project-visible symbols.
- Changing a page used only as a component host would invalidate unrelated pages.
- Duplicate component names and visibility rules become harder to explain.
- It weakens the existing one-page-per-file invariant.

### B. One project-level `components.kdm` file

A single file could contain every component.

Rejected:

- One large file gives poor ownership and merge behavior.
- It makes per-component dependency tracking coarser.
- A malformed component at the end of the file can obscure unrelated components.
- It does not match the existing one-unit-per-file model.

### C. Dedicated component files in a project component directory

**Chosen.** Each `.kdm` component file contains exactly one component. Components
are listed explicitly in `kadam.json` and conventionally live under
`components/`.

```json
{
  "kadam": "0.1",
  "name": "components-example",
  "components": [
    "components/Button.kdm",
    "components/Card.kdm",
    "components/NavLink.kdm",
    "components/Navigation.kdm"
  ],
  "pages": [
    { "file": "pages/home.kdm", "route": "/" },
    { "file": "pages/about.kdm", "route": "/about" }
  ],
  "outDir": "dist"
}
```

Rules:

- `components` is optional and defaults to an empty list.
- An entry may be a string path or an object with `source` and an optional
  `namespace`. A namespace is a lower-camel identifier; the pair
  `(namespace, component name)` is unique.
- Every entry is a project-relative `.kdm` path.
- Paths are validated like page sources: inside the project, not inside the
  output directory, not escaping through a symlink, and not duplicated.
- A component file contains exactly one `component` block and no page.
- A page file contains exactly one `page` block and no component.
- The manifest order is not semantic. The catalog is keyed by declared component
  name and sorted by name for lookup and reporting.
- The file basename is conventionally the component name, but the declared name
  is authoritative. A mismatch is allowed rather than creating a second naming
  system.
- There are no packages or per-page component lists. The project has one
  catalog with named library namespaces; a component reference is qualified
  only when it targets a library.
- Component files are source, not routes and not assets. They are never copied
  to the output directory.
- Single-file mode (`kadam build page.kdm`) has no component catalog. It does
  not scan `components/` implicitly; a component instance in single-file mode is
  an unknown-component diagnostic. Components are a project-mode feature.

Why explicit manifest entries instead of automatic directory discovery:

- no hidden filesystem walk or accidental inclusion;
- a deterministic, reviewable dependency list;
- the same explicit model already used for pages;
- component files can be checked before pages are expanded;
- a future package/import system can replace the list without changing the
  language's component declaration syntax.

Trade-off: adding a component requires a manifest edit. That is acceptable for
M6 and avoids directory-order and ignore-file ambiguities.

---

## 4. Language design

The component grammar uses the existing sentence style. No new global keywords
are required. Words such as `as`, `with`, `variant`, and `defaulting` are
**contextual words** recognized only in the component grammar. This prevents an
existing v0.1 element named `variant` or `with` from silently becoming reserved.

`component` and `takes` are already reserved by the lexer.

### 4.1 Component declaration syntax

A component file starts with the optional version directive, then one component:

```kdm
kadam 0.1

component PriceCard takes a title as text, a price as text, a badge as text defaulting to "New" {
    card1 {
        a card

        title1 {
            a section heading
            the heading text says "{$title}"
        }

        price1 {
            a paragraph
            the paragraph text says "{$price}"
        }

        badge1 {
            a paragraph
            the paragraph text says "{$badge}"
        }
    }
}
```

Header grammar:

```text
component <ComponentName> [takes <parameter> ("," <parameter>)*] {
```

Rules:

- `ComponentName` uses the existing Pascal-case component-name form:
  `[A-Z][A-Za-z0-9]{0,63}`.
- Component names are case-sensitive and unique across the whole project.
- A component name may not be a built-in kind name.
- Parameters are comma-separated. `and` is not a second list separator here;
  one canonical separator keeps parsing unambiguous.
- A component with no parameters omits the entire `takes` clause.
- The component body contains element declarations and optional `variant`
  blocks. Page settings, page declarations, and top-level statements are
  invalid.
- Every component file has exactly one component body. A second `component`
  header is `KDM3021`.
- The default body must contain exactly one root element. A named variant must
  also contain exactly one root element.
- Element names must be unique within the body or variant in which they appear.
  The same local name may be reused in the default body and in another variant,
  because only one of them is expanded for a given instance.

Exactly one root is deliberate. It lets an instance expand in place without
inventing a wrapper `<div>`, which would change layout, semantics, and
accessibility. A component that needs several siblings can declare a
`container`, `card`, or `navigation bar` as its root.

### 4.2 Component invocation syntax

An instance is an element whose kind sentence names the component:

```kdm
pricing1 {
    a PriceCard
    with a title of "Starter"
    with a price of "$9"
}
```

Variant selection is part of the kind sentence:

```kdm
cta1 {
    a Button in the outline variant
    with a label of "Learn more"
}
```

Grammar:

```text
a <ComponentName> [from <namespace>] [in the <variantName> variant]
with a <parameterName> of <string>
```

Rules:

- The instance block must contain exactly one component kind sentence.
- After the kind, zero or more `with` property bindings may appear.
- No appearance, responsive, hover, click, motion, image, field, or text
  statements are allowed directly on an instance. The component owns its
  visual definition.
- An instance may supply child elements only when the selected body or
  variant declares a content slot (section 4.13). Otherwise the children are
  `KDM3030`. Plain children fill the unnamed slot; named slots are filled by
  slot groups.
- To position or style a component in context, wrap the instance in an ordinary
  container:
  ```kdm
  priceWrapper {
      a container
      it has 16px gap between children

      pricing1 {
          a PriceCard
          with a title of "Starter"
          with a price of "$9"
      }
  }
  ```
- The instance name is unique within its containing page/component variant, just
  like an element name, and participates in stable identity.
- The instance itself does not emit an element. Its selected variant's single
  root replaces it in the expanded tree.
- Unknown component: `KDM3022`.
- Unknown or duplicate variant: `KDM3029`.
- Unsupported instance content: `KDM3030`.

The `with` form is intentionally distinct from all existing statements. It
cannot be confused with `the text is ...`, field labels, or appearance
statements, and it does not make arbitrary property names part of the general
statement grammar.

### 4.3 Parameter and property system

A declaration parameter has:

- a lower-camel name,
- a type,
- an optional static default.

A property binding supplies one value by name.

**Parameter types:**

| Type | Meaning | Binding value | Allowed interpolation slot |
| --- | --- | --- | --- |
| `text` | Human-readable text | A quoted string | Text content, field label, field placeholder, image description, or another `text` binding |
| `page` | A page title reference | A quoted page title | A navigation target, or another `page` binding |
| `url` | An absolute external URL | A quoted `http`/`https` URL | An external link target, or another `url` binding |
| `image` | A project-relative image asset | A quoted path without `..` or a scheme | An image source, or another `image` binding |
| `length` | A spacing, size, or type value | A quoted `px`/`rem`/`0` length | A length position, or another `length` binding |
| `color` | A named or hex color | A quoted color name or hex literal | Backgrounds, gradients, border color, text color, or hover colors |

Examples:

```kdm
component NavLink takes a label as text, a target as page {
    link1 {
        a link
        the link text says "{$label}"
        when clicked, go to page "{$target}"
    }
}
```

Why these types:

- `text` covers buttons, cards, navigation labels, headings, and form copy.
- `page` makes a navigation target meaningful and lets a misspelled or missing
  page be diagnosed at the binding as well as at the navigation statement.
- Styling differences are expressed with variants or with typed `length` and
  `color` parameters; there are no arbitrary expressions.
- `url` keeps outbound links absolute and validated at both the binding and the
  statement.
- `image` keeps asset paths project-relative and lets the existing asset copy
  and existence checks run on the expanded page.
- `length` keeps spacing, size, and type values typed and lets instances bind
  different values without a runtime; each distinct set of referenced style
  values gets its own component class.
- `color` keeps palette values typed and validated, with the same binding-based
  class separation so instances can use different colors safely.
- A broad string type with no slot checking would not be meaningfully typed.

Parameter declaration rules:

- Parameter names are unique within a component (`KDM3031`).
- A parameter name is a lower-camel identifier and may not be an existing
  reserved word.
- Defaults use `defaulting to "<string>"`.
- A default is a literal string and may not contain `{$...}` placeholders.
- A `page` default must name a declared page once the project page table exists.
- The parameter list is part of the component's public interface. Changing it
  invalidates every instance.

Binding rules:

- A required parameter with no default must be supplied (`KDM3023`).
- A supplied name not declared by the component is an error (`KDM3024`).
- Supplying the same parameter twice is an error (`KDM3025`).
- Supplying a value that does not satisfy the declared type is an error
  (`KDM3026`). For `page`, the effective value must name an existing page; for
  `url`, it must be an absolute http or https URL; for `image`, it must be a
  project-relative image path; for `length`, it must be a `px`/`rem` length or
  `0`; for `color`, it must be a named color or hex literal.
- Bindings are named, so order never changes meaning. Canonical examples use
  declaration order.
- An optional parameter omitted at the call site uses its default.
- A component may declare a parameter it does not use; this is allowed so a
  public interface can be extended without immediately changing every body.

Interpolation:

- `{$name}` is the only interpolation form.
- It is recognized only in component declaration bodies and in `with` binding
  values inside component bodies. Page files treat it as literal text.
- The placeholder must name a parameter in the current component.
- `text` parameters may appear only in the text-bearing string slots listed
  above. `page` parameters may appear only in navigation targets. `url`
  parameters may appear only in external link targets, and `image` parameters
  only in image sources.  `length` parameters occupy a whole length position and
  are written as a quoted placeholder: `it has "{$gap}" gap between children`;
  `color` parameters fill a whole color position the same way:
  `has a "{$accent}" background`. In `the text is "{$value}"`, the parameter's
  declared type selects type size or text color. Any typed parameter may also
  appear in a binding whose target parameter has the same type.
- Interpolation is one pass. A value inserted from a parameter is never scanned
  again for placeholders.
- Interpolation cannot form expressions, call functions, concatenate dynamic
  values outside the quoted string, or produce markup.
- The final string is emitted through the existing `escapeText` /
  `escapeAttribute` functions. Parameter values cannot inject HTML.
- Unknown names, malformed placeholders, and wrong-slot usage are `KDM3027`.

### 4.4 Default values

Defaults are compile-time constants:

```kdm
component Badge takes a label as text defaulting to "New" {
    badge1 {
        a paragraph
        the paragraph text says "{$label}"
    }
}
```

Rules:

- Defaults are evaluated once when the component declaration is checked, not at
  each instance.
- A default is used only when the property is absent.
- A supplied value always wins; an empty supplied string is still supplied and
  is validated as such.
- Defaults are immutable strings. There is no default expression, environment
  lookup, translation lookup, or page-data lookup.
- A `page` default is checked against the project page-title table, not against
  the current page only.
- A `url` default must be an absolute http or https URL.
- An `image` default must be a project-relative image path.
- A `length` default must be a `px` or `rem` length, or `0`.
- A `color` default must be a CSS named color or a `#RGB`/`#RRGGBB` hex literal.
- Defaults never change emitted bytes between builds.

Example:

```kdm
badge1 {
    a Badge
}
```

expands exactly as if the author had written:

```kdm
badge1 {
    a Badge
    with a label of "New"
}
```

### 4.5 Variant system

A component has one default body and zero or more named variants. The default
body is the element content written directly in the component block.

```kdm
component Button takes a label as text {
    button1 {
        a button
        the button text says "{$label}"
    }

    variant outline {
        button1 {
            a button
            the button text says "{$label}"
            has no background
            has a 2px blue border
            the text is blue
        }
    }
}
```

Selecting a variant:

```kdm
secondaryAction {
    a Button in the outline variant
    with a label of "Cancel"
}
```

Rules:

- Omitting the selection uses the default body.
- `variant <name> { ... }` is a top-level block inside a component only.
- Variant names are lower-camel and unique within the component.
- `default` is reserved and may not be declared as a variant name.
- Every variant has the same parameter interface as the component.
- Every variant is validated even if no page selects it.
- A variant is a complete alternative element tree, not a style overlay. This
  avoids selector languages, inheritance, and cascade-order questions.
- Exactly one root element is required in every variant.
- Element and instance names are scoped to the chosen body/variant. Reusing a
  name in another variant is allowed.
- Variant selection is static. There is no `{$variant}` selection, conditional
  variant, or variant fallback chain.
- Unknown variant and duplicate/reserved variant names are `KDM3029`.

Trade-off: style-only variants repeat the element body. This is explicit and
deterministic, and it keeps variants independent from CSS selectors. Shared
structure can still be factored into nested components when it is genuinely
common.

### 4.6 Nested component behavior

A component may instantiate another component in its default body or any
variant:

```kdm
component NavLink takes a label as text, a target as page {
    link1 {
        a link
        the link text says "{$label}"
        when clicked, go to page "{$target}"
    }
}

component Navigation takes a homeTarget as page, an aboutTarget as page {
    nav1 {
        a navigation bar

        homeLink1 {
            a NavLink
            with a label of "Home"
            with a target of "{$homeTarget}"
        }

        aboutLink1 {
            a NavLink
            with a label of "About"
            with a target of "{$aboutTarget}"
        }
    }
}
```

Rules:

- Nested instantiation is resolved recursively at compile time.
- An outer `text` parameter may flow into a nested `text` binding; an outer
  `page` parameter may flow into a nested `page` binding. A type mismatch is
  `KDM3026`.
- Interpolation in a nested binding is one pass. The resulting value is then
  type-checked against the nested parameter.
- A component's root kind must be compatible with its position after expansion.
  For example, a component rooted in a heading may not be placed inside a leaf
  button; the existing leaf/container check reports this on the expanded tree.
- Nested components do not introduce a wrapper element.
- Nested instance names form part of the identity path. Two instances of the
  same component in different parents remain distinguishable.
- All direct and transitive dependencies participate in cycle detection.

### 4.7 Scope and visibility

- One project-wide component catalog. M6 has no imports or file-local
  component namespaces; optional library namespaces were added afterwards (see
  `docs/component-imports.md`).
- Component names are Pascal-case and unique across the project.
- Page titles remain the only navigation identity and are also project-global.
- Parameter names, variant names, element names, and instance names are local
  to their declaration/body.
- A component can see every other component and every page title in the project.
  There is no page-private component.
- A page can instantiate any declared component by name.
- A component cannot declare page settings, a page, or a route. It may navigate
  to a page by title because page titles are project-scoped.
- Component files are not routes and are never emitted as HTML.
- Unknown component names are `KDM3022`, with a nearest-name suggestion.
- Duplicate component names are `KDM3020`, with the first declaration as a
  related location.

### 4.8 Cross-page reuse

The same component may be instantiated on any number of pages. There is no
per-page registration or import.

Each page expansion is independent:

- the component declaration is parsed and validated once;
- each instance gets its own bindings and variant selection;
- each instance gets a unique identity path and unique form IDs;
- component CSS rules are shared by class name within a page stylesheet;
- text, page, url, image, length, and color references are resolved against the
  complete project.

A component file is a dependency of every page that uses it directly or through
another component. The build records the direct-use graph and its transitive
closure. A change to a component invalidates all dependent pages; an unrelated
page is not re-emitted by an incremental layer. The current project build may
still produce a full deterministic output tree; the dependency graph is the
source of truth for selective re-emission where the caller supports it.

Component definitions may be used by components that are themselves used by
pages, but cycles are rejected (section 4.10).

### 4.9 Type checking

The type checker runs in this order:

1. **Declaration syntax.** Component header, parameter list, duplicate names,
   defaults, variants, and body shape.
2. **Local element validation.** Reuse the existing structural/typed checks for
   every built-in element in every default body and variant, including unused
   components.
3. **Property interface checking.** For every instance, verify the target
   component exists, the variant exists, required properties are present,
   unknown properties are absent, and no property is duplicated.
4. **Binding type checking.** Check `text`, `page`, `url`, `image`, `length`, and
   `color` values, including nested pass-through bindings. Resolve page titles
   against the project page table, require absolute http or https URLs, require
   project-relative image paths, require `px`/`rem`/`0` lengths, and require
   named or hex colors.
5. **Interpolation checking.** Check every `{$name}` occurrence against the
   enclosing component's parameter table and the slot's allowed type.
6. **Expansion-time checking.** Run the existing validation and semantic
   analysis on the expanded page, so required text, image descriptions, field
   labels, navigation targets, asset paths, and statement capabilities are
   checked with concrete values.
7. **Emission safety.** No component kind or unresolved placeholder may reach
   `lowerDocument`; that is an internal compiler error.

Static checks cover unused components and unused variants. A project with an
unused broken component does not build. This is deliberate: a component
declaration is source code, not a template fragment that becomes valid only
when called.

Concrete-value failures are reported at the instance binding, with a related
location at the declaration. Declaration-shape failures are reported once at
the declaration even if several instances use it. The compiler deduplicates
declaration-origin diagnostics by source span, code, and message before applying
the global 100-diagnostic cap.

### 4.10 Circular-reference prevention

The component catalog records every component instance edge in every default
body and every variant.

Before expansion:

- run a deterministic depth-first search over the catalog, in component-name
  order;
- mark nodes `unvisited`, `visiting`, and `visited`;
- a back edge is a cycle;
- report `KDM3028` at the referencing instance, with the component chain as
  related locations;
- reject self-reference in the same way.

A cycle is an error even if no page uses the components involved. Expansion
never starts on a cyclic graph.

The expander also enforces two deterministic safety limits:

- component instantiation depth counts toward the existing 64-level nesting
  limit;
- a single page may expand to at most 10,000 elements.

Exceeding either limit is `KDM3032` at the instance that crossed it. These limits
prevent accidental exponential expansion after cycle checking. They are
compiler constants, not configuration, so builds remain reproducible.

### 4.11 Accessibility requirements

Components do not create a new accessibility model. They expand to the same
native HTML that hand-written Kadam elements produce.

Required behavior:

- No wrapper element is invented, so a component cannot accidentally change
  landmarks, list structure, or focus order.
- The existing semantic checks apply to every expanded instance:
  - buttons and links require non-empty text;
  - headings, paragraphs, and links keep their explicit levels/kinds;
  - images require a source and either description or an explicit decorative
    marker;
  - text fields require a visible label;
  - links require a click target;
  - focus-visible styling remains on native interactive elements.
- Unused components and unused variants are checked too, so an inaccessible
  component cannot hide until it is first used.
- A placeholder counts as present during declaration validation, but the
  expanded value is checked. Binding an empty string to a required text slot is
  still `KDM3009` / `KDM3005`, reported at the binding.
- Form IDs and label `for` attributes use the unique instance path, so two
  instances of the same component never produce duplicate IDs.
- Parameter text is escaped like all other Kadam text. There is no raw HTML
  parameter, so a binding cannot inject markup or ARIA attributes.
- Component authors choose heading levels explicitly. The compiler does not
  auto-adjust heading levels by context; that would be non-local and surprising.
- A navigation component is expected to use a `navigation bar` root and native
  `link` elements. The compiler does not infer a `nav` landmark from a
  component name.
- Interactive component roots remain real `button`/`a` elements. A component
  cannot turn a non-interactive container into a clickable element because
  click statements remain restricted to buttons and links.

### 4.12 Deterministic emission

Determinism rules:

- Component files are loaded from the explicit manifest list; no directory
  order, glob expansion, timestamps, or locale are inputs.
- The catalog is keyed and sorted by declared component name.
- Expansion follows page source order and child order.
- Instance paths are built from declared names, never counters, hashes, random
  values, or machine paths.
- Stable identity:
  - a page element keeps `nodeId = "<page-slug>-<element-name>"`;
  - an expanded component element uses an instance path such as
    `"home-pricing1-card1"`;
  - nested instances extend that path with each instance name and local element
    name.
- Component-scoped CSS class:
  - `kdm-c-<ComponentName>-<variantName>-<localElementName>`;
  - `kdm-c-<namespace>-<ComponentName>-<variantName>-<localElementName>` when
    the component belongs to a library namespace;
  - a deterministic `-<styleKey>` suffix when the body uses `length` or `color`
    parameters, so instances with different style values get distinct CSS
    rules;
  - the suffix hashes only the referenced length/color bindings, so instances
    that differ only in text, page, URL, or image values share the class; a body
    without style parameters always shares it;
  - direct page elements keep the existing `kdm-<page-slug>-<element-name>`
    class.
- Page CSS emits a component rule once per class, even when the component is
  instantiated many times. The base `assets/kadam.css` is unchanged.
- CSS rules are emitted in first-expansion order for the page. Repeated rules
  with the same class are deduplicated without reordering the rest.
- Diagnostics are sorted by the existing file/offset/code/message comparator.
- Output files are sorted by output path, as they are today.
- No generated HTML contains a `<script>` element or a client runtime.
- Golden tests compare bytes across repeated builds and across manifest
  reorderings that do not change the page/component set.

The expansion algorithm must not mutate the parsed page or component AST. It
builds new element nodes and new arrays, so a failed build or a second compile
cannot observe partially expanded state.

### 4.13 Content slots

A component may declare one insertion point for instance-supplied elements:

```kdm
component Panel takes a title as text {
    frame1 {
        a container
        heading1 {
            a minor heading
            the heading text says "{$title}"
        }
        content1 {
            a slot
            empty1 {
                a paragraph
                the text says "Nothing here yet."
            }
        }
    }
}
```

```kdm
notice1 {
    a Panel
    with a title of "Notice"
    body1 {
        a paragraph
        the text says "Page-owned content."
    }
}
```

Named slots add a name after the article, and instances target them with a
slot group:

```kdm
component Panel {
    frame1 {
        a container
        head1 {
            a header slot
            empty1 {
                a paragraph
                the text says "No header yet."
            }
        }
        body1 {
            a content slot
        }
    }
}
```

```kdm
panel1 {
    a Panel
    head1 {
        a header slot
        title1 {
            a minor heading
            the heading text says "Reports"
        }
    }
    body1 {
        a content slot
        note1 {
            a paragraph
            the text says "Page-owned content."
        }
    }
}
```

Rules:

- `a slot` is a placeholder kind, not an HTML element. It never reaches the IR
  or the emitters.
- A default body or variant may declare one unnamed slot (`a slot`) and any
  number of named slots (`a header slot`). Names are lower-camel and unique
  within the body or variant. Slots must sit inside a `container`, `card`, or
  `navigation bar`; a slot cannot be the root (a leaf parent is already
  `KDM3010`).
- A slot carries no statements, size, or properties of its own. Its child
  elements are fallback content: component-authored, expanded in the
  component's scope, and emitted only when the instance supplies no children.
- Plain instance children fill the unnamed slot. A named slot is filled by a
  slot group: a child element whose kind names that slot, for example
  `head1 { a header slot; ... }`. A group's children are the slot content and
  the group itself emits nothing.
- Supplying content for an undeclared slot name, reusing a name, or filling the
  unnamed slot with `a slot` is `KDM3034`. Plain children when no unnamed slot
  exists, or any content when the body declares no slot, is `KDM3030`.
- Each slot uses its own fallback children when the instance supplies nothing
  for that slot; with no fallback the slot expands to nothing. Either way the
  component still expands to one root.
- Supplied children are expanded in the caller's scope before insertion. A
  page-owned child therefore keeps `kdm-<page-slug>-<name>` identity, its page
  source span, and its page CSS. A child authored inside another component
  keeps that caller component's instance path and scope.
- Slot content is ordinary caller source: the component does not interpolate
  it, and the component's parameters are not visible inside it.
- Per-slot parameters and fallback content that reads instance parameters are
  deferred. Fallback children see only the component's own parameters, like any
  other component-authored element.
- Slot misuse is `KDM3033`.

Because the slot is replaced in place, an instance still expands to exactly one
root and no wrapper element is introduced.

---

## 5. Identity, source locations, and emissions

### 5.1 Instance path

Every expanded element carries an origin path. For example:

```text
page: home
  instance: pricing1 (PriceCard, default)
    root: card1
      child: title1
```

produces:

```text
nodeId:  home-pricing1-card1
class:   kdm-c-PriceCard-default-card1
```

A nested `NavLink` inside a `Navigation` instance extends the path with the
nested instance name and its local root name. Because element/instance names are
unique in their containing scope, the path is unique without a global counter.

The path is also used for form IDs:

```text
home-pricing1-field1-input
```

and for the matching label `for` attribute.

### 5.2 Source origins

Expanded element nodes retain:

- the declaration span of the local element;
- the declaration span of the component;
- the instance name and name span at the call site;
- the variant name;
- the chain of outer instance origins for nested components.

`IrElement` gains an optional component origin chain. `IrSourceMapping` records
both the declaration location and the instance chain. This gives editors and
error reporters both "where the template is written" and "which instance caused
this output".

When a parameter is substituted into a string, the cloned value span points to
the binding value at the instance, not to the declaration placeholder. The
declaration span remains available as a related origin. This makes an empty
required text or unknown page target report at the call site, while a structural
mistake remains a declaration error.

### 5.3 HTML and CSS emitters

The emitters remain component-agnostic:

- `emitHtml` renders the expanded `IrElement` tree as it does today.
- `emitPageCss` renders the expanded tree as it does today, with class-based
  deduplication.
- `kadam.css` remains the shared reset/kind stylesheet.
- No new stylesheet request is added to every page for components.

This is the main compatibility guarantee: existing pages with no components
produce the same HTML and CSS bytes as before.

---

## 6. Diagnostics

New codes are allocated rather than overloading unrelated lexical or semantic
codes. Existing codes continue to mean what they mean now.

| Code | Condition | Primary location | Related location / hint |
| --- | --- | --- | --- |
| `KDM2012` | A file mixes page and component declarations, or repeats the wrong top-level unit | offending header | "a file contains exactly one page or one component" |
| `KDM3020` | Duplicate component name | second component header | first declaration |
| `KDM3021` | Invalid component body: page setting, no root, multiple roots, component block shape | offending element/setting | "a component body and each variant need exactly one root element" |
| `KDM3022` | Unknown component kind | kind name | nearest component-name suggestions |
| `KDM3023` | Missing required property | instance kind/name | list required properties and the declaration |
| `KDM3024` | Unknown property | binding name | nearest parameter-name suggestions |
| `KDM3025` | Duplicate property binding | second binding | first binding |
| `KDM3026` | Property value has the wrong type, or a page value does not name a page | binding value | parameter declaration and expected type |
| `KDM3027` | Unknown/malformed placeholder or wrong interpolation slot | placeholder/value span | parameter declaration and allowed slots |
| `KDM3028` | Circular component reference | referencing instance | full cycle chain and declaration locations |
| `KDM3029` | Unknown, duplicate, reserved, or malformed variant | selection or variant header | available variants / first declaration |
| `KDM3030` | Component instance contains children or non-binding statements | offending statement/child | "move styling into the component or wrap the instance" |
| `KDM3031` | Invalid parameter declaration: duplicate name, bad default, duplicate default | parameter name/default | first declaration |
| `KDM3032` | Expansion depth or total expanded-element limit exceeded | instance that crossed the limit | "split the component structure or reduce nesting" |
| `KDM3033` | Slot declaration misuse: outside a component body, duplicated name, at the root, nested in a fallback, or with statements | slot name/statement span | "name each slot once per body or variant" |
| `KDM3034` | Slot fill misuse: unknown slot name, duplicate group, `a slot` used as a group, or statements on a group | fill group name/statement span | available slot names / "each named slot accepts one group" |
| `KDM3035` | Duplicate component name inside one library namespace | second component header | first declaration |
| `KDM3036` | Unknown namespace, or the component is not in that namespace | qualifier/component name | declared namespaces / available components |
| `KDM3037` | Namespace qualifier on a component in the project namespace | qualifier | remove `from ...` or declare a library component |
| `KDM4007` | Component manifest entry is missing, unreadable, outside the project, or not a `.kdm` file | manifest entry | expected path |
| `KDM4008` | Component file contains a page, page file contains a component, or a component path is duplicated | manifest entry/unit header | page/component list mismatch |
| `KDM4009` | Malformed library entry: bad namespace, unknown property, or missing source | manifest entry | `source` plus a lower-camel `namespace` |

Existing validation after expansion continues to use:

- `KDM3005` for invalid image descriptions/sources and other value errors;
- `KDM3007` for unknown navigation page titles;
- `KDM3009` for missing/empty required content;
- `KDM3010` for leaf nesting;
- `KDM3014`/`KDM3015` for hover constraints.

Syntax errors in a component header (bad braces, missing `{`) use the existing
`KDM2002`/`KDM2009` structural codes.

All diagnostics go through the existing `DiagnosticBag`, including the
100-diagnostic cap and `KDM9003` summary.

---

## 7. Validation and expansion algorithm

### 7.1 Load and parse

1. Load `kadam.json` and validate the new `components` list.
2. Read every page and component in memory before emitting anything.
3. Parse each file with the same lexer and statement templates.
4. A page parse produces `DocumentNode.page`; a component parse produces
   `DocumentNode.component`.
5. A component file with no component, or a page file with no page, is a unit
   mismatch (`KDM4008`), not an empty successful build.

### 7.2 Build the catalog

The catalog stores, per component:

- resolved catalog key (`Name` or `namespace/Name`) and namespace;
- name and declaration span;
- source file and parameter table;
- default body root;
- named variants and their roots;
- direct component references from every body/variant;
- a fingerprint of the declaration for cache keys.

Catalog construction rejects duplicate component names before any expansion.

### 7.3 Validate declarations independently

Every default body and every variant is validated even if unused:

- exactly one root;
- built-in element shape and statement capability;
- leaf/container correctness within the component;
- image/field/text declaration requirements;
- instance target, property names/arity, variant names;
- interpolation names and slot types;
- page references against the project page table (once loaded);
- cycle freedom.

This pass does not require concrete parameter values. It checks that required
content placeholders exist, not that a particular binding supplies a non-empty
value.

### 7.4 Expand pages

For each page, in declared order:

1. Walk top-level elements in source order.
2. If an element is a component instance:
   - resolve the component and selected variant;
   - collect supplied properties; fill defaults; report missing/unknown/duplicate;
   - check concrete types and page targets;
   - create a binding map;
   - expand supplied child elements in the caller's scope and use them as the
     component's slot content, in source order;
   - clone the selected root and descendants in source order;
   - substitute placeholders in allowed slots;
   - replace the declared content slot with the expanded children;
   - assign the instance origin chain and identity path;
   - recursively expand nested component instances;
3. If an element is a built-in element, clone it and recurse into children.
4. Return a `PageNode` containing only built-in `ElementNode` values.

Expansion is all-or-nothing. If any page fails, `compileProject()` returns
`ok: false` with no files, preserving the existing atomic-build guarantee.

### 7.5 Reuse existing validation and lowering

After expansion:

- `validateDocument()` sees ordinary built-in elements and re-checks structure.
- `analyzeDocument()` sees the complete expanded page and the project page
  table, so navigation and accessibility checks use concrete values.
- `lowerDocument()` computes styles, IDs, actions, assets, responsive scopes,
  hover, and motion exactly as for hand-written elements.
- `emitHtml()` and `emitPageCss()` require no component-specific branches.

The only lowerer additions are identity/class selection from component origin
and deduplication of shared component CSS.

---

## 8. Implementation layers

The implementation is intentionally staged and independently testable.

1. **Component AST nodes.** Add `ComponentNode`, parameter declarations,
   variants, component instances, property bindings, and origin metadata.
   Keep `DocumentNode.page` compatible.
2. **Component declarations.** Parse one component header per file, optional
   `takes` parameters, defaults, and the default body.
3. **Component parser.** Parse `variant` blocks, component instances, `with`
   bindings, and `in the ... variant` selections using contextual words.
4. **Component symbol table.** Build the project catalog, unique names, parameter
   tables, variant tables, and direct dependency edges.
5. **Parameter and type validation.** Check required/unknown/duplicate
   properties, `text`/`page`/`url`/`image`/`length` types, defaults, and page
   references.
6. **Default values.** Resolve omitted properties deterministically and record
   the effective binding.
7. **Component expansion/lowering.** Expand a page into a built-in-only AST
   before `lowerDocument`, with substitution and origin paths.
8. **Variant support.** Select the default or named variant and validate every
   variant independently.
9. **Nested components.** Recursive expansion, pass-through property
   interpolation, and identity paths.
10. **HTML/CSS emission.** Reuse existing emitters; add scoped component
    classes, unique form IDs, source origins, and CSS deduplication.
11. **Project-wide resolution.** Load components from `kadam.json`, validate the
    graph, expose dependency information, and integrate with the existing
    all-or-nothing build.

Each layer lands with focused tests before the next layer depends on it.

Suggested new modules:

```text
src/core/components/catalog.ts       component records and lookup
src/core/components/validate.ts      declaration, property, and graph checks
src/core/components/interpolate.ts   one-pass placeholder substitution
src/core/components/expand.ts        pure page expansion
src/core/parser/component.ts         component header/variant/instance grammar
```

Each module landed with focused tests before the next layer depended on it.

---

## 9. Test plan

### Parser and AST

- basic component declaration with no parameters;
- parameters, comma separation, and defaults;
- one component per file and version directive;
- default body plus named variants;
- component instance with bindings;
- variant selection;
- page/component mixing errors;
- malformed headers, roots, and variant blocks;
- contextual words remain usable as v0.1 element names.

### Catalog and symbols

- duplicate component names, including across files;
- unknown component with suggestion;
- manifest path missing/outside project/inside output;
- page file listed as a component and component file listed as a page;
- component names are case-sensitive and project-global.

### Properties and defaults

- required parameter supplied;
- required parameter missing;
- optional parameter omitted and defaulted;
- explicit empty string overrides a default and is checked;
- unknown property;
- duplicate property;
- `text`, `page`, `url`, `image`, `length`, and `color` type success/failure;
- page, url, image, length, or color default that is invalid;
- nested pass-through of `text`, `page`, `url`, `image`, `length`, and `color`.

### Expansion and variants

- one instance and multiple instances;
- default variant;
- named variant;
- every variant validated even when unused;
- nested components;
- sibling instances with the same component;
- instance inside a container and at page root;
- root replacement without a wrapper;
- leaf/container placement error after expansion;
- instance style statements rejected;
- slot content expanded in the caller's scope, empty slots, and children
  rejected when no slot exists;
- slot misuse: page-level slot, duplicate names, root slot, slot statements,
  and a slot nested in its own fallback;
- named slots filled by groups, fallback per slot, unknown or duplicate
  groups, plain children without an unnamed slot, and styled groups;
- fallback content used only when the instance supplies no children;

### Cycles and limits

- direct self-reference;
- two-component cycle;
- longer cross-file cycle;
- cycle in an unused variant/component;
- maximum nesting/expanded-element limit.

### Accessibility and semantics

- empty text binding reports `KDM3009` at the binding;
- missing image description/source after expansion;
- empty field label after expansion;
- unique label `for` and input `id` for two instances;
- navigation target from a `page` property;
- unknown page title;
- focus-visible/hover styles still emitted for expanded interactive elements.

### Determinism and compatibility

- same build twice produces byte-identical HTML/CSS;
- manifest component order does not change output;
- source maps retain declaration and instance locations;
- component CSS is emitted once per class per page;
- instances that differ only in text/page/url/image bindings share a component
  class, while referenced length/color values split it;
- no component or placeholder reaches `PageIR`;
- all existing tests and examples continue to pass;
- generated production output contains no `<script>`;
- browser acceptance: render the example pages, verify component markup,
  variants, navigation, focus, hover, reduced motion, and absence of console
  errors.

---

## 10. Example project

`examples/components/` is the M6 acceptance fixture.

```text
examples/components/
  kadam.json
  README.md
  components/
    Button.kdm
    ExternalLink.kdm
    FormField.kdm
    NavLink.kdm
    Navigation.kdm
    Panel.kdm
    PriceCard.kdm
  libs/
    ui/
      Tag.kdm
  pages/
    home.kdm
    about.kdm
    services.kdm
  assets/
    kadam-mark.svg
```

It demonstrates:

- **Button:** default body and `outline` variant, `text` label and `page`
  target parameters.
- **ExternalLink:** a `text` label and a `url` parameter used as an external
  link target.
- **PriceCard:** default body and `featured` variant, required title/price, a
  defaulted `badge`, a defaulted `image` parameter used as the decorative image
  source, a defaulted `length` used as the price type size, and a defaulted
  `color` used as the badge accent.
- **NavLink:** `text` label and `page` target.
- **Navigation:** a `navigation bar` containing three nested `NavLink`
  instances.
- **Panel:** a titled frame with a named `content` slot, filled by a page-owned
  slot group on the About page, and fallback content on the Services page where
  no children are supplied.
- **Tag:** a library component in the `ui` namespace, referenced as
  `a Tag from ui` and emitted with `kdm-c-ui-Tag-...` classes.
- **Cross-page reuse:** the same navigation, button, card, and field components
  across three pages.
- **Defaults:** a badge and a placeholder omitted on at least one instance.
- **Accessibility:** text field instances with unique label/input pairs, and a
  decorative image inside a component.

The example must build without warnings, produce no script, and remain
deterministic across repeated builds. It must not duplicate authored component
structure in page files.

---

## 11. Alternatives considered

| Area | Alternative | Decision |
| --- | --- | --- |
| File layout | Components inside page files | Rejected: visibility and dependency ownership are ambiguous |
| File layout | One project `components.kdm` | Rejected: poor ownership and coarse error isolation |
| File layout | Automatic `components/**/*.kdm` discovery | Rejected for M6: hidden filesystem order and accidental inclusion; explicit manifest entries are reviewable |
| Invocation | Positional arguments | Rejected: misordering and poor diagnostics |
| Properties | Generic property statements like `the title is ...` | Rejected: collision with existing typography/text grammar |
| Property syntax | `with a title of "..."` | Chosen: distinct, named, and statically checkable |
| Parameters | One untyped string | Rejected: cannot validate navigation targets |
| Parameters | General expressions / arbitrary CSS values | Deferred: typed whole-value `length` and `color` parameters are implemented |
| Variants | Style overlays on a shared tree | Rejected for M6: needs selectors, inheritance, and cascade rules |
| Variants | Complete alternative bodies | Chosen: explicit and deterministic |
| Component root | Wrapper element | Rejected: changes layout/semantics and adds unnecessary DOM |
| Component root | Exactly one root, expand in place | Chosen |
| Composition | Slots / child injection | Implemented: one unnamed plus named slots, caller-owned content, and fallback |
| Modules | Imports and namespaces | Implemented: manifest namespaces and the `from` qualifier; external roots and re-exports deferred |

---

## 12. Review outcome and approved decisions

Approved on 2026-11-08 with the amendments below. M6 implementation remains a
separate authorized step; no component code was started during review.

The following decisions are now approved:

1. **File model:** one component per `.kdm` file, listed explicitly under
   `components` in `kadam.json`, conventionally in `components/`.
2. **Expansion boundary:** expand components into ordinary page elements before
   `validateDocument` and `lowerDocument`; do not add component handling to the
   emitters.
3. **Root rule:** exactly one root per default body and per variant, with no
   generated wrapper.
4. **Instance rule:** instances contain only a component kind, optional variant,
   and `with` bindings; no children or instance-level styling.
5. **Parameter types:** support `text`, `page`, `url`, `image`, `length`, and
   `color`; defer all expression syntax.
6. **Variants:** full alternative element bodies, one default body, named
   variants, static selection.
7. **Scope:** one project-global component namespace with no imports or
   namespaces.
8. **Identity:** stable instance paths for `data-kdm-id`, form IDs, source maps,
   and component-scoped CSS classes; component CSS emitted once per class per
   page.
9. **Validation strictness:** unused components and unused variants must validate
   and can fail the build.
10. **Keywords:** use contextual words rather than adding new global keywords,
    preserving existing v0.1 element names.

**Review amendments:**

1. Components are project-mode only. Single-file builds have no implicit
   component catalog and report a component instance as unknown.
2. Component files are source, not routes or assets, and are never copied to the
   output tree.
3. Component names remain case-sensitive Pascal-case identifiers; built-in kinds
   remain lowercase, so the namespaces do not collide in the grammar.
4. Approval is recorded in D-10 and D-19–D-22. Implementation still requires a
   separate start request; this document does not authorize code changes by
   itself.

No implementation code, tests, or examples were changed. Documentation status
and decision records were updated by this review.
