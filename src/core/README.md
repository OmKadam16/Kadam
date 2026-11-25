# Core module

The language front end. This module is pure: it receives source text and
configuration through injected interfaces and returns tokens, syntax trees,
semantic models, and diagnostics. It performs no file-system or network I/O.

Planned layout:

```
core/
  source/       SourceFile, spans, line maps, in-memory source overrides
  lexer/        UTF-8 text -> tokens with source offsets and line/column spans
  parser/       Tokens -> AST (line-oriented statement matching)
  ast/          JSON-serializable syntax node types
  semantics/    Symbols, kind registry, references, required content
  types/        Value domains and property capability checks
  diagnostics/  Stable error codes, formatting, deterministic suggestions
```

Dependency rule: `core` imports nothing from `compiler`, `server`, `cli`, or
`editor`. The editor consumes this module; this module never consumes the
editor.
