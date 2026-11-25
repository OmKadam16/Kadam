import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import {
  insertSourceStatement,
  type InsertSourceStatementOptions,
  type SourceInsertionError,
} from "./insert.js";
import type { SourceDocument, SourceEditRequest } from "./source-document.js";
import { applyValidatedSourceEdit } from "./validate.js";

export interface InsertValidatedSourceStatementOptions
  extends InsertSourceStatementOptions {
  readonly projectRoot: string;
  /** Other open buffers, keyed by project-relative path. */
  readonly sourceOverrides?:
    | ReadonlyMap<string, string | Uint8Array>
    | undefined;
}

export type ValidatedSourceInsertionResult =
  | {
      readonly ok: true;
      readonly document: SourceDocument;
      readonly request: SourceEditRequest;
      readonly targetId: string;
      readonly offset: number;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      /** The unchanged document when insertion or validation fails. */
      readonly document: SourceDocument;
      /** Present when the insertion itself was rejected before compilation. */
      readonly error: SourceInsertionError | null;
      readonly diagnostics: readonly Diagnostic[];
    };

/**
 * Plan a canonical insertion and accept it only when the whole project compiles.
 *
 * Like `applyValidatedSourceEdit`, this never writes a source file. The candidate
 * is supplied through `sourceOverrides` during validation.
 */
export function insertValidatedSourceStatement(
  options: InsertValidatedSourceStatementOptions,
): ValidatedSourceInsertionResult {
  const planned = insertSourceStatement(options);
  if (!planned.ok) {
    return {
      ok: false,
      document: options.document,
      error: planned.error,
      diagnostics: [],
    };
  }

  const validated = applyValidatedSourceEdit({
    projectRoot: options.projectRoot,
    document: options.document,
    request: planned.request,
    sourceOverrides: options.sourceOverrides,
  });

  if (!validated.ok) {
    return {
      ok: false,
      document: options.document,
      error: null,
      diagnostics: validated.diagnostics,
    };
  }

  return {
    ok: true,
    document: validated.document,
    request: planned.request,
    targetId: planned.targetId,
    offset: planned.offset,
    diagnostics: validated.diagnostics,
  };
}
