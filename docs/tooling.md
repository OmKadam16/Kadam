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

## `kadam fix`

The checker never guesses what a sentence means. When something close is in
the vocabulary, an error carries numbered fixes. `kadam fix` shows each
problem and asks which fix to apply; `kadam fix --first` applies fix 1 for
every problem and lists the changes. Without a terminal and without `--first`
it only lists them. The language server offers the same fixes as quick fixes.

## Hover in a paragraph page

In a kadam 0.4 page, hovering a sentence in the editor shows the block
sentences it is built as, so the meaning of every sentence is visible.

## `kadam explain --blocks`

`kadam explain --blocks pages/home.kdm` prints a kadam 0.4 paragraph page in
the block form it is built from (spec section 17).

## `kadam eject`

`kadam eject Card` copies a standard library component (D-46) into the
project's `components/` folder, lists the copy in `kadam.json`, and removes
`from kadam` from its uses, so the project owns it from then on. `kadam explain
Card` describes a library component first; `kadam explain --library` lists
them. See `docs/components.md`.

## `kadam fonts`

Fonts (D-51). 150 free families are built in; `The page font is Lora.` needs no
setup. The catalog lists every free family Fontsource publishes (about 2,100).

```bash
kadam fonts list --category serif
```

```bash
kadam fonts info "Noto Sans JP"
```

```bash
kadam fonts add "Noto Sans JP" --weights 400,700
```

`list` takes `--category`, `--built-in` and `--search`. `add` downloads a
family once into the project's `fonts/<family>/` folder with its licence and a
`font.json`; `--weights` limits a family that is not variable and
`--alphabets latin,devanagari` limits the alphabets. It is the only Kadam
command that uses the network; commit the folder and every build stays offline
and identical. Paid fonts you own go in `fonts/` as files.

Maintainers refresh the catalog and the built-in families (listed in
`library/fonts/built-in.txt`) with `node scripts/bundle-fonts.mjs` after
`npm run build`.

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

## VS Code

`editors/vscode` is the Kadam extension: highlighting, plus everything above
from `kadam lsp`. It has no dependencies (it carries its own small LSP client).

```bash
node scripts/package-vscode.mjs                      # writes editors/vscode/kadam-0.3.0.vsix
code --install-extension editors/vscode/kadam-0.3.0.vsix
```

Publishing it to the Marketplace needs your own publisher account and access
token. Set `publisher` in `editors/vscode/package.json` to your publisher ID,
then run `npx @vscode/vsce publish --packagePath editors/vscode/kadam-0.3.0.vsix`.

## Live reload keeps your place

When `kadam dev` reloads a page after an edit, the page's state (a counter, an
open menu, a selected tab) and the scroll position stay as they were. Only the
development server does this; built pages always start from their declared
values.

## The documentation site

`site/` is the Kadam documentation, written in Kadam: a home page, guide pages
made from `site/data/guides.json` and Markdown in `site/content/`, and two
reference pages, every sentence and every error code, whose data
`scripts/generate-site-data.mjs` writes from the compiler itself.

```bash
kadam dev site
kadam build site --out site/dist
```

## In the browser: Alt-click

In `kadam dev`, Alt-click (Option-click on a Mac) any element to see its
name, kind and `file:line:column`, with a button to copy the location and a
link that opens it in VS Code. Elements from a component point into the
component file.
