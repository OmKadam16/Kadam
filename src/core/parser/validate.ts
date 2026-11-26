import type {
  BuiltinKindName,
  ColorValue,
  DocumentNode,
  ElementNode,
  KindNode,
  LengthValue,
  PageSettingNode,
  ResponsiveStatement,
  ScopedStatement,
  StatementNode,
} from "../ast/nodes.js";
import type { DiagnosticBag } from "../diagnostics/diagnostic.js";
import type { Span } from "../source/source-file.js";
import { BUILTIN_KIND_INFO } from "./kind.js";
import { findProperty, isNativeProperty } from "./properties.js";

const TEXT_CONTENT: ReadonlySet<BuiltinKindName> = new Set([
  "button",
  "link",
  "main heading",
  "section heading",
  "minor heading",
  "paragraph",
  // kadam 0.3
  "small heading",
  "list item",
  "cell",
  "code block",
  "badge",
]);

/** Kinds whose text may carry inline spans (`the words "x" are bold`). */
const SPAN_TEXT: ReadonlySet<BuiltinKindName> = new Set([
  "main heading",
  "section heading",
  "minor heading",
  "small heading",
  "paragraph",
  "list item",
  "cell",
]);

/** Form controls: label, required, and disabled apply to all of them. */
const FORM_CONTROLS: ReadonlySet<BuiltinKindName> = new Set([
  "text field",
  "text area",
  "checkbox",
  "dropdown",
  "radio group",
]);

const TEXT_BEARING: ReadonlySet<BuiltinKindName> = new Set([
  ...TEXT_CONTENT,
  "text field",
]);

const CONTAINERS: ReadonlySet<BuiltinKindName> = new Set([
  "card",
  "container",
  "navigation bar",
  // kadam 0.3
  "header",
  "footer",
  "section",
  "article",
  "sidebar",
  "form",
  "list",
  "numbered list",
  "dialog",
]);

export interface ValidateOptions {
  /** Component definitions contain unresolved instances until M6 expansion. */
  readonly allowComponentKinds?: boolean | undefined;
  /** Component definitions may declare content slots; pages may not. */
  readonly allowSlotKinds?: boolean | undefined;
  /** The file's language version; kadam 0.3 widens some capabilities. */
  readonly languageVersion?: string | undefined;
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

  validateElementTree(page.elements, diagnostics, { ...options, languageVersion: document.languageVersion });
}

/**
 * kadam 0.3 parent/child rules: list items live in lists, rows in tables,
 * cells in rows, and a header row comes first. Children whose kind is not a
 * built-in (component instances before expansion, slots) are not judged.
 */
const PARENT_RULES: Readonly<Partial<Record<BuiltinKindName, readonly BuiltinKindName[]>>> = {
  "list item": ["list", "numbered list"],
  "header row": ["table"],
  row: ["table"],
  cell: ["header row", "row"],
};
const CHILD_RULES: Readonly<Partial<Record<BuiltinKindName, readonly BuiltinKindName[]>>> = {
  list: ["list item"],
  "numbered list": ["list item"],
  table: ["header row", "row"],
  "header row": ["cell"],
  row: ["cell"],
};

function checkStructure(
  elements: readonly ElementNode[],
  parent: ElementNode | null,
  insideForm: boolean,
  diagnostics: DiagnosticBag,
  /** A component root's parent is the instance's parent, judged after expansion. */
  parentUnknown = false,
): void {
  const parentKind = parent === null ? null : builtinKindName(parent.kind);
  const allowedChildren = parentKind === null ? undefined : CHILD_RULES[parentKind];
  elements.forEach((element, index) => {
    const kind = builtinKindName(element.kind);
    if (kind !== null) {
      const allowedParents = PARENT_RULES[kind];
      if (allowedParents !== undefined && !parentUnknown && (parentKind === null || !allowedParents.includes(parentKind))) {
        diagnostics.error(
          "KDM3010",
          `${articleFor(kind)} ${kind} must be inside ${allowedParents.map((p) => `${articleFor(p)} ${p}`).join(" or ")}`,
          element.nameSpan,
          `move ${element.name} into ${articleFor(allowedParents[0]!)} ${allowedParents[0]}`,
        );
      } else if (allowedChildren !== undefined && !allowedChildren.includes(kind)) {
        diagnostics.error(
          "KDM3010",
          `${articleFor(parentKind!)} ${parentKind} can only contain ${allowedChildren.join(" or ")} elements`,
          element.nameSpan,
          `put ${element.name} inside ${allowedChildren.length === 1 ? `${articleFor(allowedChildren[0]!)} ${allowedChildren[0]}` : "a row"}`,
        );
      }
      if (kind === "header row" && index !== 0) {
        diagnostics.error(
          "KDM3010",
          "a header row must be the first row of its table",
          element.nameSpan,
          "move the header row above the other rows",
        );
      }
      if (kind === "form" && insideForm) {
        diagnostics.error("KDM3010", "a form cannot contain another form", element.nameSpan, "move the inner form out");
      }
    }
    checkLayoutContext(element, parent, diagnostics);
    if ((kind === "card" || kind === "container") && element.statements.some((statement) => statement.type === "click")) {
      const inner = firstInteractive(element.children);
      if (inner !== null) {
        diagnostics.error(
          "KDM3010",
          `a clickable ${kind} cannot contain ${inner.name}, which is interactive`,
          inner.nameSpan,
          `make the ${kind} the only link: remove the click action from ${inner.name}, or the one from ${element.name}`,
        );
      }
    }
    checkStructure(element.children, element, insideForm || kind === "form", diagnostics);
  });
}

/** Validate one element tree without requiring a page wrapper. */
export function validateElementTree(
  elements: readonly ElementNode[],
  diagnostics: DiagnosticBag,
  options: ValidateOptions = {},
): void {
  for (const element of elements) validateElement(element, diagnostics, options);
  checkStructure(elements, null, false, diagnostics, options.allowSlotKinds === true);
  checkPinnedOverlap(elements, diagnostics);
}

function checkPageSettingDuplicate(
  setting: PageSettingNode,
  seen: Map<string, Span>,
  diagnostics: DiagnosticBag,
): void {
  // kadam 0.3: theme colors are keyed by name; dark-mode settings are separate.
  const dark = "dark" in setting && setting.dark === true ? " in dark mode" : "";
  const what = setting.property === "color token" ? `${setting.name} color` : `page ${setting.property}`;
  const key = `${what}${dark}`;
  const previous = seen.get(key);
  if (previous !== undefined) {
    diagnostics.error(
      "KDM3004",
      setting.property === "color token" ? `duplicate ${what}${dark}` : `duplicate page ${setting.property} setting${dark}`,
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

  const responsiveByBreakpoint = new Map<string, (ResponsiveStatement | ScopedStatement)[]>();
  for (const statement of element.statements) {
    if (statement.type === "responsive" || statement.type === "scoped") {
      const key = scopeKey(statement);
      const list = responsiveByBreakpoint.get(key) ?? [];
      list.push(statement);
      responsiveByBreakpoint.set(key, list);
      continue;
    }
    checkCapability(kindName, element.kind, statement, diagnostics, options.languageVersion);
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
      if (inner.type === "responsive" || inner.type === "scoped") {
        diagnostics.error(
          "KDM3013",
          "a responsive statement cannot be nested inside another responsive scope",
          inner.span,
          "use one breakpoint prefix per line",
        );
        continue;
      }
      checkCapability(kindName, element.kind, inner, diagnostics, options.languageVersion);
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

const INTERACTIVE: ReadonlySet<BuiltinKindName> = new Set([
  "button", "link", "text field", "text area", "checkbox", "dropdown", "radio group", "video", "audio clip",
  "expandable section", "form",
]);

/** The first interactive descendant: a link inside a link is invalid HTML. */
function firstInteractive(elements: readonly ElementNode[]): ElementNode | null {
  for (const element of elements) {
    const kind = builtinKindName(element.kind);
    if (kind !== null && INTERACTIVE.has(kind)) return element;
    if (element.statements.some((statement) => statement.type === "click")) return element;
    const nested = firstInteractive(element.children);
    if (nested !== null) return nested;
  }
  return null;
}

/** Statements in the same responsive scope share duplicate detection. */
function scopeKey(statement: ResponsiveStatement | ScopedStatement): string {
  if (statement.type === "responsive") return statement.breakpoint;
  const scope = statement.scope;
  if (scope.kind === "dark") return "dark mode";
  return scope.kind === "breakpoint"
    ? `${scope.name} screens`
    : `parent ${scope.comparison} than ${scope.width.raw}`;
}

/** Every statement of an element, including those inside scopes. */
function allStatements(element: ElementNode): StatementNode[] {
  return element.statements.map((statement) =>
    statement.type === "responsive" || statement.type === "scoped" ? statement.statement : statement,
  );
}

/**
 * kadam 0.3 layout rules that depend on the parent element: child rules and
 * spans need a parent that arranges its children, a placed element and a
 * container condition need a parent element at all.
 */
function checkLayoutContext(element: ElementNode, parent: ElementNode | null, diagnostics: DiagnosticBag): void {
  const parentKind = parent === null ? null : builtinKindName(parent.kind);
  const parentStatements = parent === null ? [] : allStatements(parent);
  const parentHasGrid = parentStatements.some((statement) => statement.type === "grid");
  const needsParent = (statement: StatementNode, what: string): void => {
    diagnostics.error(
      "KDM3010",
      `${what} needs a parent element`,
      statement.span,
      `move ${element.name} inside a container, or remove the statement`,
    );
  };
  for (const scoped of element.statements) {
    if (scoped.type === "scoped" && scoped.scope.kind === "container" && parent === null) {
      needsParent(scoped, "a container condition");
    }
  }
  for (const statement of allStatements(element)) {
    if (statement.type === "child-rule") {
      if (parent === null) {
        needsParent(statement, describeStatement(statement));
      } else if (parentKind !== null && !CONTAINERS.has(parentKind)) {
        diagnostics.error(
          "KDM3010",
          `${describeStatement(statement)} needs a parent that arranges its children`,
          statement.span,
          `${parent.name} is ${articleFor(parentKind)} ${parentKind}; put ${element.name} in a container`,
        );
      }
    } else if (statement.type === "column-span") {
      if (parent === null) {
        needsParent(statement, "an it spans statement");
      } else if (parentKind !== null && !parentHasGrid) {
        diagnostics.error(
          "KDM3010",
          "an it spans statement needs a parent that arranges its children in columns",
          statement.span,
          `add to ${parent.name}: it arranges its children in 3 columns`,
        );
      }
    } else if (statement.type === "position" && statement.mode === "placed" && parent === null) {
      needsParent(statement, "an it is placed statement");
    }
  }
}

/** Warn when two elements are pinned to the same spot: one hides the other. */
function checkPinnedOverlap(elements: readonly ElementNode[], diagnostics: DiagnosticBag): void {
  const seen = new Map<string, ElementNode>();
  const visit = (list: readonly ElementNode[]): void => {
    for (const element of list) {
      for (const statement of element.statements) {
        if (statement.type !== "position" || statement.mode !== "pinned") continue;
        const spot = [statement.vertical, statement.horizontal].filter((edge) => edge !== null).join(" ");
        const key = `${spot}@${statement.offset?.raw ?? "0"}`;
        const first = seen.get(key);
        if (first === undefined) {
          seen.set(key, element);
        } else {
          diagnostics.warning(
            "KDM3038",
            `${element.name} and ${first.name} are both pinned to the ${spot}; one will cover the other`,
            statement.span,
            "pin them to different spots, or put both in one pinned container",
          );
        }
      }
      visit(element.children);
    }
  };
  visit(elements);
}

function builtinKindName(kind: KindNode | null): BuiltinKindName | null {
  return kind?.reference.type === "builtin-kind" ? kind.reference.name : null;
}

function checkCapability(
  kindName: BuiltinKindName | null,
  kind: KindNode | null,
  statement: StatementNode,
  diagnostics: DiagnosticBag,
  languageVersion: string = "0.1",
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
    case "property":
      {
        const row = findProperty(statement.name);
        if (row !== undefined && isNativeProperty(row) && row.applies === "all") return;
      }
      if (!TEXT_BEARING.has(kindName)) {
        reject(`the ${statement.name} applies to text-bearing kinds: button, link, headings, paragraph, and text field`);
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
      if (kindName !== "image" && kindName !== "icon") {
        reject("image statements apply only to an image or icon");
      }
      return;
    case "field-label":
    case "required":
      if (!FORM_CONTROLS.has(kindName)) {
        reject("field statements apply to text field, text area, checkbox, dropdown, and radio group");
      }
      return;
    case "field-placeholder":
      if (kindName !== "text field" && kindName !== "text area" && kindName !== "dropdown") {
        reject("a placeholder applies to a text field, text area, or dropdown");
      }
      return;
    case "field-type":
      if (kindName !== "text field") {
        reject("field statements apply only to a text field");
      }
      return;
    case "caption":
      if (kindName !== "table") reject("a caption applies only to a table");
      return;
    case "media-source":
      if (kindName !== "video" && kindName !== "audio clip") {
        reject("it plays applies to a video or audio clip");
      }
      return;
    case "captions":
    case "poster":
    case "no-speech":
      if (kindName !== "video") reject("captions, posters, and no speech apply only to a video");
      return;
    case "options":
      if (kindName !== "dropdown" && kindName !== "radio group") {
        reject("options apply to a dropdown or radio group");
      }
      return;
    case "checked":
      if (kindName !== "checkbox") reject("it is checked applies only to a checkbox");
      return;
    case "disabled":
      if (kindName !== "button" && !FORM_CONTROLS.has(kindName)) {
        reject("it is disabled applies to a button or a form control");
      }
      return;
    case "length-limit":
      if (kindName !== "text field" && kindName !== "text area") {
        reject("character limits apply to a text field or text area");
      }
      return;
    case "form-action":
      if (kindName !== "form") reject("it sends to applies only to a form");
      return;
    case "submit":
      if (kindName !== "button") reject("it submits the form applies only to a button");
      return;
    case "data-load":
    case "data-shape":
    case "data-state":
      if (!["container", "card", "section", "article", "sidebar", "dialog"].includes(kindName)) {
        reject("loaded data goes in a container, card, section, article, sidebar, or dialog");
      }
      return;
    case "document-source":
      if (!["container", "card", "section", "article", "sidebar", "dialog"].includes(kindName)) {
        reject("a document goes inside a container, card, section, article, sidebar, or dialog");
      }
      return;
    case "text-span":
      if (!SPAN_TEXT.has(kindName)) {
        reject("inline spans apply to headings, paragraphs, list items, and cells");
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
      // kadam 0.3 (F4): a card or container may be one big link.
      if (kindName === "card" || kindName === "container") {
        if (languageVersion !== "0.1") return;
      }
      if (kindName !== "button" && kindName !== "link") {
        reject("click actions apply only to a button or link");
      }
      return;
    case "summary":
    case "starts-open":
      if (kindName !== "expandable section") reject("a title and it starts open apply to an expandable section");
      return;
    case "field-error":
      if (kindName !== "text field" && kindName !== "text area" && kindName !== "dropdown") {
        reject("an error message applies to a text field, text area, or dropdown");
      }
      return;
    case "event":
      if (statement.trigger === "click" && kindName !== "button") {
        reject("click effects apply to a button; a link or card navigates instead");
      }
      return;
    case "text-binding":
      if (!TEXT_CONTENT.has(kindName)) reject("the text shows applies to text kinds: headings, paragraphs, buttons, badges, cells");
      return;
    case "remember":
    case "starts-hidden":
    case "visibility-binding":
      return;
    case "fluid-text":
      if (kindName === "text field") {
        reject("fluid text applies to buttons, links, headings, and paragraphs; give a text field one size");
        return;
      }
      if (!TEXT_BEARING.has(kindName)) {
        reject("fluid text applies to text-bearing kinds: button, link, headings, paragraph, and text field");
      }
      return;
    case "flex-rule":
    case "grid":
      if (!CONTAINERS.has(kindName)) {
        reject("layout statements apply to container, card, and navigation bar");
      }
      return;
    case "image-fit":
    case "image-focus":
      if (kindName !== "image" && kindName !== "video") {
        reject("image fit and focus apply to an image or video");
      }
      return;
    case "loading":
      if (kindName !== "image") reject("it loads lazily applies only to an image");
      return;
    case "size-limit":
    case "aspect-ratio":
    case "content-width":
    case "self-center":
    case "child-rule":
    case "column-span":
    case "sticky":
    case "position":
    case "overflow":
      if (kindName === "divider" && statement.type !== "child-rule" && statement.type !== "column-span") {
        reject("a divider supports margin, color, and spacing only");
      }
      return;
    case "side-border":
    case "corner-radius":
    case "outline":
      if (kindName === "divider") reject("a divider does not support borders, outlines, or rounded corners");
      return;
    case "gradient":
    case "gradient-angle":
    case "background-image":
    case "background-fit":
    case "background-focus":
      if (kindName === "divider") reject("a divider supports margin, color, and spacing only");
      return;
    case "custom-font":
      // A font on a container is inherited by the text inside it.
      if (!TEXT_BEARING.has(kindName) && !CONTAINERS.has(kindName)) {
        reject("a font applies to text-bearing kinds and to containers, whose text inherits it");
      }
      return;
    case "text-decoration":
    case "text-case":
      if (!TEXT_BEARING.has(kindName)) {
        reject("typography applies to text-bearing kinds: button, link, headings, paragraph, and text field");
      }
      return;
    case "text-measure":
    case "line-clamp":
      if (!TEXT_CONTENT.has(kindName)) {
        reject("line length and truncation apply to text kinds: headings, paragraphs, list items, cells, buttons, and links");
      }
      return;
    case "custom-shadow":
    case "filter":
    case "rotate":
    case "move":
    case "scale":
    case "loop":
    case "scroll-entrance":
      return;
    case "stagger":
      if (!CONTAINERS.has(kindName)) reject("its children ... one after another applies to containers");
      return;
    case "state": {
      const allowed: Readonly<Record<string, (kind: BuiltinKindName) => boolean>> = {
        hovered: (kind) => kind !== "divider",
        focused: (kind) => kind === "button" || kind === "link" || FORM_CONTROLS.has(kind),
        pressed: (kind) => kind === "button" || kind === "link",
        disabled: (kind) => kind === "button" || FORM_CONTROLS.has(kind),
        checked: (kind) => kind === "checkbox",
        invalid: (kind) => kind === "text field" || kind === "text area" || kind === "dropdown",
      };
      const hints: Readonly<Record<string, string>> = {
        hovered: "hover effects are not supported on a divider",
        focused: "when focused applies to buttons, links, and form controls",
        pressed: "when pressed applies to buttons and links",
        disabled: "when disabled applies to buttons and form controls",
        checked: "when checked applies to a checkbox",
        invalid: "when invalid applies to a text field, text area, or dropdown",
      };
      if (!allowed[statement.state]!(kindName)) {
        reject(hints[statement.state]!);
        return;
      }
      if (statement.effect.type === "text" && !TEXT_BEARING.has(kindName)) {
        reject("a text color effect applies to text-bearing kinds");
      }
      return;
    }
    case "responsive":
    case "scoped":
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
        kind === "minor heading" ||
        kind === "small heading"
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
    case "property":
      return `a ${statement.name} statement`;
    case "caption":
      return "a caption statement";
    case "media-source":
      return "an it plays statement";
    case "captions":
      return "a captions statement";
    case "poster":
      return "a poster statement";
    case "no-speech":
      return "an it has no speech statement";
    case "options":
      return "an options statement";
    case "checked":
      return "an it is checked statement";
    case "disabled":
      return "an it is disabled statement";
    case "length-limit":
      return "a character limit statement";
    case "form-action":
      return "an it sends to statement";
    case "submit":
      return "an it submits the form statement";
    case "text-span":
      return "an inline span statement";
    case "document-source":
      return "a document statement";
    case "data-load":
      return "an it loads statement";
    case "data-shape":
      return "an each ... has statement";
    case "data-state":
      return `a ${statement.state} state statement`;
    case "size-limit":
      return "a size limit statement";
    case "aspect-ratio":
      return "a shape statement";
    case "content-width":
      return "a width statement";
    case "self-center":
      return "an it is centered statement";
    case "raw-css":
      return `a css ${statement.property} statement`;
    case "stylesheet-class":
      return `a class ${statement.className} statement`;
    case "external":
      return `an external ${statement.name} statement`;
    case "fluid-text":
      return "a fluid text statement";
    case "flex-rule":
      return "a child spacing statement";
    case "child-rule":
      return `an ${statement.rule === "grow" ? "it grows to fill the space" : statement.rule === "end" ? "it sits at the end" : "it does not shrink"} statement`;
    case "grid":
      return "a grid statement";
    case "column-span":
      return "an it spans statement";
    case "sticky":
      return "an it sticks statement";
    case "position":
      return statement.mode === "pinned" ? "an it is pinned statement" : "an it is placed statement";
    case "overflow":
      return "an overflow statement";
    case "image-fit":
      return "an image fit statement";
    case "image-focus":
      return "an image focus statement";
    case "loading":
      return "an image loading statement";
    case "side-border":
      return "a side border statement";
    case "corner-radius":
      return "a per-corner rounding statement";
    case "outline":
      return "an outline statement";
    case "gradient":
      return "a gradient statement";
    case "gradient-angle":
      return "a gradient angle statement";
    case "background-image":
      return "a background image statement";
    case "background-fit":
    case "background-focus":
      return "a background image rule";
    case "text-decoration":
      return "a text decoration statement";
    case "text-case":
      return "a text case statement";
    case "text-measure":
      return "a line length statement";
    case "line-clamp":
      return "a truncation statement";
    case "custom-font":
      return "a custom font statement";
    case "custom-shadow":
      return "a shadow statement";
    case "filter":
      return statement.mode === "blur" ? "a blur statement" : "a backdrop blur statement";
    case "rotate":
      return "a rotation statement";
    case "move":
      return "a move statement";
    case "scale":
      return "a scale statement";
    case "state":
      return `a when ${statement.state} statement`;
    case "scroll-entrance":
      return "a scroll entrance statement";
    case "loop":
      return "a looping animation statement";
    case "stagger":
      return "a staggered entrance statement";
    case "summary":
      return "a title statement";
    case "starts-open":
      return "an it starts open statement";
    case "field-error":
      return "an error message statement";
    case "remember":
      return "a state statement";
    case "starts-hidden":
      return "an it starts hidden statement";
    case "event":
      return statement.trigger === "click" ? "a click effect statement" : `a when the ${statement.key} key is pressed statement`;
    case "text-binding":
      return "a text binding";
    case "visibility-binding":
      return "an it is hidden unless statement";
    case "responsive":
      return "a responsive statement";
    case "scoped":
      return statement.scope.kind === "container" ? "a container condition" : "a custom breakpoint statement";
  }
}

function articleFor(kind: BuiltinKindName): string {
  return /^[aeiou]/.test(kind) ? "an" : "a";
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
    case "property":
      return [statement.name];
    case "length-limit":
      return [`length-${statement.bound}`];
    case "text-span":
      // Several spans per text; overlaps are checked in semantic analysis.
      return [];
    case "data-state":
      return [`data-state-${statement.state}`];
    case "data-load":
    case "data-shape":
    case "document-source":
    case "caption":
    case "media-source":
    case "captions":
    case "poster":
    case "no-speech":
    case "options":
    case "checked":
    case "disabled":
    case "form-action":
    case "submit":
      return [statement.type];
    case "size-limit":
      return [`${statement.bound}-${statement.axis}`];
    case "aspect-ratio":
      return ["aspect-ratio"];
    case "content-width":
      return ["width"];
    case "raw-css":
      return [`css-${statement.property}`];
    case "stylesheet-class":
      return [`class-${statement.className}`];
    case "external":
      return [`external-${statement.name}`];
    case "self-center":
      // It sets both side margins.
      return ["margin-left", "margin-right"];
    case "fluid-text":
      // Same property as `the text is 18px`.
      return ["text-size"];
    case "flex-rule":
      return [statement.rule === "wrap" ? "flex-wrap" : "child-spacing"];
    case "child-rule":
      return [`child-${statement.rule}`];
    case "grid":
      // A grid replaces the row/column direction.
      return ["layout-direction"];
    case "column-span":
      return ["column-span"];
    case "sticky":
    case "position":
      return ["position"];
    case "overflow":
      return statement.mode === "hidden"
        ? ["overflow-x", "overflow-y"]
        : [statement.mode === "scroll-x" ? "overflow-x" : "overflow-y"];
    case "image-fit":
    case "image-focus":
    case "loading":
      return [statement.type];
    case "side-border":
      return statement.sides.map((side) => `border-${side}`);
    case "corner-radius":
      return statement.corners.map((corner) => `corner-${corner}`);
    case "gradient":
      // One background per scope, like has a blue background.
      return ["background"];
    case "gradient-angle":
      return ["gradient-direction"];
    case "custom-font":
      return ["font-family"];
    case "custom-shadow":
      return ["shadow"];
    case "filter":
      return [statement.mode];
    case "move":
      return ["translate"];
    case "state":
      return [`${statement.state}-${statement.effect.type}`];
    case "scroll-entrance":
    case "loop":
      // Both are the element's animation.
      return ["motion"];
    case "outline":
    case "background-image":
    case "background-fit":
    case "background-focus":
    case "text-decoration":
    case "text-case":
    case "text-measure":
    case "line-clamp":
    case "rotate":
    case "scale":
    case "stagger":
    case "summary":
    case "starts-open":
    case "field-error":
      return [statement.type];
    case "remember":
      return [`state-${statement.name}`];
    case "event":
      // A button either navigates or runs effects; a key has one handler.
      return statement.trigger === "click" ? ["click"] : [`key-${statement.key}`];
    case "text-binding":
      return ["text"];
    case "starts-hidden":
    case "visibility-binding":
      return ["visibility"];
    case "responsive":
    case "scoped":
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
    } else if (statement.type === "gradient") {
      background = "gradient";
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
  statements: readonly (ResponsiveStatement | ScopedStatement)[],
  base: ScopeFacts,
): ScopeFacts {
  let background = base.background;
  let hasBorder = base.hasBorder;
  for (const responsive of statements) {
    const statement = responsive.statement;
    if (statement.type === "background") {
      background = statement.mode;
    } else if (statement.type === "gradient") {
      background = "gradient";
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
      (statement.type === "responsive" || statement.type === "scoped") &&
      ((statement.statement.type === "background" && statement.statement.mode === "gradient") ||
        statement.statement.type === "gradient"),
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
    if (statement.type === "responsive" || statement.type === "scoped") continue;
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

    // kadam 0.3 (F3) combinations.
    if (statement.type === "gradient-angle" && !facts.hasGradient) {
      diagnostics.error("KDM3005", "a gradient angle requires a gradient background", statement.span,
        "add has a <color> and <color> gradient");
    }
    if ((statement.type === "gradient-direction" || statement.type === "gradient-angle") &&
        element.statements.some((other) => other.type === "gradient" && other.shape === "radial")) {
      diagnostics.error("KDM3005", "a radial gradient has no direction", statement.span,
        "remove the direction, or use a linear gradient");
    }
    if (statement.type === "background-image" &&
        element.statements.some((other) => other.type === "gradient" || (other.type === "background" && other.mode === "gradient"))) {
      diagnostics.error("KDM3005", "an element cannot have both a background image and a gradient", statement.span,
        "keep one; a solid background color can sit under an image");
    }
    if ((statement.type === "background-fit" || statement.type === "background-focus") &&
        !element.statements.some((other) => other.type === "background-image")) {
      diagnostics.error("KDM3005", "a background image rule requires a background image", statement.span,
        'add has a "assets/..." background image');
    }
    if (statement.type === "state" && statement.effect.type === "border" && !facts.hasBorder) {
      diagnostics.error("KDM3014", `a when ${statement.state} border color requires a base border with a non-zero width`,
        statement.span, "add a base border such as has a white border");
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
