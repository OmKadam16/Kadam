# Kadam tooling (F7)

Everything here ships in the `kadam` package and works offline.

## `kadam new`

```bash
kadam new my-site                    # one page to start from
kadam new my-blog --template blog    # from a reference project
kadam new --list                     # minimal, blog, dashboard, docs, marketing, shop, server
```

The templates are the reference projects (`examples/reference/*`) and the
server fixture, built into the package by `scripts/generate-templates.mjs`. A
test fails when they drift apart. `kadam new` writes only into a new or empty
directory and names the project after it.

## `kadam format`

```bash
kadam format                 # every .kdm file under this folder
kadam format pages/home.kdm  # one file
kadam format --check         # change nothing; exit 1 if a file is not formatted (for CI)
```

Only whitespace changes: four spaces per open brace, one space between words
(quoted text and comments stay exactly as written), no space before a comma,
no trailing spaces, at most one blank line in a row and none just inside a
brace, LF line endings, and a final newline. Statement order never changes.
A file with an unclosed brace or quote is left untouched and reported. A test
formats every example project and checks that its build output is byte for
byte the same.

## `kadam explain`

```bash
kadam explain KDM3005        # what a code means and where its rules are
kadam explain 3005 KDM2001   # several at once; KDM is optional
kadam explain                # every code, by area
kadam explain KDM3005 --json
```

## `kadam lsp`

A Language Server Protocol server over stdio, with no dependencies:

- **Diagnostics** from the same compile as `kadam check`, for the whole
  project, using the unsaved text of open files. A component edit updates the
  pages that use it.
- **Completion** of every canonical sentence (the template examples, the
  property table and the kind sentences), filtered by what the line already
  says, plus the project's components after `a `.
- **Hover**: the sentence a line is and its examples, and what any error on
  the line means.
- **Go to definition**: a component name opens its file, `go to page "..."`
  opens that page, a state name goes to its `it remembers` line, and an
  element name goes to its header.
- **Formatting**: the same as `kadam format`.

Any editor with a generic LSP client can use it. For example, in Neovim:

```lua
vim.lsp.start({ name = "kadam", cmd = { "kadam", "lsp" }, root_dir = vim.fs.root(0, { "kadam.json" }) })
```

and in VS Code, any generic LSP extension configured to run `kadam lsp` for
`*.kdm` files.

## In the browser: Alt-click

In `kadam dev`, Alt-click (Option-click on a Mac) any element to see its
name, kind and `file:line:column`, with a button to copy the location and a
link that opens it in VS Code. Elements from a component point into the
component file.
