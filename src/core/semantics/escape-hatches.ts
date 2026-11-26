import type { ElementNode, PageNode, StatementNode } from "../ast/nodes.js";
import type { Span } from "../source/source-file.js";
import type { DiagnosticBag } from "../diagnostics/diagnostic.js";

/**
 * kadam 0.3 (F6, D-42): escape hatches. They are allowed, but always visible:
 * this module finds them, checks stylesheet classes, and reports them.
 */

export function eachStatement(elements: readonly ElementNode[], visit: (statement: StatementNode, element: ElementNode) => void): void {
  for (const element of elements) {
    for (const statement of element.statements) {
      visit(statement, element);
      if (statement.type === "responsive" || statement.type === "scoped") visit(statement.statement, element);
    }
    eachStatement(element.children, visit);
  }
}

/** Stylesheet files the elements take classes from, in first-use order. */
export function usedStylesheets(elements: readonly ElementNode[]): string[] {
  const files: string[] = [];
  eachStatement(elements, (statement) => {
    if (statement.type === "stylesheet-class" && !files.includes(statement.file)) files.push(statement.file);
  });
  return files;
}

/**
 * Every `it also uses the class` names a stylesheet listed in kadam.json, and
 * the class appears in it as a selector. `sheets` is null for a single file
 * built without a project.
 */
export function checkStylesheetClasses(
  elements: readonly ElementNode[],
  sheets: ReadonlyMap<string, string | null> | null,
  diagnostics: DiagnosticBag,
): void {
  eachStatement(elements, (statement) => {
    if (statement.type !== "stylesheet-class") return;
    if (sheets === null || !sheets.has(statement.file)) {
      diagnostics.error(
        "KDM3052",
        `the stylesheet "${statement.file}" is not listed in kadam.json`,
        statement.fileSpan,
        `add it to kadam.json: "stylesheets": ["${statement.file}"]`,
      );
      return;
    }
    const text = sheets.get(statement.file);
    if (text === null || text === undefined) return; // already reported when it was read
    if (!definesClass(text, statement.className)) {
      diagnostics.error(
        "KDM3052",
        `the class "${statement.className}" is not in ${statement.file}`,
        statement.classSpan,
        `check the spelling, or add .${statement.className} to ${statement.file}`,
      );
    }
  });
}

function definesClass(css: string, name: string): boolean {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = name.replace(/[-]/g, "\\-");
  return new RegExp(`\\.${escaped}(?![_a-zA-Z0-9-])`).test(withoutComments);
}

/** One escape hatch in the source, for `kadam check` and strict mode. */
export interface EscapeHatch {
  readonly kind: "css" | "class" | "external";
  /** The property, class or function name. */
  readonly detail: string;
  readonly span: Span;
}

/**
 * Every escape hatch a page uses, once per source position (a component used
 * twice, or a page made for each record, is still one line of source).
 */
export function collectEscapeHatches(page: PageNode, into: EscapeHatch[] = []): EscapeHatch[] {
  const seen = new Set(into.map(key));
  const add = (hatch: EscapeHatch): void => {
    if (seen.has(key(hatch))) return;
    seen.add(key(hatch));
    into.push(hatch);
  };
  for (const external of page.externals ?? []) add({ kind: "external", detail: external.name, span: external.span });
  eachStatement(page.elements, (statement) => {
    if (statement.type === "raw-css") add({ kind: "css", detail: statement.property, span: statement.span });
    if (statement.type === "stylesheet-class") add({ kind: "class", detail: statement.className, span: statement.span });
  });
  return into;
}

function key(hatch: EscapeHatch): string {
  return `${hatch.span.file}:${hatch.span.start.offset}`;
}

/** Strict mode (`kadam check --strict`, or "strict": true in kadam.json) bans every escape hatch. */
export function banEscapeHatches(hatches: readonly EscapeHatch[], diagnostics: DiagnosticBag): void {
  for (const hatch of hatches) {
    const what = hatch.kind === "css" ? `the css ${hatch.detail}` : hatch.kind === "class" ? `the class ${hatch.detail}` : `external ${hatch.detail}`;
    diagnostics.error("KDM3053", `${what} is an escape hatch, and strict mode bans escape hatches`, hatch.span,
      "use a Kadam sentence instead, or turn strict mode off");
  }
}

/** "3 escape hatches (2 css, 1 external)". */
export function describeEscapeHatches(hatches: readonly EscapeHatch[]): string {
  const counts = (["css", "class", "external"] as const)
    .map((kind) => [kind, hatches.filter((hatch) => hatch.kind === kind).length] as const)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind === "class" ? (count === 1 ? "class" : "classes") : kind}`);
  return `${hatches.length} escape hatch${hatches.length === 1 ? "" : "es"} (${counts.join(", ")})`;
}
