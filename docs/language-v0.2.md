# Kadam v0.2 Core Language Specification

**Status:** Implemented for the `kadam 0.2` core, portable IR, and TypeScript and
Python target adapters. The v0.1 page/component language remains a separate
executable surface and is unchanged.
**Applies to:** the M7 core and M8 target adapters.
**Companion documents:** `docs/language-spec.md` (v0.1 UI),
`docs/multi-target.md` (target contract), `docs/roadmap.md`.
**Review gate:** the syntax and capability model were approved as D-30 and D-31.
Further changes to the points in §12.1 require a new decision record.

---

## 1. Purpose

Kadam v0.2 adds a small general-purpose core alongside the declarative UI
subset. The core is deliberately smaller than Python, TypeScript, Rust, or Java:
it exists to prove that one typed program can be lowered to a target-neutral IR
and emitted correctly for multiple hosts.

The core is not an attempt to reproduce every feature of a host language. A
host feature is supported only when its semantics can be defined here and
verified in every target adapter.

### 1.1 Surface style

The UI subset remains constrained English. Core code uses:

- English declaration and statement keywords;
- braces and one statement per line, matching the existing source model;
- conventional expression operators and calls, so precedence is unambiguous;
- explicit types at module boundaries and inferred local types where safe.

This split is intentional. Declarative UI properties read well as prose, while
nested general-purpose expressions need explicit operators.

### 1.2 Non-goals for v0.2

- Imports, multiple modules per compilation, and package linking.
- Classes, interfaces, inheritance, generics, traits, or first-class functions.
- Async/await, concurrency, exceptions, or user-defined error handling.
- Browser APIs, network access, clocks, randomness, or environment access
  without an `external` declaration.
- Mutable lists or record field assignment.
- Embedding general-purpose code inside `page` or `component` files.
- JavaScript/TypeScript/Python syntax or runtime types in the core IR.

---

## 2. Files and compilation units

A v0.2 file is UTF-8 `.kdm` source with normalized LF handling, optional BOM,
and CRLF accepted on input.

```text
kadam 0.2

module greeting {
    ...
}
```

Rules:

1. The first non-blank, non-comment line must be exactly `kadam 0.2`.
2. A file contains exactly one `module` declaration.
3. The file stem must equal the module name: `greeting.kdm` contains
   `module greeting`.
4. A module file contains only `record`, `function`, and `external function`
   declarations inside the module block.
5. A module file cannot contain `page` or `component` declarations.
6. A page/component file cannot contain a `module` declaration.
7. Imports are not part of v0.2. A module is a single-file compilation unit.
8. The compiler produces no output if any declaration fails validation.

The existing `kadam.json` manifest remains a UI-project manifest in v0.2. Core
modules are compiled one file at a time with `kadam build <file> --target
<typescript|python>` or `kadam check <file> --target <id>`; project-level module
integration remains M8 work.

### 2.1 Lexical rules

- UTF-8 source, one statement per line.
- Indentation is cosmetic.
- `//` starts a comment. Blank lines are ignored.
- Strings use double quotes and the v0.1 escape rules.
- Number literals are `digits [ "." digits ] [ ("e" | "E") ["+" | "-"] digits ]`.
  There is no hexadecimal, binary, underscore, leading sign, NaN, or infinity
  literal. A literal is decoded to the nearest binary64 value; a literal that
  is not finite is `KDM5002`.
- Identifiers are ASCII. Values, functions, modules, fields, and parameters use
  lowerCamelCase. Record type names use PascalCase.
- Keywords are case-insensitive. Identifiers are case-sensitive.
- There are no semicolons and no trailing-period statements in the core.
- Expressions must fit on one line. Multi-line expressions are deferred.
- Braces follow the existing block convention: opening brace at the end of a
  declaration/control line, closing brace on its own line.

The lexer must preserve every token span. Comments are not semantic, but must
not be lost by later source-editing tooling.

---

## 3. Types and values

### 3.1 Primitive types

| Type | Values | Rules |
| --- | --- | --- |
| `text` | Unicode text | Immutable. `+` concatenates. No indexing. |
| `number` | Finite IEEE-754 binary64 | Decimal literals; no NaN or infinity. |
| `boolean` | `true`, `false` | Conditions require this type explicitly. |
| `nothing` | No value | Return type only; cannot be stored or passed. |

There is no `null`, `undefined`, truthiness, implicit conversion, or numeric
suffix. A number that becomes non-finite at runtime is a runtime failure. Text
equality compares Unicode code-point sequences exactly; no normalization or
locale collation is applied.

### 3.2 Lists

`list of T` is a homogeneous, immutable sequence. `T` may be any core type
except `nothing`, including another list or a record.

- Literal: `[1, 2, 3]`.
- Empty literal: `[]`. It requires an expected type from a parameter, field,
  return, or a local type annotation.
- Index: `values[0]`, zero-based. The index must be an integer-valued number in
  `[0, length - 1]`; otherwise the program fails at runtime.
- `length(values)` is an intrinsic returning the number of elements.
- Lists are compared only through their elements or explicit functions; `==` is
  not defined for lists in v0.2.
- Appending, removal, and element assignment are deferred.

### 3.3 Records

Records are nominal types declared in the module:

```kdm
record Person {
    name as text
    age as number
}
```

- Field names are unique, lowerCamelCase, and immutable.
- Record types may not be recursive, directly or indirectly. Recursive data
  structures are deferred.
- Construction uses the type name:

```kdm
let person be Person { name: "Kadam", age: 1 }
```

- Every field must be supplied exactly once. Missing, unknown, duplicate, and
  mistyped fields are compile errors.
- Field access uses `person.name`.
- Record equality and record update are not part of v0.2.
- Record declarations may appear in any order; the module scope is complete
  before type checking.

### 3.4 Local type annotations

Locals may infer their type from the initializer:

```kdm
let title be "Kadam"
var count be 0
let person be Person { name: "Kadam", age: 1 }
```

An optional annotation resolves empty lists and documents intent:

```kdm
let names as list of text be []
```

The annotation must exactly match the initializer's type when the initializer
determines one. It is the only way to give an empty list a type at a local
binding. Parameters, return types, record fields, and external signatures
always require annotations.

---

## 4. Declarations

### 4.1 Module

```kdm
module greeting {
}
```

The module name must match the file stem. Module names are unique within a
compilation. There is no module-level mutable state in v0.2.

### 4.2 Functions

```kdm
function greet takes person as Person and returns text {
    return "Hello, " + person.name
}
```

The grammar is:

```text
function <name> takes nothing and returns <type> {
function <name> takes <param> as <type> and <param> as <type> and returns <type> {
```

Rules:

- Function names are unique and lowerCamelCase.
- Parameters are unique lowerCamelCase names and immutable bindings. `set` may
  target only `var` locals.
- Local and parameter names may not shadow a module-level function or
  external-function name.
- Functions are visible throughout the module, so recursion and mutual
  recursion are allowed.
- No overloading, default parameters, variadic parameters, closures, or generic
  user functions.
- A non-`nothing` function must return a value on every reachable path.
- A `nothing` function may omit a final return and may use `return` alone.
- A module may declare at most one `main` entry point. `main` must be declared
  with `function`, not `external function`.
- `main` takes nothing and returns `number`; every other signature for `main`
  is a compile error.
- A module without `main` is a library and can be type-checked/emitted but not
  run as a program.

Calls use ordinary parentheses:

```kdm
greet(person)
length(names)
```

Arguments are evaluated left to right and must match the parameter types
exactly. A function that returns `nothing` can only be called as a standalone
statement; its result cannot be stored.

### 4.3 External functions

An external declaration binds a typed Kadam signature to one or more target
providers:

```kdm
external function getEnv takes name as text and returns text {
    provided by "target-id" as "native.symbol"
    affects env.read
}
```

Rules:

- `provided by` may appear one or more times. The target identifier and native
  symbol are non-empty opaque strings interpreted by that target adapter.
- A target identifier may not occur twice in one declaration.
- `affects` may appear zero or more times. Effect names must be unique within a
  declaration. With no `affects`, the function is pure from the core's
  perspective.
- The Kadam signature is authoritative. The target adapter must verify that its
  native provider matches the arity and types.
- If a target is asked to emit a module containing an external function it does
  not provide, compilation fails with `KDM5008`.
- Provider strings are metadata, never evaluated by the core compiler.
- External functions have no Kadam body and cannot be redefined by a function
  or another external declaration.

The implemented provider convention is `module#symbol` for both core targets.
The TypeScript adapter treats the module as an import specifier (include a
`.ts` extension for a local TypeScript module) and the symbol as a named export.
The Python adapter treats the module as a dotted import path and the symbol as a
named import. Both adapters reject malformed providers with `KDM5014`. Because
the compiler does not parse host source, it cannot inspect the native arity or
types; the generated Kadam-side wrapper fixes the signature, and the provider
must honor it at runtime.

### 4.4 Built-in operations

The core provides three intrinsics:

| Operation | Signature | Effect |
| --- | --- | --- |
| `readText` | `(path: text) -> text` | `io.file.read` |
| `writeText` | `(path: text, contents: text) -> nothing` | `io.file.write` |
| `length` | `(values: list of T) -> number` | none |

`readText` reads the whole file and decodes it as UTF-8; `writeText` replaces
the file contents and encodes them as UTF-8. Invalid UTF-8, a missing file, or a
failed write is a runtime failure. Neither operation appends.

`output` is a statement, not a value-producing function. Its effect is
`io.output`. Every runnable core target must support `io.output`; a target
without it is compile-only.

These names are reserved and cannot be used as module, record, function, field,
parameter, or local names. Runtime I/O is not sandboxed by the language;
targets may enforce additional host policy, but a target that cannot implement
the effect must reject the module.

---

## 5. Statements

### 5.1 Local bindings

```kdm
let name be expression
let name as type be expression
var name be expression
var name as type be expression
```

- `let` bindings are immutable.
- `var` bindings are mutable with `set`.
- The initializer is mandatory.
- `set name to expression` requires an existing `var`; the new value must have
  the same type.
- Locals are block-scoped and enter scope at their declaration. A reference
  before the declaration is unknown, not hoisted.
- A local name may not shadow any enclosing local or parameter in the same
  function. Duplicate local names are compile errors.
- Initializers are mandatory, so a local is initialized when its declaration
  executes. There is no uninitialized local form.

### 5.2 Conditional

```kdm
if count > 2 {
    output "ready"
} otherwise {
    output "waiting"
}
```

- The condition must be exactly `boolean`.
- `otherwise` is optional.
- `otherwise` must follow the closing brace of its `if`.
- There is no `otherwise if`; nest another `if`.
- No truthiness or implicit comparison is allowed.

### 5.3 Loop

```kdm
var count be 0
while count < 3 {
    output "tick"
    set count to count + 1
}
```

- The condition must be exactly `boolean`.
- `while` is the only loop in v0.2.
- `break` and `continue` are deferred.
- The compiler does not prove termination. A target may impose an execution
  timeout, but the language does not promise one.

### 5.4 Return

```kdm
return expression
return
```

- A non-`nothing` function must use `return expression`.
- A `nothing` function may use bare `return` or fall off the final brace.
- Returning a value from a `nothing` function, or omitting a value from a
  non-`nothing` function, is a compile error.
- A return value must exactly match the declared return type.
- For return checking, a `while` is treated as possibly non-executing and never
  as a guaranteed return. An `if` without `otherwise` has a fall-through path.
- Code after an unconditional return in the same block is unreachable and is a
  compile error in v0.2, rather than a warning. A return inside only one branch
  does not make code after the `if` unreachable.

### 5.5 Output

```kdm
output expression
```

`output` formats its value and writes it as UTF-8 followed by a single LF
(`\n`) to the program's output stream. CLI runners expose that stream as
standard output. It accepts `text`, `number`, or `boolean`:

- text is written unchanged; embedded newlines are preserved;
- booleans become `true` or `false`;
- numbers use canonical decimal formatting described in §8.4;
- lists and records are compile errors; format them explicitly.

The effect is `io.output`. Output is flushed according to the target runner's
normal output behavior; the language does not require a per-line flush.

### 5.6 Expression statements

Only a call returning `nothing` may stand alone as a statement:

```kdm
writeText("out.txt", "done")
```

A value-producing call cannot be discarded. This prevents silent side effects
and unused computations. To retain a value, bind it with `let` or `var`.

---

## 6. Expressions

### 6.1 Grammar and precedence

Lowest to highest:

```text
or          -> `or`
and         -> `and` (short-circuit)
equality    -> `==` `!=`
comparison  -> `<` `<=` `>` `>=` (numbers only)
additive    -> `+` `-`
multiplicative -> `*` `/`
unary       -> `not` `-`
postfix     -> `.` field, `[` index `]`, `(` arguments `)`
primary     -> literal, name, list, record, parenthesized expression
```

All binary operators are left-associative. Parentheses override precedence.
`and` and `or` short-circuit left to right. Operands, arguments, list elements,
and record fields evaluate left to right.

### 6.2 Literals

```kdm
"text"
42
3.5
true
false
[1, 2, 3]
Person { name: "Kadam", age: 1 }
```

There is no interpolation in the core. Build text with `+` or a function.

### 6.3 Operations

- `+`: number + number, or text + text.
- `-`, `*`, `/`: number only. Division by zero is a runtime failure.
- `-` unary: number only.
- `==` and `!=`: primitive values only (`text`, `number`, `boolean`).
- `<`, `<=`, `>`, `>=`: numbers only.
- `and`, `or`, `not`: booleans only.
- Field access: named record type only.
- Index: list only. Runtime bounds and integer checks apply.
- `length`: list only; generic over the element type.
- No implicit conversions, mixed arithmetic, or truthiness.
- No list/record equality in v0.2.
- No assignment expression; use `set` as a statement.

### 6.4 Calls and external effects

Function calls produce their declared return type. A call to an external
function carries its declared effects. A call to a Kadam function carries the
union of the effects inferred from its body.

A function's value result and effects are separate: a function can return text
and also read a file.

---

## 7. Effects and target capabilities

### 7.1 Effect names

Effects are dotted lower-case identifiers. The core reserves:

```text
io.output
io.file.read
io.file.write
```

Externals may declare additional effects, such as `env.read`. Effect names are
opaque strings outside the core; the target capability registry decides whether
they are supported.

### 7.2 Effect inference

Effects are inferred from the function body:

- `output` contributes `io.output`;
- `readText` contributes `io.file.read`;
- `writeText` contributes `io.file.write`;
- a call contributes every effect of the called function;
- an external call contributes its declared `affects` set;
- record/list/field/index/arithmetic operations contribute nothing.

Inference handles recursive and mutually recursive functions with a fixed-point
union. Effects are part of the module's public IR.

### 7.3 Capability checks

Each target adapter publishes a capability set. Before emitting files, the
adapter receives the complete module IR and must check every declared function,
including functions unused by `main`. Dead-code elimination cannot hide an
effect. A missing capability is a deterministic compile error:

```text
KDM5009: target "example" does not support effect "io.file.write"
required by function "main" in greeting.kdm:12:5
```

There is no silent fallback, emulation, warning-only path, or automatic target
switch. A target may support a subset of the core and reject the rest.

A module that can never run on a target (for example, it requires filesystem
access on a target with no filesystem capability) is rejected before any file
is written.

### 7.4 Effect-free targets

A target may declare no capabilities. Such a target is compile-only for modules
whose entire emitted surface is effect-free; it is not a runnable core target
and is not required to pass run cases. This is useful for constrained
environments and must produce the same IR as a full target.

---

## 8. Execution semantics

### 8.1 Entry point

If a target is asked to run a program, it executes the module's `main`.
`main` receives no arguments and returns a program status as a number:

- `0` means success.
- Any other integer in `0..255` is a non-zero program status.
- A non-integer, or an integer outside `0..255`, is a runtime failure.
- A module without `main` cannot be run as a program.

A CLI runner maps the program status to the process exit status. An embedded
runner reports the same status through its run API. Library modules can still be
checked and emitted.

### 8.2 Runtime failures

The following terminate the program with program status `1`:

- division by zero;
- a non-finite arithmetic result;
- a list index that is negative, fractional, or out of bounds;
- a failed file read or write;
- a failing external provider;
- a `main` return value that is not a valid exit status.

v0.2 has no catch/try mechanism. Partial output produced before a failure
remains observable. The exact runtime error text is target-specific, but the
program status and failure category are part of the conformance contract. A CLI
runner reports a failing program status as exit status `1`.

### 8.3 Evaluation order

Statements execute top to bottom. `if`/`while` evaluate their condition before
the body. `and`/`or` short-circuit. Calls evaluate arguments left to right.
Record construction evaluates fields left to right in source order.

### 8.4 Number formatting

`output` and any target diagnostics that print numbers use this canonical form:

- finite binary64 only;
- `-0` is printed as `0`;
- plain decimal notation is used when the absolute value is at least `1e-6`
  and less than `1e21`; exponent notation is used otherwise;
- within the chosen form, use the shortest digit sequence that round-trips to
  the same binary64 value;
- plain integer values have no decimal point;
- exponent notation uses lowercase `e`, no `+`, and no leading zeroes.

The exact formatter is part of the shared runtime contract; target adapters
must pass the same number-formatting cases. The conformance suite uses values
such as `1`, `2`, `0.5`, and `-3` to avoid platform-specific edge cases until
the formatter is implemented and tested.

### 8.5 File paths

`readText` and `writeText` take text paths. The string is passed unchanged to
the target runtime; relative paths are resolved against that runner's
documented path root. CLI runners use the process working directory. The
language does not promise a filesystem sandbox. Targets may impose their own
policy, but must reject unsupported effects before execution rather than
silently ignoring them.

---

## 9. Relationship to the UI subset

The v0.1 `page` and `component` language remains unchanged:

- one page or component per file;
- manifest routing and components;
- static HTML/CSS output;
- the existing M0–M6 compiler and tests.

v0.2 adds a separate module file form. In this milestone:

- a module cannot contain UI declarations;
- a page/component cannot contain functions or module declarations;
- the core spec does not change existing page output;
- UI event handlers and data binding are deferred;
- the web adapter will compile both file forms only after the core IR is stable.

This is a deliberate first step: one language family, two statically checked
surfaces. Unifying UI declarations with general-purpose functions is a later
language decision, not an implicit privilege of the web target.

---

## 10. Determinism and source spans

1. The same source, compiler version, target version, and target options must
   produce byte-identical output.
2. Source order is preserved where it is semantically visible; record field
   order is preserved in construction IR.
3. Every declaration, statement, expression, and binding carries a UTF-16 span.
4. Line and column are 1-based; columns count Unicode code points, matching
   v0.1.
5. Diagnostics are ordered by source path in code-point order, then start
   offset, then code, then message. Each includes file, line, column, stable
   code, and related spans where applicable.
6. The existing 100-diagnostic cap applies.
7. External effects may make runtime observations nondeterministic, but
   generated code and core IR remain deterministic.
8. No clocks, randomness, network, environment, process, or concurrency
   primitives are implicit in the core.

---

## 11. Diagnostics

v0.2 reserves the `KDM5000–KDM5099` range for core diagnostics. Initial codes:

| Code | Meaning |
| --- | --- |
| `KDM5001` | Invalid file header, module shape, or module/file name mismatch |
| `KDM5002` | Core syntax error |
| `KDM5003` | Unknown or invalid type |
| `KDM5004` | Duplicate declaration or local name, or shadowed name |
| `KDM5005` | Unknown function, field, or local |
| `KDM5006` | Type mismatch |
| `KDM5007` | Assignment to an immutable binding or invalid `set` |
| `KDM5008` | Target has no provider for an external declaration |
| `KDM5009` | Target lacks a required effect capability |
| `KDM5010` | Invalid return or missing return on a reachable path |
| `KDM5011` | Control-flow condition is not boolean |
| `KDM5012` | Invalid record construction or field set |
| `KDM5013` | Invalid expression statement, call, index, or operator operand |
| `KDM5014` | Invalid external declaration, duplicate provider, or duplicate effect |
| `KDM5015` | Unreachable statement after an unconditional return |
| `KDM5016` | Invalid `main` entry point or signature |

The v0.2 allocation may move codes before 1.0, but the categories and severity
are fixed. Runtime failures are not compile diagnostics; they use
the target runner's program status and a stable failure category.

---

## 12. Conformance cases

Cases C01–C07 and C10–C14 are required for every runnable core target, which
must support `io.output`. C08 requires a target that advertises both
`io.file.read` and `io.file.write`; C09 requires at least one external provider.
A target lacking either optional capability must reject the corresponding
fixture with `KDM5009` or `KDM5008` and still pass C10/C11. C15 is a repository
regression check for the UI compiler, not a requirement for non-UI adapters.
`test/v02.test.mjs` executes C01–C09, C13, and C14 on both the TypeScript and
Python targets and checks C10–C12 for deterministic diagnostics with no files
emitted. C15 remains covered by the existing v0.1 suite. “Run” means the target's
native runtime executes the generated program.

| ID | Program | Expected |
| --- | --- | --- |
| C01 | `main` returns `0` | Compiles and runs; program status `0` (CLI exit `0`) |
| C02 | `output "hello"` | Output stream `hello\n`; program status `0` (CLI exit `0`) |
| C03 | Record plus field access | Correct text output |
| C04 | `if` / `otherwise` | Correct branch on the output stream, no fallthrough |
| C05 | `var` plus `while` | Correct repeated output, no mutation of `let` |
| C06 | List literal, `length`, index | Correct count and element |
| C07 | Recursive function | Correct result and deterministic output |
| C08 | `readText`, `writeText`, `output` | File round-trip; effects reported in IR |
| C09 | External with a target provider | Target link succeeds and runs |
| C10 | External without a provider | Compile error `KDM5008`, no files emitted |
| C11 | Unsupported effect on a target | Compile error `KDM5009`, no files emitted |
| C12 | Static type/scope/return errors | Stable diagnostics, no files emitted |
| C13 | Runtime index/division failure | Program status `1`; CLI exit `1`; no silent fallback |
| C14 | Two identical builds | Byte-identical generated output |
| C15 | Existing v0.1 page fixture | Unchanged HTML/CSS and green suite |

C15 protects the existing UI subset. It does not imply that a Python or other
non-UI adapter must implement HTML/CSS.

### 12.1 Approved review points

The following points were approved with D-30 and D-31:

1. The module/file separation from v0.1 pages.
2. The hybrid syntax: English declarations, explicit expressions.
3. `nothing` as a return-only type.
4. The intrinsic set and the three reserved effects.
5. The external-provider metadata strings.
6. Canonical number output and runtime failure behavior.
7. The absence of imports and collection mutation in v0.2.
8. The target-neutral IR boundary and the rule that capability checks run
   before emission.

Any change to these points changes the core IR and target-adapter tests.
