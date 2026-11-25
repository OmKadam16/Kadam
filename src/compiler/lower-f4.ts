import type { Breakpoint, Effect, ElementNode, StateLiteral } from "../core/ast/nodes.js";
import {
  indexPage,
  inner,
  resolveElement,
  resolveState,
  usesRuntime,
  type DeclaredState,
} from "../core/semantics/runtime-check.js";
import { InternalCompilerError } from "./internal-error.js";

/**
 * F4 step 2 (D-36): lower state, events, and bindings into a runtime
 * description. Names were checked in semantic analysis; anything unresolved
 * here is a compiler defect.
 */

export type IrStateValue = boolean | number | string;

export type IrEffect =
  | { readonly type: "visibility"; readonly mode: "show" | "hide" | "flip"; readonly target: string }
  | { readonly type: "open-dialog"; readonly target: string }
  | { readonly type: "close-dialog"; readonly from: string }
  | { readonly type: "focus"; readonly target: string }
  | { readonly type: "set"; readonly key: string; readonly value: IrStateValue }
  | { readonly type: "flip"; readonly key: string }
  | { readonly type: "add"; readonly key: string; readonly amount: number };

export interface IrRuntime {
  /** `assets/kadam.<page>.js`, relative to the site root. */
  readonly script: string;
  readonly states: readonly { readonly key: string; readonly initial: IrStateValue }[];
  readonly handlers: readonly {
    readonly nodeId: string;
    readonly trigger: "click" | "key";
    readonly key?: "Escape" | "Enter";
    readonly effects: readonly IrEffect[];
  }[];
  readonly textBindings: readonly { readonly nodeId: string; readonly key: string }[];
  readonly visibilityBindings: readonly {
    readonly nodeId: string;
    readonly key: string;
    readonly value: IrStateValue;
    /** `data-kdm-hidden`, or `data-kdm-hidden-phones` for a phones-only binding. */
    readonly attribute: string;
  }[];
  /** Buttons that open and close something: they get aria-expanded and aria-controls. */
  readonly controllers: readonly {
    readonly nodeId: string;
    readonly targets: readonly string[];
    /** The boolean state that decides whether the targets are open, if any. */
    readonly key: string | null;
  }[];
  /** Responsive hide attributes the stylesheet must define. */
  readonly scopes: readonly Breakpoint[];
}

export interface RuntimeLowering {
  readonly runtime: IrRuntime;
  /** Extra attributes per element, emitted after `data-kdm-id`. */
  readonly attributes: ReadonlyMap<ElementNode, readonly (readonly [string, string])[]>;
  /** Text an element shows before the runtime loads (its bound state's start). */
  readonly texts: ReadonlyMap<ElementNode, string>;
  /** Elements referenced by aria-controls, which need an `id`. */
  readonly ids: ReadonlySet<ElementNode>;
}

export function value(literal: StateLiteral): IrStateValue {
  return literal.value;
}

export function formatValue(value: IrStateValue): string {
  return String(value);
}

export function lowerRuntime(
  elements: readonly ElementNode[],
  slug: string,
  nodeIdOf: (element: ElementNode) => string,
): RuntimeLowering | null {
  if (!usesRuntime(elements)) return null;
  const index = indexPage(elements);
  const keyOf = (state: DeclaredState): string => `${nodeIdOf(state.owner)}.${state.name}`;
  const stateFor = (reference: Parameters<typeof resolveState>[0], from: ElementNode): DeclaredState => {
    const resolved = resolveState(reference, from, index);
    if (typeof resolved === "string") throw new InternalCompilerError(resolved, reference.span);
    return resolved;
  };
  const elementFor = (reference: Parameters<typeof resolveElement>[0], from: ElementNode): ElementNode => {
    const resolved = resolveElement(reference, from, index);
    if (typeof resolved === "string") throw new InternalCompilerError(resolved, reference.span);
    return resolved;
  };

  const attributes = new Map<ElementNode, [string, string][]>();
  const addAttribute = (element: ElementNode, name: string, value = ""): void => {
    const list = attributes.get(element) ?? [];
    if (!list.some(([existing]) => existing === name)) list.push([name, value]);
    attributes.set(element, list);
  };
  const texts = new Map<ElementNode, string>();
  const ids = new Set<ElementNode>();
  const handlers: IrRuntime["handlers"][number][] = [];
  const textBindings: IrRuntime["textBindings"][number][] = [];
  const visibilityBindings: IrRuntime["visibilityBindings"][number][] = [];
  const controllers: IrRuntime["controllers"][number][] = [];
  const scopes = new Set<Breakpoint>();

  const lowerEffect = (effect: Effect, from: ElementNode): IrEffect => {
    switch (effect.type) {
      case "visibility":
        return { type: "visibility", mode: effect.mode, target: nodeIdOf(elementFor(effect.target, from)) };
      case "open-dialog":
        return { type: "open-dialog", target: nodeIdOf(elementFor(effect.target, from)) };
      case "close-dialog":
        return { type: "close-dialog", from: nodeIdOf(from) };
      case "focus":
        return { type: "focus", target: nodeIdOf(elementFor(effect.target, from)) };
      case "set-state":
        return { type: "set", key: keyOf(stateFor(effect.state, from)), value: value(effect.value) };
      case "flip-state":
        return { type: "flip", key: keyOf(stateFor(effect.state, from)) };
      case "add-state":
        return { type: "add", key: keyOf(stateFor(effect.state, from)), amount: effect.amount };
    }
  };

  // Visibility bindings first: controllers need to know which elements a state opens.
  const openedBy = new Map<string, ElementNode[]>();
  const visit = (list: readonly ElementNode[], visitor: (element: ElementNode) => void): void => {
    for (const element of list) {
      visitor(element);
      visit(element.children, visitor);
    }
  };
  visit(elements, (element) => {
    for (const scoped of element.statements) {
      const statement = inner(scoped);
      if (statement.type === "starts-hidden") addAttribute(element, "data-kdm-hidden");
      if (statement.type === "visibility-binding") {
        const state = stateFor(statement.state, element);
        const breakpoint = scoped.type === "responsive" ? scoped.breakpoint : null;
        if (scoped.type === "scoped") {
          throw new InternalCompilerError("a state condition inside a custom scope reached lowering", scoped.span);
        }
        const attribute = breakpoint === null ? "data-kdm-hidden" : `data-kdm-hidden-${breakpoint}`;
        if (breakpoint !== null) scopes.add(breakpoint);
        visibilityBindings.push({ nodeId: nodeIdOf(element), key: keyOf(state), value: value(statement.value), attribute });
        if (state.initial.value !== statement.value.value) addAttribute(element, attribute);
        if (state.type === "boolean" && statement.value.value === true) {
          const list = openedBy.get(keyOf(state)) ?? [];
          list.push(element);
          openedBy.set(keyOf(state), list);
        }
      }
      if (statement.type === "text-binding") {
        const state = stateFor(statement.state, element);
        textBindings.push({ nodeId: nodeIdOf(element), key: keyOf(state) });
        texts.set(element, formatValue(state.initial.value));
        // State-bound text that changes is announced politely.
        addAttribute(element, "aria-live", "polite");
      }
    }
  });

  visit(elements, (element) => {
    for (const statement of element.statements) {
      if (statement.type !== "event") continue;
      const effects = statement.effects.map((effect) => lowerEffect(effect, element));
      handlers.push({
        nodeId: nodeIdOf(element),
        trigger: statement.trigger,
        ...(statement.key === undefined ? {} : { key: statement.key }),
        effects,
      });
      if (statement.trigger !== "click") continue;
      // A button that flips, shows, or hides something else is a disclosure.
      const targets: ElementNode[] = [];
      let key: string | null = null;
      for (const effect of statement.effects) {
        if (effect.type === "visibility" && effect.target.name !== null) targets.push(elementFor(effect.target, element));
        if (effect.type === "flip-state") {
          const state = stateFor(effect.state, element);
          const opened = openedBy.get(keyOf(state)) ?? [];
          if (opened.length > 0) {
            targets.push(...opened);
            key = keyOf(state);
          }
        }
      }
      if (targets.length > 0) {
        for (const target of targets) ids.add(target);
        controllers.push({ nodeId: nodeIdOf(element), targets: targets.map(nodeIdOf), key });
      }
    }
  });

  return {
    runtime: {
      script: `assets/kadam.${slug}.js`,
      states: index.states.map((state) => ({ key: keyOf(state), initial: value(state.initial) })),
      handlers,
      textBindings,
      visibilityBindings,
      controllers,
      scopes: (["phones", "tablets", "desktops"] as const).filter((breakpoint) => scopes.has(breakpoint)),
    },
    attributes,
    texts,
    ids,
  };
}
