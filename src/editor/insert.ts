import {
  buildOutline,
  findOutlineNode,
  type OutlineKind,
  type OutlineNode,
} from "./outline.js";
import {
  applySourceEdit,
  type SourceDocument,
  type SourceEditRequest,
} from "./source-document.js";

export type SourceInsertionPlacement = "end" | "before-children";

export interface InsertSourceStatementOptions {
  readonly document: SourceDocument;
  readonly documentKind: OutlineKind;
  /** Outline ID of the page, component, variant, or element to extend. */
  readonly targetId: string;
  /** Statement or child element text, with optional relative indentation. */
  readonly statement: string;
  /** Defaults to the end of the body. */
  readonly placement?: SourceInsertionPlacement | undefined;
}

export type SourceInsertionErrorCode =
  | "target-not-found"
  | "empty-statement"
  | "unsupported-layout"
  | "edit-rejected";

export interface SourceInsertionError {
  readonly code: SourceInsertionErrorCode;
  readonly message: string;
}

export type InsertSourceStatementResult =
  | {
      readonly ok: true;
      readonly document: SourceDocument;
      /** Exact request to pass to compiler-backed validation. */
      readonly request: SourceEditRequest;
      readonly targetId: string;
      readonly offset: number;
    }
  | {
      readonly ok: false;
      readonly document: SourceDocument;
      readonly error: SourceInsertionError;
    };

/**
 * Append text to the end of an outlined container's body.
 *
 * The helper only plans and applies a source insertion. It does not compile or
 * write the candidate; use `insertValidatedSourceStatement()` or validate
 * `request` with `applyValidatedSourceEdit()` before accepting the new document.
 */
export function insertSourceStatement(
  options: InsertSourceStatementOptions,
): InsertSourceStatementResult {
  const outline = buildOutline(
    options.document.path,
    options.document.text,
    options.documentKind,
  ).outline;
  const target = findOutlineNode(outline, options.targetId);
  if (target === null) {
    return failed(
      options.document,
      "target-not-found",
      `outline target '${options.targetId}' was not found`,
    );
  }

  const statement = normalizeStatement(options.statement);
  if (statement === null) {
    return failed(options.document, "empty-statement", "statement is empty");
  }

  const layout = insertionLayout(
    options.document.text,
    target,
    options.placement ?? "end",
  );
  if (layout === null) {
    return failed(
      options.document,
      "unsupported-layout",
      `target '${options.targetId}' does not end with a standalone closing brace`,
    );
  }

  const indented = statement.lines
    .map((line) => (line.length === 0 ? "" : `${layout.bodyIndent}${line}`))
    .join("\n");
  const insertion = `${indented}\n`;
  const request: SourceEditRequest = {
    path: options.document.path,
    baseVersion: options.document.version,
    from: layout.offset,
    to: layout.offset,
    originalText: "",
    replacementText: insertion,
    intent: "inspector",
  };

  const applied = applySourceEdit(options.document, request);
  if (!applied.ok) {
    return failed(options.document, "edit-rejected", applied.error.message);
  }

  return {
    ok: true,
    document: applied.document,
    request,
    targetId: target.id,
    offset: layout.offset,
  };
}

interface NormalizedStatement {
  readonly lines: readonly string[];
}

function normalizeStatement(statement: string): NormalizedStatement | null {
  const lines = statement.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[0]!.trim().length === 0) lines.shift();
  while (
    lines.length > 0 &&
    lines[lines.length - 1]!.trim().length === 0
  ) {
    lines.pop();
  }
  if (lines.length === 0) return null;

  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => /^[ \t]*/.exec(line)?.[0] ?? "");
  const common = Math.min(...indents.map((indent) => indent.length));
  return {
    lines: lines.map((line) =>
      line.trim().length === 0 ? "" : line.slice(common),
    ),
  };
}

interface InsertionLayout {
  readonly offset: number;
  readonly bodyIndent: string;
}

function insertionLayout(
  text: string,
  target: OutlineNode,
  placement: SourceInsertionPlacement,
): InsertionLayout | null {
  if (placement === "before-children" && target.children.length > 0) {
    const child = target.children[0]!;
    const offset =
      text.lastIndexOf("\n", child.span.start.offset - 1) + 1;
    const indent = text.slice(offset, child.span.start.offset);
    if (!/^[ \t]*$/.test(indent)) return null;
    return { offset, bodyIndent: indent };
  }

  const end = Math.min(target.span.end.offset, text.length);
  let brace = end - 1;
  while (brace >= 0 && /\s/.test(text[brace]!)) brace -= 1;
  if (brace < 0 || text[brace]! !== "}") return null;

  const lineStart = text.lastIndexOf("\n", brace - 1) + 1;
  const closingIndent = text.slice(lineStart, brace);
  if (!/^[ \t]*$/.test(closingIndent)) return null;

  const body = text.slice(target.span.start.offset, brace);
  let bodyIndent: string | null = null;
  for (const line of body.split("\n").slice(1)) {
    if (line.trim().length === 0) continue;
    const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
    if (indent.length > closingIndent.length && indent.startsWith(closingIndent)) {
      bodyIndent = indent;
      break;
    }
  }

  return {
    offset: lineStart,
    bodyIndent: bodyIndent ?? `${closingIndent}    `,
  };
}

function failed(
  document: SourceDocument,
  code: SourceInsertionErrorCode,
  message: string,
): Extract<InsertSourceStatementResult, { ok: false }> {
  return { ok: false, document, error: { code, message } };
}
