import type {
  BuiltinKindName,
  ColorValue,
  DocumentNode,
  ElementNode,
  KindNode,
  LengthValue,
  PageSettingNode,
  ResponsiveStatement,
  StatementNode,
} from "../ast/nodes.js";
import type { DiagnosticBag } from "../diagnostics/diagnostic.js";
import type { Span } from "../source/source-file.js";
import { BUILTIN_KIND_INFO } from "./kind.js";

const TEXT_CONTENT: ReadonlySet<BuiltinKindName> = new Set([
  "button",
  "link",
  "main heading",
  "section heading",
  "minor heading",
  "paragraph",
]);

const TEXT_BEARING: ReadonlySet<BuiltinKindName> = new Set([
  ...TEXT_CONTENT,
  "text field",
]);

const CONTAINERS: ReadonlySet<BuiltinKindName> = new Set([
  "card",
  "container",
  "navigation bar",
]);

export interface ValidateOptions {
  /** Component definitions contain unresolved instances until M6 expansion. */
  readonly allowComponentKinds?: boolean | undefined;
  /** Component definitions may declare content slots; pages may not. */
  readonly allowSlotKinds?: boolean | undefined;
}

/**
 * Structural and typed checks that are part of the M1 front end: duplicate
 * properties, statement capability, value combinations, and leaf nesting.
 * Project-wide semantics (required content, page references, assets) stay in
 * later milestones.
 */
export function validateDocument(
  document: DocumentNode,
  diagnostics: DiagnosticBag,
  options: ValidateOptions = {},
): void {
  const page = document.page;
  if (page === null) return;

  const settings = new Map<string, Span>();
  for (const setting of page.settings) {
    checkPageSettingDuplicate(setting, settings, diagnostics);
  }

  validateElementTree(page.elements, diagnostics, options);
}

/** Validate one element tree without requiring a page wrapper. */
export function validateElementTree(
  elements: readonly ElementNode[],
  diagnostics: DiagnosticBag,
  options: ValidateOptions = {},
): void {
  for (const element of elements) validateElement(element, diagnostics, options);
}

function checkPageSettingDuplicate(
  setting: PageSettingNode,
  seen: Map<string, Span>,
  diagnostics: DiagnosticBag,
): void {
  const key = `page-${setting.property}`;
  const previous = seen.get(key);
  if (previous !== undefined) {
    diagnostics.error(
      "KDM3004",
      `duplicate page ${setting.property} setting`,
      setting.span,
      "each page setting may appear at most once",
      [{ span: previous, message: "first declared here" }],
    );
    return;
  }
  seen.set(key, setting.span);
}

function validateElement(
  element: ElementNode,
  diagnostics: DiagnosticBag,
  options: ValidateOptions,
): void {
  const kindName = builtinKindName(element.kind);

  if (
    !options.allowComponentKinds &&
    element.kind?.reference.type === "component-kind"
  ) {
    diagnostics.error(
      "KDM3001",
      `component kind ${JSON.stringify(element.kind.reference.name)} requires a project component catalog`,
      element.kind.reference.span,
      "declare the component in kadam.json or remove the component instance",
    );
  }

  if (
    !options.allowSlotKinds &&
    element.kind?.reference.type === "slot-kind"
  ) {
    diagnostics.error(
      "KDM3033",
      "a content slot is only allowed inside a component body",
      element.kind.reference.span,
      "declare the slot in a component file and pass child elements at the instance",
    );
  }

  if (element.kind === null) {
    diagnostics.error(
      "KDM2004",
      `element ${JSON.stringify(element.name)} has no kind sentence`,
      element.nameSpan,
      `add a kind sentence such as "a container" as the first line of the element`,
    );
  }

  if (
    kindName !== null &&
    BUILTIN_KIND_INFO[kindName].category === "leaf" &&
    element.children.length > 0
  ) {
    const firstChild = element.children[0]!;
    diagnostics.error(
      "KDM3010",
      `${kindName} is a leaf kind and cannot contain child elements`,
      firstChild.nameSpan,
      "use a container, card, or navigation bar for child elements",
      [{ span: element.kind!.span, message: `kind declared here` }],
    );
  }

  const baseUsed = new Map<string, Span>();
  if (element.kind?.width !== undefined) baseUsed.set("width", element.kind.span);
  if (element.kind?.height !== undefined) baseUsed.set("height", element.kind.span);

  const responsiveByBreakpoint = new Map<string, ResponsiveStatement[]>();
  for (const statement of element.statements) {
    if (statement.type === "responsive") {
      const list = responsiveByBreakpoint.get(statement.breakpoint) ?? [];
      list.push(statement);
      responsiveByBreakpoint.set(statement.breakpoint, list);
      continue;
    }
    checkCapability(kindName, element.kind, statement, diagnostics);
    checkClickUrl(statement, options, diagnostics);
    checkLengthReferences(statement, options, diagnostics);
    checkColorReferences(statement, options, diagnostics);
    checkDuplicates(statement, baseUsed, diagnostics);
  }

  const baseFacts = collectFacts(element);
  checkValueCombinations(element, baseFacts, diagnostics);

  for (const [breakpoint, statements] of responsiveByBreakpoint) {
    const used = new Map<string, Span>();
    const scopeFacts = collectResponsiveFacts(statements, baseFacts);
    for (const responsive of statements) {
      const inner = responsive.statement;
      if (inner.type === "responsive") {
        diagnostics.error(
          "KDM3013",
          "a responsive statement cannot be nested inside another responsive scope",
          inner.span,
          "use one breakpoint prefix per line",
        );
        continue;
      }
      checkCapability(kindName, element.kind, inner, diagnostics);
      checkClickUrl(inner, options, diagnostics);
      checkLengthReferences(inner, options, diagnostics);
      checkColorReferences(inner, options, diagnostics);
      checkDuplicates(inner, used, diagnostics);
      if (inner.type === "gradient-direction" && !scopeFacts.hasGradient) {
        diagnostics.error(
          "KDM3005",
          `gradient direction on ${breakpoint} requires a gradient in the same scope`,
          inner.span,
          "add a gradient background for this breakpoint or at the base scope",
        );
      }
    }
  }

  for (const child of element.children) {
    validateElement(child, diagnostics, options);
  }
}

function builtinKindName(kind: KindNode | null): BuiltinKindName | null {
  return kind?.reference.type === "builtin-kind" ? kind.reference.name : null;
}

function checkCapability(
  kindName: BuiltinKindName | null,
  kind: KindNode | null,
  statement: StatementNode,
  diagnostics: DiagnosticBag,
): void {
  if (kindName === null) return;
  const reject = (hint: string): void => {
    diagnostics.error(
      "KDM3003",
      `${describeStatement(statement)} is not supported on ${articleFor(kindName)} ${kindName}`,
      statement.span,
      hint,
      kind === null ? undefined : [{ span: kind.span, message: "kind declared here" }],
    );
  };

  switch (statement.type) {
    case "size":
    case "visibility":
    case "motion":
      return;
    case "shadow":
      if (kindName === "divider") {
        reject("a divider does not support shadows");
        return;
      }
      return;
    case "background":
      if (kindName === "divider" && statement.mode === "gradient") {
        reject("a divider supports a solid or absent background, not a gradient");
        return;
      }
      return;
    case "gradient-direction":
      if (kindName === "divider") {
        reject("a divider does not support gradients or gradient directions");
        return;
      }
      return;
    case "border":
    case "corners":
      if (kindName === "divider") {
        reject("a divider does not support borders or rounded corners");
        return;
      }
      return;
    case "typography":
    case "font-family":
      if (!TEXT_BEARING.has(kindName)) {
        reject(
          "typography applies to text-bearing kinds: button, link, headings, paragraph, and text field",
        );
      }
      return;
    case "spacing":
      if (kindName === "divider" && statement.property === "padding") {
        reject("a divider supports margin but not padding");
        return;
      }
      return;
    case "layout":
      if (!CONTAINERS.has(kindName)) {
        reject("layout statements apply to container, card, and navigation bar");
      }
      return;
    case "text":
      if (!TEXT_CONTENT.has(kindName)) {
        reject("text content applies to button, link, headings, and paragraph");
        return;
      }
      if (!textNounMatches(statement.noun, kindName)) {
        reject(
          "the noun in a text statement must match the element kind, or use the generic text form",
        );
      }
      return;
    case "image-source":
    case "image-description":
    case "decorative":
      if (kindName !== "image") {
        reject("image statements apply only to an image");
      }
      return;
    case "field-label":
    case "field-placeholder":
    case "field-type":
    case "required":
      if (kindName !== "text field") {
        reject("field statements apply only to a text field");
      }
      return;
    case "hover":
      if (kindName === "divider") {
        reject("hover effects are not supported on a divider");
        return;
      }
      if (statement.effect.type === "text" && !TEXT_BEARING.has(kindName)) {
        reject("hover text color applies to text-bearing kinds");
        return;
      }
      return;
    case "click":
      if (kindName !== "button" && kindName !== "link") {
        reject("click actions apply only to a button or link");
      }
      return;
    case "responsive":
      return;
  }
}

function textNounMatches(
  noun: "text" | "button" | "link" | "heading" | "paragraph",
  kind: BuiltinKindName,
): boolean {
  switch (noun) {
    case "text":
      return true;
    case "button":
      return kind === "button";
    case "link":
      return kind === "link";
    case "heading":
      return (
        kind === "main heading" ||
        kind === "section heading" ||
        kind === "minor heading"
      );
    case "paragraph":
      return kind === "paragraph";
  }
}

function checkClickUrl(
  statement: StatementNode,
  options: ValidateOptions,
  diagnostics: DiagnosticBag,
): void {
  if (statement.type !== "click") return;
  if (statement.action.type !== "external") return;
  if (options.allowComponentKinds === true) return;
  if (!statement.action.url.includes("{$")) return;
  diagnostics.error(
    "KDM3005",
    "external URLs on a page are literal and cannot contain interpolation",
    statement.action.urlSpan,
    "bind a url property on a component, or write an absolute URL",
  );
}

function checkLengthReferences(
  statement: StatementNode,
  options: ValidateOptions,
  diagnostics: DiagnosticBag,
): void {
  if (options.allowComponentKinds === true) return;

  const report = (value: LengthValue | undefined): void => {
    const reference = value?.reference;
    if (reference === undefined) return;
    diagnostics.error(
      "KDM3027",
      "length interpolation is only allowed in a component body",
      reference.span,
      "declare the placeholder in a component and bind the length at its instance",
    );
  };

  switch (statement.type) {
    case "spacing":
      report(statement.value);
      return;
    case "layout":
      if (statement.property === "gap") report(statement.value);
      return;
    case "size":
      report(statement.width);
      report(statement.height);
      return;
    case "typography":
      if (statement.property === "size") report(statement.value);
      return;
    case "border":
      if (statement.mode === "solid") report(statement.width);
      return;
    case "corners":
      if (statement.mode === "custom") report(statement.radius);
      return;
    case "hover":
      if (statement.effect.type === "lift") report(statement.effect.distance);
      return;
    default:
      return;
  }
}

function checkColorReferences(
  statement: StatementNode,
  options: ValidateOptions,
  diagnostics: DiagnosticBag,
): void {
  if (options.allowComponentKinds === true) return;

  const report = (value: ColorValue | undefined): void => {
    const reference = value?.reference;
    if (reference === undefined) return;
    diagnostics.error(
      "KDM3027",
      "color interpolation is only allowed in a component body",
      reference.span,
      "declare the placeholder in a component and bind the color at its instance",
    );
  };

  switch (statement.type) {
    case "background":
      if (statement.mode === "solid") report(statement.color);
      if (statement.mode === "gradient") {
        report(statement.from);
        report(statement.to);
      }
      return;
    case "border":
      if (statement.mode === "solid") report(statement.color);
      return;
    case "typography":
      if (statement.property === "reference") {
        diagnostics.error(
          "KDM3027",
          "typography interpolation is only allowed in a component body",
          statement.value.span,
          "declare the placeholder in a component and bind the value at its instance",
        );
      } else if (statement.property === "color") {
        report(statement.value);
      }
      return;
    case "hover":
      if (statement.effect.type !== "lift" && statement.effect.type !== "scale") {
        report(statement.effect.color);
      }
      return;
    default:
      return;
  }
}

function describeStatement(statement: StatementNode): string {
  switch (statement.type) {
    case "size":
      return "a size statement";
    case "background":
      return "a background statement";
    case "gradient-direction":
      return "a gradient direction statement";
    case "border":
      return "a border statement";
    case "corners":
      return "a corners statement";
    case "shadow":
      return "a shadow statement";
    case "typography":
      return "a typography statement";
    case "font-family":
      return "a font family statement";
    case "spacing":
      return `${statement.property} statement`;
    case "layout":
      return "a layout statement";
    case "visibility":
      return "an it is hidden statement";
    case "text":
      return "a text statement";
    case "image-source":
      return "an image source statement";
    case "image-description":
      return "an image description statement";
    case "decorative":
      return "an it is decorative statement";
    case "field-label":
      return "a field label statement";
    case "field-placeholder":
      return "a field placeholder statement";
    case "field-type":
      return "a field type statement";
    case "required":
      return "an it is required statement";
    case "hover":
      return "a hover statement";
    case "click":
      return "a click statement";
    case "motion":
      return "an entrance animation";
    case "responsive":
      return "a responsive statement";
  }
}

function articleFor(kind: BuiltinKindName): string {
  return kind === "image" ? "an" : "a";
}

function checkDuplicates(
  statement: StatementNode,
  seen: Map<string, Span>,
  diagnostics: DiagnosticBag,
): void {
  const keys = propertyKeys(statement);
  if (keys.length === 0) return;

  const duplicates = keys.filter((key) => seen.has(key));
  if (duplicates.length > 0) {
    const firstKey = duplicates[0]!;
    const previous = seen.get(firstKey)!;
    diagnostics.error(
      "KDM3004",
      `duplicate ${duplicates.join(" and ")} declaration`,
      statement.span,
      "each property may be declared once per scope; there is no last-write-wins",
      [{ span: previous, message: "first declared here" }],
    );
  }
  for (const key of keys) {
    if (!seen.has(key)) seen.set(key, statement.span);
  }
}

function propertyKeys(statement: StatementNode): string[] {
  switch (statement.type) {
    case "size":
      switch (statement.mode) {
        case "both":
          return ["width", "height"];
        case "width":
        case "full-width":
          return ["width"];
        case "height":
        case "full-height":
          return ["height"];
      }
      return [];
    case "background":
      return ["background"];
    case "gradient-direction":
      return ["gradient-direction"];
    case "border":
      return ["border"];
    case "corners":
      return ["corners"];
    case "shadow":
      return ["shadow"];
    case "typography":
      return [`text-${statement.property}`];
    case "font-family":
      return ["font-family"];
    case "spacing":
      return statement.sides.map((side) => `${statement.property}-${side}`);
    case "layout":
      if (statement.property === "direction") return ["layout-direction"];
      if (statement.property === "gap") return ["gap"];
      return statement.axis === "both"
        ? ["align-horizontal", "align-vertical"]
        : statement.axis === "horizontal"
          ? ["align-horizontal"]
          : ["align-vertical"];
    case "visibility":
      return ["visibility"];
    case "text":
      return ["text"];
    case "image-source":
      return ["image-source"];
    case "image-description":
      return ["image-description"];
    case "decorative":
      return ["decorative"];
    case "field-label":
      return ["field-label"];
    case "field-placeholder":
      return ["field-placeholder"];
    case "field-type":
      return ["field-type"];
    case "required":
      return ["required"];
    case "hover":
      return [`hover-${statement.effect.type}`];
    case "click":
      return ["click"];
    case "motion":
      return ["motion"];
    case "responsive":
      return [];
  }
}

interface ScopeFacts {
  readonly background: "solid" | "none" | "gradient" | null;
  readonly hasBorder: boolean;
  readonly hasGradient: boolean;
}

function collectFacts(element: ElementNode): ScopeFacts {
  let background: ScopeFacts["background"] = null;
  let hasBorder = false;
  let borderDeclared = false;

  for (const statement of element.statements) {
    if (statement.type === "background") {
      background = statement.mode;
    } else if (statement.type === "border") {
      borderDeclared = true;
      hasBorder = statement.mode === "solid" && statement.width.value > 0;
    }
  }

  const kindName = builtinKindName(element.kind);
  if (kindName === "text field" && !borderDeclared) {
    // A text field has a kind-default border; the compiler does not invent one
    // for any other kind. An explicit no-border/zero-width declaration removes
    // that default for hover validation.
    hasBorder = true;
  }

  return {
    background,
    hasBorder,
    hasGradient: background === "gradient",
  };
}

function collectResponsiveFacts(
  statements: readonly ResponsiveStatement[],
  base: ScopeFacts,
): ScopeFacts {
  let background = base.background;
  let hasBorder = base.hasBorder;
  for (const responsive of statements) {
    const statement = responsive.statement;
    if (statement.type === "background") {
      background = statement.mode;
    } else if (statement.type === "border") {
      hasBorder = statement.mode === "solid" && statement.width.value > 0;
    }
  }
  return {
    background,
    hasBorder,
    hasGradient: background === "gradient",
  };
}

function hasGradientInAnyScope(
  element: ElementNode,
  base: ScopeFacts,
): boolean {
  if (base.hasGradient) return true;
  return element.statements.some(
    (statement) =>
      statement.type === "responsive" &&
      statement.statement.type === "background" &&
      statement.statement.mode === "gradient",
  );
}

function checkValueCombinations(
  element: ElementNode,
  facts: ScopeFacts,
  diagnostics: DiagnosticBag,
): void {
  let description: StatementNode | null = null;
  let decorative: StatementNode | null = null;

  for (const statement of element.statements) {
    if (statement.type === "responsive") continue;
    if (statement.type === "image-description") description = statement;
    if (statement.type === "decorative") decorative = statement;

    if (statement.type === "gradient-direction" && !facts.hasGradient) {
      diagnostics.error(
        "KDM3005",
        "gradient direction requires a gradient background",
        statement.span,
        "add has a <color> and <color> gradient before the direction statement",
      );
    }

    if (statement.type === "hover") {
      if (
        statement.effect.type === "background" &&
        hasGradientInAnyScope(element, facts)
      ) {
        diagnostics.error(
          "KDM3015",
          "a hover background color is invalid when any scope uses a gradient background",
          statement.span,
          "use a solid background in every scope or remove the hover background effect",
        );
      }
      if (statement.effect.type === "border" && !facts.hasBorder) {
        diagnostics.error(
          "KDM3014",
          "a hover border color requires a base border with a non-zero width",
          statement.span,
          "add a base border such as has a white border",
        );
      }
    }
  }

  if (description !== null && decorative !== null) {
    const later =
      decorative.span.start.offset > description.span.start.offset
        ? decorative
        : description;
    const earlier = later === decorative ? description : decorative;
    diagnostics.error(
      "KDM3005",
      "an image cannot have both a description and a decorative declaration",
      later.span,
      "keep the description, or remove it and keep it is decorative",
      [{ span: earlier.span, message: "conflicting declaration here" }],
    );
  }
}
