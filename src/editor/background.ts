import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import { parseColorText } from "../core/parser/values.js";
import { findElementByOffset, parseEditorDocument } from "./ast.js";
import {
  buildOutline,
  findOutlineNode,
  type OutlineKind,
} from "./outline.js";
import type { SourceDocument, SourceEditRequest } from "./source-document.js";
import { applyValidatedSourceEdit } from "./validate.js";

export type BackgroundInput =
  | { readonly mode: "solid"; readonly color: string }
  | { readonly mode: "none" }
  | {
      readonly mode: "gradient";
      readonly from: string;
      readonly to: string;
      readonly conjunction?: "and" | "to" | undefined;
    };

export interface PlanElementBackgroundOptions {
  readonly document: SourceDocument;
  readonly documentKind: OutlineKind;
  readonly targetId: string;
  readonly background: BackgroundInput;
}

export type BackgroundEditErrorCode =
  | "target-not-found"
  | "target-not-element"
  | "background-not-found"
  | "gradient-direction-present"
  | "invalid-value";

export interface BackgroundEditError {
  readonly code: BackgroundEditErrorCode;
  readonly message: string;
}

export type PlanElementBackgroundResult =
  | {
      readonly ok: true;
      readonly request: SourceEditRequest;
      readonly targetId: string;
    }
  | {
      readonly ok: false;
      readonly error: BackgroundEditError;
    };

export interface SetElementBackgroundOptions
  extends PlanElementBackgroundOptions {
  readonly projectRoot: string;
  readonly sourceOverrides?:
    | ReadonlyMap<string, string | Uint8Array>
    | undefined;
}

export type SetElementBackgroundResult =
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
      readonly error: BackgroundEditError | null;
      readonly diagnostics: readonly Diagnostic[];
    };

/**
 * Plan an exact replacement of an element's background statement.
 *
 * The canonical statement replaces only the existing statement span. A gradient
 * direction is preserved; changing a gradient to solid/none is rejected while a
 * separate direction statement would remain.
 */
export function planElementBackgroundEdit(
  options: PlanElementBackgroundOptions,
): PlanElementBackgroundResult {
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
    return failed(
      "target-not-element",
      `'${options.targetId}' is not an element`,
    );
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

  const current = element.statements.find((item) => item.type === "background");
  if (current === undefined) {
    return failed(
      "background-not-found",
      `element '${options.targetId}' has no background statement`,
    );
  }

  const canonical = canonicalBackground(options.background);
  if (!canonical.ok) return canonical;

  if (
    options.background.mode !== "gradient" &&
    element.statements.some((item) => item.type === "gradient-direction")
  ) {
    return failed(
      "gradient-direction-present",
      "remove the gradient direction before changing to a non-gradient background",
    );
  }

  const from = current.span.start.offset;
  const to = current.span.end.offset;
  return {
    ok: true,
    targetId: target.id,
    request: {
      path: options.document.path,
      baseVersion: options.document.version,
      from,
      to,
      originalText: options.document.text.slice(from, to),
      replacementText: canonical.statement,
      intent: "inspector",
    },
  };
}

/** Plan and accept a background edit only when the project compiles. */
export function setValidatedElementBackground(
  options: SetElementBackgroundOptions,
): SetElementBackgroundResult {
  const planned = planElementBackgroundEdit(options);
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
    sourceOverrides: options.sourceOverrides,
    request: planned.request,
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

type CanonicalBackground =
  | { readonly ok: true; readonly statement: string }
  | Extract<PlanElementBackgroundResult, { ok: false }>;

function canonicalBackground(input: BackgroundInput): CanonicalBackground {
  if (input.mode === "none") {
    return { ok: true, statement: "has no background" };
  }

  if (input.mode === "solid") {
    const color = parseColorText(input.color);
    if (color === null) {
      return failed("invalid-value", `invalid background color '${input.color}'`);
    }
    return { ok: true, statement: `has a ${color.raw} background` };
  }

  const from = parseColorText(input.from);
  const to = parseColorText(input.to);
  if (from === null || to === null) {
    return failed(
      "invalid-value",
      `invalid gradient colors '${input.from}' and '${input.to}'`,
    );
  }
  return {
    ok: true,
    statement: `has a ${from.raw} ${input.conjunction ?? "and"} ${to.raw} gradient`,
  };
}

function failed(
  code: BackgroundEditErrorCode,
  message: string,
): Extract<PlanElementBackgroundResult, { ok: false }> {
  return { ok: false, error: { code, message } };
}
