import type {
  ComponentElementOrigin,
  ComponentInstanceOrigin,
  ColorValue,
  ComponentKindReference,
  ElementNode,
  LengthValue,
  PageNode,
  PropertyBindingNode,
  StatementNode,
} from "../ast/nodes.js";
import { DiagnosticBag, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { Span } from "../source/source-file.js";
import { closestMatches } from "../parser/suggest.js";
import {
  hasMalformedInterpolation,
  interpolateValue,
  type InterpolationBinding,
  type InterpolationBindings,
} from "./interpolate.js";
import type { ComponentCatalog, ComponentRecord } from "./catalog.js";
import { componentKey } from "./catalog.js";
import { collectSlots, isSlotElement, slotName } from "./slot.js";
import { parseColorText, parseLengthText } from "../parser/values.js";

export const MAX_COMPONENT_EXPANSION_DEPTH = 64;
export const MAX_EXPANDED_ELEMENTS = 10_000;

export interface ExpandOptions {
  /** Maximum nested component instantiation depth. */
  readonly maxDepth?: number | undefined;
  /** Maximum number of elements in the expanded page. */
  readonly maxElements?: number | undefined;
}

export interface ExpansionResult {
  /** Null when expansion fails; expansion is all-or-nothing. */
  readonly page: PageNode | null;
  readonly diagnostics: readonly Diagnostic[];
}

interface ExpansionState {
  readonly catalog: ComponentCatalog;
  readonly diagnostics: DiagnosticBag;
  readonly maxDepth: number;
  readonly maxElements: number;
  count: number;
  limitReported: boolean;
  readonly active: string[];
}

/** Caller-expanded children, grouped by the slot they fill. */
interface SlotContent {
  readonly unnamed: readonly ElementNode[];
  readonly named: ReadonlyMap<string, readonly ElementNode[]>;
}

interface ExpansionScope {
  readonly component: string;
  readonly namespace: string | null;
  readonly variant: string | null;
  readonly instancePath: readonly string[];
  readonly instances: readonly ComponentInstanceOrigin[];
  /** Caller-expanded children that fill the component's content slots. */
  readonly content: SlotContent;
  /** Binding hash when the body uses style parameters; otherwise null. */
  readonly styleKey: string | null;
}

/** Expand one page into ordinary built-in element trees. */
export function expandPage(
  page: PageNode,
  catalog: ComponentCatalog,
  options: ExpandOptions = {},
): ExpansionResult {
  const diagnostics = new DiagnosticBag();
  const state: ExpansionState = {
    catalog,
    diagnostics,
    maxDepth: options.maxDepth ?? MAX_COMPONENT_EXPANSION_DEPTH,
    maxElements: options.maxElements ?? MAX_EXPANDED_ELEMENTS,
    count: 0,
    limitReported: false,
    active: [],
  };

  preflightCycles(catalog, diagnostics);
  if (diagnostics.hasErrors) {
    return { page: null, diagnostics: diagnostics.sorted() };
  }

  const elements: ElementNode[] = [];
  for (const element of page.elements) {
    const expanded = expandPageElement(element, state, null);
    if (expanded !== null) elements.push(expanded);
  }

  const sorted = diagnostics.sorted();
  if (diagnostics.hasErrors) return { page: null, diagnostics: sorted };
  return {
    page: { ...page, elements },
    diagnostics: sorted,
  };
}

function expandPageElement(
  element: ElementNode,
  state: ExpansionState,
  scope: ExpansionScope | null,
): ElementNode | null {
  if (isSlotElement(element)) {
    state.diagnostics.error(
      "KDM3033",
      "a content slot is only allowed inside a component body",
      element.kind!.reference.span,
      "declare the slot in a component file and pass child elements at the instance",
    );
    return null;
  }

  if (element.kind?.reference.type === "component-kind") {
    return expandInstance(element, state, null, scope);
  }

  if (element.properties.length > 0) {
    state.diagnostics.error(
      "KDM3030",
      "property bindings require a component kind",
      element.properties[0]!.span,
      "declare the element as a component instance first",
    );
    return null;
  }

  if (!countElement(element, state)) return null;
  const children: ElementNode[] = [];
  for (const child of element.children) {
    const expanded = expandPageElement(child, state, scope);
    if (expanded !== null) children.push(expanded);
  }
  return {
    ...element,
    statements: [...element.statements],
    properties: [],
    children,
  };
}

/**
 * Expand one component-authored node. A content slot may contribute zero or
 * many nodes, so this returns an array; all other elements return one node.
 */
function expandComponentNode(
  element: ElementNode,
  state: ExpansionState,
  bindings: InterpolationBindings,
  scope: ExpansionScope,
): ElementNode[] {
  if (isSlotElement(element)) {
    const name = slotName(element);
    const supplied =
      name === null
        ? scope.content.unnamed
        : scope.content.named.get(name) ?? [];
    if (supplied.length > 0) return [...supplied];
    return expandComponentChildren(element.children, state, bindings, scope);
  }

  if (element.kind?.reference.type === "component-kind") {
    const instance = expandInstance(element, state, bindings, scope);
    return instance === null ? [] : [instance];
  }

  if (element.properties.length > 0) {
    state.diagnostics.error(
      "KDM3030",
      "property bindings require a component kind",
      element.properties[0]!.span,
      "declare the element as a component instance first",
    );
    return [];
  }

  if (!countElement(element, state)) return [];
  const statements = element.statements.map((statement) =>
    substituteStatement(statement, bindings, state.diagnostics),
  );
  return [
    {
      ...element,
      statements,
      properties: [],
      children: expandComponentChildren(
        element.children,
        state,
        bindings,
        scope,
      ),
      componentOrigin: scopeOrigin(scope),
      ...(scope.styleKey === null ? {} : { styleKey: scope.styleKey }),
    },
  ];
}

function expandComponentChildren(
  children: readonly ElementNode[],
  state: ExpansionState,
  bindings: InterpolationBindings,
  scope: ExpansionScope,
): ElementNode[] {
  const result: ElementNode[] = [];
  for (const child of children) {
    result.push(...expandComponentNode(child, state, bindings, scope));
  }
  return result;
}

/** Expand instance children in the caller's scope so they keep caller identity. */
function expandCallerContent(
  children: readonly ElementNode[],
  state: ExpansionState,
  bindings: InterpolationBindings | null,
  scope: ExpansionScope | null,
): ElementNode[] {
  const result: ElementNode[] = [];
  for (const child of children) {
    if (scope === null) {
      const expanded = expandPageElement(child, state, null);
      if (expanded !== null) result.push(expanded);
    } else if (bindings !== null) {
      result.push(...expandComponentNode(child, state, bindings, scope));
    }
  }
  return result;
}

function expandInstance(
  element: ElementNode,
  state: ExpansionState,
  sourceBindings: InterpolationBindings | null,
  scope: ExpansionScope | null,
): ElementNode | null {
  const kind = element.kind;
  if (kind?.reference.type !== "component-kind") return null;

  if (element.statements.length > 0) {
    state.diagnostics.error(
      "KDM3030",
      "a component instance cannot contain appearance or event statements",
      element.statements[0]!.span,
      "move styling and interactions into the component or wrap the instance",
    );
    return null;
  }

  const reference = kind.reference;
  const target = resolveTarget(reference, state);
  if (target === null) return null;

  const nextDepth = state.active.length + 1;
  if (nextDepth > state.maxDepth) {
    state.diagnostics.error(
      "KDM3032",
      `component expansion exceeds the ${state.maxDepth}-level depth limit`,
      kind.span,
      "split the component structure or reduce nesting",
    );
    return null;
  }

  const cycleStart = state.active.indexOf(target.key);
  if (cycleStart !== -1) {
    const cycle = [...state.active.slice(cycleStart), target.key];
    state.diagnostics.error(
      "KDM3028",
      `circular component reference: ${cycle.join(" -> ")}`,
      reference.span,
      "remove one component instance from the cycle",
    );
    return null;
  }

  const selectedVariant = kind.variant?.name ?? null;
  const body = selectBody(target, selectedVariant, kind.variant?.nameSpan ?? kind.span, state);
  if (body === null) return null;
  if (body.length !== 1) {
    state.diagnostics.error(
      "KDM3021",
      `component ${JSON.stringify(target.name)} and each variant must have exactly one root element`,
      body.length === 0 ? target.node.nameSpan : body[1]?.nameSpan ?? body[0]!.nameSpan,
      "add one root element or wrap the content in a container",
    );
    return null;
  }

  const bindings = resolveBindings(element, target, sourceBindings, state);
  if (bindings === null) return null;

  const slots = collectSlots(body);
  if (element.children.length > 0 && slots.total === 0) {
    state.diagnostics.error(
      "KDM3030",
      `component ${JSON.stringify(target.name)} does not accept child elements`,
      element.children[0]!.nameSpan,
      "add a content slot to the component or remove the children",
    );
    return null;
  }

  const unnamed: ElementNode[] = [];
  const named = new Map<string, ElementNode[]>();
  let contentFailed = false;
  for (const child of element.children) {
    if (!isSlotElement(child)) {
      unnamed.push(...expandCallerContent([child], state, sourceBindings, scope));
      continue;
    }

    const childName = slotName(child);
    if (childName === null) {
      state.diagnostics.error(
        "KDM3034",
        "use plain child elements for the unnamed content slot",
        child.nameSpan,
        "remove the a slot kind from the supplied content",
      );
      contentFailed = true;
      continue;
    }
    if (!slots.named.has(childName)) {
      const available = [...slots.named.keys()].sort();
      state.diagnostics.error(
        "KDM3034",
        `this component has no content slot named ${JSON.stringify(childName)}`,
        child.kind?.reference.span ?? child.nameSpan,
        available.length > 0
          ? `available slots: ${available.join(", ")}`
          : "declare a named slot in the component body",
      );
      contentFailed = true;
      continue;
    }
    if (named.has(childName)) {
      state.diagnostics.error(
        "KDM3034",
        `duplicate content for slot ${JSON.stringify(childName)}`,
        child.nameSpan,
        "each named slot accepts one group of children",
      );
      contentFailed = true;
      continue;
    }
    if (child.statements.length > 0 || child.properties.length > 0) {
      state.diagnostics.error(
        "KDM3034",
        "a slot group cannot carry statements or properties",
        child.statements[0]?.span ?? child.properties[0]!.span,
        "style the supplied elements instead",
      );
      contentFailed = true;
      continue;
    }
    named.set(
      childName,
      expandCallerContent(child.children, state, sourceBindings, scope),
    );
  }
  if (contentFailed) return null;

  if (unnamed.length > 0 && !slots.hasUnnamed) {
    state.diagnostics.error(
      "KDM3030",
      "this component has no unnamed content slot",
      element.children.find((child) => !isSlotElement(child))!.nameSpan,
      "pass children inside a named slot group",
    );
    return null;
  }

  const content: SlotContent = { unnamed, named };
  const styleNames = styleReferenceNames(body);
  const styleKey =
    styleNames.size > 0 ? bindingStyleKey(bindings, styleNames) : null;

  const instance: ComponentInstanceOrigin = {
    component: target.name,
    ...(target.namespace === null ? {} : { namespace: target.namespace }),
    variant: selectedVariant,
    instanceName: element.name,
    instanceSpan: element.span,
    componentSpan: target.node.span,
    componentNameSpan: target.node.nameSpan,
  };
  const nextScope: ExpansionScope = {
    component: target.name,
    namespace: target.namespace,
    variant: selectedVariant,
    instancePath: [...(scope?.instancePath ?? []), element.name],
    instances: [...(scope?.instances ?? []), instance],
    content,
    styleKey,
  };

  state.active.push(target.key);
  try {
    const expanded = expandComponentNode(body[0]!, state, bindings, nextScope);
    if (expanded.length !== 1) return null;
    // kadam 0.3 (D-41): the instance root carries its runtime list.
    return element.runtimeList === undefined ? expanded[0]! : { ...expanded[0]!, runtimeList: element.runtimeList };
  } finally {
    state.active.pop();
  }
}

/** Length and color parameters referenced by the selected body's styles. */
function styleReferenceNames(elements: readonly ElementNode[]): Set<string> {
  const names = new Set<string>();
  const add = (reference: { readonly name: string } | undefined): void => {
    if (reference !== undefined) names.add(reference.name);
  };
  const visitStatement = (statement: StatementNode): void => {
    switch (statement.type) {
      case "background":
        if (statement.mode === "solid") add(statement.color.reference);
        if (statement.mode === "gradient") {
          add(statement.from.reference);
          add(statement.to.reference);
        }
        return;
      case "spacing":
        add(statement.value.reference);
        return;
      case "layout":
        if (statement.property === "gap") add(statement.value.reference);
        return;
      case "size":
        add(statement.width?.reference);
        add(statement.height?.reference);
        return;
      case "typography":
        if (statement.property === "reference") {
          names.add(statement.value.name);
        } else if (statement.property === "size" || statement.property === "color") {
          add(statement.value.reference);
        }
        return;
      case "border":
        if (statement.mode === "solid") {
          add(statement.width.reference);
          add(statement.color.reference);
        }
        return;
      case "corners":
        if (statement.mode === "custom") add(statement.radius.reference);
        return;
      case "hover":
        if (statement.effect.type === "lift") {
          add(statement.effect.distance.reference);
        } else if (statement.effect.type !== "scale") {
          add(statement.effect.color.reference);
        }
        return;
      case "responsive":
      case "scoped":
        visitStatement(statement.statement);
        return;
      default:
        return;
    }
  };

  const visitElements = (list: readonly ElementNode[]): void => {
    for (const element of list) {
      for (const statement of element.statements) visitStatement(statement);
      visitElements(element.children);
    }
  };

  visitElements(elements);
  return names;
}

function bindingStyleKey(
  bindings: InterpolationBindings,
  names: ReadonlySet<string>,
): string {
  const entries = [...names]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap((name) => {
      const binding = bindings.get(name);
      return binding === undefined ? [] : [[name, binding] as const];
    });
  let hash = 2166136261;
  for (const [name, binding] of entries) {
    const text = `${name}=${binding.value};`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(36);
}

function scopeOrigin(scope: ExpansionScope): ComponentElementOrigin {
  return {
    component: scope.component,
    ...(scope.namespace === null ? {} : { namespace: scope.namespace }),
    variant: scope.variant,
    instancePath: scope.instancePath,
    instances: scope.instances,
  };
}

function resolveTarget(
  reference: ComponentKindReference,
  state: ExpansionState,
): ComponentRecord | null {
  const target = state.catalog.records.get(
    componentKey(reference.namespace, reference.name),
  );
  if (target !== undefined) return target;

  if (reference.namespace === null) {
    const names = [...state.catalog.records.values()]
      .filter((record) => record.namespace === null)
      .map((record) => record.name);
    const suggestions = closestMatches(reference.name, names, 3);
    state.diagnostics.error(
      "KDM3022",
      `unknown component ${JSON.stringify(reference.name)}`,
      reference.span,
      suggestions.length > 0
        ? `did you mean: ${suggestions.join(", ")}?`
        : "declare the component in kadam.json and its own .kdm file",
    );
    return null;
  }

  if (!state.catalog.namespaces.has(reference.namespace)) {
    const namespaces = [...state.catalog.namespaces].sort();
    state.diagnostics.error(
      "KDM3036",
      `unknown component namespace ${JSON.stringify(reference.namespace)}`,
      reference.namespaceSpan ?? reference.span,
      namespaces.length > 0
        ? `declared namespaces: ${namespaces.join(", ")}`
        : "add a component entry with a namespace to kadam.json",
    );
    return null;
  }

  const projectRecord = state.catalog.records.get(reference.name);
  if (projectRecord !== undefined && projectRecord.namespace === null) {
    state.diagnostics.error(
      "KDM3037",
      `component ${JSON.stringify(reference.name)} belongs to the project namespace`,
      reference.namespaceSpan ?? reference.span,
      `remove "from ${reference.namespace}" or declare a library component with that name`,
    );
    return null;
  }

  const names = [...state.catalog.records.values()]
    .filter((record) => record.namespace === reference.namespace)
    .map((record) => record.name);
  const suggestions = closestMatches(reference.name, names, 3);
  state.diagnostics.error(
    "KDM3036",
    `namespace ${JSON.stringify(reference.namespace)} has no component ${JSON.stringify(reference.name)}`,
    reference.span,
    suggestions.length > 0
      ? `did you mean: ${suggestions.join(", ")}?`
      : `available components: ${names.join(", ") || "none"}`,
  );
  return null;
}

function selectBody(
  target: ComponentRecord,
  variantName: string | null,
  span: Span,
  state: ExpansionState,
): readonly ElementNode[] | null {
  if (variantName === null) return target.node.elements;
  const variant = target.variants.get(variantName);
  if (variant === undefined) {
    const names = [...target.variants.keys()].sort(compareText);
    state.diagnostics.error(
      "KDM3029",
      `unknown variant ${JSON.stringify(variantName)} on component ${JSON.stringify(target.name)}`,
      span,
      names.length > 0
        ? `available variants: ${names.join(", ")}`
        : "this component has no named variants",
    );
    return null;
  }
  return variant.elements;
}

function resolveBindings(
  element: ElementNode,
  target: ComponentRecord,
  sourceBindings: InterpolationBindings | null,
  state: ExpansionState,
): Map<string, InterpolationBinding> | null {
  let failed = false;
  const supplied = new Map<string, PropertyBindingNode>();

  for (const binding of element.properties) {
    if (!target.parameters.has(binding.name)) {
      const names = [...target.parameters.keys()].sort(compareText);
      const suggestions = closestMatches(binding.name, names, 3);
      state.diagnostics.error(
        "KDM3024",
        `unknown property ${JSON.stringify(binding.name)} on component ${JSON.stringify(target.name)}`,
        binding.nameSpan,
        suggestions.length > 0
          ? `did you mean: ${suggestions.join(", ")}?`
          : `available properties: ${names.join(", ") || "none"}`,
      );
      failed = true;
      continue;
    }

    const previous = supplied.get(binding.name);
    if (previous !== undefined) {
      state.diagnostics.error(
        "KDM3025",
        `duplicate property ${JSON.stringify(binding.name)}`,
        binding.span,
        "each component property may be bound once",
        [{ span: previous.span, message: "first bound here" }],
      );
      failed = true;
      continue;
    }
    supplied.set(binding.name, binding);
  }

  const values = new Map<string, InterpolationBinding>();
  for (const parameter of target.node.parameters) {
    const binding = supplied.get(parameter.name);
    if (binding !== undefined) {
      if (sourceBindings === null) {
        // Page files treat braces as literal text. Only component bodies
        // interpolate their own `with` values.
        values.set(parameter.name, { value: binding.value, span: binding.valueSpan });
      } else {
        if (hasMalformedInterpolation(binding.value)) {
          reportMalformedInterpolation(binding.valueSpan, state.diagnostics);
          failed = true;
          values.set(parameter.name, { value: binding.value, span: binding.valueSpan });
          continue;
        }
        const result = interpolateValue(binding.value, binding.valueSpan, sourceBindings);
        reportMissingInterpolation(result.missing, binding.valueSpan, state.diagnostics);
        if (result.missing.length > 0) failed = true;
        values.set(parameter.name, { value: result.value, span: result.span });
      }
      continue;
    }

    if (parameter.defaultValue !== null) {
      values.set(parameter.name, {
        value: parameter.defaultValue,
        span: parameter.defaultValueSpan ?? parameter.nameSpan,
      });
      continue;
    }

    state.diagnostics.error(
      "KDM3023",
      `missing required property ${JSON.stringify(parameter.name)} on component ${JSON.stringify(target.name)}`,
      element.kind?.reference.span ?? element.nameSpan,
      `add: with a ${parameter.name} of "..."`,
      [{ span: parameter.nameSpan, message: "property declared here" }],
    );
    failed = true;
  }

  return failed ? null : values;
}

function substituteStatement(
  statement: StatementNode,
  bindings: InterpolationBindings,
  diagnostics: DiagnosticBag,
): StatementNode {
  switch (statement.type) {
    case "text":
    case "field-label":
    case "field-placeholder":
    case "image-description":
    case "image-source":
      return substituteText(statement, bindings, diagnostics);
    case "click": {
      if (statement.action.type === "external") {
        const url = substituteString(
          statement.action.url,
          statement.action.urlSpan,
          bindings,
          diagnostics,
        );
        return {
          ...statement,
          action: {
            ...statement.action,
            url: url.value,
            urlSpan: url.span,
          },
        };
      }
      if (statement.action.type !== "navigate") return statement;
      const pageTitle = substituteString(
        statement.action.pageTitle,
        statement.action.pageTitleSpan,
        bindings,
        diagnostics,
      );
      return {
        ...statement,
        action: {
          ...statement.action,
          pageTitle: pageTitle.value,
          pageTitleSpan: pageTitle.span,
        },
      };
    }
    case "spacing":
      return {
        ...statement,
        value: resolveLength(statement.value, bindings, diagnostics),
      };
    case "layout":
      if (statement.property !== "gap") return statement;
      return {
        ...statement,
        value: resolveLength(statement.value, bindings, diagnostics),
      };
    case "size":
      return {
        ...statement,
        ...(statement.width === undefined
          ? {}
          : { width: resolveLength(statement.width, bindings, diagnostics) }),
        ...(statement.height === undefined
          ? {}
          : { height: resolveLength(statement.height, bindings, diagnostics) }),
      };
    case "background":
      if (statement.mode === "solid") {
        return {
          ...statement,
          color: resolveColor(statement.color, bindings, diagnostics),
        };
      }
      if (statement.mode === "gradient") {
        return {
          ...statement,
          from: resolveColor(statement.from, bindings, diagnostics),
          to: resolveColor(statement.to, bindings, diagnostics),
        };
      }
      return statement;
    case "typography":
      if (statement.property === "reference") {
        const binding = bindings.get(statement.value.name);
        if (binding === undefined) return statement;
        const length = parseLengthText(binding.value);
        if (length !== null) {
          return { type: "typography", property: "size", value: length, span: statement.span };
        }
        const color = parseColorText(binding.value);
        if (color !== null) {
          return { type: "typography", property: "color", value: color, span: statement.span };
        }
        diagnostics.error(
          "KDM3026",
          `typography value ${JSON.stringify(binding.value)} is not a length or color`,
          statement.value.span,
          "bind a length or color parameter",
        );
        return statement;
      }
      if (statement.property === "size") {
        return {
          ...statement,
          value: resolveLength(statement.value, bindings, diagnostics),
        };
      }
      if (statement.property === "color") {
        return {
          ...statement,
          value: resolveColor(statement.value, bindings, diagnostics),
        };
      }
      return statement;
    case "border":
      if (statement.mode !== "solid") return statement;
      return {
        ...statement,
        width: resolveLength(statement.width, bindings, diagnostics),
        color: resolveColor(statement.color, bindings, diagnostics),
      };
    case "corners":
      if (statement.mode !== "custom") return statement;
      return {
        ...statement,
        radius: resolveLength(statement.radius, bindings, diagnostics),
      };
    case "hover": {
      if (statement.effect.type === "scale") return statement;
      if (statement.effect.type === "lift") {
        return {
          ...statement,
          effect: {
            ...statement.effect,
            distance: resolveLength(
              statement.effect.distance,
              bindings,
              diagnostics,
            ),
          },
        };
      }
      return {
        ...statement,
        effect: {
          ...statement.effect,
          color: resolveColor(statement.effect.color, bindings, diagnostics),
        },
      };
    }
    case "responsive":
    case "scoped":
      return {
        ...statement,
        statement: substituteStatement(statement.statement, bindings, diagnostics),
      };
    default:
      return statement;
  }
}

function resolveColor(
  value: ColorValue,
  bindings: InterpolationBindings,
  diagnostics: DiagnosticBag,
): ColorValue {
  const reference = value.reference;
  if (reference === undefined) return value;
  const binding = bindings.get(reference.name);
  if (binding === undefined) return value;
  const parsed = parseColorText(binding.value);
  if (parsed === null) {
    diagnostics.error(
      "KDM3026",
      `color value ${JSON.stringify(binding.value)} is not a color`,
      reference.span,
      "use a CSS named color or a #RGB/#RRGGBB hex literal",
    );
    return value;
  }
  return parsed;
}

function resolveLength(
  value: LengthValue,
  bindings: InterpolationBindings,
  diagnostics: DiagnosticBag,
): LengthValue {
  const reference = value.reference;
  if (reference === undefined) return value;
  const binding = bindings.get(reference.name);
  if (binding === undefined) return value;
  const parsed = parseLengthText(binding.value);
  if (parsed === null) {
    diagnostics.error(
      "KDM3026",
      `length value ${JSON.stringify(binding.value)} is not a length`,
      reference.span,
      "use px, rem, or 0",
    );
    return value;
  }
  return parsed;
}

function substituteText<T extends { readonly value: string; readonly valueSpan: Span }>(
  statement: T,
  bindings: InterpolationBindings,
  diagnostics: DiagnosticBag,
): T {
  const result = substituteString(statement.value, statement.valueSpan, bindings, diagnostics);
  return { ...statement, value: result.value, valueSpan: result.span };
}

function substituteString(
  value: string,
  span: Span,
  bindings: InterpolationBindings,
  diagnostics: DiagnosticBag,
): { readonly value: string; readonly span: Span } {
  if (hasMalformedInterpolation(value)) {
    reportMalformedInterpolation(span, diagnostics);
    return { value, span };
  }
  const result = interpolateValue(value, span, bindings);
  reportMissingInterpolation(result.missing, span, diagnostics);
  return { value: result.value, span: result.span };
}

function reportMalformedInterpolation(span: Span, diagnostics: DiagnosticBag): void {
  diagnostics.error(
    "KDM3027",
    "malformed component interpolation; expected {$name}",
    span,
    "placeholders use a lower-camel parameter name inside {$...}",
  );
}

function reportMissingInterpolation(
  missing: readonly string[],
  span: Span,
  diagnostics: DiagnosticBag,
): void {
  for (const name of new Set(missing)) {
    diagnostics.error(
      "KDM3027",
      `unknown interpolation parameter ${JSON.stringify(name)}`,
      span,
      "use a parameter declared by the enclosing component",
    );
  }
}

function countElement(element: ElementNode, state: ExpansionState): boolean {
  state.count += 1;
  if (state.count <= state.maxElements) return true;
  if (!state.limitReported) {
    state.limitReported = true;
    state.diagnostics.error(
      "KDM3032",
      `expanded page exceeds the ${state.maxElements}-element limit`,
      element.nameSpan,
      "split the component structure or reduce nesting",
    );
  }
  return false;
}

function preflightCycles(catalog: ComponentCatalog, diagnostics: DiagnosticBag): void {
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (name: string): void => {
    state.set(name, 1);
    stack.push(name);
    const record = catalog.records.get(name);
    for (const use of record?.references ?? []) {
      if (!catalog.records.has(use.component)) continue;
      const next = state.get(use.component) ?? 0;
      if (next === 1) {
        const start = stack.indexOf(use.component);
        const cycle = [...stack.slice(start), use.component];
        diagnostics.error(
          "KDM3028",
          `circular component reference: ${cycle.join(" -> ")}`,
          use.nameSpan,
          "remove one component instance from the cycle",
          cycle.slice(0, -1).map((component) => {
            const target = catalog.records.get(component)!;
            return { span: target.node.nameSpan, message: `component ${component} declared here` };
          }),
        );
      } else if (next === 0) {
        visit(use.component);
      }
    }
    stack.pop();
    state.set(name, 2);
  };

  for (const name of catalog.names) {
    if ((state.get(name) ?? 0) === 0) visit(name);
  }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}