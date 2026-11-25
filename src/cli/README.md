# CLI module

Owns argument parsing, terminal output, exit codes, and file-system-facing
commands. It is a thin adapter over `core`, `compiler`, and `server`.

Rules:

- No language logic in this directory.
- Exit codes: `0` success, `1` compile errors, `2` usage/config errors,
  `3` internal compiler error.
- The CLI must be usable headlessly; it must never import browser UI code.
