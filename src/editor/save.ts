import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { randomUUID } from "node:crypto";

import {
  createSourceDocument,
  sourceDocumentToSaveText,
  type SourceDocument,
} from "./source-document.js";

export interface SaveSourceDocumentOptions {
  readonly projectRoot: string;
  readonly document: SourceDocument;
}

export type SaveSourceErrorCode =
  | "invalid-path"
  | "missing"
  | "conflict"
  | "io-error";

export interface SaveSourceError {
  readonly code: SaveSourceErrorCode;
  readonly message: string;
  /** Normalized current disk text, present only for a conflict. */
  readonly diskText?: string;
}

export type SaveSourceDocumentResult =
  | {
      readonly ok: true;
      readonly status: "saved" | "unchanged";
      readonly document: SourceDocument;
    }
  | {
      readonly ok: false;
      readonly document: SourceDocument;
      readonly error: SaveSourceError;
    };

/**
 * Save one edited source document atomically.
 *
 * The path must stay inside `projectRoot` and name a `.kdm` regular file. Before
 * writing, the normalized disk text is compared with the document's saved
 * baseline; an external edit returns a conflict instead of overwriting it.
 */
export function saveSourceDocument(
  options: SaveSourceDocumentOptions,
): SaveSourceDocumentResult {
  const root = resolve(options.projectRoot);
  const file = resolve(root, options.document.path);
  const relativePath = relative(root, file);

  if (
    isAbsolute(options.document.path) ||
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath) ||
    !file.endsWith(".kdm")
  ) {
    return failed(
      options.document,
      "invalid-path",
      `'${options.document.path}' is not a project-relative .kdm source file`,
    );
  }

  if (!options.document.dirty) {
    return {
      ok: true,
      status: "unchanged",
      document: options.document,
    };
  }

  let diskText: string;
  let mode: number;
  try {
    const stat = lstatSync(file);
    if (!stat.isFile()) {
      return failed(
        options.document,
        "invalid-path",
        `'${options.document.path}' is not a regular file`,
      );
    }
    mode = stat.mode & 0o777;
    diskText = readFileSync(file, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return failed(
        options.document,
        "missing",
        `source file '${options.document.path}' does not exist`,
      );
    }
    return failed(options.document, "io-error", ioMessage(options.document, error));
  }

  const current = createSourceDocument(options.document.path, diskText);
  if (current.text !== options.document.savedText) {
    return {
      ...failed(
        options.document,
        "conflict",
        `source file '${options.document.path}' changed on disk`,
      ),
      error: {
        code: "conflict",
        message: `source file '${options.document.path}' changed on disk`,
        diskText: current.text,
      },
    };
  }

  const temporary = join(
    dirname(file),
    `.${basename(file)}.${randomUUID()}.tmp`,
  );
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, "wx", mode);
    writeFileSync(descriptor, sourceDocumentToSaveText(options.document), "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // The original save error is more useful than a cleanup error.
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may not have been created.
    }
    return failed(options.document, "io-error", ioMessage(options.document, error));
  }

  return {
    ok: true,
    status: "saved",
    document: {
      ...options.document,
      savedText: options.document.text,
      dirty: false,
    },
  };
}

function failed(
  document: SourceDocument,
  code: SaveSourceErrorCode,
  message: string,
): Extract<SaveSourceDocumentResult, { ok: false }> {
  return { ok: false, document, error: { code, message } };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function ioMessage(document: SourceDocument, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `could not save '${document.path}': ${detail}`;
}
