# Kadam Studio

Kadam Studio is a local browser application for editing Kadam projects. It is a
client of the compiler and development server, not a second implementation of
the language. `.kdm` files remain the source of truth, and the preview is the
compiler's real HTML/CSS.

Status: **M7.1 foundation implemented.** The shell, host APIs, CodeMirror
adapter, preview bridge, page click-to-source, a focused inspector, and a
Figma-style Layers tree with drag-to-reorder nesting and plain-English styling
edits are working. Later M7 slices remain listed at the end of this file.

## Architecture

```text
studio/src/
  host/        loopback Node host, project session, preview proxy
  shared/      JSON request/response contract
  web/         React shell
    components/ explorer, layers, editor, preview, inspector, diagnostics
    language/  CodeMirror highlighting and lint adapters
  test/        Node host integration tests
```

The host imports the compiler through the public `kadam` package. The browser
imports only `kadam/dist/browser.js`, which exports the Node-free lexer and
source modules. The compiler never imports Studio.

The preview is served through a reverse proxy:

```text
/                  Studio browser shell
/__studio/*        Studio host APIs and the dev-only preview bridge
/__preview/*       existing dev server, mounted at basePath /__preview
/__kadam/*         existing dev status, SSE, studio map, and client assets
```

The proxy rewrites the upstream `Host` header, preserves SSE streaming, adds
`frame-ancestors 'self'`, and injects `/__studio/preview-bridge.js` into preview
HTML. The bridge is development-only and is never emitted by the compiler.

## Commands

Run from the repository root:

```bash
npm --prefix studio install
npm --prefix studio run build
npm run studio -- examples/portfolio
```

The root script runs the built host with the repository root as its working
directory, so example paths are root-relative:

```bash
node studio/dist/host/main.js examples/portfolio
```

Studio prints its URL (default `http://127.0.0.1:4310/`).

Other commands:

```bash
npm --prefix studio run typecheck   # compiler build + both TypeScript targets
npm --prefix studio test            # build + 9 host integration tests
npm --prefix studio run check       # typecheck + test
```

The default project argument is the current working directory. Options:

```text
--port <number>    Studio port (default 4310)
--host <address>   Bind address (default 127.0.0.1)
--strict-port      Fail instead of trying the next port
--open             Open the Studio URL in the default browser
--help
```

## Host APIs

```text
GET  /__studio/bootstrap
GET  /__studio/tree
GET  /__studio/status
GET  /__studio/file?path=...
GET  /__studio/outline?path=...
GET  /__studio/inspect?path=...&targetId=...|offset=...
POST /__studio/check
POST /__studio/edit
POST /__studio/property
POST /__studio/style
POST /__studio/layer
POST /__studio/save
POST /__studio/reload
```

Source edits are exact UTF-16 patches with `baseVersion` and `originalText`
preconditions. The host applies the candidate through `compileProject` with
`sourceOverrides`; an invalid candidate is rejected and never replaces the
accepted document. Unsaved dirty buffers are the only source overlay used by
the preview. Save is atomic, checks for external edits, and returns the disk
text on conflict instead of overwriting it.

Inspector property edits cover element text, background, border, and corners.
Background, border, and corner controls insert a canonical statement when the
selected element has none; every edit is compiled before it is accepted. The
style endpoint applies one typed selector and canonical Kadam statement for
typography, font family, size, spacing, layout, shadow, visibility, hover,
motion, and gradient direction. A null statement removes matching declarations.

## Preview controls

The workspace uses three columns: project files and the Layers tree on the left,
the editor and diagnostics in the middle, and the compiled preview with the
plain-English bar and inspector on the right. Below 940px, the preview moves to
a full-width top row above the files and editor; the right sidebar and divider
are hidden.

- Drag the vertical divider between the editor and preview to change the
  preview width. The handle also accepts Left and Right arrow keys, and the
  chosen width is stored locally.
- The preview opens at 100% so source text is immediately readable. `Fit`
  scales it to the available width without resizing the page's actual CSS
  viewport.
- `−` and `+` zoom from 25% to 150% and show the current percentage.
- `Select` mode turns a click on a generated `[data-kdm-id]` element into a
  source selection. Studio opens the owning file, selects the element name,
  and paints the element's full source block yellow with an amber left gutter.
- The Layers tree mirrors the active file's outline. Selecting a row selects
  the element in the preview and inspector. Add creates a uniquely named layer.
  Drag a layer onto the top or bottom edge of another to place it before or
  after, or onto the middle of a container to nest it inside. The arrow controls
  remain as a keyboard/click alternative for sibling order, and the delete
  control removes a layer after confirmation. Every operation is compiled first
  and rejected if the resulting source is invalid.
- Selecting a layer or editing an inspector property applies the same block
  highlight. Editing, reloading, or changing builds clears stale ranges.

## Plain-English edits

The right sidebar accepts a local, deterministic command grammar. It does not
call a model, network service, or `kadam` source interpreter. The parser maps
phrases to the same inspected, compiler-validated operations used by the
Inspector and Layers controls. Every emitted statement is canonical Kadam, and
a command that cannot compile leaves the source and preview unchanged. Hover
commands accept “when hovered,” “on hover,” or “while hovered.”

Choose **Commands** in the panel header to open a searchable reference of the
supported command types. Search by category, property, alias, or example, then
click an example to place it in the command bar for review before applying it.
The reference is local UI data and does not bypass parser or compiler
validation.

Supported commands cover the visual properties Kadam exposes:

- **Text and typography:** text color (every CSS color name or hex), size in
  `px`/`rem`, weight, italic, left/center/right alignment, and the three font
  family presets.
- **Backgrounds and gradients:** solid colors, transparent/none, two-color
  gradients, and gradient direction.
- **Borders and corners:** solid border width/color or removal, plus corner
  radius, default corners, and fully rounded/pill corners.
- **Shadows:** soft, medium, strong, or none.
- **Size and spacing:** full width/height, width, height, both dimensions,
  padding/margin on all sides or a supported pair, and child gaps.
- **Layout:** row/column direction, center children on both axes or one axis.
- **Hover:** background/text/border color, lift, or scale, with an optional
  duration.
- **Motion:** fade-in or slide-in entrance animations, with an optional
  duration, and removal.
- **Visibility:** hide or show the selected layer.
- **Layers:** add, move up/down, delete, and select by name.

```text
make the text #2563EB
set the font to sans-serif
make it bold
center the heading text
add a 2px solid blue border
make the corners 12px
add a medium shadow
add 16px padding on the left and right
arrange children in a row
add 16px gap between children
align children center
when hovered, make the background black over 200ms
when hovered, lift it by 4px
fade it in over 300ms
slide it in from the left
remove all animations
add a heading saying Hello
move this down
select hero
```

Style edits apply to the selected element. Add targets the selected container,
or the page root when the selection is a leaf. Move and delete target the
selected layer. `select` matches a layer by its name or humanized label.

Kadam has a deliberately smaller surface than Tailwind or raw CSS. Unsupported
ideas such as dashed borders, arbitrary keyframes, transforms, filters, and
freeform utility classes are rejected with an explanation rather than silently
approximated. The compiler remains the final authority.

## Security model

- The host binds to loopback by default and validates the `Host` header.
- Mutating endpoints reject foreign `Origin` headers.
- Source paths must be project-relative `.kdm` files, inside the project root,
  regular files, and not symlink escapes. The explorer skips symlinks.
- Request bodies are capped at 2 MiB and must be JSON objects.
- Preview content is treated as untrusted. The bridge accepts only a narrow
  click/select message and validates `event.source` and `event.origin`.
- No arbitrary shell command, dynamic import, environment file, source tree
  proxy, or production Studio asset is exposed.

A per-launch session nonce and `Sec-Fetch-Site` checks remain hardening work.

## Current limitations

- One open editor buffer at a time; tabs are not implemented.
- Component instance/definition navigation and the component browser are not
  implemented. The explorer lists component files.
- Asset browsing, project creation, settings, and build-to-disk are not
  implemented in Studio.
- Completion, hover, folding, search/replace, and multi-cursor are not wired.
- No automated browser acceptance suite is installed. The current suite is
  Node host integration tests; the React shell has only been inspected
  manually.
- The browser bundle is roughly 680 kB uncompressed (214 kB gzip); code
  splitting is a later optimization.
- Preview device sizes are true viewport sizes. The frame is scaled visually;
  the page itself is never reflowed to the dock size.
- Component instance/definition navigation is not available yet. Clicking an
  expanded component element selects its page source location.
