import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import type { ElementNode } from "../core/ast/nodes.js";
import {
  parseColorText,
  parseLengthText,
} from "../core/parser/values.js";
import { findElementByOffset, parseEditorDocument } from "./ast.js";
import { insertSourceStatement } from "./insert.js";
import {
  buildOutline,
  findOutlineNode,
  type OutlineKind,
} from "./outline.js";
import type { SourceDocument, SourceEditRequest } from "./source-document.js";
import { applyValidatedSourceEdit } from "./validate.js";

export type BorderInput =
  | { readonly mode: "none" }
  | {
      readonly mode: "solid";
      readonly color: string;
      readonly width?: string | undefined;
    };

export type CornersInput =
  | { readonly mode: "default" }
  | { readonly mode: "full" }
  | { readonly mode: "custom"; readonly radius: string };

export interface PlanElementBorderOptions {
  readonly document: SourceDocument;
  readonly documentKind: OutlineKind;
  readonly targetId: string;
  readonly border: BorderInput;
}

export interface PlanElementCornersOptions {
  readonly document: SourceDocument;
  readonly documentKind: OutlineKind;
  readonly targetId: string;
  readonly corners: CornersInput;
}

export type BorderEditErrorCode =
  | "target-not-found"
  | "target-not-element"
  | "invalid-value"
  | "insertion-failed";

export type CornersEditErrorCode =
  | "target-not-found"
  | "target-not-element"
  | "invalid-value"
  | "insertion-failed";

export interface BorderEditError {
  readonly code: BorderEditErrorCode;
  readonly message: string;
}

export interface CornersEditError {
  readonly code: CornersEditErrorCode;
  readonly message: string;
}

export type PlanElementBorderResult =
  | {
      readonly ok: true;
      readonly request: SourceEditRequest;
      readonly targetId: string;
    }
  | { readonly ok: false; readonly error: BorderEditError };

export type PlanElementCornersResult =
  | {
      readonly ok: true;
      readonly request: SourceEditRequest;
      readonly targetId: string;
    }
  | { readonly ok: false; readonly error: CornersEditError };

export interface SetElementBorderOptions extends PlanElementBorderOptions {
  readonly projectRoot: string;
  readonly sourceOverrides?:
    | ReadonlyMap<string, string | Uint8Array>
    | undefined;
}

export interface SetElementCornersOptions extends PlanElementCornersOptions {
  readonly projectRoot: string;
  readonly sourceOverrides?:
    | ReadonlyMap<string, string | Uint8Array>
    | undefined;
}

export type SetElementBorderResult =
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
      readonly error: BorderEditError | null;
      readonly diagnostics: readonly Diagnostic[];
    };

export type SetElementCornersResult =
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
      readonly error: CornersEditError | null;
      readonly diagnostics: readonly Diagnostic[];
    };

export function planElementBorderEdit(
  options: PlanElementBorderOptions,
): PlanElementBorderResult {
  const target = findTarget(options.document, options.documentKind, options.targetId);
  if (!target.ok) return target;
  const statement = target.element.statements.find(
    (item) => item.type === "border",
  );
  const canonical = canonicalBorder(options.border);
  if (!canonical.ok) return canonical;

  if (statement === undefined) {
    const inserted = insertSourceStatement({
      document: options.document,
      documentKind: options.documentKind,
      targetId: target.id,
      statement: canonical.statement,
      placement: "before-children",
    });
    if (!inserted.ok) {
      return borderFailed("insertion-failed", inserted.error.message);
    }
    return {
      ok: true,
      targetId: inserted.targetId,
      request: inserted.request,
    };
  }

  return succeeded(target.id, options.document, statement.span, canonical.statement);
}

export function planElementCornersEdit(
  options: PlanElementCornersOptions,
): PlanElementCornersResult {
  const target = findTarget(options.document, options.documentKind, options.targetId);
  if (!target.ok) return target;
  const statement = target.element.statements.find(
    (item) => item.type === "corners",
  );
  const canonical = canonicalCorners(options.corners);
  if (!canonical.ok) return canonical;

  if (statement === undefined) {
    const inserted = insertSourceStatement({
      document: options.document,
      documentKind: options.documentKind,
      targetId: target.id,
      statement: canonical.statement,
      placement: "before-children",
    });
    if (!inserted.ok) {
      return cornersFailed("insertion-failed", inserted.error.message);
    }
    return {
      ok: true,
      targetId: inserted.targetId,
      request: inserted.request,
    };
  }

  return succeeded(target.id, options.document, statement.span, canonical.statement);
}

export function setValidatedElementBorder(
  options: SetElementBorderOptions,
): SetElementBorderResult {
  const planned = planElementBorderEdit(options);
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

export function setValidatedElementCorners(
  options: SetElementCornersOptions,
): SetElementCornersResult {
  const planned = planElementCornersEdit(options);
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

type TargetErrorCode = "target-not-found" | "target-not-element";

interface TargetError {
  readonly code: TargetErrorCode;
  readonly message: string;
}

type TargetResult =
  | {
      readonly ok: true;
      readonly id: string;
      readonly element: ElementNode;
    }
  | { readonly ok: false; readonly error: TargetError };

interface StatementEditSuccess {
  readonly ok: true;
  readonly request: SourceEditRequest;
  readonly targetId: string;
}

function findTarget(
  document: SourceDocument,
  kind: OutlineKind,
  targetId: string,
): TargetResult {
  const outline = buildOutline(document.path, document.text, kind).outline;
  const target = findOutlineNode(outline, targetId);
  if (target === null) {
    return { ok: false, error: { code: "target-not-found", message: `outline target '${targetId}' was not found` } };
  }
  if (target.type !== "element") {
    return { ok: false, error: { code: "target-not-element", message: `'${targetId}' is not an element` } };
  }

  const parsed = parseEditorDocument(document, kind);
  const element = findElementByOffset(parsed, target.nameSpan.start.offset);
  if (element === null) {
    return { ok: false, error: { code: "target-not-found", message: `source element for '${targetId}' was not found` } };
  }
  return { ok: true, id: target.id, element };
}

type CanonicalStatement =
  | { readonly ok: true; readonly statement: string }
  | {
      readonly ok: false;
      readonly error: { readonly code: "invalid-value"; readonly message: string };
    };

function canonicalBorder(input: BorderInput): CanonicalStatement {
  if (input.mode === "none") {
    return { ok: true, statement: "has no border" };
  }

  const color = parseColorText(input.color);
  if (color === null) {
    return invalidValue(`invalid border color '${input.color}'`);
  }
  if (input.width === undefined) {
    return { ok: true, statement: `has a ${color.raw} border` };
  }
  const width = parseLengthText(input.width);
  if (width === null) {
    return invalidValue(`invalid border width '${input.width}'`);
  }
  return {
    ok: true,
    statement: `has a ${lengthText(width)} ${color.raw} border`,
  };
}

function canonicalCorners(input: CornersInput): CanonicalStatement {
  if (input.mode === "default") {
    return { ok: true, statement: "has rounded corners" };
  }
  if (input.mode === "full") {
    return { ok: true, statement: "has fully rounded corners" };
  }
  const radius = parseLengthText(input.radius);
  if (radius === null) {
    return invalidValue(`invalid corner radius '${input.radius}'`);
  }
  return { ok: true, statement: `has ${lengthText(radius)} rounded corners` };
}

function lengthText(length: { readonly value: number; readonly unit: "px" | "rem" | null }): string {
  return length.unit === null ? "0" : `${length.value}${length.unit}`;
}

function succeeded(
  targetId: string,
  document: SourceDocument,
  span: { readonly start: { readonly offset: number }; readonly end: { readonly offset: number } },
  replacementText: string,
): StatementEditSuccess {
  const from = span.start.offset;
  const to = span.end.offset;
  return {
    ok: true,
    targetId,
    request: {
      path: document.path,
      baseVersion: document.version,
      from,
      to,
      originalText: document.text.slice(from, to),
      replacementText,
      intent: "inspector",
    },
  };
}

function invalidValue(message: string): Extract<CanonicalStatement, { ok: false }> {
  return { ok: false, error: { code: "invalid-value", message } };
}

function borderFailed(
  code: BorderEditErrorCode,
  message: string,
): Extract<PlanElementBorderResult, { ok: false }> {
  return { ok: false, error: { code, message } };
}

function cornersFailed(
  code: CornersEditErrorCode,
  message: string,
): Extract<PlanElementCornersResult, { ok: false }> {
  return { ok: false, error: { code, message } };
}
