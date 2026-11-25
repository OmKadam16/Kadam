# Kadam Language Specification

> This document specifies the implemented **v0.1 UI language**. The separate
> typed general-purpose core is implemented in
> [`language-v0.2.md`](language-v0.2.md) and is selected by the `kadam 0.2`
> header; it does not change this v0.1 surface.

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
- This compiler accepts `0.1` and `0.3`. `0.2` is the general-purpose core
  module language ([language-v0.2.md](language-v0.2.md)), not a UI version.
  `0.3` accepts everything in `0.1` with the same meaning and byte-identical
  output, plus the additions marked *kadam 0.3* in this document.
- A construct introduced after the file's version is rejected with `KDM2013`,
  which names the construct and the version that introduced it.
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

### 6.14 Regular property sentence (*kadam 0.3*)

```kdm
the line height is 1.6
the letter spacing is 1px
```

`the <property> is <value>` sets one property from the closed property table
(decision D-32, `kadam keywords --properties`). The table is the normative
list. Most rows are a regular spelling of an existing sentence and mean exactly
the same thing: same kinds, same defaults, same generated CSS.

| Property | Value | Same as |
| --- | --- | --- |
| `text size` | length | `the text is 18px` |
| `text color` | color | `the text is #171717` |
| `text weight` | `light`, `regular`, `medium`, `semibold`, `bold` | `the text is semibold` |
| `text style` | `italic` | `the text is italic` |
| `text alignment` | `left`, `centered`, `right` | `the text is centered` |
| `font family` | `sans serif`, `serif`, `monospace` | `the font is monospace` |
| `width` | length | `it is 320px wide` |
| `height` | length | `it is 48px tall` |
| `padding` | length (all four sides) | `it has 24px padding` |
| `margin` | length (all four sides) | `it has 16px margin` |
| `gap` | length | `it has 16px gap between children` |
| `background color` | color | `has a #F7F5F0 background` |
| `corner radius` | length | `has 12px rounded corners` |

Two rows exist only in the regular form:

| Property | Value | Applies to | CSS |
| --- | --- | --- | --- |
| `line height` | number from 0.5 to 4 | text-bearing kinds | `line-height` |
| `letter spacing` | length | text-bearing kinds | `letter-spacing` |

- A regular sentence and its equivalent sentence set the same property, so
  writing both in one scope is a duplicate (`KDM3004`).
- Rows that mirror an existing sentence accept component placeholders
  (`"{$tone}"`) wherever that sentence does.

- A name not in the table is not a property sentence; the line is reported as
  an unrecognized statement (`KDM2001`).
- Values are typed: a length where a number is expected, or a number outside
  its bounds, is `KDM3005`.
- A property outside its kinds is `KDM3003`; a second sentence for the same
  property in the same scope is `KDM3004`.
- Property sentences are allowed in responsive scopes (§9).
- On a text field, text properties apply to the input, as typography does.
- In a `kadam 0.1` file the sentence is `KDM2013`.

### 6.15 Frontend elements (*kadam 0.3*)

Every kind, sentence, and behaviour in this section is new in `kadam 0.3`. In a
`kadam 0.1` file each one is `KDM2013`. The new words are contextual, not
reserved, so existing element names such as `list1` or `table` stay valid.

**Kinds**

| Kind phrase | HTML | Category | Required content |
| --- | --- | --- | --- |
| `a small heading` | `h4` | leaf, text | text |
| `a header` / `a footer` | `header` / `footer` | container | none |
| `a section` | `section aria-labelledby` | container | a heading inside it |
| `an article` / `a sidebar` | `article` / `aside` | container | none |
| `a list` / `a numbered list` | `ul` / `ol` | container of list items | none |
| `a list item` | `li` | leaf, text | text; inside a list |
| `a table` | `table` + `caption` | container of rows | a caption and a row |
| `a header row` / `a row` | `tr` in `thead` / `tbody` | container of cells | inside a table; a header row comes first |
| `a cell` | `th scope="col"` in a header row, else `td` | leaf, text | text; inside a row |
| `a video` | `video controls` + `track` | leaf, media | a source, and captions or `it has no speech` |
| `an audio clip` | `audio controls` | leaf, media | a source |
| `an icon` | `img` (24px) | leaf, media | an SVG or PNG source, and a description or `it is decorative` |
| `a code block` | `pre` > `code` | leaf, text | text; whitespace is preserved |
| `a form` | `form method="post"` | container | a destination; no nested forms |
| `a text area` | labelled `textarea` | leaf, form | label |
| `a checkbox` | `input type="checkbox"` + label | leaf, form | label |
| `a dropdown` | labelled `select` | leaf, form | label and at least two options |
| `a radio group` | `fieldset` + `legend` + radios | leaf, form | label and at least two options |

A page-level `header` before the content and `footer` after it are emitted
outside `<main>`. Containers among these kinds accept layout statements (§6.9).

**Sentences**

| Sentence | Applies to |
| --- | --- |
| `the caption says "Plans"` | table |
| `it plays "assets/intro.mp4"` | video (`mp4`, `webm`), audio clip (`mp3`, `ogg`, `wav`, `m4a`) |
| `the captions are "assets/intro.vtt"` | video (`vtt`) |
| `the poster is "assets/poster.jpg"` | video |
| `it has no speech` | video; exclusive with captions |
| `the options are "Small", "Medium", "Large"` | dropdown, radio group; at least two, unique |
| `it is checked` | checkbox |
| `it is disabled` | button and every form control |
| `it is at least 8 characters` / `it is at most 200 characters` | text field, text area |
| `it accepts phone numbers`, `dates`, `times`, `web addresses`, `search terms` | text field |
| `it sends to "https://example.com/subscribe"` | form; absolute http(s) URL |
| `it submits the form` | button inside a form; not combined with a click action |
| `the label says`, `it is required` | every form control |
| `the placeholder says` | text field, text area, dropdown (an unselectable first option) |
| `it shows`, `the description says`, `it is decorative` | image and icon |

In a `kadam 0.3` page every form control is submitted under its element name
(`name="emailField"`).

**Text**

- A `\n` escape in text is a line break (`<br>`).
- Inline spans are one sentence each, after the text they refer to:

```kdm
the text says "Read the guide, it is fast."
the words "guide" go to page "Guide"
the word "fast" is bold
the words "source" open "https://example.com" in a new tab
```

  `word`/`words`, `is`/`are`, `goes`/`go`, and `opens`/`open` are
  interchangeable. The quoted words must appear exactly once in the text, and
  spans cannot overlap. Spans apply to headings, paragraphs, list items, and
  cells.

**Page metadata** (page settings)

```kdm
the page description says "Plans and pricing"
the page language is "fr"
the page icon is "assets/icon.png"
the page share image is "assets/share.png"
```

The language must be a language tag such as `en` or `pt-BR`. A share image
needs the manifest `siteUrl`, which also adds a canonical link, Open Graph
tags, and `sitemap.xml`.

**Outline.** A `kadam 0.3` page has at most one main heading (`KDM3009`).
Skipping a heading level, for example from 1 to 4, is a warning: it is
reported, but the page still builds.

### 6.16 Layout and sizing (*kadam 0.3*)

Everything in this section is new in `kadam 0.3`; in a `kadam 0.1` file each
sentence, and each new unit, is `KDM2013`. The new words are contextual, not
reserved.

**Units.** Lengths may also use `em`, `vw`, `vh`, and `dvh` (written directly
after the number: `80vh`, never `80 vh`). Sizes and size limits also accept a
percentage (`50%`).

**Sizes and shapes**

| Sentence | CSS |
| --- | --- |
| `it is 50% wide` / `it is 50% tall` / `it is 50% by 300px` | `width` / `height` |
| `it is at most 1200px wide` / `it is at least 50vh tall` | `max-width` / `min-height` (and `min-width`, `max-height`) |
| `it is as wide as its content` | `width: fit-content`, for kinds that are full width by default, such as a navigation bar; it is a width, so it conflicts with `it is full width` |
| `it is centered` | `margin-inline: auto`: the box itself sits in the middle of its parent, e.g. a column `at most 720px wide` (*kadam 0.3*). For text, use `the text is centered` |
| `it keeps a 16 by 9 shape` / `it keeps a square shape` | `aspect-ratio: 16 / 9` (whole numbers 1 to 100) |
| `the text is between 1rem and 2.5rem` | `font-size: clamp(...)` |

Fluid text grows linearly from the first size at a 360px viewport to the
second at 1280px (1rem = 16px), and stays inside both sizes beyond that. Both
sizes use px or rem and the first is smaller. It is the text size, so it
clashes with `the text is 18px` in the same scope. It applies to text-bearing
kinds except a text field. `the text size is between ...` is the regular form.

**Rows and columns**

| Sentence | Applies to | CSS |
| --- | --- | --- |
| `it wraps its children` | containers | `flex-wrap: wrap` |
| `it spreads its children apart` | containers | `justify-content: space-between` |
| `it spaces its children evenly` | containers | `justify-content: space-evenly` |
| `it grows to fill the space` | a child of a container | `flex-grow: 1` |
| `it does not shrink` | a child of a container | `flex-shrink: 0` |
| `it sits at the end` | a child of a container | `margin-inline-start: auto` in a row, `margin-block-start: auto` in a column, `justify-self: end` in a grid |
| `it arranges its children in 3 columns` | containers (1 column, or 2 to 12) | `display: grid`, equal columns |
| `it arranges its children in columns at least 240px wide` | containers | as many columns as fit (`auto-fit`, `minmax`) |
| `it spans 2 columns` / `it spans all columns` | a child of a grid | `grid-column` |

A grid replaces the row or column direction, so both in one scope is
`KDM3004`. A grid inside a column stretches to the full width. A responsive
scope may change the column count, or switch back to a row or column, which
turns the grid back into flex. Child rules and spans need a parent element
that arranges its children (`KDM3010`).

`it sits at the end` follows the parent on every breakpoint: when a parent
arranges its children in a row but in a column on phones, the child moves to
the end of the column on phones.

In a parent that arranges its children in a column, a heading or paragraph
with `the text is centered` (or `right`) also centers (or right-aligns) its
own box, so a short line is centered too (*kadam 0.3*).

**Position and layers**

| Sentence | CSS |
| --- | --- |
| `it sticks to the top` / `it sticks 16px from the bottom` | `position: sticky` |
| `it is pinned to the bottom right` / `it is pinned 24px from the top` | `position: fixed` |
| `it is placed over its parent` | `position: absolute; inset: 0` |
| `it is placed at the top right of its parent` / `it is placed 8px from the top right of its parent` | `position: absolute` |
| `the layer is 10` | `z-index` (whole number 0 to 1000; any kind) |

A spot is one edge (`top`, `bottom`, `left`, `right`) or a corner
(`top left`, `bottom right`, ...). One edge stretches along that edge: a bar
pinned to the top spans the width. The parent of a placed element becomes its
positioning box automatically (`position: relative`), and so does an element
with a layer but no position. Sticky, pinned, and placed are one property per
scope. Two elements pinned to the same spot get warning `KDM3038`.

**Overflow and images**

| Sentence | Applies to | Result |
| --- | --- | --- |
| `it scrolls vertically` / `it scrolls horizontally` | any kind | `overflow-y` / `overflow-x: auto`, and `tabindex="0"` so keyboard users can scroll it |
| `it hides overflow` / `it hides its overflow` | any kind | `overflow: hidden` |
| `it fills its box` / `it fits inside its box` | image, video | `object-fit: cover` / `contain` |
| `it keeps the top right in view` / `it keeps the center in view` | image, video | `object-position` |
| `it loads lazily` / `it loads right away` | image | `loading="lazy"` / none |

On a `kadam 0.3` page every image except the first one in the page loads
lazily unless it says `it loads right away`. A code block is always focusable,
because it scrolls sideways.

**Custom breakpoints and container conditions**

```kdm
on wide screens, it arranges its children in 4 columns
when its parent is narrower than 400px, it arranges its children in a column
when its parent is wider than 50rem, it has 32px gap between children
```

- `on <name> screens,` uses a breakpoint from `kadam.json`
  (`"breakpoints": { "wide": 1440 }`) and applies at that viewport width and
  wider (`@media (min-width: 1440px)`). An undefined name is `KDM3005`.
  The built-in `phones`, `tablets`, and `desktops` are unchanged.
- `when its parent is narrower|wider than <width>,` is a container query on the
  parent element (`@container (width < 400px)`). The width uses px, rem, or em.
  The parent gets `container-type: inline-size`, and it fills its slot rather
  than shrinking to its content. A top-level element has no parent element, so
  the condition is `KDM3010` there.
- Both prefixes wrap one ordinary statement and follow the rules of
  responsive scopes (§9). They cannot be nested in each other or in `on phones,`.
- Order in the stylesheet: built-in breakpoints, then custom breakpoints by
  increasing width, then `wider than` conditions by increasing width, then
  `narrower than` conditions by decreasing width, so the more specific rule wins.

### 6.17 Styling, themes, states, and motion (*kadam 0.3*)

Everything here is new in `kadam 0.3`; in a `kadam 0.1` file each sentence,
`rgb()`/`hsl()` color, and `deg` angle is `KDM2013`.

**Colors.** Besides named colors and hex, a color may be `rgb(37, 99, 235)`,
`rgb(37 99 235 / 50%)`, `rgba(...)`, `hsl(220, 83%, 53%)`, or `hsla(...)`. Each
is converted to hex at compile time (`#2563eb`, or `#2563eb80` with alpha).
`the opacity is 50%` sets the opacity of any kind (property table row).

**Borders, corners, outline**

| Sentence | CSS |
| --- | --- |
| `has a 2px dashed red border` / `has a dotted blue border` | `border` plus `border-style` |
| `has a 1px #E5E5E5 border on the bottom` / `on the left and right` | `border-bottom` / `border-left`, `border-right` |
| `has 12px rounded corners on the top` / `on the bottom right` | `border-top-left-radius`, ... |
| `has fully rounded corners on the left` | the same, as a pill |
| `has a 2px blue outline` | `outline` with a 2px offset |

A side border refines a full border, so both may be written. On a form field,
borders, outlines, backgrounds, shadows, and text styles apply to the input;
layout and size apply to the field.

**Backgrounds**

| Sentence | CSS |
| --- | --- |
| `has a blue and white and red gradient` (2 to 8 colors) | `linear-gradient(to bottom, ...)` |
| `has a radial white and blue gradient` | `radial-gradient(circle, ...)` |
| `the gradient goes at 135deg` | the angle of any linear gradient |
| `has a "assets/hero.jpg" background image` | `background-image`, `cover`, centered, no repeat |
| `the background image fits inside its box` / `covers its box` / `repeats` | `background-size`, `background-repeat` |
| `the background image keeps the top in view` | `background-position` |

`the gradient goes from left to right` also applies to a multi-color gradient.
A radial gradient has no direction. An element has a background image or a
gradient, not both; a solid background color may sit under an image.
Background images are copied like other assets.

**Text**

| Sentence | CSS |
| --- | --- |
| `the text is underlined` / `struck through` / `not underlined` | `text-decoration-line` |
| `the text is uppercase` / `lowercase` / `capitalized` | `text-transform` |
| `the text is at most 65 characters wide` (10 to 200) | `max-width: 65ch` |
| `it shows at most 2 lines` (1 to 10) | line clamp; one line is an ellipsis |
| `the font is "Inter"` | a custom font from `kadam.json` |

A custom font must be declared in `kadam.json` `fonts` (a local `.woff2` or
`.woff` file; no remote fonts), or the sentence is `KDM3005`. It applies to
text kinds and to containers, whose text inherits it. The page stylesheet gets
an `@font-face` rule with `font-display: swap`, and the fallback stack is used
while the font loads.

**Shadows and effects**

| Sentence | CSS |
| --- | --- |
| `has a soft blue shadow` (any preset and color) | `box-shadow` |
| `has an inner shadow` / `has an inner strong shadow` | `box-shadow: inset ...` |
| `has a #0000001A shadow that is 24px blurred and 8px down` | a custom shadow (`up`, `left`, `right` too) |
| `it is blurred by 4px` | `filter: blur(4px)` |
| `it blurs the background behind it by 12px` | `backdrop-filter` (with the Safari prefix) |
| `it is rotated by 10deg` / `it is moved 8px down` / `it is scaled to 110%` | `rotate` / `translate` / `scale` |

**Interaction states**

```kdm
when focused, the border turns blue
when pressed, it scales to 102%
when disabled, the background turns gray
when checked, the background turns honeydew
when invalid, the border turns red
when hovered, it rotates by 10deg
```

States use the hover effects (`the background|text|border turns`,
`it lifts by`, `it scales to`) plus `it rotates by`, with an optional
`over <duration>`. `focused` applies to buttons, links, and form controls
(`:focus-visible`; the built-in focus ring always stays); `pressed` to buttons
and links (`:active`); `disabled` to buttons and form controls; `checked` to a
checkbox; `invalid` to a text field, text area, or dropdown (`:user-invalid`,
so the style appears after the user has interacted; Safari 16.5 and later).
A border color effect needs a base border (`KDM3014`). Every transition is
turned off under `prefers-reduced-motion`.

**Motion**

| Sentence | Result |
| --- | --- |
| `it fades in when it scrolls into view` / `it slides in from the left when it scrolls into view` | a scroll-driven entrance behind `@supports (animation-timeline: view())`; browsers without it show the element at once |
| `it spins forever` / `it pulses every 2s` / `it bounces` / `it floats` | a looping animation; keyframes are emitted only on pages that use them |
| `its children fade in one after another` / `slide in from the bottom one after another` | each child enters 100ms after the previous one |

An entrance and a loop are the element's one animation (`KDM3004`). All motion
is turned off under `prefers-reduced-motion`.

**A badge.** `a badge` is a short pill of text (`span`); it requires text.

**Theme colors and dark mode** (decision D-38)

```kdm
the brand color is #4F46E5
in dark mode, the brand color is #818CF8
the page is dark when the system is dark

heroCta {
    a button
    the text says "Start"
    has a brand background
    in dark mode, the text is #111418
}
```

- `the <name> color is <color>` declares a theme color; the name is one
  lower-case word that is not a reserved word or a CSS color name. It is
  usable anywhere a color is, on the lines after the declaration. Page colors
  apply to that page; a project theme file (`"theme": "theme.kdm"` in
  `kadam.json`, holding a `theme { ... }` block of theme colors) applies to
  every page and component, and a page color with the same name replaces it.
- Theme colors are CSS custom properties (`--kdm-color-brand` on `:root`).
- `in dark mode, ...` wraps one statement, like `on phones,`, and applies under
  `@media (prefers-color-scheme: dark)`. It also accepts the page background,
  the page text, and theme colors. It cannot be nested with other scopes.
- `the page is dark when the system is dark` turns on dark versions of Kadam's
  own default colors (page, text, cards, navigation bars, fields, code blocks,
  dividers, cells, badges, links) and `color-scheme: light dark`. Colors the
  author wrote are not changed; override them with `in dark mode,`.

**Contrast** (decision D-39). For every element with text whose color and
background are known at compile time (through ancestors, the page, theme
colors, and in dark mode when the page uses it), the compiler checks WCAG
2.2 AA: 4.5:1, or 3:1 for text 24px and up or bold text 18.66px and up. A
failure is warning `KDM3039`; it never blocks a build. Gradients, background
images, semi-transparent colors, and opacity are not guessed at.

### 6.18 Native interactions (*kadam 0.3*, F4 step 1)

These need no JavaScript; the page stays script-free.

| Sentence | Applies to | HTML |
| --- | --- | --- |
| `when clicked, go to "features"` | button, link, card, container | `href="#<page>-features"`; the named element on this page gets that `id` |
| `when clicked, send an email to "hello@acme.com"` | same | `mailto:` |
| `when clicked, call "+1 555 0100"` | same | `tel:` (spaces and punctuation removed) |
| `when clicked, download "assets/guide.pdf"` | same | `href` plus `download`; the file is copied (images, `pdf`, `zip`, `csv`, `txt`) |
| `when clicked, go to page "Pricing"` | card, container (new in 0.3) | the whole card is one link |

- A clickable card or container cannot contain buttons, links, form controls,
  media, or other clickable elements (`KDM3010`), because a link inside a link
  is invalid HTML.
- An in-page link names an element on the same page (`KDM3012` otherwise).

**Expandable sections**

```kdm
faqFree {
    an expandable section
    the title says "Is Kadam free?"
    it starts open
    faqFreeAnswer {
        a paragraph
        the text says "Yes."
    }
}
```

`an expandable section` is `details` and `summary`: it opens and closes with
the mouse, Enter, or Space. It requires a title (`KDM3009`) and starts closed
unless `it starts open`. Its children are stacked with a 12px gap; layout
statements do not apply to it.

**Field errors.** `the error says "Enter a valid email address"` on a text
field, text area, or dropdown adds the message after the control, linked with
`aria-describedby`. It is shown once the user has edited the field and it is
invalid (`:user-invalid`; Safari 16.5 and later), and hidden otherwise.

### 6.19 State, events, and dialogs (*kadam 0.3*, F4 step 2, D-36)

A page that uses anything in this section gets a small script written for it,
`assets/kadam.<page>.js`, loaded with `<script type="module">`. Pages that use
none of it ship no JavaScript.

**State** belongs to the element that declares it:

```kdm
it remembers isOpen, a boolean that starts as false
it remembers count, a number that starts as 0
it remembers plan, a text that starts as "monthly"
```

A name starts with a lowercase letter. Another element refers to it as `isOpen`
when only one element on the page remembers `isOpen`, or as `isOpen of menu1`
otherwise. Its own element and that element's children can always say just
`isOpen`.

**Events and effects.** One event line holds one or more effects joined by
`and`:

```kdm
when clicked, flip isOpen
when clicked, show "promo1" and focus "emailField"
when the Escape key is pressed, set isOpen to false
```

| Effect | Meaning |
| --- | --- |
| `show "name"`, `hide "name"`, `flip "name"` | show, hide, or flip an element (`it starts hidden` hides it at first) |
| `it is hidden`, `it is shown` | the same for the element itself |
| `set count to 0`, `set plan of form1 to "yearly"` | set a state |
| `flip isOpen` | flip a true-or-false state |
| `add 1 to count`, `subtract 1 from count` | change a number state |
| `open dialog "name"` | open a dialog as a modal |
| `close the dialog` | close the dialog the button is in |
| `focus "name"` | move keyboard focus to an element |

- `when clicked,` with effects applies to a button (`KDM3003` otherwise); links
  and cards go somewhere instead (§6.18).
- `when the Escape key is pressed,` and `when the Enter key is pressed,` apply
  to any element and fire while keyboard focus is in it or one of its
  children.

**Bindings** follow state:

```kdm
it is hidden unless isOpen is true
on phones, it is hidden unless isOpen is true
the text shows count
```

`on phones, it is hidden unless ...` controls the element on phones only; on
other screens it is shown. Bound text is a polite live region, so a screen
reader announces the change.

**Dialogs.** `a dialog` is the native `dialog` element, opened with
`showModal()`: the rest of the page cannot be reached while it is open, Escape
closes it, and focus returns to the button that opened it. It needs a heading
inside it, which names it (`KDM3009`). It is a raised panel with 24px padding
and 16px between children, at most 560px wide.

**Checks.** Every name is resolved at compile time:

- an unknown element or state, or a state name two elements share without
  `of`: `KDM3012`;
- a value of the wrong type (`flip count` on a number, `set isOpen to "yes"`):
  `KDM3005`;
- `open dialog` naming something that is not a dialog, or `close the dialog`
  outside a dialog: `KDM3012`;
- an element both bound to a state (`it is hidden unless`) and shown or hidden
  by effects, or always hidden (`it is hidden`) but shown by an effect:
  `KDM3005`.

**Output.** The page HTML is complete and shows the starting state: hidden
elements carry `data-kdm-hidden` (or `data-kdm-hidden-phones` and so on), and
bound text holds the starting value. The script finds elements by
`data-kdm-id`, adds `aria-expanded` and `aria-controls` to buttons that show
and hide something, and uses no `eval`, `new Function`, inline handlers, or
`innerHTML`, so `Content-Security-Policy: script-src 'self'` works. With
JavaScript off, a `noscript` stylesheet shows everything the script would
hide and puts dialogs in the page.

---

### 6.20 Data lists (*kadam 0.3*, F5 step 1, D-40)

A project can declare JSON data files in `kadam.json`:

```json
"data": { "projects": "data/projects.json" }
```

Each file is an array of flat records whose fields are text, numbers, or
true/false:

```json
[
  { "title": "PaperRepro", "tag": "Research tools", "picture": "assets/paperrepro.svg" },
  { "title": "RenoLens", "tag": "Multi-agent AI" }
]
```

A page repeats a component once per record:

```kdm
project {
    a ProjectCard for each project in projects
    with a title of the title of project
    with a tag of the tag of project
    with a picture of the picture of project
}
```

- The kind sentence ends with `for each <record> in <data>`. A variant may come
  first: `a ProjectCard in the linked variant for each project in projects`.
- `with a <parameter> of the <field> of <record>` reads a field. Quoted
  bindings (`with a badge of "New"`) still work and are the same for every
  record.
- The instances are named `project1`, `project2`, … in file order, and each is
  checked exactly like a hand-written instance. A field that is missing or
  `null` leaves the parameter to its default.
- The output is static HTML. Data lists never add a runtime.

**Filtering, sorting, and limits.** Lines after the kind sentence shape the
list. They apply in this order: filters, then the sort, then the limit.

```kdm
project {
    a ProjectCard for each project in projects
    only where the featured of project is true
    only where the status of project is not "archived"
    sorted by the year of project from highest to lowest
    showing at most 3
    with a title of the title of project
}
```

- `only where the <field> of <record> is [not] <value>`: the value is quoted
  text, a number, or `true`/`false`, and must match the field's type. Several
  lines must all hold. A record without the field never `is` a value, and
  always `is not` one.
- `sorted by the <field> of <record>` sorts lowest first (A to Z for text);
  add `from highest to lowest` to reverse it. The sort is stable, and records
  without the field go last. Text is compared by character code, so the order
  never depends on the machine's locale.
- `showing at most <n>` keeps the first n records (1 to 1000).
- A list has at most one sorted by line and one showing at most line
  (`KDM3040`). These lines outside a data list are `KDM3041`.

Two lists over the same file can give some records a different variant:
`only where the linked of project is true` in one, and `... is not true` in
the other.

**Errors.** An unknown data name (`KDM3042`); an unknown field, the wrong
record name, or a true/false field used as a value (`KDM3043`); a generated
name that is already used (`KDM3044`); a field read outside a data list or
inside a component (`KDM3041`); a built-in kind or child elements on a repeated
instance (`KDM3040`); a data file that is not valid JSON, not an array, over
1000 records, or that mixes types in one field (`KDM4010`).

---

### 6.21 Pages made from data (*kadam 0.3*, F5 step 3, D-40)

A page can be made once per record. The header names the data, and any quoted
text reads a field with `{the <field> of <record>}`:

```kdm
page "{the title of post}" for each post in posts {
    headline {
        a main heading
        the text says "{the title of post}"
    }
    body1 {
        a paragraph
        the text says "{the body of post}"
    }
}
```

The route in `kadam.json` takes its value from a field with a `:field`
segment:

```json
{ "source": "pages/post.kdm", "route": "/posts/:slug" }
```

- Each record becomes an ordinary page, checked like a hand-written one. Its
  title comes from the record, so other pages link to it by that title:
  `when clicked, go to page "Hello world"`, or `with a target of the title of
  post` in a data list.
- Every field the page reads must exist (`KDM3043`, with suggestions), and every
  record must have it (`KDM3043` names the record). A route value may contain
  only letters, digits, `.`, `_`, `~`, and `-`.
- The route needs at least one `:field` segment (`KDM3044`). Two records that
  make the same route are `KDM4005`; two with the same title are `KDM3011`.
- `{the ... of ...}` on a page that is not made for each record is `KDM3041`,
  and so is a `:field` route on such a page (`KDM3044`).

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
- `it scales to <percentage>` accepts 100%–200% in `kadam 0.1`, and
  50%–200% in `kadam 0.3`, where hover and press may shrink an element
  (`when pressed, it scales to 97%`).
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
- `it scales to` accepts 100%–200% (50%–200% in `kadam 0.3`).
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
| KDM2012 | A source file contains more than one page or component |
| KDM2013 | Construct requires a newer language version (*kadam 0.3*) |

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
| KDM3012 | Invalid event target (or an in-page link to a missing element) |
| KDM3013 | Statement is not allowed in a responsive scope |
| KDM3014 | Hover border color requires a base border |
| KDM3015 | Hover background color is invalid on a gradient |
| KDM3038 | Warning: two elements are pinned to the same spot (*kadam 0.3*) |
| KDM3039 | Warning: text contrast is below WCAG AA (*kadam 0.3*, D-39) |
| KDM3040 | Only a component can repeat for each record, and it cannot have child elements yet (*kadam 0.3*) |
| KDM3041 | A record field is read outside a data list, or a data list is inside a component (*kadam 0.3*) |
| KDM3042 | Unknown data name, or a data list in a single-file build (*kadam 0.3*) |
| KDM3043 | Unknown field, wrong record name, a true/false field used as a value, or a filter value of the wrong type (*kadam 0.3*) |
| KDM3044 | A data list makes an element name that is already used (*kadam 0.3*) |

**Project (`KDM4xxx`)**

| Code | Meaning |
| --- | --- |
| KDM4001 | Missing or invalid `kadam.json` |
| KDM4002 | Page file is missing or unreadable |
| KDM4003 | Asset is missing, outside the project root, or unsupported |
| KDM4004 | Language version mismatch or unsupported version |
| KDM4005 | Duplicate route |
| KDM4006 | Project declares no pages |
| KDM4010 | Data file is missing, not valid JSON, or not an array of flat records with one type per field (*kadam 0.3*) |

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
| regular properties (*kadam 0.3*) | per row of the property table (§6.14) |
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
the exact frozen list with `kadam keywords` (`--colors` for named colors,
`--all` for every group, `--json` for tooling).

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
