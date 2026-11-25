# Compiler module

Turns an analyzed project into a normalized intermediate representation (IR)
and then into static HTML, CSS, and optional JavaScript. It depends on `core`
and Node built-ins, never on the editor.

Planned layout:

```
compiler/
  project/      kadam.json loader, file graph, incremental cache
  ir/           Backend-neutral page/element/style/interaction model
  passes/       Defaulting, validation, canonical ordering, optimization
  emit-html/    Semantic HTML emitter
  emit-css/     Deterministic CSS emitter
  emit-js/      Minimal runtime emitter (only when an interaction needs it)
```

Every compile stage is a pure function over its inputs plus an explicit
context. Output paths are supplied by the caller; the compiler never infers
them from the current working directory.
