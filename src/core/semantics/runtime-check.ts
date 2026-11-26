import type {
  BuiltinKindName,
  Effect,
  ElementNode,
  ElementReference,
  ExternalDeclaration,
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
          if (statement.type === "scoped" && statement.scope.kind === "state") return true;
          const type = inner(statement).type;
          return type === "event" || type === "remember" || type === "text-binding" || type === "visibility-binding" || type === "starts-hidden" || type === "data-load" || type === "form-state" || type === "background-play" || type === "lightbox";
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

export function checkRuntime(
  elements: readonly ElementNode[],
  diagnostics: DiagnosticBag,
  externals: readonly ExternalDeclaration[] = [],
): void {
  const index = indexPage(elements);
  const visibilityTargets = new Map<ElementNode, true>();
  const bound = new Set<ElementNode>();
  const loaders = checkLoaders(elements, index, diagnostics);
  // F5 step 7: each state kept in the address has its own query name.
  const addressed = new Map<string, DeclaredState>();
  for (const declared of index.states) {
    const statement = declared.owner.statements.find((s) => s.type === "remember" && s.name === declared.name);
    if (statement?.type !== "remember" || statement.inAddress !== true) continue;
    const previous = addressed.get(declared.name);
    if (previous !== undefined) {
      diagnostics.error("KDM3044", `two states named ${declared.name} are kept in the address`, statement.nameSpan, "give each state kept in the address its own name");
    }
    addressed.set(declared.name, declared);
  }

  const state = (reference: StateReference, from: ElementNode, expected: StateType | null, what: string): DeclaredState | null => {
    const resolved = resolveState(reference, from, index);
    if (typeof resolved === "string") {
      diagnostics.error("KDM3012", resolved, reference.span, "state is declared with it remembers <name>, a boolean|number|text that starts as <value>");
      return null;
    }
    if (expected !== null && resolved.type !== expected) {
      diagnostics.error("KDM3005", `${what} needs a ${expected} state, but ${resolved.name} is a ${resolved.type}`, reference.span,
        what.startsWith("value ") ? `the external declares this value as ${expected === "text" ? "text" : `a ${expected}`}`
          : expected === "boolean" ? "flip and true/false conditions need a boolean" : "add and subtract need a number");
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
      case "reload":
        if (!loaders.has(value.source)) {
          diagnostics.error("KDM3012", `nothing on this page loads "${value.source}"`, value.span, "reload names the data an element loads with it loads <name> from \"...\"");
        }
        return;
      case "tell":
        if (from.componentOrigin === undefined) {
          diagnostics.error("KDM3012", "tell the page is only used inside a component", value.span,
            "put it in a component file; a page can use show, set, or call instead");
        }
        return;
      case "call": {
        // F6 (D-42): the call matches the external's declared types.
        const external = externals.find((candidate) => candidate.name === value.name);
        if (external === undefined) {
          diagnostics.error("KDM3012", `no external named ${value.name} on this page`, value.nameSpan,
            `declare it in the page body: external ${value.name} from "${value.name}.js" takes text and returns nothing`);
          return;
        }
        if (value.args.length !== external.parameters.length) {
          const count = (n: number): string => (n === 0 ? "nothing" : n === 1 ? "1 value" : `${n} values`);
          diagnostics.error("KDM3005", `${value.name} takes ${count(external.parameters.length)}, but this call passes ${count(value.args.length)}`, value.span,
            external.parameters.length === 0 ? `write: call ${value.name}` : `pass ${external.parameters.map((p) => (p === "text" ? "text" : `a ${p}`)).join(" and ")}`);
          return;
        }
        value.args.forEach((arg, position) => {
          const expected = external.parameters[position]!;
          if (arg.kind === "literal") {
            if (arg.value.kind !== expected) {
              diagnostics.error("KDM3005", `value ${position + 1} of ${value.name} must be ${expected === "text" ? "text" : `a ${expected}`}`, arg.value.span,
                `the external declares: takes ${external.parameters.map((p) => (p === "text" ? "text" : `a ${p}`)).join(" and ")}`);
            }
          } else {
            state(arg.state, from, expected, `value ${position + 1} of ${value.name}`);
          }
        });
        return;
      }
    }
  };

  const visit = (list: readonly ElementNode[]): void => {
    for (const element of list) {
      for (const scoped of element.statements) {
        // kadam 0.3: a style that follows a state names a real state, with a value of its type.
        if (scoped.type === "scoped" && scoped.scope.kind === "state") {
          literal(state(scoped.scope.state, element, null, "a style that follows state"), scoped.scope.value);
        }
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

const STATE_WORDS = { loading: "while loading", empty: "when there are none", error: "when loading fails" } as const;

/**
 * kadam 0.3 (D-41): every element that loads data declares its shape and all
 * three states, each state names an element inside it, and a list shows it.
 * Returns the loaders by name.
 */
function checkLoaders(elements: readonly ElementNode[], index: PageRuntimeIndex, diagnostics: DiagnosticBag): Map<string, ElementNode> {
  const loaders = new Map<string, ElementNode>();
  const lists = new Map<string, ElementNode[]>();
  const descendants = (element: ElementNode): Set<ElementNode> => {
    const found = new Set<ElementNode>();
    const walk = (list: readonly ElementNode[]): void => {
      for (const child of list) {
        found.add(child);
        walk(child.children);
      }
    };
    walk(element.children);
    return found;
  };
  const visit = (list: readonly ElementNode[]): void => {
    for (const element of list) {
      if (element.runtimeList !== undefined) {
        const entry = lists.get(element.runtimeList.source) ?? [];
        entry.push(element);
        lists.set(element.runtimeList.source, entry);
      }
      const load = element.statements.find((s) => s.type === "data-load");
      const shape = element.statements.find((s) => s.type === "data-shape");
      const states = element.statements.filter((s): s is Extract<StatementNode, { type: "data-state" }> => s.type === "data-state");
      if (load === undefined) {
        const stray = shape ?? states[0];
        if (stray !== undefined) {
          diagnostics.error("KDM3045", "this line describes loaded data, but this element does not load any", stray.span, 'add it loads <name> from "..." to the same element');
        }
        visit(element.children);
        continue;
      }
      if (load.type !== "data-load") continue;
      if (loaders.has(load.name)) {
        diagnostics.error("KDM3045", `two elements load "${load.name}"`, load.nameSpan, "give each loaded data its own name");
      }
      loaders.set(load.name, element);
      if (shape === undefined) {
        diagnostics.error("KDM3045", `${element.name} loads ${load.name} but does not say what each record has`, load.span, "add: each <record> has a <field> as text, ...");
      }
      const inside = descendants(element);
      const used = new Map<ElementNode, string>();
      for (const want of ["loading", "empty", "error"] as const) {
        const state = states.find((s) => s.state === want);
        if (state === undefined) {
          diagnostics.error("KDM3045", `${element.name} loads ${load.name} but has no ${STATE_WORDS[want]} state`, load.span, `add: ${STATE_WORDS[want]}, it shows <element name>`);
          continue;
        }
        const target = index.elements.get(state.target);
        if (target === undefined || target === null || !inside.has(target)) {
          diagnostics.error("KDM3012", `${STATE_WORDS[want]} names "${state.target}", which is not an element inside ${element.name}`, state.targetSpan, `name one element inside ${element.name}`);
          continue;
        }
        if (used.has(target)) {
          diagnostics.error("KDM3045", `${state.target} is already the ${used.get(target)} state`, state.targetSpan, "use a different element for each state");
          continue;
        }
        used.set(target, want);
        if (target.statements.some((s) => { const t = inner(s).type; return t === "visibility" || t === "visibility-binding" || t === "starts-hidden"; })) {
          diagnostics.error("KDM3005", `${state.target} is shown and hidden by the data, so it cannot also be hidden by another statement`, state.targetSpan, `remove the hidden statement from ${state.target}`);
        }
      }
      visit(element.children);
    }
  };
  visit(elements);
  // F5 step 7: state filters and paging follow states of the right type.
  const FIELD_STATE: Readonly<Record<string, StateType>> = { text: "text", url: "text", number: "number", "yes/no": "boolean" };
  for (const [name, listElements] of lists) {
    const loader = loaders.get(name);
    const shape = loader?.statements.find((s) => s.type === "data-shape");
    if (shape === undefined || shape.type !== "data-shape") continue;
    for (const list of listElements) {
      const runtime = list.runtimeList!;
      for (const filter of runtime.filters) {
        if (filter.state === undefined) continue;
        const resolved = resolveState(filter.state, list, index);
        if (typeof resolved === "string") {
          diagnostics.error("KDM3012", resolved, filter.state.span, "state is declared with it remembers <name>, a boolean|number|text that starts as <value>");
          continue;
        }
        if (filter.unless !== undefined && typeof filter.unless.value !== (resolved.type === "boolean" ? "boolean" : resolved.type === "number" ? "number" : "string")) {
          diagnostics.error("KDM3005", `${resolved.name} is a ${resolved.type}, so unless it is ... needs a ${resolved.type} value`, filter.unless.span, `use a ${resolved.type} value`);
        }
        const fieldType = shape.fields.find((field) => field.name === filter.field.name)?.type;
        if (fieldType !== undefined && FIELD_STATE[fieldType] !== resolved.type) {
          diagnostics.error("KDM3005", `the field ${filter.field.name} is ${fieldType === "yes/no" ? "true or false" : fieldType}, but ${resolved.name} is a ${resolved.type}`, filter.state.span, "compare a field with a state of the same type");
        }
      }
      if (runtime.paging !== null) {
        const resolved = resolveState(runtime.paging.state, list, index);
        if (typeof resolved === "string") {
          diagnostics.error("KDM3012", resolved, runtime.paging.state.span, "page through with a number state: it remembers page, a number that starts as 1");
        } else if (resolved.type !== "number") {
          diagnostics.error("KDM3005", `paging needs a number state, but ${resolved.name} is a ${resolved.type}`, runtime.paging.state.span, "use a number state that starts as 1");
        }
      }
    }
  }
  for (const [name, element] of loaders) {
    if (!lists.has(name)) {
      const load = element.statements.find((s) => s.type === "data-load")!;
      diagnostics.error("KDM3045", `${name} is loaded but no list shows it`, load.span, `add a component inside ${element.name}: a ProductCard for each <record> in ${name}`);
    }
  }
  return loaders;
}
