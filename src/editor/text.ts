import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import { findElementByOffset, parseEditorDocument } from "./ast.js";
import {
  buildOutline,
  findOutlineNode,
  type OutlineKind,
} from "./outline.js";
import type {
  SourceDocument,
  SourceEditRequest,
} from "./source-document.js";
import { applyValidatedSourceEdit } from "./validate.js";

export interface PlanElementTextOptions {
  readonly document: SourceDocument;
  readonly documentKind: OutlineKind;
  readonly targetId: string;
  readonly value: string;
}

export type TextEditErrorCode =
  | "target-not-found"
  | "target-not-element"
  | "text-not-found";

export interface TextEditError {
  readonly code: TextEditErrorCode;
  readonly message: string;
}

export type PlanElementTextResult =
  | {
      readonly ok: true;
      readonly request: SourceEditRequest;
      readonly targetId: string;
    }
  | {
      readonly ok: false;
      readonly error: TextEditError;
    };

export interface SetElementTextOptions extends PlanElementTextOptions {
  readonly projectRoot: string;
  readonly sourceOverrides?:
    | ReadonlyMap<string, string | Uint8Array>
    | undefined;
}

export type SetElementTextResult =
  | {
      readonly ok: true;
      readonly document: SourceDocument;
      readonly request: SourceEditRequest;
      readonly targetId: string;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly document: SourceDocument;
      readonly error: TextEditError | null;
      readonly diagnostics: readonly Diagnostic[];
    };

/**
 * Plan an exact replacement of an element's visible text.
 *
 * The request replaces the existing quoted literal, so comments and surrounding
 * source are untouched. Callers validate the request through the compiler before
 * accepting it.
 */
export function planElementTextEdit(
  options: PlanElementTextOptions,
): PlanElementTextResult {
  const outline = buildOutline(
    options.document.path,
    options.document.text,
    options.documentKind,
  ).outline;
  const target = findOutlineNode(outline, options.targetId);
  if (target === null) {
    return failed(
      "target-not-found",
      `outline target '${options.targetId}' was not found`,
    );
  }
  if (target.type !== "element") {
    return failed("target-not-element", `'${options.targetId}' is not an element`);
  }

  const parsed = parseEditorDocument(options.document, options.documentKind);
  const element = findElementByOffset(
    parsed,
    target.nameSpan.start.offset,
  );
  if (element === null) {
    return failed(
      "target-not-found",
      `source element for '${options.targetId}' was not found`,
    );
  }

  const statement = element.statements.find((item) => item.type === "text");
  if (statement === undefined) {
    return failed(
      "text-not-found",
      `element '${options.targetId}' has no text statement`,
    );
  }

  const from = statement.valueSpan.start.offset;
  const to = statement.valueSpan.end.offset;
  return {
    ok: true,
    targetId: target.id,
    request: {
      path: options.document.path,
      baseVersion: options.document.version,
      from,
      to,
      originalText: options.document.text.slice(from, to),
      replacementText: quoteTextLiteral(options.value),
      intent: "inspector",
    },
  };
}

/** Plan and accept an element text edit only when the project compiles. */
export function setValidatedElementText(
  options: SetElementTextOptions,
): SetElementTextResult {
  const planned = planElementTextEdit(options);
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
    diagnostics: validated.diagnostics,
  };
}

/** Encode a value as a double-quoted Kadam text literal. */
export function quoteTextLiteral(value: string): string {
  let quoted = '"';
  for (const character of value) {
    if (character === "\\") quoted += "\\\\";
    else if (character === '"') quoted += '\\"';
    else if (character === "\n") quoted += "\\n";
    else if (character === "\r") quoted += "\\r";
    else if (character === "\t") quoted += "\\t";
    else {
      const code = character.codePointAt(0) ?? 0;
      quoted +=
        code < 0x20
          ? `\\u${code.toString(16).padStart(4, "0")}`
          : character;
    }
  }
  return `${quoted}"`;
}

function failed(
  code: TextEditErrorCode,
  message: string,
): Extract<PlanElementTextResult, { ok: false }> {
  return { ok: false, error: { code, message } };
}
