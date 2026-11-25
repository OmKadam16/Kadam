import type {
  ElementNode,
  F2Statement,
  LengthValue,
  ScopedStatement,
  StatementNode,
  StatementScope,
} from "../core/ast/nodes.js";
import { ROOT_FONT_PX } from "../core/parser/matchers-f2.js";
import { findProperty, isNativeProperty } from "../core/parser/properties.js";
import type { IrDeclaration } from "./ir.js";

/**
 * Lowering for kadam 0.3 (F2) layout statements. Each statement becomes CSS
 * declarations in source order. A 0.1 element has none, so its IR and CSS
 * keep their exact shape.
 */

/** The fluid text range: sizes grow between these viewport widths. */
export const FLUID_MIN_VIEWPORT = 360;
export const FLUID_MAX_VIEWPORT = 1280;

export interface F2ParentInfo {
  /** The parent's flex direction, or "grid" when it arranges columns. */
  readonly arrangement: "row" | "column" | "grid" | null;
}

function length(value: LengthValue): string {
  return `${formatNumber(value.value)}${value.unit ?? ""}`;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(4)));
}

function px(value: LengthValue): number {
  return value.unit === "rem" || value.unit === "em" ? value.value * ROOT_FONT_PX : value.value;
}

/** `clamp(min, intercept + slope·vw, max)` between the fluid viewport widths. */
export function fluidFontSize(min: LengthValue, max: LengthValue): string {
  const minPx = px(min);
  const maxPx = px(max);
  const slope = (maxPx - minPx) / (FLUID_MAX_VIEWPORT - FLUID_MIN_VIEWPORT);
  const interceptRem = (minPx - slope * FLUID_MIN_VIEWPORT) / ROOT_FONT_PX;
  const vw = slope * 100;
  return `clamp(${length(min)}, ${formatNumber(interceptRem)}rem + ${formatNumber(vw)}vw, ${length(max)})`;
}

function edgeDeclarations(
  vertical: "top" | "bottom" | null,
  horizontal: "left" | "right" | null,
  offset: LengthValue | null,
): IrDeclaration[] {
  const value = offset === null ? "0" : length(offset);
  const result: IrDeclaration[] = [];
  if (vertical !== null) result.push({ property: vertical, value });
  if (horizontal !== null) result.push({ property: horizontal, value });
  // One edge only: stretch along it (a bar along the top, a rail on the left).
  if (horizontal === null && vertical !== null) {
    result.push({ property: "left", value: "0" }, { property: "right", value: "0" });
  }
  if (vertical === null && horizontal !== null) {
    result.push({ property: "top", value: "0" }, { property: "bottom", value: "0" });
  }
  return result;
}

function statementDeclarations(statement: StatementNode, parent: F2ParentInfo): IrDeclaration[] {
  const d = (property: string, value: string): IrDeclaration => ({ property, value });
  switch (statement.type) {
    case "size-limit":
      return [d(`${statement.bound}-${statement.axis}`, length(statement.value))];
    case "aspect-ratio":
      return [d("aspect-ratio", `${statement.width} / ${statement.height}`)];
    case "fluid-text":
      return [d("font-size", fluidFontSize(statement.min, statement.max))];
    case "flex-rule":
      if (statement.rule === "wrap") return [d("flex-wrap", "wrap")];
      return [d("justify-content", statement.rule === "spread" ? "space-between" : "space-evenly")];
    case "child-rule":
      if (statement.rule === "grow") return [d("flex-grow", "1")];
      if (statement.rule === "no-shrink") return [d("flex-shrink", "0")];
      if (parent.arrangement === "grid") return [d("justify-self", "end")];
      return [d(parent.arrangement === "row" ? "margin-inline-start" : "margin-block-start", "auto")];
    case "grid":
      return [
        d("display", "grid"),
        // Containers hug their content in a column; a grid fills the width.
        ...(parent.arrangement === "column" ? [d("align-self", "stretch")] : []),
        d(
          "grid-template-columns",
          statement.columns !== null
            ? `repeat(${statement.columns}, minmax(0, 1fr))`
            : `repeat(auto-fit, minmax(min(${length(statement.minWidth!)}, 100%), 1fr))`,
        ),
      ];
    case "column-span":
      return [d("grid-column", statement.columns === "all" ? "1 / -1" : `span ${statement.columns}`)];
    case "sticky":
      return [
        d("position", "sticky"),
        d(statement.edge, statement.offset === null ? "0" : length(statement.offset)),
      ];
    case "position":
      if (statement.mode === "placed" && statement.vertical === null && statement.horizontal === null) {
        return [d("position", "absolute"), d("inset", "0")];
      }
      return [
        d("position", statement.mode === "pinned" ? "fixed" : "absolute"),
        ...edgeDeclarations(statement.vertical, statement.horizontal, statement.offset),
      ];
    case "overflow":
      if (statement.mode === "hidden") return [d("overflow", "hidden")];
      return [d(statement.mode === "scroll-y" ? "overflow-y" : "overflow-x", "auto")];
    case "image-fit":
      return [d("object-fit", statement.fit)];
    case "image-focus": {
      const spot =
        statement.horizontal === "center" && statement.vertical === "center"
          ? "center"
          : `${statement.horizontal} ${statement.vertical}`;
      return [d("object-position", spot)];
    }
    case "property": {
      const row = findProperty(statement.name);
      if (row === undefined || !isNativeProperty(row) || row.applies !== "all") return [];
      return [d(row.css, formatNumber(statement.value.value) + (statement.value.type === "length" ? statement.value.unit ?? "" : ""))];
    }
    default:
      return [];
  }
}

function isPositioned(statement: StatementNode): boolean {
  return statement.type === "sticky" || statement.type === "position";
}

/**
 * Declarations for one scope's statements (the base scope, or one
 * breakpoint/container scope). `base` is the element's base statements, used
 * to switch a grid back to flex when a scope asks for a row or column.
 */
export function scopeDeclarations(
  statements: readonly StatementNode[],
  parent: F2ParentInfo,
  base: readonly StatementNode[] | null,
): IrDeclaration[] {
  const result: IrDeclaration[] = [];
  for (const statement of statements) result.push(...statementDeclarations(statement, parent));

  if (base === null) {
    // A layer needs a positioned box to take effect.
    const hasLayer = statements.some(
      (statement) => statement.type === "property" && findProperty(statement.name)?.name === "layer",
    );
    if (hasLayer && !statements.some(isPositioned)) result.push({ property: "position", value: "relative" });
  } else {
    const baseGrid = base.some((statement) => statement.type === "grid");
    const scopeGrid = statements.some((statement) => statement.type === "grid");
    const scopeDirection = statements.some(
      (statement) => statement.type === "layout" && statement.property === "direction",
    );
    if (baseGrid && scopeDirection && !scopeGrid) result.push({ property: "display", value: "flex" });
  }
  return result;
}

/** Declarations an element needs because of what its children say. */
export function parentDeclarations(
  element: ElementNode,
  baseStatements: readonly StatementNode[],
  parent: F2ParentInfo,
): IrDeclaration[] {
  const result: IrDeclaration[] = [];
  const childStatements = element.children.flatMap((child) => child.statements);
  const placesChild = element.children.some((child) =>
    allStatements(child).some((statement) => statement.type === "position" && statement.mode === "placed"),
  );
  if (placesChild && !baseStatements.some(isPositioned)) {
    result.push({ property: "position", value: "relative" });
  }
  if (childStatements.some((statement) => statement.type === "scoped" && statement.scope.kind === "container")) {
    result.push({ property: "container-type", value: "inline-size" });
    // Size containment ignores the content's width, so a parent that would
    // hug its content would collapse: make it fill its slot instead.
    if (parent.arrangement === "column") result.push({ property: "align-self", value: "stretch" });
    if (parent.arrangement === "row") result.push({ property: "flex-grow", value: "1" });
  }
  return result;
}

export function allStatements(element: ElementNode): StatementNode[] {
  return element.statements.map((statement) =>
    statement.type === "responsive" || statement.type === "scoped" ? statement.statement : statement,
  );
}

export function isF2Statement(statement: StatementNode): statement is F2Statement {
  return F2_TYPES.has(statement.type);
}

const F2_TYPES: ReadonlySet<string> = new Set([
  "size-limit",
  "aspect-ratio",
  "fluid-text",
  "flex-rule",
  "child-rule",
  "grid",
  "column-span",
  "sticky",
  "position",
  "overflow",
  "image-fit",
  "image-focus",
  "loading",
]);

/** The parent arrangement seen by children, from base statements and defaults. */
export function arrangementOf(
  statements: readonly StatementNode[],
  direction: "row" | "column" | null,
): F2ParentInfo["arrangement"] {
  if (statements.some((statement) => statement.type === "grid")) return "grid";
  return direction;
}

/**
 * Group scoped statements by scope, ordered so the more specific scope comes
 * later in the stylesheet: breakpoints by ascending min-width, then
 * `wider than` by ascending width, then `narrower than` by descending width.
 */
export function groupScopes(
  element: ElementNode,
): readonly { readonly scope: StatementScope; readonly statements: StatementNode[]; readonly order: number; readonly query: string }[] {
  const groups = new Map<string, { scope: StatementScope; statements: StatementNode[]; order: number; query: string }>();
  for (const statement of element.statements) {
    if (statement.type !== "scoped") continue;
    const { query, order } = describeScope(statement);
    const group = groups.get(query) ?? { scope: statement.scope, statements: [], order, query };
    group.statements.push(statement.statement);
    groups.set(query, group);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || (a.query < b.query ? -1 : a.query > b.query ? 1 : 0));
}

function describeScope(statement: ScopedStatement): { query: string; order: number } {
  const scope = statement.scope;
  if (scope.kind === "breakpoint") {
    return { query: `@media (min-width: ${scope.minWidth}px)`, order: scope.minWidth };
  }
  const width = px(scope.width);
  const operator = scope.comparison === "narrower" ? "<" : ">";
  return {
    query: `@container (width ${operator} ${length(scope.width)})`,
    order: scope.comparison === "wider" ? 1_000_000 + width : 3_000_000 - width,
  };
}
