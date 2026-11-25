# Editor module

The visual editor is a client of the language tooling, not part of the
compiler. It may depend on `core`, the compiler's public API, and the server's
development API. None of those modules may depend on this directory.

Implemented foundation:

- normalized source documents with version, newline, BOM, and dirty tracking;
- exact range-checked source edits with stale-version protection;
- project-validated edits that compile the candidate through `sourceOverrides`;
- page/component AST outlines with stable IDs, nesting, and source spans;
- cursor-offset lookup for the deepest outline node and its ancestor path;
- compiler diagnostics mapped to file-filtered editor offsets and related spans;
- exact element text replacement with escaping and compiler validation;
- background statement replacement for solid, none, and gradient forms;
- border and corner-radius replacement with canonical values;
- snapshot-based undo/redo with fresh document versions;
- canonical statement insertion with inferred body indentation;
- before-children placement for missing border and corner properties;
- compiler-validated insertion that rejects candidates with diagnostics;
- atomic saves with path checks, external-edit conflicts, and newline/BOM
  preservation.

Studio now consumes these services from `studio/src/host` and the CodeMirror
shell in `studio/src/web`. Implemented end to end:

- project bootstrap, source tree, file reads, outline, and inspection;
- click-to-source using spans and generated `data-kdm-id` attributes;
- in-memory source overrides for unsaved preview edits;
- source-preserving text, background, border, and corner patches;
- save, external-change conflicts, and reload-from-disk;
- CodeMirror highlighting from the core lexer and diagnostics as lint markers.

Component instance/definition navigation, the asset browser, completion, hover,
tabbed buffers, and browser-level acceptance tests remain later work.

The source-document and outline modules are pure TypeScript with no filesystem
access. `save.ts` is the editor module that writes source files; it writes a
sibling temporary file, fsyncs it, and renames it over the source. The Studio
host still owns save UX and conflict presentation.
