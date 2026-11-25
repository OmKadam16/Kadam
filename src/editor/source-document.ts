/**
 * Editor-owned source text.
 *
 * The compiler normalizes CRLF and a leading BOM; the editor keeps the original
 * newline and BOM metadata so saving can restore them without rewriting source
 * outside the edited range.
 */
export type SourceNewline = "\n" | "\r\n";

export type SourceEditIntent =
  | "inspector"
  | "format"
  | "rename"
  | "create"
  | "manual";

export interface SourceDocument {
  /** Project-relative source path. */
  readonly path: string;
  /** Normalized LF text, matching compiler spans. */
  readonly text: string;
  /** Monotonically increasing in-memory revision. */
  readonly version: number;
  readonly newline: SourceNewline;
  readonly bom: boolean;
  /** Normalized text at the last load/save; used to derive dirty state. */
  readonly savedText: string;
  readonly dirty: boolean;
}

export interface SourceEditRequest {
  readonly path: string;
  readonly baseVersion: number;
  /** UTF-16 offset into the normalized text. */
  readonly from: number;
  /** Exclusive UTF-16 end offset. */
  readonly to: number;
  /** Exact text expected in [from, to). */
  readonly originalText: string;
  readonly replacementText: string;
  readonly intent: SourceEditIntent;
}

export interface AppliedSourceEdit {
  readonly path: string;
  readonly version: number;
  readonly from: number;
  readonly to: number;
  readonly replacementText: string;
  readonly intent: SourceEditIntent;
}

export type SourceEditErrorCode =
  | "path-mismatch"
  | "stale-version"
  | "invalid-range"
  | "text-mismatch";

export interface SourceEditError {
  readonly code: SourceEditErrorCode;
  readonly message: string;
}

export type SourceEditResult =
  | {
      readonly ok: true;
      readonly document: SourceDocument;
      readonly edit: AppliedSourceEdit;
    }
  | {
      readonly ok: false;
      readonly document: SourceDocument;
      readonly error: SourceEditError;
    };

export interface CreateSourceDocumentOptions {
  readonly version?: number | undefined;
}

/** Create a document from raw file text, preserving newline/BOM metadata. */
export function createSourceDocument(
  path: string,
  rawText: string,
  options: CreateSourceDocumentOptions = {},
): SourceDocument {
  const bom = rawText.charCodeAt(0) === 0xfeff;
  const newline: SourceNewline = rawText.includes("\r\n") ? "\r\n" : "\n";
  const text = normalizeNewlines(bom ? rawText.slice(1) : rawText);
  return {
    path,
    text,
    version: options.version ?? 1,
    newline,
    bom,
    savedText: text,
    dirty: false,
  };
}

/**
 * Apply one exact replacement to an in-memory document.
 *
 * This function is pure: it never reads or writes the filesystem. The caller
 * validates the candidate with the compiler before replacing the open document
 * or preview overlay.
 */
export function applySourceEdit(
  document: SourceDocument,
  request: SourceEditRequest,
): SourceEditResult {
  if (request.path !== document.path) {
    return failed(document, "path-mismatch", `edit targets '${request.path}', not '${document.path}'`);
  }
  if (request.baseVersion !== document.version) {
    return failed(
      document,
      "stale-version",
      `edit targets version ${request.baseVersion}; the document is at version ${document.version}`,
    );
  }
  if (
    !Number.isInteger(request.from) ||
    !Number.isInteger(request.to) ||
    request.from < 0 ||
    request.to < request.from ||
    request.to > document.text.length
  ) {
    return failed(
      document,
      "invalid-range",
      `edit range [${request.from}, ${request.to}) is outside the document`,
    );
  }

  const current = document.text.slice(request.from, request.to);
  if (current !== request.originalText) {
    return failed(
      document,
      "text-mismatch",
      `expected ${JSON.stringify(request.originalText)} at [${request.from}, ${request.to}) but found ${JSON.stringify(current)}`,
    );
  }

  const replacementText = normalizeNewlines(request.replacementText);
  const text =
    document.text.slice(0, request.from) +
    replacementText +
    document.text.slice(request.to);
  const version = document.version + 1;
  const next: SourceDocument = {
    ...document,
    text,
    version,
    savedText: document.savedText,
    dirty: text !== document.savedText,
  };

  return {
    ok: true,
    document: next,
    edit: {
      path: document.path,
      version,
      from: request.from,
      to: request.to,
      replacementText,
      intent: request.intent,
    },
  };
}

/** Restore the document's original newline style and BOM for saving. */
export function sourceDocumentToSaveText(document: SourceDocument): string {
  const text =
    document.newline === "\r\n" ? document.text.replaceAll("\n", "\r\n") : document.text;
  return document.bom ? `\uFEFF${text}` : text;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function failed(
  document: SourceDocument,
  code: SourceEditErrorCode,
  message: string,
): SourceEditResult {
  return { ok: false, document, error: { code, message } };
}
