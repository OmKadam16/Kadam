# Kadam Multi-Target Architecture

**Status:** proposed. The current compiler emits static web HTML/CSS only.
**Applies to:** the planned M7 general-purpose core and M8 target adapters.
**Implementation:** none of the target adapters described here are available
yet. This document defines the contract they must meet.

---

## 1. Decision

Kadam is becoming a general-purpose language with a declarative UI subset. It
will remain CLI-first: the compiler, installer, development server, and all
language tooling must work without a browser editor.

The language is **not** made compatible with other ecosystems by loading or
guessing their source. Compatibility is provided by two explicit mechanisms:

1. **Target adapters** that deterministically emit source for a host ecosystem.
2. **Typed external bindings** that let generated code call native packages.

A language, framework, or runtime is supported only when an adapter and its
conformance tests exist. "Compatible with everything" is not a shippable
property.

---

## 2. Why targets must be adapters

Python, Java, Rust, and TypeScript are general-purpose host languages. CSS is a
styling language. React and Next.js are framework/runtime targets. They cannot
share one untyped emitter without creating invalid or unidiomatic output.

The core pipeline therefore stops at a **portable IR** with no target syntax.
Each adapter receives the same semantically validated program and is responsible
for:

- declaring which language capabilities it supports;
- rejecting unsupported programs with explicit diagnostics;
- producing deterministic source and asset files;
- generating typed bindings for external calls;
- passing the shared conformance fixtures.

No adapter may add syntax to `.kdm`, special-case a framework in the parser, or
read files outside the project root.

---

## 3. Planned pipeline

```text
.kdm source
    |
    v
lexer -> parser -> AST
                       |
                       v
             semantic analysis + types
                       |
                       v
                portable core IR
                       |
        +--------------+--------------+
        |              |              |
        v              v              v
 TypeScript/Web     Python         Rust/Java
    adapter          adapter        adapters
        |              |              |
        v              v              v
 generated source + bindings + assets
```

The existing HTML/CSS emitters become the web adapter's backend rather than the
definition of the language.

The portable IR must represent, at minimum:

- values, types, functions, and modules;
- control flow and errors;
- state and effects;
- UI declarations for the declarative subset;
- external declarations and their type signatures;
- source locations for diagnostics and generated-code mapping.

It must not contain HTML tags, CSS property names, Python imports, TypeScript
types, React components, or framework-specific lifecycle concepts.

---

## 4. Adapter contract (proposed)

The exact TypeScript interface will be frozen with the M7 IR. The required shape
is:

```ts
interface TargetAdapter {
  readonly id: string;
  readonly version: string;
  readonly capabilities: ReadonlySet<Capability>;

  validate(program: CoreProgram): readonly Diagnostic[];
  emit(program: CoreProgram, options: EmitOptions): readonly OutputFile[];
}
```

Rules:

- `validate` runs before any output is written.
- `emit` is pure and deterministic for the same program, options, and adapter
  version.
- A capability that is not declared is rejected before emission, never silently
  approximated.
- Adapter versions are recorded in generated metadata and in the CLI's
  `--version` output.
- Adapter-specific tests must execute the generated code with the native
  runtime, not merely compare strings.

### Conformance fixtures

Every target must pass shared fixtures in the repository. A new fixture is added
to the core suite only when its semantics are target-neutral; target-specific
behavior lives in that adapter's suite.

---

## 5. First target set

The first installable multi-target release supports:

| Adapter | Output | Purpose |
| --- | --- | --- |
| `web` | HTML/CSS, optionally TypeScript/React/Next-compatible client output | Frontend and UI |
| `python` | Python modules and package metadata | Backend programs |

CSS remains part of the web adapter. Next.js is a web-adapter mode, not a
separate language target.

Rust and Java adapters follow only after the adapter contract and conformance
suite are stable.

---

## 6. External bindings

Existing native code is called through explicit declarations, not translated
from another language.

A binding declaration must eventually specify:

- a stable local name;
- the target or targets that provide it;
- argument and return types;
- error/effect behavior;
- the native module or symbol.

The exact `.kdm` syntax is not frozen yet. The compiler will not parse Python,
TypeScript, Rust, or Java source, and it will not claim to understand arbitrary
packages without a binding definition.

Bindings must be checked at compile time and tested at runtime. A missing target
implementation is a diagnostic, not a generated stub that fails later.

---

## 7. Installation and CLI

The chosen distribution path is:

```bash
bash install.sh
kadam --version
```

`install.sh` supports a local checkout now and a published npm package through
`KADAM_PACKAGE` later. The adopter-facing command remains `kadam`; target
selection will be added only when the adapters exist.

Planned commands, not yet implemented:

```bash
kadam build --target web
kadam build --target python
kadam check --target python
kadam bindings generate
```

The current CLI accepts no target flag. It builds the static web target.

---

## 8. Compatibility policy

A target is **supported** only when:

1. its adapter implements the frozen contract;
2. it declares a capability set;
3. it passes the shared core conformance fixtures;
4. its generated output is executed in CI with the native runtime;
5. its bindings have positive and negative tests;
6. its limitations are documented.

The support matrix, not the language name, tells users what is actually
available. This prevents a future “supports all languages” claim from becoming
a maintenance and trust failure.

---

## 9. Milestone gates

- **M7:** approve the typed core, portable IR, capability model, and binding
  model. Preserve the current web output.
- **M8:** implement the web and Python adapters, `install.sh`, and executable
  conformance tests.
- **M9:** add Rust/Java adapters and external language tooling.

Do not implement a Python emitter before the portable IR exists. Doing so would
make one target's runtime the accidental definition of the language.
