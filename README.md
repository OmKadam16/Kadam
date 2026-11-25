# Kadam

Kadam is a deterministic programming language written in constrained English. A
`.kdm` file is the source of truth. The current compiler turns a page or project
into plain HTML and CSS, and compiles a `kadam 0.2` module into TypeScript or
Python through a portable typed core.

> **Status: CLI-first, with the v0.2 core and TypeScript/Python adapters
> implemented.** The browser Studio and its editor infrastructure have been
> removed. The M0–M6 static-web compiler remains unchanged: multi-page projects,
> components, a development server, and deterministic HTML/CSS output all work
> through the `kadam` command. `kadam 0.2` modules are parsed, type-checked,
> lowered to a target-neutral IR, and emitted as runnable `main.ts` or `main.py`
> with capability and external-provider checks. See
> [`docs/language-v0.2.md`](docs/language-v0.2.md).

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

UI and application code are split across markup, styles, behavior, target
languages, and build tooling. Kadam explores a different surface: a precise,
constrained English that keeps intent readable and removes fuzzy interpretation.

The language is deliberately **not** a prompt interface:

- Every sentence must match a documented grammar rule.
- Ambiguous or unknown sentences are compile errors, never guesses.
- The compiler performs no network access and contains no model.
- The same source and compiler version always produce byte-identical output.

## Product direction

Kadam is moving from a frontend-only compiler to a general-purpose language
with a declarative UI subset:

- A typed core with values, functions, state, modules, errors, and effects.
- A target-neutral intermediate representation.
- Explicit target adapters, starting with the TypeScript and Python core targets;
  the existing v0.1 web pipeline remains separate for now.
- Typed `external` declarations for calling native packages.
- A terminal-first installation and workflow: no browser IDE is required.
- Later Rust and Java adapters, plus optional editor tooling.

“Compatible with all languages” is not a compiler switch. Compatibility means
an explicit, tested adapter for each target and typed bindings for existing
code. See [`docs/multi-target.md`](docs/multi-target.md) for the contract,
supported-target plan, and non-goals.

## Design principles

1. **The `.kdm` file is the source of truth.** Generated files are disposable.
2. **Deterministic first.** No AI, no fuzzy interpretation, no hidden state.
3. **Explicit over clever.** Defaults are documented; conflicts are errors.
4. **Targets are adapters.** Core semantics never depend on a framework or host
   language.
5. **CLI-first.** Every compiler feature works from a terminal without a GUI.
6. **A real toolchain.** Lexer, parser, AST, semantic analysis, type checking,
   IR, emitters, and a development server—not a prompt-to-website converter.
7. **Boring infrastructure.** TypeScript, Node.js built-ins, no runtime
   dependencies, and no framework required in generated output.

## Current compiler pipeline

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

The v0.1 web emitter is deterministic and framework-free. The v0.2 core has a
separate pipeline:

```text
kadam 0.2 module -> lexer/parser -> type checker -> portable IR
                                                       |
                                          +------------+------------+
                                          v                         v
                                    TypeScript                   Python
                                     main.ts                    main.py
```

A core module must match its filename (`hello.kdm` contains `module hello`):

```kdm
kadam 0.2

module hello {
    function main takes nothing and returns number {
        output "hello"
        return 0
    }
}
```

```bash
kadam build hello.kdm --target python --out dist
python3 dist/main.py
```

The `--target` values are `typescript` (the default for a v0.2 build) and
`python`. Core capability and external-provider checks run before files are
written. See [`docs/multi-target.md`](docs/multi-target.md) and
[`docs/language-v0.2.md`](docs/language-v0.2.md).

## Install

Requirements: Node.js 22.18 or newer.

From this checkout:

```bash
bash install.sh
kadam --version
```

The installer builds the compiler and installs the global `kadam` command. To
install into a user-owned prefix instead:

```bash
KADAM_PREFIX="$HOME/.local" bash install.sh
```

The npm package can also be installed directly:

```bash
npm install --global .
```

A public one-line `curl` installer will be documented once the package and
installer are published. The installer already accepts `KADAM_PACKAGE` for that
release path. See [`docs/installation.md`](docs/installation.md).

For development without a global install:

```bash
npm install
npm run check
node dist/cli/main.js --version
```

## CLI

The CLI exposes `build`, `check`, `dev`, and `parse`.

```bash
# Parse one file
kadam parse examples/hello.kdm

# Build one page
kadam build examples/hello.kdm --out ./dist

# Build the multi-page example project
kadam build --project examples/portfolio --out ./dist

# Build the component example project
kadam build --project examples/components --out ./dist

# Validate without writing anything
kadam check --project examples/portfolio
kadam check --project examples/components

# Edit with live reload at http://127.0.0.1:3000/
kadam dev --project examples/portfolio
```

A project is a `kadam.json` manifest plus one `.kdm` file per page, with an
optional list of component source files. Routes are declared in the manifest,
page titles are navigation identities, and referenced images and fonts are
copied into the output. See
[the manifest guide](docs/project-manifest.md) and
[the component architecture](docs/components.md).

## Repository map

| Path | Purpose |
| --- | --- |
| `install.sh` | Bash installer for the global `kadam` command |
| `docs/language-spec.md` | Current v0.1 UI syntax, semantics, defaults, and errors |
| `docs/language-v0.2.md` | Implemented typed general-purpose core and conformance cases |
| `docs/multi-target.md` | Target-adapter and native-binding architecture |
| `docs/installation.md` | Local, user-prefix, and future public installation |
| `docs/architecture.md` | Compiler pipeline and module boundaries |
| `docs/project-manifest.md` | `kadam.json` schema, routing, assets, output layout |
| `docs/roadmap.md` | Development milestones and exit criteria |
| `docs/decisions.md` | Technical decisions taken, proposed, and still open |
| `examples/` | Smoke fixtures and the portfolio/component example projects |
| `src/core/` | Source manager, lexer, parser, AST, diagnostics, semantics |
| `src/compiler/` | Project loading, IR, HTML/CSS emission, asset copying |
| `src/v02/` | Core lexer/parser, type checker, portable IR, TypeScript/Python emitters |
| `src/runtime/` | Reserved for a future stateful runtime; v0.1 emits none |
| `src/server/` | Development server, watcher, SSE, overlay client |
| `src/cli/` | Command-line interface and installer entry point |
| `test/` | Unit, golden, and invalid-source fixtures |

## Documentation

- [v0.1 language specification](docs/language-spec.md)
- [v0.2 core specification](docs/language-v0.2.md)
- [Multi-target architecture](docs/multi-target.md)
- [Installation](docs/installation.md)
- [M6 component architecture](docs/components.md)
- [M5 specification compliance matrix](docs/m5-compliance.md)
- [Compiler architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Decision log](docs/decisions.md)

## Scope and limitations

The M0–M6 compiler is complete: static web output, layouts, responsive rules,
motion, components, a development server, and CLI build/check/dev commands.

The v0.2 core and its TypeScript/Python adapters are implemented for single-file
modules. Kadam still does not have cross-file imports, classes, first-class
functions, collection mutation, or Rust/Java targets. The declarative web target
continues to use the separate v0.1 HTML/CSS pipeline; unifying it with the core
remains M8 work. The browser editor has been removed entirely.

The generated web output remains JavaScript-free in v0.1. No AI, model, network
service, or telemetry is involved.

## License

Kadam is licensed under the [Apache License, Version 2.0](LICENSE).
