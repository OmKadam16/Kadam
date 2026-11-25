# Kadam

Kadam is a programming language for building user interfaces in ordinary
English. A `.kdm` file is the source of truth. A deterministic compiler turns
it into plain HTML, CSS, and — only when necessary — JavaScript.

> **Status: milestone M7 — visual editor alpha (M7.1 foundation implemented).**
> The compiler turns one `.kdm` page or a complete `kadam.json` project into
> static HTML, CSS, and copied assets. Components are declared once and expanded
> at compile time into ordinary elements, so no component node reaches the
> output. `kadam dev` compiles in memory, watches pages, components, and assets,
> and pushes reloads and diagnostics to a real browser while preserving the last
> successful preview. `kadam check` validates without writing output. The local
> Studio in `studio/` adds a React + CodeMirror 6 editor, compiled preview,
> diagnostics, click-to-source, and an inspector, all backed by the same
> compiler. v0.1 emits no JavaScript: navigation, hover, and motion are native
> HTML and CSS. No AI or language model is involved, and none will be.

```kdm
page "Home" {

    button1 {
        a button that is 160px by 48px
        has a blue and black gradient
        has a white border
        has rounded corners
        when hovered, the border turns black
        the button text says "Get Started"
    }

}
```

## Why Kadam

UI code is split across markup, styles, behavior, and build tooling. That
split is powerful, but it makes intent hard to read and hard to edit visually.
Kadam explores a different surface: a precise, constrained English that keeps
the whole interface in one readable source file.

The language is deliberately **not** a prompt interface:

- Every sentence must match a documented grammar rule.
- Ambiguous or unknown sentences are compile errors, never guesses.
- The compiler performs no network access and contains no model.
- The same source and compiler version always produce byte-identical output.

## Product direction

Kadam is intended to grow into a complete UI development environment:

- A language, compiler, and deterministic runtime.
- Projects, folders, multiple pages, and reusable components.
- A built-in component library.
- A visual code editor with real-time browser preview.
- Two-way visual editing backed by the `.kdm` source.
- A development server with incremental rebuilds.
- VS Code integration and language tooling.

The foundation, specification, and language front end exist today. The roadmap
sequences the rest; see [`docs/roadmap.md`](docs/roadmap.md).

## Design principles

1. **The `.kdm` file is the source of truth.** Generated files are disposable.
2. **Deterministic first.** No AI, no fuzzy interpretation, no hidden state.
3. **Explicit over clever.** Defaults are documented; conflicts are errors.
4. **Static-first output.** Semantic HTML, separate CSS, JavaScript only when
   an interaction cannot be expressed declaratively.
5. **Accessible by construction.** Required labels and descriptions, visible
   focus styles, and reduced-motion support are compiler concerns.
6. **A real toolchain.** Lexer, parser, AST, semantic analysis, type checking,
   IR, emitters, incremental rebuilds, and a development server — not a
   prompt-to-website converter.
7. **Editor-independent compiler.** The visual editor is a client of the
   language tooling, never a dependency of it.
8. **Boring infrastructure.** TypeScript, Node.js built-ins, no runtime
   dependencies, no framework in generated output.

## How it works

```text
.kdm source + kadam.json
        |
        v
   source manager
        |
        v
      lexer  ->  parser  ->  AST
                              |
                              v
                 semantic analysis + type checking
                              |
                              v
                     normalized IR
                              |
              +---------------+---------------+
              v               v               v
           HTML emitter    CSS emitter     JS emitter
              |               |               |
              +---------------+---------------+
                              |
                              v
                    static project output
```

Incremental compilation and the development server sit around this pipeline;
they do not change language semantics. See
[`docs/architecture.md`](docs/architecture.md).

## Repository map

| Path | Purpose |
| --- | --- |
| `docs/language-spec.md` | Proposed `.kdm` syntax, semantics, defaults, and errors |
| `docs/architecture.md` | Compiler pipeline, module boundaries, incremental design |
| `docs/project-manifest.md` | `kadam.json` schema, routing, assets, output layout |
| `docs/roadmap.md` | Development milestones and exit criteria |
| `docs/decisions.md` | Technical decisions taken, proposed, and still open |
| `examples/` | Target syntax: the M2 smoke fixture and the full portfolio project |
| `src/core/` | Source manager, lexer, parser, AST, diagnostics, semantic analysis (semantics planned) |
| `src/compiler/` | Project loading, IR, HTML/CSS emission, asset copying |
| `src/runtime/` | Reserved for a future stateful runtime; v0.1 emits none |
| `src/server/` | Development server, watcher, SSE, overlay client |
| `src/cli/` | Command-line interface |
| `src/editor/` | Source documents, validated edits, AST outlines and cursor lookup, diagnostic mapping, text/background/border editing with missing-property insertion, undo/redo history, canonical and validated insertion, and atomic saves; consumed by Studio |
| `studio/` | Local Studio host, React/CodeMirror shell, preview proxy, click-to-source bridge, inspector, and host integration tests |
| `test/` | Unit, golden, and invalid-source fixtures |

## Getting started

Requirements: Node.js 22.18 or newer.

```bash
npm install
npm run check
node dist/cli/main.js --version
```

The CLI exposes `build`, `check`, `dev`, and `parse`.

```bash
# Parse one file
node dist/cli/main.js parse examples/hello.kdm

# Build one page
node dist/cli/main.js build examples/hello.kdm --out ./dist

# Build the multi-page example project
node dist/cli/main.js build --project examples/portfolio --out ./dist

# Build the component example project
node dist/cli/main.js build --project examples/components --out ./dist

# Validate without writing anything
node dist/cli/main.js check --project examples/portfolio
node dist/cli/main.js check --project examples/components

# Edit with live reload at http://127.0.0.1:3000/
node dist/cli/main.js dev --project examples/portfolio

# Build and launch the local Studio at http://127.0.0.1:4310/
npm --prefix studio install
npm --prefix studio run build
npm run studio -- examples/portfolio
```

A project is a `kadam.json` manifest plus one `.kdm` file per page, with an
optional list of component source files. Routes are declared in the manifest,
page titles are navigation identities, and referenced images and fonts are
copied into the output. See
[the manifest guide](docs/project-manifest.md) and
[the component architecture](docs/components.md).

## Documentation

- [Language specification](docs/language-spec.md)
- [M6 component architecture](docs/components.md)
- [M5 specification compliance matrix](docs/m5-compliance.md)
- [Studio architecture](docs/studio-architecture.md)
- [Studio package guide](studio/README.md)
- [Compiler architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Decision log](docs/decisions.md)

## Scope discipline

Milestone M6 adds compile-time reusable components: explicit component files,
typed `text`, `page`, `url`, `image`, `length`, and `color` parameters, static
variants, unnamed and named content slots, manifest library namespaces, nested
instantiation, stable component identities, and class-based CSS sharing.
Components expand before lowering, so the language still emits a static site
with no client-side runtime and no component-specific emitter.

The M7.1 Studio foundation adds the visual editor shell. Component
instance/definition navigation, an asset browser, completion and hover,
tabbed buffers, and browser-level acceptance tests remain later work. A
packaged component library is also still future work; stateful actions and
image optimization need their own language decisions.

## License

No license has been selected. This is an open decision (`D-16` in the decision
log) and must be resolved before the repository is published.
