## In your editor

`kadam lsp` is a language server for any editor that supports one. It shows the same errors as `kadam check` as you type, completes sentences from the closed list, explains the sentence under the cursor, and jumps to components, pages, states and elements.

## In the browser

In `kadam dev`, Alt-click any element to see where it is written, with a link that opens the file at that line.

## In CI

- `kadam check --strict` fails on any escape hatch.
- `kadam format --check` fails on a file that is not formatted.
- `kadam build --fragment` and `--target web-components` make output for other sites and frameworks.
