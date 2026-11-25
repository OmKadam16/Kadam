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
import { checkRuntime } from "./runtime-check.js";
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
  /** The project manifest declares a siteUrl (needed for share images). */
  readonly hasSiteUrl?: boolean;
  /** kadam 0.3: custom font names declared in kadam.json. */
  readonly fonts?: ReadonlySet<string>;
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
  if (document.languageVersion !== "0.1") {
    analyzeF1Page(page, routes, diagnostics);
    checkCustomFonts(page.elements, options.fonts ?? new Set(), diagnostics);
    // F4 step 2 (D-36): events and bindings name real elements and typed state.
    checkRuntime(page.elements, diagnostics);
    for (const setting of page.settings) {
      if (setting.property === "share image" && options.hasSiteUrl !== true) {
        diagnostics.error(
          "KDM3005",
          "a share image needs an absolute address; add siteUrl to kadam.json",
          setting.span,
          'set "siteUrl": "https://example.com" in kadam.json (project mode only)',
        );
      }
    }
  }

  return diagnostics.sorted();
}

/** Every `the font is "Name"` must name a font declared in kadam.json. */
function checkCustomFonts(
  elements: readonly ElementNode[],
  fonts: ReadonlySet<string>,
  diagnostics: DiagnosticBag,
): void {
  for (const element of elements) {
    for (const statement of element.statements) {
      const inner = statement.type === "responsive" || statement.type === "scoped" ? statement.statement : statement;
      if (inner.type === "custom-font" && !fonts.has(inner.name)) {
        diagnostics.error(
          "KDM3005",
          `unknown font ${JSON.stringify(inner.name)}`,
          inner.nameSpan,
          fonts.size === 0
            ? `declare it in kadam.json: "fonts": { "${inner.name}": { "source": "assets/fonts/${inner.name.replaceAll(" ", "")}.woff2" } }`
            : `declared fonts: ${[...fonts].map((name) => JSON.stringify(name)).join(", ")}`,
        );
      }
    }
    checkCustomFonts(element.children, fonts, diagnostics);
  }
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
      default:
        analyzeF1Element(element, kind, diagnostics);
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

function findText(element: ElementNode): TextStatement | { type: "text-binding" } | null {
  // kadam 0.3 (F4): text bound to state is the element's text.
  return findStatement(element, "text") ?? (findStatement(element, "text-binding") as { type: "text-binding" } | null);
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
  if (text.type === "text" && text.value.length === 0) {
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
  const kindName = builtinKind(element) ?? "text field";
  if (label === null) {
    diagnostics.error(
      "KDM3009",
      `${kindName} ${JSON.stringify(element.name)} requires a label`,
      element.nameSpan,
      'add the label says "Email"',
    );
  } else if (label.value.length === 0) {
    diagnostics.error(
      "KDM3009",
      `a ${kindName} label cannot be empty`,
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
  return /^[aeiou]/.test(kind) ? "an" : "a";
}

// ---------------------------------------------------------------------------
// kadam 0.3 (F1) content requirements.

const HEADING_LEVELS: Readonly<Partial<Record<BuiltinKindName, number>>> = {
  "main heading": 1,
  "section heading": 2,
  "minor heading": 3,
  "small heading": 4,
};

/** Allowed asset extensions, per use. */
export const ASSET_EXTENSIONS = {
  image: ["png", "jpg", "jpeg", "webp", "avif", "gif", "svg"],
  icon: ["svg", "png"],
  video: ["mp4", "webm"],
  audio: ["mp3", "ogg", "wav", "m4a"],
  captions: ["vtt"],
  pageIcon: ["png", "svg", "ico"],
  shareImage: ["png", "jpg", "jpeg", "webp"],
  download: ["pdf", "zip", "csv", "txt", "png", "jpg", "jpeg", "svg", "webp"],
} as const;

/** Shared path rules for every asset reference (spec §6.11). */
export function checkAssetPath(
  value: string,
  span: Span,
  extensions: readonly string[],
  what: string,
  diagnostics: DiagnosticBag,
): void {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const extension = normalized.slice(normalized.lastIndexOf(".") + 1).toLowerCase();
  const invalid =
    value.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    value.includes("\\") ||
    normalized.includes("?") ||
    normalized.includes("#") ||
    segments.includes("..") ||
    !normalized.includes(".") ||
    !extensions.includes(extension);
  if (invalid) {
    diagnostics.error(
      "KDM3005",
      `invalid ${what} ${JSON.stringify(value)}`,
      span,
      `use a project-root-relative path without .., ending in ${extensions.join(", ")}`,
    );
  }
}

function require(
  element: ElementNode,
  present: boolean,
  what: string,
  hint: string,
  diagnostics: DiagnosticBag,
): void {
  if (present) return;
  diagnostics.error("KDM3009", `${JSON.stringify(element.name)} requires ${what}`, element.nameSpan, hint);
}

function analyzeF1Element(
  element: ElementNode,
  kind: BuiltinKindName,
  diagnostics: DiagnosticBag,
): void {
  const has = (type: StatementNode["type"]): boolean => findStatement(element, type) !== null;
  switch (kind) {
    case "small heading":
    case "list item":
    case "cell":
    case "code block":
    case "badge":
      requireText(element, kind, diagnostics);
      analyzeTextSpans(element, diagnostics);
      return;
    case "expandable section":
      if (!has("summary")) {
        diagnostics.error("KDM3009", "an expandable section requires a title", element.nameSpan,
          `add the title says "..." as a statement in ${element.name}`);
      }
      return;
    case "dialog":
      require(
        element,
        containsHeading(element),
        "a heading inside it, which names the dialog",
        "add a section heading (or any heading) as a child",
        diagnostics,
      );
      return;
    case "section":
      require(
        element,
        containsHeading(element),
        "a heading inside it, which names the section",
        "add a section heading (or any heading) as a child",
        diagnostics,
      );
      return;
    case "table":
      require(element, has("caption"), "a caption", 'add the caption says "..."', diagnostics);
      require(element, element.children.length > 0, "at least one row", "add a row with cells", diagnostics);
      return;
    case "video": {
      const source = findStatement(element, "media-source");
      require(element, source !== null, "a source", 'add it plays "assets/intro.mp4"', diagnostics);
      if (source !== null) checkAssetPath(source.value, source.valueSpan, ASSET_EXTENSIONS.video, "video source", diagnostics);
      const captions = findStatement(element, "captions");
      const noSpeech = findStatement(element, "no-speech");
      if (captions !== null && noSpeech !== null) {
        diagnostics.error("KDM3005", "a video cannot have captions and no speech", noSpeech.span, "remove one of the two statements");
      }
      require(
        element,
        captions !== null || noSpeech !== null,
        "captions, or it has no speech",
        'add the captions are "assets/intro.vtt", or it has no speech if nothing is said',
        diagnostics,
      );
      if (captions !== null) checkAssetPath(captions.value, captions.valueSpan, ASSET_EXTENSIONS.captions, "captions file", diagnostics);
      const poster = findStatement(element, "poster");
      if (poster !== null) checkAssetPath(poster.value, poster.valueSpan, ASSET_EXTENSIONS.image, "poster image", diagnostics);
      return;
    }
    case "audio clip": {
      const source = findStatement(element, "media-source");
      require(element, source !== null, "a source", 'add it plays "assets/episode.mp3"', diagnostics);
      if (source !== null) checkAssetPath(source.value, source.valueSpan, ASSET_EXTENSIONS.audio, "audio source", diagnostics);
      return;
    }
    case "icon": {
      const source = findStatement(element, "image-source");
      require(element, source !== null, "a source", 'add it shows "assets/check.svg"', diagnostics);
      if (source !== null) checkAssetPath(source.value, source.valueSpan, ASSET_EXTENSIONS.icon, "icon source", diagnostics);
      require(
        element,
        has("image-description") || has("decorative"),
        "a description or an explicit decorative marker",
        'add the description says "..." or it is decorative',
        diagnostics,
      );
      return;
    }
    case "text area":
    case "checkbox":
      analyzeField(element, diagnostics);
      return;
    case "dropdown":
    case "radio group":
      analyzeField(element, diagnostics);
      require(element, has("options"), "options", 'add the options are "One", "Two"', diagnostics);
      return;
    case "form":
      require(element, has("form-action"), "a destination", 'add it sends to "https://example.com/subscribe"', diagnostics);
      return;
    default:
      return;
  }
}

function containsHeading(element: ElementNode): boolean {
  return element.children.some((child) => {
    const kind = builtinKind(child);
    return (kind !== null && HEADING_LEVELS[kind] !== undefined) || containsHeading(child);
  });
}

/** Each span's words appear exactly once in the text, and spans never overlap. */
function analyzeTextSpans(element: ElementNode, diagnostics: DiagnosticBag): void {
  const text = findText(element);
  const ranges: { start: number; end: number; span: Span }[] = [];
  for (const statement of element.statements) {
    if (statement.type !== "text-span") continue;
    if (text === null || text.type !== "text") continue;
    const first = statement.at ?? text.value.indexOf(statement.target);
    const count =
      statement.at !== undefined
        ? text.value.slice(statement.at, statement.at + statement.target.length) === statement.target ? 1 : 0
        : first === -1 ? 0 : text.value.split(statement.target).length - 1;
    if (count !== 1) {
      diagnostics.error(
        "KDM3005",
        count === 0
          ? `the words ${JSON.stringify(statement.target)} do not appear in the text`
          : `the words ${JSON.stringify(statement.target)} appear ${count} times in the text`,
        statement.targetSpan,
        "an inline span must name words that appear exactly once; quote a longer phrase",
      );
      continue;
    }
    const range = { start: first, end: first + statement.target.length, span: statement.targetSpan };
    const overlap = ranges.find((other) => range.start < other.end && other.start < range.end);
    if (overlap !== undefined) {
      diagnostics.error(
        "KDM3005",
        `inline span ${JSON.stringify(statement.target)} overlaps another span`,
        statement.targetSpan,
        "spans cannot overlap or nest",
        [{ span: overlap.span, message: "overlapping span" }],
      );
      continue;
    }
    ranges.push(range);
  }
}

function analyzeF1Page(
  page: import("../ast/nodes.js").PageNode,
  routes: ReadonlyMap<string, string>,
  diagnostics: DiagnosticBag,
): void {
  // Page metadata assets.
  for (const setting of page.settings) {
    if (setting.property === "icon") {
      checkAssetPath(setting.value, setting.valueSpan, ASSET_EXTENSIONS.pageIcon, "page icon", diagnostics);
    } else if (setting.property === "share image") {
      checkAssetPath(setting.value, setting.valueSpan, ASSET_EXTENSIONS.shareImage, "share image", diagnostics);
    }
  }

  // F4: in-page links name an element on this page; downloads are assets.
  const names = new Set<string>();
  const collect = (elements: readonly ElementNode[]): void => {
    for (const element of elements) {
      names.add(element.name);
      collect(element.children);
    }
  };
  collect(page.elements);
  const checkLinks = (elements: readonly ElementNode[]): void => {
    for (const element of elements) {
      for (const statement of element.statements) {
        if (statement.type !== "click") continue;
        const action = statement.action;
        if (action.type === "anchor" && !names.has(action.elementName)) {
          diagnostics.error("KDM3012", `no element named ${JSON.stringify(action.elementName)} on this page`, action.elementSpan,
            "an in-page link names an element on the same page; use go to page \"Title\" for another page");
        } else if (action.type === "download") {
          checkAssetPath(action.path, action.valueSpan, ASSET_EXTENSIONS.download, "download", diagnostics);
        }
      }
      checkLinks(element.children);
    }
  };
  checkLinks(page.elements);

  // Heading outline, submit buttons, and inline-span links, in document order.
  const mainHeadings: ElementNode[] = [];
  let previousLevel = 0;
  const visit = (elements: readonly ElementNode[], insideForm: boolean): void => {
    for (const element of elements) {
      const kind = builtinKind(element);
      const level = kind === null ? undefined : HEADING_LEVELS[kind];
      if (level !== undefined) {
        if (level === 1) mainHeadings.push(element);
        if (previousLevel > 0 && level > previousLevel + 1) {
          diagnostics.warning(
            "KDM3009",
            `heading levels skip from ${previousLevel} to ${level}`,
            element.nameSpan,
            "use the next heading level down so the outline stays navigable",
          );
        }
        previousLevel = level;
      }
      for (const statement of element.statements) {
        if (statement.type === "submit") {
          if (!insideForm) {
            diagnostics.error("KDM3005", "a submit button must be inside a form", statement.span, "move the button into a form");
          }
          if (findStatement(element, "click") !== null) {
            diagnostics.error("KDM3005", "a submit button cannot also have a click action", statement.span, "remove the click action");
          }
        }
        if (statement.type === "text-span" && statement.effect.type === "navigate" && !routes.has(statement.effect.pageTitle)) {
          diagnostics.error(
            "KDM3007",
            `unknown page reference ${JSON.stringify(statement.effect.pageTitle)}`,
            statement.effect.pageSpan,
            "use the exact title of a page in the project",
          );
        }
      }
      if (kind !== null && TEXT_CONTENT_KINDS.has(kind)) analyzeTextSpans(element, diagnostics);
      visit(element.children, insideForm || kind === "form");
    }
  };
  visit(page.elements, false);

  if (mainHeadings.length > 1) {
    diagnostics.error(
      "KDM3009",
      "a page has at most one main heading",
      mainHeadings[1]!.nameSpan,
      "use a section heading for the second title",
      [{ span: mainHeadings[0]!.nameSpan, message: "first main heading" }],
    );
  }
}

export function isTextContentKind(kind: BuiltinKindName): boolean {
  return TEXT_CONTENT_KINDS.has(kind);
}

export function requiredContentSpan(element: ElementNode): Span {
  return element.nameSpan;
}
