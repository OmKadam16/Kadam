import type {
  BuiltinKindName,
  ClickStatement,
  ElementNode,
  FieldLabelStatement,
  ImageDescriptionStatement,
  ImageSourceStatement,
  StatementNode,
  TextStatement,
} from "../ast/nodes.js";
import {
  DiagnosticBag,
  type Diagnostic,
} from "../diagnostics/diagnostic.js";
import type { Span } from "../source/source-file.js";

export interface SemanticPage {
  /** Human-facing title; navigation statements use this exact string. */
  readonly title: string;
  /** Route declared by the project manifest, or "/" in single-file mode. */
  readonly route: string;
}

export interface SemanticOptions {
  readonly pages?: readonly SemanticPage[];
}

const TEXT_CONTENT_KINDS: ReadonlySet<BuiltinKindName> = new Set([
  "button",
  "link",
  "main heading",
  "section heading",
  "minor heading",
  "paragraph",
]);

const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|webp|avif|gif|svg)$/i;

/**
 * M2 semantic and accessibility analysis. Syntax and structural diagnostics
 * already come from the parser; this pass adds the content requirements that
 * make a program meaningful and accessible.
 */
export function analyzeDocument(
  document: import("../ast/nodes.js").DocumentNode,
  options: SemanticOptions = {},
): readonly Diagnostic[] {
  const page = document.page;
  if (page === null) return [];

  const diagnostics = new DiagnosticBag();
  const routes = new Map<string, string>();
  for (const candidate of options.pages ?? [{ title: page.title, route: "/" }]) {
    if (!routes.has(candidate.title)) routes.set(candidate.title, candidate.route);
  }

  for (const element of page.elements) {
    analyzeElement(element, routes, diagnostics);
  }

  return diagnostics.sorted();
}

function analyzeElement(
  element: ElementNode,
  routes: ReadonlyMap<string, string>,
  diagnostics: DiagnosticBag,
): void {
  const kind = builtinKind(element);
  if (kind !== null) {
    switch (kind) {
      case "button":
        requireText(element, "button", diagnostics);
        analyzeNavigation(element, routes, diagnostics);
        break;
      case "link":
        requireText(element, "link", diagnostics);
        requireLinkAction(element, diagnostics);
        analyzeNavigation(element, routes, diagnostics);
        break;
      case "main heading":
      case "section heading":
      case "minor heading":
      case "paragraph":
        requireText(element, kind, diagnostics);
        break;
      case "image":
        analyzeImage(element, diagnostics);
        break;
      case "text field":
        analyzeField(element, diagnostics);
        break;
      case "card":
      case "container":
      case "navigation bar":
      case "divider":
        break;
    }
  }

  for (const child of element.children) {
    analyzeElement(child, routes, diagnostics);
  }
}

function builtinKind(element: ElementNode): BuiltinKindName | null {
  return element.kind?.reference.type === "builtin-kind"
    ? element.kind.reference.name
    : null;
}

function findStatement<T extends StatementNode["type"]>(
  element: ElementNode,
  type: T,
): Extract<StatementNode, { type: T }> | null {
  for (const statement of element.statements) {
    if (statement.type === type) {
      return statement as Extract<StatementNode, { type: T }>;
    }
  }
  return null;
}

function findText(element: ElementNode): TextStatement | null {
  return findStatement(element, "text");
}

function requireText(
  element: ElementNode,
  kind: BuiltinKindName,
  diagnostics: DiagnosticBag,
): void {
  const text = findText(element);
  if (text === null) {
    diagnostics.error(
      "KDM3009",
      `${articleFor(kind)} ${kind} requires text`,
      element.nameSpan,
      `add the text says "..." as a statement in ${element.name}`,
    );
    return;
  }
  if (text.value.length === 0) {
    diagnostics.error(
      "KDM3009",
      `${articleFor(kind)} ${kind} cannot have empty text`,
      text.valueSpan,
      "provide a non-empty visible label",
    );
  }
}

function requireLinkAction(
  element: ElementNode,
  diagnostics: DiagnosticBag,
): void {
  const actions = element.statements.filter(
    (statement): statement is ClickStatement => statement.type === "click",
  );
  if (actions.length === 0) {
    diagnostics.error(
      "KDM3009",
      `link ${JSON.stringify(element.name)} requires one click action`,
      element.nameSpan,
      'add when clicked, go to page "..." or when clicked, open "https://..." in a new tab',
    );
  }
}

function analyzeNavigation(
  element: ElementNode,
  routes: ReadonlyMap<string, string>,
  diagnostics: DiagnosticBag,
): void {
  for (const statement of element.statements) {
    if (statement.type !== "click") continue;
    if (statement.action.type !== "navigate") continue;
    if (routes.has(statement.action.pageTitle)) continue;
    diagnostics.error(
      "KDM3007",
      `unknown page reference ${JSON.stringify(statement.action.pageTitle)}`,
      statement.action.pageTitleSpan,
      "use the exact title of a page in the project",
    );
  }
}

function analyzeImage(
  element: ElementNode,
  diagnostics: DiagnosticBag,
): void {
  const source = findStatement(element, "image-source") as ImageSourceStatement | null;
  const description = findStatement(
    element,
    "image-description",
  ) as ImageDescriptionStatement | null;
  const decorative = findStatement(element, "decorative") !== null;

  if (source === null) {
    diagnostics.error(
      "KDM3009",
      `image ${JSON.stringify(element.name)} requires a source`,
      element.nameSpan,
      'add it shows "assets/photo.png"',
    );
  } else {
    validateImageSource(source, diagnostics);
  }

  if (description === null && !decorative) {
    diagnostics.error(
      "KDM3009",
      `image ${JSON.stringify(element.name)} requires alt text or an explicit decorative marker`,
      element.nameSpan,
      'add the description says "..." or it is decorative',
    );
  } else if (description !== null && description.value.length === 0) {
    diagnostics.error(
      "KDM3005",
      "an image description cannot be empty",
      description.valueSpan,
      'write a meaningful description, or use it is decorative for a purely visual image',
    );
  }
}

function validateImageSource(
  source: ImageSourceStatement,
  diagnostics: DiagnosticBag,
): void {
  const value = source.value;
  if (value.length === 0) {
    diagnostics.error(
      "KDM3005",
      "an image source cannot be empty",
      source.valueSpan,
      'use a project-root-relative path such as "assets/photo.png"',
    );
    return;
  }

  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const invalid =
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    value.includes("\\") ||
    normalized.includes("?") ||
    normalized.includes("#") ||
    segments.includes("..") ||
    !IMAGE_EXTENSIONS.test(normalized);

  if (invalid) {
    diagnostics.error(
      "KDM3005",
      `invalid image source ${JSON.stringify(value)}`,
      source.valueSpan,
      "use a project-root-relative path without .., ending in png, jpg, jpeg, webp, avif, gif, or svg",
    );
  }
}

function analyzeField(
  element: ElementNode,
  diagnostics: DiagnosticBag,
): void {
  const label = findStatement(element, "field-label") as FieldLabelStatement | null;
  if (label === null) {
    diagnostics.error(
      "KDM3009",
      `text field ${JSON.stringify(element.name)} requires a label`,
      element.nameSpan,
      'add the label says "Email"',
    );
  } else if (label.value.length === 0) {
    diagnostics.error(
      "KDM3009",
      "a text field label cannot be empty",
      label.valueSpan,
      "provide a visible, non-empty label",
    );
  }

  for (const statement of element.statements) {
    if (
      statement.type === "field-placeholder" &&
      statement.value.length === 0
    ) {
      diagnostics.error(
        "KDM3005",
        "a placeholder cannot be empty",
        statement.valueSpan,
        "write placeholder text, or remove the placeholder statement",
      );
    }
  }
}

function articleFor(kind: BuiltinKindName): string {
  return kind === "image" ? "an" : "a";
}

export function isTextContentKind(kind: BuiltinKindName): boolean {
  return TEXT_CONTENT_KINDS.has(kind);
}

export function requiredContentSpan(element: ElementNode): Span {
  return element.nameSpan;
}
