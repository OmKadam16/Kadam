import type { Span } from "../core/source/source-file.js";

/**
 * A handled invariant failure in a compiler stage that runs after all user
 * diagnostics. The build reports KDM9002 and writes nothing.
 */
export class InternalCompilerError extends Error {
  readonly span: Span;

  constructor(message: string, span: Span) {
    super(message);
    this.name = "InternalCompilerError";
    this.span = span;
  }
}
