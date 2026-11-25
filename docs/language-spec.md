# Kadam Language Specification

**Specification version:** 0.1
**Compiler status:** implemented through M5 — see `docs/m5-compliance.md`
**Status:** approved for v0.1 — see `docs/decisions.md`

This document defines the proposed Kadam language. It is normative for the
v0.1 language surface unless a section is explicitly marked *planned* or
*provisional*. The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY**
are used in their usual standards sense.

Nothing in this document is interpreted by a language model. Every sentence
either matches a grammar rule in this specification or produces a diagnostic.
There is no best-effort mode.

---

## 1. Scope

### 1.1 Goals

- Describe user interfaces in readable, constrained English.
- Guarantee deterministic parsing, analysis, and generated output.
- Produce semantic HTML, separate CSS, and minimal JavaScript.
- Report errors with a file, line, column, and stable error code.
- Provide a language foundation that supports reusable components, multiple
  pages, a development server, and CLI-first tooling.

### 1.2 Non-goals for v0.1

- General-purpose programming: variables, expressions, conditionals, loops.
- User-authored JavaScript, HTML, or CSS.
- Data fetching, forms submission, authentication, or server logic.
- Custom breakpoints, container queries, or arbitrary CSS.
- Theming beyond the three page-level defaults in §6.1.
- Multiple pages or components in one source file.
- Raw HTML injection.

These are deferred, not rejected. The roadmap assigns them to later
milestones where applicable.

### 1.3 Interpretation policy

1. The compiler recognizes a finite, documented vocabulary and a finite set of
   statement templates.
2. A statement matches **exactly one** template. Zero matches is a syntax
   error; more than one match is a compiler defect and must fail with an
   internal error. The compiler never chooses the "most likely" meaning.
3. Unknown sentences are errors with a deterministic hint. They are never
   ignored, rewritten, or sent to an external service.
4. If a document contains any error, the compiler produces no output files.

---

## 2. Design principles

- **Readable first.** Braces and quotes are the only structural punctuation.
  Sentences read like short English instructions.
- **Explicit semantics.** Every default is documented. Every conflict is an
  error.
- **One idea per line.** A statement expresses one property, one event, or one
  responsive override.
- **Static first.** HTML and CSS carry the design; JavaScript exists only for
  behavior that cannot be expressed otherwise.
- **Accessible by construction.** Required content and focus behavior are
  language rules, not optional lint rules.
- **Stable tooling.** Every syntax node carries a span, and generated elements
  carry stable identifiers so editors can map DOM back to `.kdm` source.

---

## 3. Lexical structure

### 3.1 Encoding and lines

- Source files MUST be UTF-8. A leading byte-order mark is ignored.
- Both LF and CRLF line endings are accepted. The compiler normalizes them.
- The `.kdm` extension is required.
- One line contains at most one statement or block delimiter.
- Horizontal whitespace (spaces and tabs) separates tokens. Indentation has no
  semantic meaning; four spaces per level is the convention.
- A line length of 4,096 characters and a file size of 1 MiB are reference
  implementation limits. Exceeding either is a diagnostic, not undefined
  behavior.

### 3.2 Comments

A `//` sequence outside a quoted string starts a comment that extends to the
end of the line. Comments may follow a statement or occupy their own line.
Block comments are not supported.

```kdm
// A page-level comment.
has a white border  // a trailing comment
```

`//` inside a quoted string is text, not a comment. Hex colors are written
with `#`, so they never conflict with comments.

### 3.3 Statements and blocks

- Blank lines and comment-only lines are ignored.
- A block header ends with `{` and MUST occupy its own line.
- A closing `}` MUST occupy its own line, optionally followed by a comment.
- Statements are single lines. A statement MAY end with one optional period
  (`.`); the period is syntactic sugar and carries no meaning. Periods inside
  quoted strings are preserved.
- Semicolons are not valid.
- Blocks use braces, not indentation.

### 3.4 Case

- Keywords, kind phrases, units, and color names are case-insensitive.
- Element names are case-sensitive lower camel case.
- Component names (planned) are case-sensitive Pascal case.
- Quoted strings preserve case and all characters exactly.

### 3.5 Identifiers

Element names MUST match:

```text
[a-z][A-Za-z0-9]{0,63}
```

Names MUST be unique within their containing page or component. Names MUST NOT
be reserved words. Numeric suffixes are allowed and encouraged for multiple
instances (`button1`, `button2`).

### 3.6 Strings

Strings use double quotes and support these escapes:

| Escape | Meaning |
| --- | --- |
| `\"` | double quote |
| `\\` | backslash |
| `\n` | line feed |
| `\r` | carriage return |
| `\t` | tab |
| `\uXXXX` | Unicode code point |

Literal newlines inside strings are not allowed. Single-quoted strings are not
part of the language. Unicode text (including typographic quotes) is allowed
inside double quotes.

### 3.7 Numbers and units

- Numbers are non-negative decimal literals: `0`, `12`, `1.5`. Signs and
  exponent notation are not supported.
- Lengths use pixels or root-relative units: `160px`, `1.5rem`, `0`.
  One optional space is allowed between number and unit (`160 px`).
- Percentages are only valid in the scale effect (`105%`).
- Durations use milliseconds or seconds: `150ms`, `0.3s`.
- A bare non-zero number as a length is an error. The compiler never assumes
  pixels.

### 3.8 Colors

Colors are either:

- A CSS named color, case-insensitive. The `transparent` and `currentcolor`
  keywords are not colors in Kadam; use `has no background` instead.
- A hex literal: `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`.

The accepted named-color table is frozen per language version and shipped with
the compiler. Colors introduced by newer CSS specifications are not accepted
until the language version is updated.

### 3.9 Tokens

| Token | Form |
| --- | --- |
| identifier | §3.5 |
| string | §3.6 |
| number | `[0-9]+(\.[0-9]+)?` |
| length | number + optional space + `px` or `rem`, or `0` |
| duration | number + optional space + `ms` or `s` |
| percentage | number + `%` (scale effects only) |
| color | named color word or hex literal |
| punctuation | `{`, `}`, `,`, `.` (terminal period) |
| comment | `//` to end of line |

Anything else outside a string is a lexical error (`KDM1001`).

---

## 4. Document structure

### 4.1 Language version directive

A source file MAY begin with a version directive as its first non-comment,
non-blank line:

```kdm
kadam 0.1
```

- The version MUST have the form `major.minor`.
- In a project, a file directive MUST match the project's `kadam` version.
- If omitted, the file inherits the project version. In single-file mode, the
  installed compiler's language version is used.
- A compiler MUST reject a language version it does not implement. It MUST NOT
  attempt best-effort compilation of a newer grammar.

### 4.2 Page declaration

A v0.1 source file contains exactly one page and nothing else at top level:

```kdm
page "Home" {
    // page settings and elements
}
```

- The page title is a non-empty string of at most 80 characters.
- Page titles MUST be unique within a project (case-sensitive).
- The title is human-facing. Routes are declared in `kadam.json`; the title is
  also the target of navigation statements (§10).
- One page per file is deliberate: it keeps routes, diagnostics, and
  incremental rebuilds unambiguous (see `D-14`).

### 4.3 Page body

A page body contains, in any order:

- page setting statements (§6.1), and
- element declarations.

A page MAY be empty.

### 4.4 Element declarations

An element is introduced by its name and a block:

```kdm
button1 {
    a button that is 160px by 48px
    has a blue background
    the button text says "Get Started"
}
```

Rules:

1. The element name MUST be unique in the file.
2. The **first** statement inside the block MUST be a kind sentence (§5.1).
3. Exactly one kind sentence is allowed.
4. After the kind sentence, appearance statements, event statements, motion
   statements, responsive statements, and child element declarations MAY
   appear in any order.
5. A leaf kind (button, link, heading, paragraph, text field, image, divider)
   MUST NOT contain child elements. Container kinds MAY.
6. Every element block MUST be closed.
7. Nesting depth is limited to 64 levels in the reference implementation.

Using a kind sentence after any other statement is an error (`KDM2003`), even
if the rest of the element is otherwise valid.

---

## 5. Elements and kinds

### 5.1 Kind sentence

The first statement of every element declares what the element is:

```text
a <kind> [that is <length> by <length>]
```

- `a` and `an` are interchangeable; the compiler does not check grammatical
  agreement.
- The optional size clause sets width and height, equivalent to a separate
  `it is <width> by <height>` statement. Specifying both is a duplicate-size
  error.
- The kind is not written in the element header. This preserves the natural
  reading `button1 { a button ... }` (see `D-03` for the trade-off).

### 5.2 Kind catalogue (v0.1)

| Kind phrase | HTML element | Category | Required content |
| --- | --- | --- | --- |
| `a button` | `button` or styled `a` | leaf, interactive | text |
| `a link` | `a` | leaf, interactive | text and one click target |
| `a main heading` | `h1` | leaf, text | text |
| `a section heading` | `h2` | leaf, text | text |
| `a minor heading` | `h3` | leaf, text | text |
| `a paragraph` | `p` | leaf, text | text |
| `a text field` | labelled `input` group | leaf, form | label |
| `an image` | `img` | leaf, media | source and description (or decorative) |
| `a card` | `div` | container | none |
| `a container` | `div` | container | none |
| `a navigation bar` | `nav` | container | none |
| `a divider` | `hr` | leaf, visual | none |

A generic `a heading` is intentionally invalid because its document level
would be a guess. Authors choose `main`, `section`, or `minor` explicitly. HTML
heading levels `h4`–`h6` are not exposed in v0.1.

### 5.3 Container and leaf rules

- Container kinds MAY contain any element kinds, including other containers.
- Leaf kinds MUST NOT contain element declarations (`KDM3010`).
- Containers MAY be empty.
- A page is not an element and cannot be styled with element statements; use
  page settings (§6.1).

---

## 6. Statements

Every statement below is a complete line. The canonical phrasing is fixed.
Grammatical variants not listed here are errors. This is intentional: a small
closed surface is what makes deterministic natural-language parsing possible
(`D-01`).

### 6.1 Page settings

Page settings appear directly in the page body, never inside an element:

```kdm
the page background is #F7F5F0
the page text is #171717
the page font is sans serif
```

| Statement | Meaning |
| --- | --- |
| `the page background is <color>` | Page background color |
| `the page text is <color>` | Default text color for headings, paragraphs, and field labels |
| `the page font is sans serif` | System sans-serif stack |
| `the page font is serif` | System serif stack |
| `the page font is monospace` | System monospace stack |

Page settings are **not** a CSS cascade. They are lowered into explicit
defaults: `the page text` supplies the default color for headings, paragraphs,
and text-field labels; `the page font` supplies the default family for all
text-bearing kinds. An element's own typography statement overrides the page
default. Background, spacing, and layout never inherit.

Each page setting may appear at most once (`KDM3004`). A page gradient is not
supported in v0.1; use a full-size container instead.

### 6.2 Text

Text-content kinds are button, link, headings, and paragraph. They support the
text statements below. Text fields have their own label/placeholder statements
and support typography (§6.7) but not body text. The term **text-bearing**
means the text-content kinds plus text field; typography applies to all
text-bearing kinds.

```kdm
the text says "Get Started"
```

The noun-qualified form is also accepted when the noun matches the kind family:

```kdm
the button text says "Get Started"
the heading text says "Welcome"
the paragraph text says "..."
the link text says "Read more"
```

- `the text says` applies to all four text-content kinds.
- `the <noun> text says` is accepted only for the matching family (`KDM3003`
  otherwise). This exists to preserve the original Kadam example.
- Text is plain text. HTML is escaped during emission and is never interpreted
  as markup.
- Text is a single-valued property; a second text statement is a duplicate
  (`KDM3004`).

### 6.3 Size

```kdm
it is 160px by 48px
it is 160px wide
it is 48px tall
it is full width
it is full height
```

- Width and height are independent properties.
- `by` sets width first and height second.
- `full width` and `full height` are the only percentage-like size forms in
  v0.1.
- Size applies to every kind. Fixed sizes use `border-box` sizing: padding and
  border are included in the declared width and height.
- Explicit sizes are optional. Unset dimensions use the kind defaults in
  Appendix A and the surrounding layout.

### 6.4 Background and gradients

```kdm
has a blue background
has no background
has a blue and black gradient
has a blue to black gradient
the gradient goes from left to right
```

- `has a <color> background` sets a solid background.
- `has no background` sets a transparent background.
- `has a <color> and <color> gradient` and the `to` form are equivalent.
- Gradients are linear and have exactly two color stops.
- The direction statement is optional. Default: `from top to bottom`.
- Directions are `left to right`, `right to left`, `top to bottom`, and
  `bottom to top`.
- Solid background, no background, and gradient all write the same property;
  combining them is a duplicate (`KDM3004`).
- The direction statement requires a gradient (`KDM3005`).

### 6.5 Border and corners

```kdm
has a white border
has a 2px white border
has no border
has rounded corners
has 12px rounded corners
has fully rounded corners
```

- `has a <color> border` means `1px solid <color>`.
- `has a <length> <color> border` sets width and color; the style is always
  solid in v0.1.
- Border width `0` is allowed and is equivalent to no border. `has no border`
  is preferred.
- `has rounded corners` means an `8px` radius.
- `has fully rounded corners` means a pill radius (`9999px`), clipped to the
  element's box.
- Border and corner radius are single-valued properties.
- Dashed/dotted borders, per-side borders, and per-corner radii are deferred.
- A hovered border color requires a base border; see §7.1.

### 6.6 Shadow

```kdm
has a soft shadow
has a medium shadow
has a strong shadow
has no shadow
```

Shadows are fixed, documented presets (Appendix A). They are single-valued.
Colored shadows, custom offsets, and inset shadows are deferred. Shadow presets
are part of the built-in design language and may be revised before v1.0 under
language versioning rules.

### 6.7 Typography

Typography statements apply to text-bearing kinds: the text-content kinds
(button, link, headings, paragraph) and the input text of a text field.

```kdm
the text is 18px
the text is blue
the text is semibold
the text is italic
the text is centered
the text is left aligned
the text is right aligned
the font is sans serif
```

- `the text is <length>` sets font size.
- `the text is <color>` sets text color.
- `the text is light|regular|medium|semibold|bold` sets weight (300/400/500/
  600/700).
- `the text is italic` sets italic style.
- `the text is centered`, `left aligned`, and `right aligned` set horizontal
  text alignment.
- `the font is sans serif|serif|monospace` sets the font family preset.
- The overloaded `the text is ...` form is unambiguous because lengths, colors,
  weights, and alignment words are disjoint value domains. This is the one
  deliberate verb-overloading in v0.1 (`D-05`).
- Each underlying property may be set once. `the text is 18px` followed by
  `the text is 20px` is a duplicate; there is no last-write-wins rule.

### 6.8 Spacing

```kdm
it has 24px padding
it has 16px padding on the left
it has 16px padding on the left and right
it has 32px margin
it has 16px margin on top and bottom
```

The same forms exist for `margin`. Sides are `left`, `right`, `top`, and
`bottom`; combined sides are `left and right` and `top and bottom`. A single
optional `the` may precede the first side name: `on top` and `on the top` are
equivalent, as are `on top and bottom` and `on the top and bottom`. The article
carries no meaning.

- Padding and margin are non-negative lengths.
- A four-side statement expands to four side properties. A later statement
  that touches an already-set side is a duplicate (`KDM3004`), including
  `padding` followed by `padding on the left`.
- Margin does not collapse in the generated layout model; container `gap` is
  preferred for spacing between children.
- Only symmetrical combined sides are supported in v0.1. Setting all four
  sides individually is allowed with four statements.

### 6.9 Layout (containers only)

```kdm
it arranges its children in a row
it arranges its children in a column
it has 16px gap between children
it centers its children
it centers its children horizontally
it centers its children vertically
```

- Allowed only on `container`, `card`, and `navigation bar` (`KDM3003`).
- Defaults: container and card arrange children in a column; a navigation bar
  arranges children in a row.
- `gap` applies between adjacent children.
- `it centers its children` sets both axes at once. An axis-specific form
  duplicates the corresponding axis and cannot be combined with the both-axes
  form (`KDM3004`). Use two axis-specific lines when both axes are needed and
  the author wants them explicit. Axes are physical: horizontal means
  left/right and vertical means top/bottom. The emitter maps them to the
  correct flex properties for the current direction, including responsive
  direction changes.
- Child elements follow source order. There is no implicit reordering,
  absolute positioning, or grid system in v0.1.
- Flex wrapping, space-between, alignment of individual children, and grow/
  shrink controls are deferred.

### 6.10 Visibility

```kdm
it is hidden
```

`it is hidden` removes the element from layout and from the accessibility tree.
There is no `visible` statement in v0.1 because visibility is the default.
Hiding is commonly combined with a responsive scope (§9):

```kdm
on phones, it is hidden
```

### 6.11 Images

```kdm
an image that is 560px by 360px
it shows "assets/hero.png"
the description says "A person using the Kadam editor"
```

- `it shows <string>` sets the source. The path MUST be project-root-relative,
  MUST NOT be absolute or contain `..`, MUST exist at compile time, and MUST
  have an allowed raster or vector extension (`png`, `jpg`, `jpeg`, `webp`,
  `avif`, `gif`, `svg`).
- `the description says <string>` sets alt text and MUST be non-empty.
- Every image MUST have either a description or the explicit decorative form:

```kdm
it is decorative
```

- `it is decorative` and a description are mutually exclusive (`KDM3005`).
  A decorative image still requires a source.
- The compiler emits `alt=""` only for explicitly decorative images. Missing
  alt text is never inferred.
- Source and description are single-valued.
- Image cropping, object-fit, and loading strategy are deferred.

### 6.12 Text fields

```kdm
a text field
the label says "Email"
the placeholder says "you@example.com"
it accepts email addresses
it is required
```

- Every text field MUST have a label (`KDM3009`). The label is visible in
  v0.1 and is associated with the input in generated HTML.
- `the placeholder says <string>` is optional.
- `it accepts text` is the default and MAY be omitted.
- Accepted forms: `text`, `email addresses`, `passwords`, `numbers`.
- `it is required` adds the native `required` attribute.
- Label, placeholder, input type, and requiredness are single-valued.
- A field has no value statement in v0.1; fields are presentational and native.
  Form submission and validation messages are deferred.

### 6.13 Divider

```kdm
a divider
has a gray background
it has 24px margin on top and bottom
```

A divider is a one-pixel line by default. Its line color is its background
color. It accepts `has a <color> background` and `has no background`; gradients
and gradient directions are not supported. Border, corners, shadow, padding,
text, and layout statements are not supported on a divider (`KDM3003`).

---

## 7. Events and interactions

Events are declarative. There are no handlers, expressions, or user-written
callback bodies. A v0.1 event line contains exactly one effect.

### 7.1 Hover

```kdm
when hovered, the background turns blue
when hovered, the text turns white
when hovered, the border turns black
when hovered, it lifts by 2px
when hovered, it scales to 105%
when hovered, the border turns black over 200ms
```

- A comma is required after `when hovered`.
- Hover is allowed on every kind except `divider`.
- `the background turns <color>` changes a solid background. It is invalid on
  an element whose base background is a gradient (`KDM3015`); the compiler
  does not silently replace or interpolate a gradient.
- `the text turns <color>` is allowed only on text-bearing kinds.
- `the border turns <color>` requires a base border with a width greater than
  zero on the same element (`KDM3014`). A declared border or a kind-default
  border (such as a text field's) counts; the compiler does not invent one.
  An explicit `has no border` or zero-width border removes that default for
  this check.
- `it lifts by <length>` moves the element up by the given distance.
- `it scales to <percentage>` accepts 100%–200%. Values below 100% would make
  hover shrink the target and are rejected.
- An optional `over <duration>` sets that effect's transition duration.
  Default: `150ms` with `ease-out`.
- Multiple hover lines MAY set different properties. Repeating the same
  hovered property is a duplicate (`KDM3004`). Lift and scale are separate
  transform components and may be combined.
- Hover rules are emitted inside `@media (hover: hover) and (pointer: fine)`.
  Touch devices never receive a stuck hover state.
- Hover effects do not change layout dimensions.

### 7.2 Click

Click actions are allowed only on `button` and `link` (`KDM3003`):

```kdm
when clicked, go to page "About"
when clicked, open "https://example.com" in a new tab
```

- `go to page <string>` navigates in the current tab. The string is resolved
  as a page title in the same project. It MUST match exactly one page
  (`KDM3007`).
- `open <string> in a new tab` accepts only absolute `http` or `https` URLs
  (`KDM3005`). Generated markup uses `target="_blank"` and
  `rel="noopener noreferrer"`.
- A link MUST have exactly one click action (`KDM3009`).
- A button MAY have zero or one click action. A button with no action is a
  native `button type="button"` that intentionally does nothing; this is
  allowed so that design-only specimens such as the README example remain
  valid.
- A button whose only action is internal navigation is emitted as an anchor
  styled as a button. This preserves no-JavaScript navigation and correct link
  semantics. A button with an external action becomes an anchor with
  `target="_blank"`.
- More than one click action on an element is a duplicate (`KDM3004`).
- Escape-key behavior, focus management, and routing hooks are browser-native
  in v0.1. There is no client-side router.

### 7.3 Automatic focus behavior

The compiler emits a visible `:focus-visible` ring for every interactive
element. Authors do not write focus styles in v0.1. The ring uses the accent
color, a 2px outline, and a 2px offset. Removing or restyling the focus ring is
not possible in v0.1.

### 7.4 Deferred interactions

Show/hide/toggle, scroll effects, form submission, keyboard shortcuts,
drag-and-drop, and state transitions are not part of v0.1. They require the
minimal runtime and are scheduled after static code generation is stable.

### 7.5 No client-side runtime in v0.1

Generated site output for v0.1 contains no JavaScript. Navigation is ordinary
anchors, hover and entrance motion are CSS, and fields are native controls. The
compiler does not emit a script tag, inline handlers, a router, or a hydration
step. The development server injects its own reload client only while serving
a development preview; that client is not part of a build. Adding any stateful
browser runtime to generated sites requires a new language decision and
version; it is not an implementation detail of v0.1.

---

## 8. Motion

### 8.1 Entrance animation

```kdm
it fades in when the page loads
it fades in over 600ms when the page loads
it slides in from the left when the page loads
it slides in from the right over 400ms when the page loads
```

- Supported effects: `fades in` and `slides in from the left|right|top|bottom`.
- An optional `over <duration>` may appear before `when the page loads`.
- Default duration: `400ms`, easing `ease-out`.
- At most one entrance animation is allowed per element (`KDM3004`).
- Animation runs once on initial page render. There are no scroll-triggered
  or looping animations in v0.1.
- Animations animate transform and opacity only, never layout.
- Under `prefers-reduced-motion: reduce`, the compiler disables the animation
  and renders the element in its final state.

### 8.2 Transition defaults

Only hover effects create transitions in v0.1. A hover effect without `over`
uses `150ms ease-out` for the property it changes. Properties never transition
implicitly; setting a base style does not animate it.

Under `prefers-reduced-motion: reduce`, authored hover transitions are removed
so the hover state applies instantly. Entrance animations are disabled as
described in §8.1.

---

## 9. Responsive behavior

### 9.1 Breakpoints

v0.1 exposes exactly three non-overlapping tiers:

| Name | Viewport width | Generated media query |
| --- | --- | --- |
| phones | `< 600px` | `(max-width: 599px)` |
| tablets | `600px–1023px` | `(min-width: 600px) and (max-width: 1023px)` |
| desktops | `>= 1024px` | `(min-width: 1024px)` |

These values are part of the language version. Custom ranges and container
queries are deferred (`D-08`).

### 9.2 Responsive statements

A responsive statement prefixes an ordinary element statement with a
breakpoint scope and a comma:

```kdm
on phones, the text is 24px
on tablets, it has 16px padding
on phones, it is hidden
on desktops, it centers its children horizontally
```

- The scope MUST be `phones`, `tablets`, or `desktops`.
- A comma is required.
- The statement after the comma is parsed by the same statement grammar, with
  `it` referring to the containing element.
- Responsive statements are allowed only inside an element body.
- The base (unscoped) value and a scoped value MAY coexist. The scoped value
  overrides the base only inside its media query.
- Repeating the same property for the same breakpoint is a duplicate
  (`KDM3004`). Repeating it for a different breakpoint is allowed.
- Breakpoint scopes are independent. A phones declaration does not inherit
  into tablets or desktops; each tier applies the base plus its own overrides.

### 9.3 Allowed responsive properties

Allowed: size, background and gradient direction, border, corners, shadow,
typography, spacing, layout, and visibility.

Not allowed (`KDM3013`): kind declarations, text content (`the text says`),
image source, description/decorative, field label/placeholder/type/
requiredness, click actions, hover effects, entrance animations, page settings,
child elements, or another responsive prefix.

Text is content, not presentation; changing it per device would create two
different documents and is intentionally rejected.

### 9.4 Hover and responsive interaction

A hover effect is applied on top of whichever responsive base is active.
Generated CSS places hover rules after responsive base rules and inside the
hover-capability media query, so hovering never resurrects a value that the
active breakpoint overrode.

Hover rules are global to the element, not scoped to one breakpoint. A hover
background color is therefore invalid (`KDM3015`) when the base background or
any breakpoint background is a gradient, because the hover color would replace
the gradient in that scope.

---

## 10. Pages and navigation

### 10.1 Identity

- A page is identified to authors by its title (`page "About"`).
- Page titles are unique across the project and compared case-sensitively.
- The route is declared in `kadam.json`; it is not derived from the title or
  file name.
- Navigation statements use the title, never the route. This keeps links
  readable at the cost of requiring titles to be stable references (`D-09`).

### 10.2 Navigation

```kdm
aboutLink1 {
    a link
    the link text says "About"
    when clicked, go to page "About"
}
```

- Internal navigation resolves a title to the page's declared route.
- Changing a page title invalidates every navigation statement that used the
  old title; the compiler reports each one by file, line, and column. There is
  no automatic rename in v0.1.
- External navigation is always a new tab in v0.1.
- Navigation is emitted as ordinary anchors. It works without JavaScript and
  with browser history, middle-click, and "open in new tab".
- Route generation and static-hosting layout are defined in
  `docs/architecture.md`.

### 10.3 Manifest routes

A project manifest maps pages to routes explicitly. A minimal project:

```json
{
  "kadam": "0.1",
  "name": "portfolio",
  "pages": [
    { "file": "pages/home.kdm", "route": "/" },
    { "file": "pages/about.kdm", "route": "/about" }
  ],
  "assets": "assets",
  "outDir": "dist"
}
```

The manifest is the only place routes exist. The language does not accept
`/about` in a navigation statement.

---

## 11. Reusable components (implemented in M6.1, project mode)

Components were not part of the original v0.1 surface. They now ship as the
M6.1 project-mode extension; the normative syntax and semantics live in
[the component architecture](components.md). The shape below is the original
provisional sketch and is kept for history, so prefer `components.md` wherever
the two differ. `D-10` records the reviewed decisions.

A component lives in its own `.kdm` file and declares typed parameters:

```kdm
component PriceCard takes a title and a price {
    card1 {
        a card

        title1 {
            a section heading
            the text says "{$title}"
        }

        price1 {
            a paragraph
            the text says "{$price}"
        }
    }
}
```

A component instance uses the component name as its kind:

```kdm
pricing1 {
    a PriceCard
    the title says "Starter"
    the price says "$9"
}
```

Provisional rules:

- `component` files contain exactly one component and use the same element
  grammar and diagnostics as pages.
- Parameter bindings are statements in the instance block, before any child
  slots. Unknown, duplicate, and missing parameters are errors.
- `{$name}` is the only parameter interpolation form. It is replaced only at
  compile time and only inside quoted text. There is no general expression
  language.
- Component styles are scoped to the component instance. Element names are
  local to the component.
- Components may not contain page settings or navigation to a page that does
  not exist at project scope.
- A component may belong to a library namespace declared in `kadam.json` and is
  then referenced as `a Button from ui`. Unqualified names resolve only in the
  project namespace; there is no fallback search.
- Parameters are typed `text`, `page`, `url`, `image`, `length`, or `color`. A `url`
  binding must be an absolute http or https URL and may be used only as an
  external link target or passed through another `url` binding. An `image`
  binding must be a project-relative image path and may be used only as an image
  source or passed through another `image` binding. A `length` binding must be a
  `px`/`rem` length or `0` and is written in a length position as a quoted
  placeholder, `it has "{$gap}" gap between children`. A `color` binding must be
  a named color or hex literal and is written in a color position as
  `has a "{$accent}" background`.
- A component body or variant may declare one unnamed content slot, `a slot`,
  and named slots such as `a header slot`. Plain instance children fill the
  unnamed slot; a named slot is filled by a child group whose kind names it.
  Slot content is expanded in the caller's scope, so it keeps the caller's
  identity and styles. A slot may declare fallback children, used when the
  instance supplies none. Per-slot parameters and fallback content that reads
  instance parameters are deferred.
- Components cannot fetch data, hold state, or execute logic.

Trade-offs: named parameters and interpolation are less "plain English" than
the rest of the language, but they make composition unambiguous and allow
static validation. Alternatives and unresolved details are in `D-10`.

---

## 12. Semantics

### 12.1 Validation order

A conforming compiler performs these checks before emitting output:

1. **Lexical:** characters, strings, numbers, units, comments.
2. **Syntactic:** document structure, block headers, statement templates,
   element kind placement.
3. **Structural:** unique element names, leaf/container nesting, required
   statements.
4. **Semantic:** known kinds, supported statements, unique page titles,
   navigation targets, required content, asset paths.
5. **Typed:** every slot has the expected value domain (length, color,
   duration, percentage, string, color pair, and so on).
6. **Lowering:** apply defaults, resolve page defaults, layer responsive
   statements, assign stable identifiers.

All stages are pure for a given source and configuration. Errors from later
stages never suppress earlier errors in the same file; independent files are
still checked.

### 12.2 Property precedence

For a computed element property, the precedence is:

1. Active responsive override for the current breakpoint.
2. Base statement on the element.
3. Page-level default, where the property supports it (font family; text color
   for headings, paragraphs, and field labels).
4. Built-in kind default (Appendix A).

Hover rules are applied above the active base while the pointer is over the
element. They never mutate the base value.

This is a fixed precedence order, not a CSS cascade. There is no selector
specificity, `!important`, inherited padding, or container-level text styling.

### 12.3 Duplicate properties

Within one scope, each property may be declared at most once. A scope is
either the element's base declarations or one breakpoint's declarations.

- `has a white border` + `has a 2px white border` → duplicate border.
- Padding-shorthand + an overlapping side → duplicate side.
- Two text statements → duplicate text.
- Two click actions → duplicate action.
- Base + `on phones` for the same property → allowed.
- `on phones` + `on phones` for the same property → duplicate.
- Lift and scale are distinct transform components and may combine.

Duplicates are errors, not last-write-wins. Silent override is exactly the
kind of guessing this language forbids.

### 12.4 Required content

| Kind | Required |
| --- | --- |
| button | `the text says` (or noun form) |
| link | text and exactly one click action |
| main/section/minor heading | text |
| paragraph | text |
| image | source, and description or `it is decorative` |
| text field | label |
| card, container, navigation bar, divider | nothing |

A missing requirement is `KDM3009` with a hint naming the exact accepted
sentence.

### 12.5 Value rules

- Lengths and durations are non-negative; durations must be greater than zero
  when they define a transition or animation.
- `it scales to` accepts 100%–200%.
- Colors must be named colors or valid hex literals.
- Text and description strings may be empty only where explicitly allowed;
  headings, paragraphs, buttons, links, labels, placeholders, and alt text MUST
  be non-empty. An empty button label is a `KDM3009` error.
- External URLs MUST be absolute `http`/`https` URLs with a host.
- Asset paths MUST stay inside the project root and MUST resolve to an existing
  file with an allowed extension.
- Page titles are compared case-sensitively and MUST be unique.

### 12.6 Accessibility rules

The compiler enforces in v0.1:

- Button/link text must exist.
- Images need alt text or explicit decorative status.
- Text fields need visible labels.
- Every interactive element has a focus-visible ring.
- Hover styles are limited to hover-capable pointers.
- Reduced-motion preference disables entrance animations and hover
  transitions.
- Generated headings use the correct `h1`/`h2`/`h3` element.
- Generated form controls are associated with labels.

Contrast checking is planned as a warning in a later language version. Warnings
never block output; errors always do.

### 12.7 No inheritance, no global mutable state

Only page font/text defaults cross element boundaries. Padding, background,
border, size, shadow, layout, animation, and events do not inherit. There is no
runtime state in v0.1.

---

## 13. Determinism and ambiguity

Kadam's central guarantee: **the same source tree, compiler version, and
options produce byte-identical output**, independent of machine, locale,
timezone, file discovery order, or network availability.

Implementation requirements:

- Statement matching is table-driven. The template table is checked in CI for
  overlapping patterns. A line matching zero templates is `KDM2001`; a line
  matching more than one is an internal compiler defect (`KDM9001`), never a
  best guess.
- Suggestions use a fixed edit-distance algorithm over the canonical template
  list, sorted by distance and then by template order. Suggestions are shown
  but never applied.
- File discovery and project pages are sorted by Unicode code point of their
  project-relative path.
- Number formatting uses a fixed locale-independent routine.
- Generated class names and IDs derive from file/route/element names, not
  random values or timestamps.
- Output contains no current date, time, host name, or absolute path.
- The compiler performs no network access. It has no AI or model dependency.
- A determinism test compiles every fixture twice in separate directories and
  compares all bytes.

Unknown English is always an error. There is no "close enough" mode.

---

## 14. Compilation model (informative)

### 14.1 HTML

- Element kinds map to semantic HTML (`button`, `a`, `h1`–`h3`, `p`, `label` +
  `input`, `img`, `div`, `nav`, `hr`).
- Every generated element carries a stable `data-kdm-id` used by the editor
  and development server. Production builds MAY omit it later; the default in
  v0.1 keeps it for tooling and debugging.
- Text is HTML-escaped. There is no raw HTML statement.
- A text field becomes a wrapper containing a `<label>` and `<input>` with a
  generated deterministic `id`/`for` pair.
- A button with internal navigation becomes an anchor styled as a button; a
  button without an action becomes `<button type="button">`.
- Image width/height attributes are emitted when explicit sizes exist, to
  reduce layout shift.
- Generated asset URLs are root-relative (`/assets/...`) by default. Deployment
  under a URL subpath is supported by the manifest `basePath` property or the
  matching CLI option.
- The page becomes a `<main class="kdm-page">` inside `<body>` with the page's
  CSS and no inline styles.

### 14.2 CSS

- One base stylesheet contains the reset and kind defaults.
- One stylesheet per page contains only that page's rules, in deterministic
  source order.
- Class names are derived from the route slug and element name. The root route
  `/` uses the slug `home`; other routes join path segments with `-` (`/docs/intro`
  becomes `docs-intro`). For example, the root page's button is
  `.kdm-home-button1`.
- Responsive rules are grouped in fixed order: phones, tablets, desktops.
- Hover rules live inside the hover-capability media query.
- The reduced-motion block is emitted once per page that uses entrance motion
  or hover transitions.
- No inline `style` attributes are emitted in v0.1.

### 14.3 JavaScript

v0.1 needs no JavaScript: navigation is anchors, hover is CSS, entrance motion
is CSS, and fields are native. The JS emitter exists as an architecture
boundary for later show/hide/toggle actions. Generated JavaScript, when it
eventually exists, is an external ES module; inline scripts are forbidden.

### 14.4 Output and source maps

- Static output is written outside the source tree, to `outDir` (`dist/` by
  default).
- `.kdm` files, `kadam.json`, and assets are never modified by a build.
- The development server and future editor use `data-kdm-id` plus a generated
  mapping file to connect DOM nodes to source spans. Two-way editing is not a
  v0.1 concern, but spans are mandatory from the first parser implementation.

---

## 15. Diagnostics

### 15.1 Format

Human-readable diagnostics use this shape:

```text
error[KDM3003]: borders are not supported on a divider
  --> pages/home.kdm:12:5
   |
12 |     has a white border
   |     ^^^^^^^^^^^^^^^^
   = hint: supported statements for a divider are: size, solid background,
           margin, visibility, and entrance motion
```

- Severity, stable code, message, file, 1-based line, 1-based column, span
  length, and optional hint.
- The file path is project-relative and uses `/` on every platform.
- Diagnostics are sorted by file path, then start offset.
- A machine-readable JSON format is planned for the development server and
  editor. It contains the same fields plus a stable node ID where available.
- A compilation with errors writes no HTML/CSS/JS. The development server may
  serve the last successful build with an error overlay.
- The reference implementation reports at most 100 diagnostics. Reporting
  stops after 99 real diagnostics and appends a `KDM9003` summary as the 100th
  diagnostic.

### 15.2 Error codes

**Lexical (`KDM1xxx`)**

| Code | Meaning |
| --- | --- |
| KDM1001 | Unexpected character |
| KDM1002 | Unterminated string |
| KDM1003 | Invalid escape sequence |
| KDM1004 | Malformed number, length, duration, or unit |
| KDM1005 | Source file exceeds a documented limit |

**Syntax (`KDM2xxx`)**

| Code | Meaning |
| --- | --- |
| KDM2001 | Unrecognized statement |
| KDM2002 | Malformed page or element header |
| KDM2003 | Kind sentence is not the first statement |
| KDM2004 | Element has no kind sentence |
| KDM2005 | Missing closing brace |
| KDM2006 | Content outside the page block |
| KDM2007 | Invalid identifier |
| KDM2008 | File must contain exactly one page |
| KDM2009 | Block delimiter is not on its own line |
| KDM2010 | Unexpected token or punctuation |
| KDM2011 | Element nesting exceeds 64 levels |

**Semantic and typed (`KDM3xxx`)**

| Code | Meaning |
| --- | --- |
| KDM3001 | Unknown or incomplete kind |
| KDM3002 | Duplicate kind sentence |
| KDM3003 | Statement is not supported by this kind |
| KDM3004 | Duplicate property or action |
| KDM3005 | Invalid value, URL, or value combination |
| KDM3006 | Unknown color |
| KDM3007 | Unknown page reference |
| KDM3008 | Duplicate element name |
| KDM3009 | Missing required content |
| KDM3010 | Leaf element cannot contain children |
| KDM3011 | Duplicate page title |
| KDM3012 | Invalid event target |
| KDM3013 | Statement is not allowed in a responsive scope |
| KDM3014 | Hover border color requires a base border |
| KDM3015 | Hover background color is invalid on a gradient |

**Project (`KDM4xxx`)**

| Code | Meaning |
| --- | --- |
| KDM4001 | Missing or invalid `kadam.json` |
| KDM4002 | Page file is missing or unreadable |
| KDM4003 | Asset is missing, outside the project root, or unsupported |
| KDM4004 | Language version mismatch or unsupported version |
| KDM4005 | Duplicate route |
| KDM4006 | Project declares no pages |

**Internal (`KDM9xxx`)**

| Code | Meaning |
| --- | --- |
| KDM9001 | Statement matches more than one template (compiler defect) |
| KDM9002 | Internal emission failure |
| KDM9003 | Too many diagnostics; reporting stopped |

This is the initial proposed set. Codes are stable once released; new checks
receive new codes rather than changing the meaning of an existing one.

---

## 16. Grammar summary

This EBNF defines block structure. Statement interiors are defined by the
canonical templates in §6–§9, which are normative. `KIND`, `PAGE_SETTING`, and
the appearance/event/motion productions expand to those exact templates;
synonyms not listed there are invalid.

```ebnf
file            = [ version ] page EOF ;
version         = "kadam" version-number ;
page            = "page" string "{" page-item* "}" ;
page-item       = page-setting | element ;
element         = identifier "{" kind ( element-statement | element )* "}" ;
kind            = article kind-name [ "that is" length "by" length ] ;
element-statement = appearance | event | motion | responsive ;
responsive      = "on" breakpoint "," appearance ;
page-setting    = "the page" ( background-setting
                            | text-setting
                            | font-setting ) ;
appearance      = size | background | border | corners | shadow
                | typography | spacing | layout | visibility
                | image-source | image-description | field-property
                | text-content ;
event           = hover-event | click-event ;
motion          = entrance-animation ;
article         = "a" | "an" ;
breakpoint      = "phones" | "tablets" | "desktops" ;
version-number  = digit+ "." digit+ ;
identifier      = lower-letter ( letter | digit )* ;
string          = '"' ( escaped-char | any-char-except-quote-newline )* '"' ;
length          = number [ " " ] ( "px" | "rem" ) | "0" ;
duration        = number [ " " ] ( "ms" | "s" ) ;
percentage      = number "%" ;
```

All terminals are case-insensitive except identifiers and page titles. Leading
and trailing horizontal whitespace is ignored. A comment or blank line may
appear between any productions. A single terminal `.` may follow any
`page-setting`, `element-statement`, `event`, or `motion` line.

### 16.1 Canonical example

```kdm
kadam 0.1

page "Home" {
    the page background is #F7F5F0
    the page text is #171717
    the page font is sans serif

    nav1 {
        a navigation bar
        has no background
        it arranges its children in a row
        it centers its children vertically
        it has 24px padding on the left and right

        brand1 {
            a section heading
            the text says "Kadam"
            the text is 20px
        }

        navLinks1 {
            a container
            it arranges its children in a row
            it has 24px gap between children
            it centers its children vertically

            aboutLink1 {
                a link
                the link text says "About"
                when clicked, go to page "About"
            }
        }
    }

    hero1 {
        a container
        it is full width
        it centers its children horizontally
        it has 96px padding on top
        it has 64px padding on bottom
        it has 24px gap between children

        headline1 {
            a main heading
            the text says "Describe the interface. Ship the interface."
            the text is 64px
            the text is centered
        }

        intro1 {
            a paragraph
            it is 640px wide
            the text says "Kadam is a programming language for building user interfaces with ordinary English."
            the text is 20px
            the text is centered
        }

        button1 {
            a button that is 160px by 48px
            has a blue and black gradient
            has a white border
            has rounded corners
            when hovered, the border turns black
            the button text says "Get Started"
            when clicked, go to page "About"
        }
    }
}
```

The original README-style example remains valid without the page settings,
navigation, or click action. A button is allowed to have no click action. The
canonical example assumes a second project page titled `About`; without it, the
two navigation statements would correctly fail with `KDM3007` in a single-file
check.

---

## Appendix A — Built-in defaults

Defaults are part of the language's visual design system. Changing a value
that alters generated output requires a language version bump (`D-06`).

### A.1 Global tokens

| Token | Value |
| --- | --- |
| Page background | `#FFFFFF` |
| Page text | `#171717` |
| Accent | `#2563EB` |
| Focus ring | `2px solid #2563EB`, offset `2px` |
| Default corner radius | `8px` |
| Pill radius | `9999px` |
| Muted border | `#D4D4D4` |
| Muted text / placeholder | `#737373` |
| Divider color | `#E5E5E5` |
| Hover transition | `150ms ease-out` |
| Entrance duration | `400ms ease-out` |
| Phone breakpoint | `< 600px` |
| Tablet breakpoint | `600px–1023px` |
| Desktop breakpoint | `>= 1024px` |

Box sizing is `border-box` for every generated element. Default margin is `0`;
spacing is controlled by container `gap` and explicit margin statements.

### A.2 Typography

| Preset | Value |
| --- | --- |
| `sans serif` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` |
| `serif` | `ui-serif, Georgia, Cambria, "Times New Roman", serif` |
| `monospace` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

### A.3 Kind defaults

| Kind | Defaults |
| --- | --- |
| button | inline-flex, centered text; padding `12px 20px`; background `#2563EB`; text `#FFFFFF`; 16px / 600; radius 8px; no border or shadow |
| link | inline; text `#2563EB`; 16px / 400; underlined; transparent background |
| main heading | 48px / 700; line-height 1.1; text = page text; left aligned; margin 0 |
| section heading | 32px / 700; line-height 1.2; text = page text; left aligned; margin 0 |
| minor heading | 24px / 600; line-height 1.3; text = page text; left aligned; margin 0 |
| paragraph | 16px / 400; line-height 1.6; text = page text; left aligned; margin 0 |
| text field | wrapper: column, gap 8px, width 100%; label: 14px / 500, page text; input: height 44px, padding `0 12px`, white background, `#171717` text, 16px / 400, 1px `#D4D4D4` border, radius 8px, placeholder `#737373` |
| image | block; auto width/height; radius 0; no border; no shadow |
| card | flex column; padding 24px; gap 16px; white background; radius 12px; soft shadow; no border |
| container | flex column; gap 0; padding 0; transparent background; radius 0; no border or shadow |
| navigation bar | flex row; align center; gap 24px; full width; min-height 64px; padding `0 24px`; white background; no border |
| divider | full width; height 1px; background `#E5E5E5`; margin `24px 0`; no border |

All text-bearing kinds use the page font preset. Page text color applies to
headings, paragraphs, and text-field labels. Button text, link text, and input
text have their own defaults.

### A.4 Shadow presets

| Preset | Generated value |
| --- | --- |
| soft | `0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.10)` |
| medium | `0 4px 6px -1px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.10)` |
| strong | `0 10px 15px -3px rgb(0 0 0 / 0.12), 0 4px 6px -4px rgb(0 0 0 / 0.12)` |

### A.5 Statement capability summary

| Family | Supported kinds |
| --- | --- |
| text content | button, link, headings, paragraph |
| typography | button, link, headings, paragraph, text field |
| size, background, margin, visibility | all (divider background: solid or none only) |
| border, corners, shadow, padding | all except divider |
| layout | container, card, navigation bar |
| image statements | image |
| field statements | text field |
| hover effects | all except divider |
| click actions | button, link |
| entrance motion | all |

A statement outside its supported kinds is `KDM3003`.

### A.6 Reserved words

Identifiers cannot use grammar vocabulary, units, font/weight words, or CSS
named colors. The core reserved set is:

```text
a an the page kadam component takes that is by and to of in on over from
it its when clicked hovered turns lifts scales go open new tab loads fades
slides has have no full width height wide tall background gradient goes
left right top bottom border rounded corners fully shadow soft medium strong
text says button heading paragraph link main section minor image shows
description decorative field label placeholder accepts email addresses
passwords numbers required hidden visible light regular semibold bold italic
centered aligned font sans serif monospace padding margin gap between
children arranges row column centers horizontally vertically phones tablets
desktops button card container navigation bar divider
px rem ms s
```

The table above is illustrative: the normative reserved set is the union of
every fixed word in every canonical template, every unit, every font/weight
keyword, every breakpoint, and every CSS named color. The compiler will expose
the exact frozen list as `kadam keywords` when the lexer lands.

---

## Appendix B — Versioning and deferred features

### B.1 Language versioning

Kadam uses `major.minor` language versions. The version appears in
`kadam.json` and optionally at the top of each source file.

- **Patch releases** may fix diagnostics, improve determinism, or change
  generated output in ways that preserve semantics. They do not add syntax.
- **Minor releases** add syntax or behavior. Existing valid files remain valid
  unless a documented security or correctness defect requires otherwise.
- **Major releases** may remove syntax or change semantics.
- Built-in defaults (Appendix A) are part of the language version: changing a
  default shadow, color, size, breakpoint, or transition requires at least a
  minor version bump.
- Before 1.0, drafts may change between minor versions. Source files declare
  `kadam 0.1` so that a future compiler can reject or migrate them explicitly.

Deprecation policy: deprecated syntax produces a warning for at least one
minor version before removal, and diagnostics include the replacement form.
Warnings never block output; errors always do.

### B.2 Deferred features

The following are deliberately outside v0.1. Their presence here is a scope
record, not a promise for a specific release:

- Multiple pages or components per source file.
- Theme files, design tokens, dark mode, and `prefers-color-scheme` behavior.
- Custom breakpoints, container queries, and fluid typography.
- Grid layout, absolute positioning, wrapping, and per-child alignment.
- Custom fonts, font files, line-height and letter-spacing controls.
- Border styles other than solid; per-side borders; per-corner radii.
- Gradient hover interpolation, radial gradients, and more than two stops.
- Image cropping, `object-fit`, loading strategy, and responsive art direction.
- Form submission, validation messages, field values, and state.
- Show/hide/toggle actions and any interactive behavior requiring JavaScript.
- Scroll-triggered, looping, or timeline animations.
- Variables, expressions, conditionals, loops, functions, or data fetching.
- User-authored HTML, CSS, or JavaScript escape hatches.
- Per-slot parameters and fallback content that reads instance parameters.
- Internationalization and localized text catalogs.
- A standard component library and cross-language target adapters.

Items that imply general programming or state must wait for a separate design
decision. Adding them by accretion would undermine deterministic analysis and
the language's readable surface.

### B.3 Conformance

An implementation conforms to this specification when it:

1. Accepts every v0.1 construct defined here with the documented meaning.
2. Rejects every undefined construct with the documented error code class.
3. Produces byte-identical output for identical source and options.
4. Never uses a language model, network service, or probabilistic heuristic to
   interpret source.
5. Emits no output when any error is present.

`examples/hello.kdm` is the smallest smoke fixture. The portfolio project in
`examples/portfolio/` and the canonical example in §16.1, checked in as
`examples/canonical/`, are the full acceptance fixtures. Both compile with zero
diagnostics and deterministic output in M5. The canonical project includes the
`About` page required by its navigation statements.
