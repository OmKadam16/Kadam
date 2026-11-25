import type {
  BuiltinKindName,
  Effect,
  ElementNode,
  ElementReference,
  StateLiteral,
  StateReference,
  StateType,
  StatementNode,
} from "../ast/nodes.js";
import type { DiagnosticBag } from "../diagnostics/diagnostic.js";

/**
 * kadam 0.3 (F4 step 2, D-36): resolve every element and state name used by
 * events and bindings on a page, and check their types. Every mistake is a
 * compile error, so the generated runtime never meets an unknown name.
 */

export interface DeclaredState {
  readonly owner: ElementNode;
  readonly name: string;
  readonly type: StateType;
  readonly initial: StateLiteral;
}

export interface PageRuntimeIndex {
  /** Elements by name; a name used twice on the page maps to null. */
  readonly elements: ReadonlyMap<string, ElementNode | null>;
  readonly states: readonly DeclaredState[];
  readonly parents: ReadonlyMap<ElementNode, ElementNode | null>;
}

function kindOf(element: ElementNode): BuiltinKindName | null {
  return element.kind?.reference.type === "builtin-kind" ? element.kind.reference.name : null;
}

export function inner(statement: StatementNode): StatementNode {
  return statement.type === "responsive" || statement.type === "scoped" ? statement.statement : statement;
}

export function indexPage(elements: readonly ElementNode[]): PageRuntimeIndex {
  const byName = new Map<string, ElementNode | null>();
  const states: DeclaredState[] = [];
  const parents = new Map<ElementNode, ElementNode | null>();
  const visit = (list: readonly ElementNode[], parent: ElementNode | null): void => {
    for (const element of list) {
      parents.set(element, parent);
      byName.set(element.name, byName.has(element.name) ? null : element);
      for (const statement of element.statements) {
        if (statement.type === "remember") {
          states.push({ owner: element, name: statement.name, type: statement.valueType, initial: statement.initial });
        }
      }
      visit(element.children, element);
    }
  };
  visit(elements, null);
  return { elements: byName, states, parents };
}

/** True when any element on the page needs the runtime. */
export function usesRuntime(elements: readonly ElementNode[]): boolean {
  const visit = (list: readonly ElementNode[]): boolean =>
    list.some(
      (element) =>
        kindOf(element) === "dialog" ||
        element.statements.some((statement) => {
          const type = inner(statement).type;
          return type === "event" || type === "remember" || type === "text-binding" || type === "visibility-binding" || type === "starts-hidden";
        }) ||
        visit(element.children),
    );
  return visit(elements);
}

export type ResolvedState = DeclaredState | string;

/** Find the state a reference names, or a message saying why not. */
export function resolveState(reference: StateReference, from: ElementNode, index: PageRuntimeIndex): ResolvedState {
  if (reference.owner !== null) {
    const owner = index.elements.get(reference.owner);
    if (owner === undefined) return `no element named ${JSON.stringify(reference.owner)} on this page`;
    if (owner === null) return `${reference.owner} appears more than once on this page; give it a unique name`;
    const state = index.states.find((candidate) => candidate.owner === owner && candidate.name === reference.name);
    return state ?? `${reference.owner} has no state named ${reference.name}; add it remembers ${reference.name}, ...`;
  }
  // The element itself, then its nearest ancestor that remembers the name.
  for (let owner: ElementNode | null = from; owner !== null; owner = index.parents.get(owner) ?? null) {
    const own = index.states.find((candidate) => candidate.owner === owner && candidate.name === reference.name);
    if (own !== undefined) return own;
  }
  const matches = index.states.filter((candidate) => candidate.name === reference.name);
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) return `no element on this page remembers ${reference.name}`;
  return `${reference.name} is remembered by ${matches.map((m) => m.owner.name).join(" and ")}; write ${reference.name} of <element>`;
}

/** The element a reference names (`it` is the element itself). */
export function resolveElement(reference: ElementReference, from: ElementNode, index: PageRuntimeIndex): ElementNode | string {
  if (reference.name === null) return from;
  const element = index.elements.get(reference.name);
  if (element === undefined) return `no element named ${JSON.stringify(reference.name)} on this page`;
  if (element === null) return `${reference.name} appears more than once on this page; give it a unique name`;
  return element;
}

export function checkRuntime(elements: readonly ElementNode[], diagnostics: DiagnosticBag): void {
  const index = indexPage(elements);
  const visibilityTargets = new Map<ElementNode, true>();
  const bound = new Set<ElementNode>();

  const state = (reference: StateReference, from: ElementNode, expected: StateType | null, what: string): DeclaredState | null => {
    const resolved = resolveState(reference, from, index);
    if (typeof resolved === "string") {
      diagnostics.error("KDM3012", resolved, reference.span, "state is declared with it remembers <name>, a boolean|number|text that starts as <value>");
      return null;
    }
    if (expected !== null && resolved.type !== expected) {
      diagnostics.error("KDM3005", `${what} needs a ${expected} state, but ${resolved.name} is a ${resolved.type}`, reference.span,
        expected === "boolean" ? "flip and true/false conditions need a boolean" : "add and subtract need a number");
      return null;
    }
    return resolved;
  };
  const literal = (resolved: DeclaredState | null, value: StateLiteral): void => {
    if (resolved !== null && value.kind !== resolved.type) {
      diagnostics.error("KDM3005", `${resolved.name} is a ${resolved.type}, not ${value.kind === "text" ? "text" : `a ${value.kind}`}`, value.span,
        `compare or set it with a ${resolved.type} value`);
    }
  };
  const target = (reference: ElementReference, from: ElementNode): ElementNode | null => {
    const resolved = resolveElement(reference, from, index);
    if (typeof resolved === "string") {
      diagnostics.error("KDM3012", resolved, reference.span, "name an element on this page, in quotes");
      return null;
    }
    return resolved;
  };

  const effect = (value: Effect, from: ElementNode): void => {
    switch (value.type) {
      case "visibility": {
        const element = target(value.target, from);
        if (element === null) return;
        visibilityTargets.set(element, true);
        if (element.statements.some((s) => s.type === "visibility")) {
          diagnostics.error("KDM3005", `${element.name} is always hidden (it is hidden), so ${value.mode} cannot change it`, value.target.span,
            `write it starts hidden in ${element.name} instead`);
        }
        return;
      }
      case "open-dialog": {
        const element = target(value.target, from);
        if (element !== null && kindOf(element) !== "dialog") {
          diagnostics.error("KDM3012", `${element.name} is not a dialog`, value.target.span, "open dialog names an element that is a dialog");
        }
        return;
      }
      case "close-dialog": {
        let ancestor = index.parents.get(from) ?? null;
        let inside = kindOf(from) === "dialog";
        while (!inside && ancestor !== null) {
          inside = kindOf(ancestor) === "dialog";
          ancestor = index.parents.get(ancestor) ?? null;
        }
        if (!inside) diagnostics.error("KDM3012", "close the dialog is only used inside a dialog", value.span, "put the button inside the dialog it closes");
        return;
      }
      case "focus":
        target(value.target, from);
        return;
      case "set-state":
        literal(state(value.state, from, null, "set"), value.value);
        return;
      case "flip-state":
        state(value.state, from, "boolean", "flip");
        return;
      case "add-state":
        state(value.state, from, "number", value.amount >= 0 ? "add" : "subtract");
        return;
    }
  };

  const visit = (list: readonly ElementNode[]): void => {
    for (const element of list) {
      for (const scoped of element.statements) {
        const statement = inner(scoped);
        if (statement.type === "event") {
          for (const item of statement.effects) effect(item, element);
        } else if (statement.type === "text-binding") {
          state(statement.state, element, null, "the text shows");
        } else if (statement.type === "visibility-binding") {
          literal(state(statement.state, element, null, "it is hidden unless"), statement.value);
          bound.add(element);
        }
      }
      visit(element.children);
    }
  };
  visit(elements);

  for (const element of visibilityTargets.keys()) {
    if (bound.has(element)) {
      diagnostics.error("KDM3005", `${element.name} is shown by a state condition and also by show/hide/flip`, element.nameSpan,
        "control it one way: either it is hidden unless ..., or show/hide/flip with it starts hidden");
    }
  }
}
