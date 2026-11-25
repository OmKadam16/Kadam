# Tests

Test strategy is described in `docs/architecture.md`.

Planned layout:

```
test/
  unit/       Lexer, parser, semantics, type checker, emitters
  golden/     Fixture projects -> expected files and diagnostics
  fixtures/
    valid/    Accepted .kdm sources
    invalid/  Sources with exact expected error codes and spans
```

Tests use the Node.js built-in test runner. Snapshot updates are explicit
commands, never automatic during CI. A determinism test compiles each fixture
twice and compares every emitted byte.
