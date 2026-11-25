import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import { compileProject } from "../compiler/project.js";
import {
  applySourceEdit,
  type AppliedSourceEdit,
  type SourceDocument,
  type SourceEditError,
  type SourceEditRequest,
} from "./source-document.js";

export interface ApplyValidatedSourceEditOptions {
  readonly projectRoot: string;
  readonly document: SourceDocument;
  readonly request: SourceEditRequest;
  /** Other open buffers, keyed by project-relative path. */
  readonly sourceOverrides?:
    | ReadonlyMap<string, string | Uint8Array>
    | undefined;
}

export type ValidatedSourceEditResult =
  | {
      readonly ok: true;
      readonly document: SourceDocument;
      readonly edit: AppliedSourceEdit;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      /** The unchanged document when validation rejects the candidate. */
      readonly document: SourceDocument;
      /** Present when the edit itself was rejected before compilation. */
      readonly error: SourceEditError | null;
      readonly diagnostics: readonly Diagnostic[];
    };

/**
 * Apply one source edit and validate the whole project with the real compiler.
 *
 * Validation never writes a file. The candidate is supplied through
 * `sourceOverrides`, exactly like the development preview, so callers can keep
 * the previous document and preview when the edit is invalid.
 */
export function applyValidatedSourceEdit(
  options: ApplyValidatedSourceEditOptions,
): ValidatedSourceEditResult {
  const applied = applySourceEdit(options.document, options.request);
  if (!applied.ok) {
    return {
      ok: false,
      document: options.document,
      error: applied.error,
      diagnostics: [],
    };
  }

  const overrides = new Map(options.sourceOverrides ?? []);
  overrides.set(options.document.path, applied.document.text);

  const compiled = compileProject({
    projectRoot: options.projectRoot,
    sourceOverrides: overrides,
  });

  if (!compiled.ok) {
    return {
      ok: false,
      document: options.document,
      error: null,
      diagnostics: compiled.diagnostics,
    };
  }

  return {
    ok: true,
    document: applied.document,
    edit: applied.edit,
    diagnostics: compiled.diagnostics,
  };
}
