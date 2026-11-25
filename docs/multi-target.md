# Kadam Multi-Target Architecture

**Status:** implemented for the v0.2 TypeScript and Python core targets. The
v0.1 declarative web compiler still emits static HTML/CSS through its separate
pipeline.
**Applies to:** the M7 general-purpose core and M8 target adapters.
**Implementation:** `src/v02/compile.ts` and the emitters in `src/v02/`. The
v0.2 conformance suite is `test/v02.test.mjs`.
**Core language:** [`docs/language-v0.2.md`](language-v0.2.md).

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

## 3. Pipeline

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

## 4. Adapter contract

The exact TypeScript interface will be frozen with the M7 IR. The required shape
is:

```ts
interface TargetAdapter {
  readonly id: TargetId;
  readonly version: string;
  readonly capabilities: ReadonlySet<string>;

  emit(
    program: IrModule,
    bindings: readonly ExternalBinding[],
  ): OutputFile;
}
```

The compiler orchestrates provider binding and capability validation before
calling `emit`.

Rules:

- Provider and capability checks run before any output is written.
- `emit` is pure and deterministic for the same program, bindings, and adapter
  version.
- A capability that is not declared is rejected before emission, never silently
  approximated.
- Generated output records its target id; adapter versions are exposed by the
  target registry.
- Adapter tests execute the generated code with the native runtime, not merely
  compare strings.

### Conformance fixtures

Every runnable target must pass the shared run fixtures for its declared
capabilities, and every target must pass the shared compile-time diagnostics.
A new fixture is added to the core suite only when its semantics are
target-neutral; target-specific behavior lives in that adapter's suite.

---

## 5. First target set

The implemented v0.2 core targets are:

| Adapter | Output | Purpose |
| --- | --- | --- |
| `typescript` | `main.ts`, Node runtime helpers, external module imports | Core programs on a JavaScript host |
| `python` | `main.py`, standard-library runtime helpers, external module imports | Core programs on a Python host |

The v0.1 `web` path remains HTML/CSS only. Unifying it with the portable core is
still M8 work; it is not exposed as a `--target` value yet. Rust and Java
adapters follow only after the adapter contract and conformance suite are stable.

---

## 6. External bindings

Existing native code is called through explicit declarations, not translated
from another language.

A binding declaration specifies:

- a stable local name;
- the target or targets that provide it;
- argument and return types;
- effect behavior;
- the native module and symbol.

The implemented syntax is `external function ... provided by "target" as
"module#symbol"`, with optional `affects` lines. The compiler does not parse
Python, TypeScript, Rust, or Java source, and it does not claim to understand
arbitrary packages without a binding definition.

Bindings must be checked at compile time and tested at runtime. A missing target
implementation is a diagnostic, not a generated stub that fails later. The
implemented adapters validate provider syntax, require the selected target's
provider, and emit a typed wrapper; native arity and types are the provider's
responsibility because host source is not parsed.

---

## 7. Installation and CLI

The chosen distribution path is:

```bash
bash install.sh
kadam --version
```

`install.sh` supports a local checkout now and a published npm package through
`KADAM_PACKAGE` later. The adopter-facing command remains `kadam`.

Implemented core-target commands:

```bash
kadam build --target typescript
kadam build --target python
kadam check --target python
```

A v0.2 build defaults to the TypeScript target. The v0.1 static-web commands
continue to accept no target flag. `kadam bindings generate` remains planned.

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

- **M7:** complete — typed core, portable IR, capability model, and binding
  model are implemented; current web output is preserved.
- **M8:** in progress — the TypeScript and Python core adapters and executable
  conformance tests are implemented. Web unification and the public packaging
  path remain.
- **M9:** planned — add Rust/Java adapters and external language tooling.

New adapters consume the existing portable IR. They do not add target syntax to
`.kdm` or make one target's runtime the definition of the language.
