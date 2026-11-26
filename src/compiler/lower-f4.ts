import { stateAttribute } from "./lower-f2.js";
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
  | { readonly type: "add"; readonly key: string; readonly amount: number }
  | { readonly type: "reload"; readonly source: string }
  /** F6 (D-43): dispatch a DOM event named `event` from `from`. */
  | { readonly type: "tell"; readonly from: string; readonly event: string }
  /** F6 (D-42): an external, by its index in `externals`; each argument is [0, value] or [1, state key]. */
  | {
      readonly type: "call";
      readonly module: number;
      readonly name: string;
      readonly args: readonly (readonly [0, IrStateValue] | readonly [1, string])[];
    };

/** kadam 0.3 (D-41): one element that loads data, and the lists that show it. */
export interface IrLoader {
  readonly source: string;
  readonly url: string;
  readonly nodeId: string;
  readonly fields: readonly (readonly [string, "text" | "number" | "yes/no" | "url"])[];
  readonly loading: string;
  readonly empty: string;
  readonly error: string;
  readonly lists: readonly {
    readonly template: string;
    /** [field, negated, value, state key or null, unless value or null]; a state key replaces the value. */
    readonly filters: readonly (readonly [string, boolean, string | number | boolean, string | null, string | number | boolean | null])[];
    readonly sort: readonly [string, boolean] | null;
    readonly limit: number | null;
    /** F5 step 7: [per page, number state key]. */
    readonly paging: readonly [number, string] | null;
  }[];
}

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
  /** kadam 0.3 (D-41): runtime data. */
  readonly loaders: readonly IrLoader[];
  /** F5 step 7: states kept in the address, as [state key, query name]. */
  readonly addressed: readonly (readonly [string, string])[];
  /** F6 (D-42): addresses of the external modules calls import. */
  readonly externals: readonly string[];
  /** F8: background videos the runtime plays (unless motion is reduced) and pauses. */
  readonly backgroundVideos: readonly string[];
  /** F8: images that open larger in a dialog. */
  readonly lightboxes: readonly string[];
  /** kadam 0.3: elements styled while a state has a value; the attribute is present then. */
  readonly whenBindings: readonly { readonly nodeId: string; readonly key: string; readonly value: IrStateValue; readonly attribute: string }[];
  /** D-44: forms that send to a server function, as [form id, sent id, failed id, function]. */
  readonly forms: readonly (readonly [string, string, string, string])[];
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
  externals: readonly { readonly name: string; readonly href: string }[] = [],
  basePath = "",
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
  const whenBindings: IrRuntime["visibilityBindings"][number][] = [];
  const controllers: IrRuntime["controllers"][number][] = [];
  const scopes = new Set<Breakpoint>();

  const modules: string[] = [];
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
      case "reload":
        return { type: "reload", source: effect.source };
      case "tell":
        return { type: "tell", from: nodeIdOf(from), event: effect.event };
      case "call": {
        const external = externals.find((candidate) => candidate.name === effect.name);
        if (external === undefined) throw new InternalCompilerError(`external ${effect.name} reached lowering undeclared`, effect.nameSpan);
        if (!modules.includes(external.href)) modules.push(external.href);
        return {
          type: "call",
          module: modules.indexOf(external.href),
          name: effect.name,
          args: effect.args.map((arg) =>
            arg.kind === "literal" ? ([0, value(arg.value)] as const) : ([1, keyOf(stateFor(arg.state, from))] as const)),
        };
      }
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
      // kadam 0.3: `when suite is "terminal", ...` styles follow a state through an attribute.
      if (scoped.type === "scoped" && scoped.scope.kind === "state") {
        const scope = scoped.scope;
        const attribute = stateAttribute(scope);
        const state = stateFor(scope.state, element);
        if (!whenBindings.some((binding) => binding.nodeId === nodeIdOf(element) && binding.attribute === attribute)) {
          whenBindings.push({ nodeId: nodeIdOf(element), key: keyOf(state), value: value(scope.value), attribute });
          if (state.initial.value === scope.value.value) addAttribute(element, attribute);
        }
        continue;
      }
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

  // kadam 0.3 (D-41): loaders. Empty and error states start hidden; the
  // loading state is a status region and starts shown.
  const loaders: IrLoader[] = [];
  const templates = new Map<string, ElementNode[]>();
  visit(elements, (element) => {
    if (element.runtimeList === undefined) return;
    const list = templates.get(element.runtimeList.source) ?? [];
    list.push(element);
    templates.set(element.runtimeList.source, list);
  });
  // F8: background videos.
  const backgroundVideos: string[] = [];
  const lightboxes: string[] = [];
  visit(elements, (element) => {
    if (element.statements.some((s) => s.type === "background-play")) backgroundVideos.push(nodeIdOf(element));
    if (element.statements.some((s) => s.type === "lightbox")) lightboxes.push(nodeIdOf(element));
  });
  // D-44: forms that send to a server function; both states start hidden.
  const forms: (readonly [string, string, string, string])[] = [];
  visit(elements, (element) => {
    const action = element.statements.find((s) => s.type === "form-action");
    if (action?.type !== "form-action" || action.server === undefined) return;
    const stateOf = (want: "sent" | "failed"): ElementNode => {
      const state = element.statements.find((s) => s.type === "form-state" && s.state === want);
      if (state?.type !== "form-state") throw new InternalCompilerError(`a ${want} state reached lowering unresolved`, action.span);
      return elementFor({ name: state.target, span: state.targetSpan }, element);
    };
    const sent = stateOf("sent");
    const failed = stateOf("failed");
    addAttribute(sent, "data-kdm-hidden");
    addAttribute(sent, "role", "status");
    addAttribute(failed, "data-kdm-hidden");
    addAttribute(failed, "role", "alert");
    forms.push([nodeIdOf(element), nodeIdOf(sent), nodeIdOf(failed), action.server]);
  });
  visit(elements, (element) => {
    const load = element.statements.find((s) => s.type === "data-load");
    if (load === undefined || load.type !== "data-load") return;
    const shape = element.statements.find((s) => s.type === "data-shape");
    const stateOf = (want: "loading" | "empty" | "error"): ElementNode => {
      const state = element.statements.find((s) => s.type === "data-state" && s.state === want);
      if (state === undefined || state.type !== "data-state") throw new InternalCompilerError(`a ${want} state reached lowering unresolved`, load.span);
      return elementFor({ name: state.target, span: state.targetSpan }, element);
    };
    const loading = stateOf("loading");
    const empty = stateOf("empty");
    const error = stateOf("error");
    addAttribute(loading, "role", "status");
    addAttribute(empty, "data-kdm-hidden");
    addAttribute(error, "data-kdm-hidden");
    if (shape === undefined || shape.type !== "data-shape") throw new InternalCompilerError("a loader without a shape reached lowering", load.span);
    loaders.push({
      source: load.name,
      // D-44: server routes live under the site's base path.
      url: load.server === undefined ? load.url : `${basePath}${load.url}`,
      nodeId: nodeIdOf(element),
      fields: shape.fields.map((field) => [field.name, field.type] as const),
      loading: nodeIdOf(loading),
      empty: nodeIdOf(empty),
      error: nodeIdOf(error),
      lists: (templates.get(load.name) ?? []).map((list) => ({
        template: nodeIdOf(list),
        filters: list.runtimeList!.filters.map(
          (filter) =>
            [
              filter.field.name,
              filter.negated,
              filter.value,
              filter.state === undefined ? null : keyOf(stateFor(filter.state, list)),
              filter.unless?.value ?? null,
            ] as const,
        ),
        sort: list.runtimeList!.sort === null ? null : ([list.runtimeList!.sort.field.name, list.runtimeList!.sort.descending] as const),
        limit: list.runtimeList!.limit,
        paging: list.runtimeList!.paging === null ? null : ([list.runtimeList!.paging.perPage, keyOf(stateFor(list.runtimeList!.paging.state, list))] as const),
      })),
    });
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
      loaders,
      addressed: index.states
        .filter((declared) => declared.owner.statements.some((s) => s.type === "remember" && s.name === declared.name && s.inAddress === true))
        .map((declared) => [keyOf(declared), declared.name] as const),
      externals: modules,
      forms,
      whenBindings,
      backgroundVideos,
      lightboxes,
    },
    attributes,
    texts,
    ids,
  };
}
