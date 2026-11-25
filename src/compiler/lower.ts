import { findProperty, isNativeProperty } from "../core/parser/properties.js";
import type {
  BackgroundStatement,
  BorderStatement,
  Breakpoint,
  BuiltinKindName,
  ClickStatement,
  ColorValue,
  CornersStatement,
  DocumentNode,
  DurationValue,
  ElementNode,
  FieldLabelStatement,
  FieldPlaceholderStatement,
  FieldTypeStatement,
  FontFamilyStatement,
  GradientDirection,
  HoverStatement,
  ImageDescriptionStatement,
  ImageSourceStatement,
  LayoutStatement,
  LengthValue,
  MotionStatement,
  ResponsiveStatement,
  ShadowStatement,
  PropertyStatement,
  SizeStatement,
  SpacingStatement,
  StatementNode,
  TextStatement,
  TypographyStatement,
  VisibilityStatement,
} from "../core/ast/nodes.js";
import {
  GLOBAL_TOKENS,
  cloneComputedStyle,
  createDefaultStyle,
  defaultPageStyle,
  hexColor,
  length,
} from "./defaults.js";
import { InternalCompilerError } from "./internal-error.js";
import type {
  IrAccessibility,
  IrAction,
  IrAsset,
  IrAuthoredStyle,
  IrBackground,
  IrBorder,
  IrColor,
  IrComputedStyle,
  IrCorners,
  IrDuration,
  IrElement,
  IrFieldContent,
  IrFieldStyle,
  IrHoverEffect,
  IrImageContent,
  IrLength,
  IrMotion,
  IrPageStyle,
  IrResponsive,
  IrShadow,
  IrSize,
  IrSourceMapping,
  IrTextContent,
  IrTypography,
  PageIR,
} from "./ir.js";
import {
  assetUrl,
  normalizeBasePath,
  normalizeRoute,
  routeOutputPath,
  routeSlug,
  routeUrl,
} from "./routes.js";

export interface LowerOptions {
  /** Route for the page being compiled. Defaults to `/`. */
  readonly route?: string | undefined;
  /** Page-title to route lookup used by `go to page`. */
  readonly pageRoutes?: ReadonlyMap<string, string> | undefined;
  /** Optional deployment base path. */
  readonly basePath?: string | undefined;
}

type MutableStyle = { -readonly [K in keyof IrComputedStyle]: IrComputedStyle[K] };
type MutableAuthored = { -readonly [K in keyof IrAuthoredStyle]: IrAuthoredStyle[K] };

const BREAKPOINTS: readonly Breakpoint[] = ["phones", "tablets", "desktops"];

export function lowerDocument(
  document: DocumentNode,
  options: LowerOptions = {},
): PageIR {
  const pageNode = document.page;
  if (pageNode === null) {
    throw new InternalCompilerError(
      "cannot lower a document without a page",
      document.span,
    );
  }

  const route = normalizeRoute(options.route ?? "/");
  const slug = routeSlug(route);
  const basePath = normalizeBasePath(options.basePath ?? "");
  const routes =
    options.pageRoutes ?? new Map<string, string>([[pageNode.title, route]]);

  const pageStyle = lowerPageStyle(pageNode.settings);
  const context: LowerContext = { pageStyle, routes, slug, basePath };
  const elements = pageNode.elements.map((element) =>
    lowerElement(element, context),
  );

  return {
    type: "page-ir",
    route,
    routeSlug: slug,
    outputPath: routeOutputPath(route),
    title: pageNode.title,
    sourceFile: document.span.file,
    pageStyle,
    elements,
    assets: collectAssets(elements),
    sourceMap: collectSourceMap(elements),
    usesMotion: elements.some(usesMotion),
    basePath: basePath || undefined,
  };
}

interface LowerContext {
  readonly pageStyle: IrPageStyle;
  readonly routes: ReadonlyMap<string, string>;
  readonly slug: string;
  readonly basePath: string;
}

function lowerPageStyle(
  settings: readonly import("../core/ast/nodes.js").PageSettingNode[],
): IrPageStyle {
  let background = hexColor(GLOBAL_TOKENS.pageBackground);
  let text = hexColor(GLOBAL_TOKENS.pageText);
  let font = defaultPageStyle().font;
  let authoredBackground = false;
  let authoredText = false;
  let authoredFont = false;

  for (const setting of settings) {
    switch (setting.property) {
      case "background":
        background = toIrColor(setting.value);
        authoredBackground = true;
        break;
      case "text":
        text = toIrColor(setting.value);
        authoredText = true;
        break;
      case "font":
        font = setting.value;
        authoredFont = true;
        break;
    }
  }

  return {
    background,
    text,
    font,
    authored: {
      background: authoredBackground,
      text: authoredText,
      font: authoredFont,
    },
  };
}

function lowerElement(element: ElementNode, context: LowerContext): IrElement {
  const kind = elementKind(element);
  const identity = identityFor(element, context.slug);
  const style = createDefaultStyle(kind, context.pageStyle) as MutableStyle;
  const authored: MutableAuthored = {};

  if (element.kind?.width !== undefined) {
    applySizeValue(style, authored, "width", toIrSize(element.kind.width), kind);
  }
  if (element.kind?.height !== undefined) {
    applySizeValue(
      style,
      authored,
      "height",
      toIrSize(element.kind.height),
      kind,
    );
  }

  applyScope(element.statements, style, authored, kind);
  const responsive = lowerResponsive(element, style, kind);

  const text = findStatement(element, "text") as TextStatement | null;
  const image = lowerImage(element, kind, context.basePath);
  const field = lowerField(element, kind, identity.nodeId);
  const action = lowerAction(element, context);
  const hover = lowerHover(element);
  const motion = lowerMotion(element);

  return {
    type: "element",
    nodeId: identity.nodeId,
    className: identity.className,
    kindClass: kindClass(kind),
    name: element.name,
    kind,
    span: element.span,
    nameSpan: element.nameSpan,
    ...(element.componentOrigin === undefined
      ? {}
      : { componentOrigin: element.componentOrigin }),
    style,
    authored: authored as IrAuthoredStyle,
    responsive,
    hover,
    motion,
    action,
    text: text === null ? null : { text: text.value },
    image,
    field,
    accessibility: accessibilityFor(kind, text, image, field, action),
    children: element.children.map((child) => lowerElement(child, context)),
  };
}

function identityFor(
  element: ElementNode,
  pageSlug: string,
): { nodeId: string; className: string } {
  const origin = element.componentOrigin;
  if (origin === undefined) {
    return {
      nodeId: `${pageSlug}-${element.name}`,
      className: `kdm-${pageSlug}-${element.name}`,
    };
  }
  const prefix =
    origin.namespace === undefined ? "" : `${origin.namespace}-`;
  const suffix = element.styleKey === undefined ? "" : `-${element.styleKey}`;
  return {
    nodeId: [pageSlug, ...origin.instancePath, element.name].join("-"),
    className: `kdm-c-${prefix}${origin.component}-${origin.variant ?? "default"}-${element.name}${suffix}`,
  };
}

function lowerResponsive(
  element: ElementNode,
  baseStyle: IrComputedStyle,
  kind: BuiltinKindName,
): readonly IrResponsive[] {
  const result: IrResponsive[] = [];

  for (const breakpoint of BREAKPOINTS) {
    const scoped = element.statements
      .filter(
        (statement): statement is ResponsiveStatement =>
          statement.type === "responsive" && statement.breakpoint === breakpoint,
      )
      .map((statement) => statement.statement);
    if (scoped.length === 0) continue;

    const style = cloneComputedStyle(baseStyle) as MutableStyle;
    const authored: MutableAuthored = {};
    applyScope(scoped, style, authored, kind);
    result.push({
      breakpoint,
      authored: authored as IrAuthoredStyle,
      style,
    });
  }

  return result;
}

function applyScope(
  statements: readonly StatementNode[],
  style: MutableStyle,
  authored: MutableAuthored,
  kind: BuiltinKindName,
): void {
  let gradientDirection: GradientDirection | null = null;

  for (const statement of statements) {
    if (statement.type === "responsive") continue;
    if (statement.type === "gradient-direction") {
      gradientDirection = statement.direction;
      continue;
    }
    applyStatement(statement, style, authored, kind);
  }

  if (gradientDirection !== null) {
    applyGradientDirection(style, authored, gradientDirection);
  }
}

function applyStatement(
  statement: StatementNode,
  style: MutableStyle,
  authored: MutableAuthored,
  kind: BuiltinKindName,
): void {
  switch (statement.type) {
    case "size":
      applySize(statement, style, authored, kind);
      return;
    case "background":
      applyBackground(statement, style, authored);
      return;
    case "border":
      applyBorder(statement, style, authored);
      return;
    case "corners":
      applyCorners(statement, style, authored);
      return;
    case "shadow":
      applyShadow(statement, style, authored);
      return;
    case "typography":
      applyTypography(statement, style, authored);
      return;
    case "font-family":
      applyFontFamily(statement, style, authored);
      return;
    case "spacing":
      applySpacing(statement, style, authored);
      return;
    case "layout":
      applyLayout(statement, style, authored);
      return;
    case "visibility":
      applyVisibility(statement, style, authored);
      return;
    case "property":
      applyProperty(statement, authored);
      return;
    case "gradient-direction":
    case "text":
    case "image-source":
    case "image-description":
    case "decorative":
    case "field-label":
    case "field-placeholder":
    case "field-type":
    case "required":
    case "hover":
    case "click":
    case "motion":
    case "responsive":
      return;
  }
}

function applyProperty(statement: PropertyStatement, authored: MutableAuthored): void {
  const definition = findProperty(statement.name);
  if (definition === undefined || !isNativeProperty(definition)) {
    throw new InternalCompilerError(
      `property ${JSON.stringify(statement.name)} is not a native row of the property table`,
      statement.span,
    );
  }
  const value =
    statement.value.type === "number"
      ? { value: statement.value.value, unit: null }
      : { value: statement.value.value, unit: statement.value.unit };
  authored.properties = [...(authored.properties ?? []), { css: definition.css, value }];
}

function applySize(
  statement: SizeStatement,
  style: MutableStyle,
  authored: MutableAuthored,
  kind: BuiltinKindName,
): void {
  if (statement.width !== undefined) {
    applySizeValue(style, authored, "width", toIrSize(statement.width), kind);
  }
  if (statement.height !== undefined) {
    applySizeValue(style, authored, "height", toIrSize(statement.height), kind);
  }
  if (statement.mode === "full-width") {
    applySizeValue(style, authored, "width", { kind: "full" }, kind);
  }
  if (statement.mode === "full-height") {
    applySizeValue(style, authored, "height", { kind: "full" }, kind);
  }
}

function applySizeValue(
  style: MutableStyle,
  authored: MutableAuthored,
  property: "width" | "height",
  value: IrSize,
  kind: BuiltinKindName,
): void {
  if (kind === "text field" && property === "height" && style.field !== null) {
    style.field = { ...style.field, height: value };
  } else if (property === "width") {
    style.width = value;
  } else {
    style.height = value;
  }
  authored[property] = value;
}

function applyBackground(
  statement: BackgroundStatement,
  style: MutableStyle,
  authored: MutableAuthored,
): void {
  const background = toIrBackground(statement);
  if (style.field !== null) {
    style.field = { ...style.field, background };
  } else {
    style.background = background;
  }
  authored.background = copyBackground(background);
}

function applyGradientDirection(
  style: MutableStyle,
  authored: MutableAuthored,
  direction: GradientDirection,
): void {
  if (style.field !== null) {
    if (style.field.background.kind === "gradient") {
      const background: IrBackground = {
        ...style.field.background,
        direction,
      };
      style.field = { ...style.field, background };
      authored.background = copyBackground(background);
    }
  } else if (style.background.kind === "gradient") {
    const background: IrBackground = { ...style.background, direction };
    style.background = background;
    authored.background = copyBackground(background);
  }
  authored.gradientDirection = true;
}

function applyBorder(
  statement: BorderStatement,
  style: MutableStyle,
  authored: MutableAuthored,
): void {
  const border = toIrBorder(statement);
  if (style.field !== null) {
    style.field = { ...style.field, border };
  } else {
    style.border = border;
  }
  authored.border = copyBorder(border);
}

function applyCorners(
  statement: CornersStatement,
  style: MutableStyle,
  authored: MutableAuthored,
): void {
  const corners = toIrCorners(statement);
  if (style.field !== null) {
    style.field = { ...style.field, corners };
  } else {
    style.corners = corners;
  }
  authored.corners = copyCorners(corners);
}

function applyShadow(
  statement: ShadowStatement,
  style: MutableStyle,
  authored: MutableAuthored,
): void {
  const shadow = statement.preset;
  if (style.field !== null) {
    style.field = { ...style.field, shadow };
  } else {
    style.shadow = shadow;
  }
  authored.shadow = shadow;
}

function applyTypography(
  statement: TypographyStatement,
  style: MutableStyle,
  authored: MutableAuthored,
): void {
  const field = style.field;
  if (field !== null) {
    const input = { ...field.input };
    switch (statement.property) {
      case "size":
        input.fontSize = toIrLength(statement.value);
        break;
      case "color":
        input.color = toIrColor(statement.value);
        break;
      case "weight":
        input.fontWeight = weightNumber(statement.value);
        break;
      case "style":
        input.fontStyle = "italic";
        break;
      case "align":
        input.textAlign = statement.value;
        break;
    }
    style.field = { ...field, input };
  } else {
    const typography = style.typography;
    if (typography === null) {
      throw new InternalCompilerError(
        "typography required a text-bearing element",
        statement.span,
      );
    }
    style.typography = applyTypographyValue(typography, statement);
  }

  switch (statement.property) {
    case "size":
      authored.typography = {
        ...authored.typography,
        fontSize: toIrLength(statement.value),
      };
      break;
    case "color":
      authored.typography = {
        ...authored.typography,
        color: toIrColor(statement.value),
      };
      break;
    case "weight":
      authored.typography = {
        ...authored.typography,
        fontWeight: weightNumber(statement.value),
      };
      break;
    case "style":
      authored.typography = { ...authored.typography, fontStyle: "italic" };
      break;
    case "align":
      authored.typography = {
        ...authored.typography,
        textAlign: statement.value,
      };
      break;
    case "reference":
      throw new InternalCompilerError(
        "unresolved typography reference reached lowering",
        statement.value.span,
      );
  }
}

function applyTypographyValue(
  typography: IrTypography,
  statement: TypographyStatement,
): IrTypography {
  switch (statement.property) {
    case "size":
      return { ...typography, fontSize: toIrLength(statement.value) };
    case "color":
      return { ...typography, color: toIrColor(statement.value) };
    case "weight":
      return { ...typography, fontWeight: weightNumber(statement.value) };
    case "style":
      return { ...typography, fontStyle: "italic" };
    case "align":
      return { ...typography, textAlign: statement.value };
    case "reference":
      throw new InternalCompilerError(
        "unresolved typography reference reached lowering",
        statement.value.span,
      );
  }
}

function applyFontFamily(
  statement: FontFamilyStatement,
  style: MutableStyle,
  authored: MutableAuthored,
): void {
  if (style.field !== null) {
    const field = style.field;
    style.field = {
      ...field,
      label: { ...field.label, fontFamily: statement.value },
      input: { ...field.input, fontFamily: statement.value },
    };
  } else if (style.typography !== null) {
    style.typography = {
      ...style.typography,
      fontFamily: statement.value,
    };
  } else {
    throw new InternalCompilerError(
      "a font family required a text-bearing element",
      statement.span,
    );
  }
  authored.fontFamily = statement.value;
}

function applySpacing(
  statement: SpacingStatement,
  style: MutableStyle,
  authored: MutableAuthored,
): void {
  const value = toIrLength(statement.value);
  const sides = statement.sides;

  if (statement.property === "padding" && style.field !== null) {
    let padding = { ...style.field.padding };
    for (const side of sides) padding = { ...padding, [side]: value };
    style.field = { ...style.field, padding };
  } else if (statement.property === "padding") {
    let padding = { ...style.padding };
    for (const side of sides) padding = { ...padding, [side]: value };
    style.padding = padding;
  } else {
    let margin = { ...style.margin };
    for (const side of sides) margin = { ...margin, [side]: value };
    style.margin = margin;
  }

  const previous = authored[statement.property] ?? {};
  let authoredSides = { ...previous };
  for (const side of sides) authoredSides = { ...authoredSides, [side]: value };
  authored[statement.property] = authoredSides;
}

function applyLayout(
  statement: LayoutStatement,
  style: MutableStyle,
  authored: MutableAuthored,
): void {
  const layout = style.layout;
  if (layout === null) {
    throw new InternalCompilerError(
      "layout required a container element",
      statement.span,
    );
  }

  let next = { ...layout };
  const authoredLayout = { ...(authored.layout ?? {}) };
  switch (statement.property) {
    case "direction":
      next = { ...next, direction: statement.value };
      authoredLayout.direction = statement.value;
      break;
    case "gap":
      style.gap = toIrLength(statement.value);
      authoredLayout.gap = toIrLength(statement.value);
      break;
    case "align":
      if (statement.axis === "both" || statement.axis === "horizontal") {
        next = { ...next, horizontal: "center" };
        authoredLayout.horizontal = "center";
      }
      if (statement.axis === "both" || statement.axis === "vertical") {
        next = { ...next, vertical: "center" };
        authoredLayout.vertical = "center";
      }
      break;
  }
  style.layout = next;
  authored.layout = authoredLayout;
}

function applyVisibility(
  statement: VisibilityStatement,
  style: MutableStyle,
  authored: MutableAuthored,
): void {
  style.visibility = statement.hidden ? "hidden" : "visible";
  authored.visibility = "hidden";
}

function lowerImage(
  element: ElementNode,
  kind: BuiltinKindName,
  basePath: string = "",
): IrImageContent | null {
  if (kind !== "image") return null;
  const source = findStatement(element, "image-source") as ImageSourceStatement | null;
  if (source === null) {
    throw new InternalCompilerError(
      `image ${JSON.stringify(element.name)} has no source after analysis`,
      element.nameSpan,
    );
  }
  const description = findStatement(
    element,
    "image-description",
  ) as ImageDescriptionStatement | null;
  const decorative = findStatement(element, "decorative") !== null;
  return {
    sourcePath: source.value,
    url: assetUrl(source.value, basePath),
    alt: description?.value ?? null,
    decorative,
  };
}

function lowerField(
  element: ElementNode,
  kind: BuiltinKindName,
  nodeId: string,
): IrFieldContent | null {
  if (kind !== "text field") return null;
  const label = findStatement(element, "field-label") as FieldLabelStatement | null;
  if (label === null) {
    throw new InternalCompilerError(
      `text field ${JSON.stringify(element.name)} has no label after analysis`,
      element.nameSpan,
    );
  }
  const placeholder = findStatement(
    element,
    "field-placeholder",
  ) as FieldPlaceholderStatement | null;
  const type = findStatement(element, "field-type") as FieldTypeStatement | null;
  const inputId = `${nodeId}-input`;
  return {
    label: label.value,
    placeholder: placeholder?.value ?? null,
    inputType: type?.value ?? "text",
    required: findStatement(element, "required") !== null,
    inputId,
    labelFor: inputId,
  };
}

function lowerAction(
  element: ElementNode,
  context: LowerContext,
): IrAction | null {
  const click = findStatement(element, "click") as ClickStatement | null;
  if (click === null) return null;

  if (click.action.type === "external") {
    return { kind: "external", url: click.action.url };
  }

  const route = context.routes.get(click.action.pageTitle);
  if (route === undefined) {
    throw new InternalCompilerError(
      `navigation target ${JSON.stringify(click.action.pageTitle)} was not resolved`,
      click.action.pageTitleSpan,
    );
  }
  return {
    kind: "navigate",
    pageTitle: click.action.pageTitle,
    route: routeUrl(route, context.basePath),
  };
}

function lowerHover(element: ElementNode): readonly IrHoverEffect[] {
  const result: IrHoverEffect[] = [];

  for (const statement of element.statements) {
    if (statement.type !== "hover") continue;
    const hover = statement as HoverStatement;
    const duration = hoverDuration(hover.duration);
    switch (hover.effect.type) {
      case "background":
        result.push({
          property: "background-color",
          color: toIrColor(hover.effect.color),
          duration,
        });
        break;
      case "text":
        result.push({
          property: "color",
          color: toIrColor(hover.effect.color),
          duration,
        });
        break;
      case "border":
        result.push({
          property: "border-color",
          color: toIrColor(hover.effect.color),
          duration,
        });
        break;
      case "lift":
        result.push({
          property: "translate",
          distance: toIrLength(hover.effect.distance),
          duration,
        });
        break;
      case "scale":
        result.push({
          property: "scale",
          percentage: hover.effect.percentage.value,
          duration,
        });
        break;
    }
  }

  return result;
}

function lowerMotion(element: ElementNode): IrMotion | null {
  const statement = findStatement(element, "motion") as MotionStatement | null;
  if (statement === null) return null;
  const duration = statement.duration === undefined
    ? { value: GLOBAL_TOKENS.entranceDuration, unit: "ms" as const }
    : toIrDuration(statement.duration);

  if (statement.effect === "fade") {
    return { effect: "fade", duration, distance: null };
  }
  return {
    effect: "slide",
    direction: statement.direction ?? "bottom",
    distance: length(GLOBAL_TOKENS.slideDistance),
    duration,
  };
}

function accessibilityFor(
  kind: BuiltinKindName,
  text: TextStatement | null,
  image: IrImageContent | null,
  field: IrFieldContent | null,
  action: IrAction | null,
): IrAccessibility {
  const role =
    kind === "button" && action !== null ? "link" : roleFor(kind);
  const name =
    text?.value ??
    (kind === "image" ? image?.alt ?? null : null) ??
    field?.label ??
    null;
  const focusable =
    kind === "button" || kind === "link" || kind === "text field";

  const accessibility: IrAccessibility = { role, name, focusable };
  if (kind === "main heading") {
    return { ...accessibility, headingLevel: 1 };
  }
  if (kind === "section heading") {
    return { ...accessibility, headingLevel: 2 };
  }
  if (kind === "minor heading") {
    return { ...accessibility, headingLevel: 3 };
  }
  if (kind === "image") {
    return {
      ...accessibility,
      alt: image?.alt ?? null,
      decorative: image?.decorative ?? false,
    };
  }
  return accessibility;
}

function roleFor(kind: BuiltinKindName): IrAccessibility["role"] {
  switch (kind) {
    case "button":
      return "button";
    case "link":
      return "link";
    case "main heading":
    case "section heading":
    case "minor heading":
      return "heading";
    case "paragraph":
      return "paragraph";
    case "text field":
      return "text-field";
    case "image":
      return "image";
    case "card":
    case "container":
      return "container";
    case "navigation bar":
      return "navigation";
    case "divider":
      return "separator";
  }
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

function elementKind(element: ElementNode): BuiltinKindName {
  if (element.kind?.reference.type !== "builtin-kind") {
    throw new InternalCompilerError(
      `element ${JSON.stringify(element.name)} has no built-in kind`,
      element.nameSpan,
    );
  }
  return element.kind.reference.name;
}

function kindClass(kind: BuiltinKindName): string {
  return `kdm-kind-${kind.replaceAll(" ", "-")}`;
}

function weightNumber(weight: TypographyStatementValue): 300 | 400 | 500 | 600 | 700 {
  switch (weight) {
    case "light":
      return 300;
    case "regular":
      return 400;
    case "medium":
      return 500;
    case "semibold":
      return 600;
    case "bold":
      return 700;
  }
}

type TypographyStatementValue =
  | "light"
  | "regular"
  | "medium"
  | "semibold"
  | "bold";

function hoverDuration(duration: DurationValue | undefined): IrDuration {
  return duration === undefined
    ? { value: GLOBAL_TOKENS.hoverDuration, unit: "ms" }
    : toIrDuration(duration);
}

function toIrDuration(duration: DurationValue): IrDuration {
  return { value: duration.value, unit: duration.unit };
}

function toIrColor(color: ColorValue): IrColor {
  return { kind: color.kind, value: color.value };
}

function toIrLength(value: LengthValue): IrLength {
  return { value: value.value, unit: value.unit };
}

function toIrSize(value: LengthValue): IrSize {
  return { kind: "length", value: toIrLength(value) };
}

function toIrBackground(statement: BackgroundStatement): IrBackground {
  switch (statement.mode) {
    case "none":
      return { kind: "none" };
    case "solid":
      return { kind: "solid", color: toIrColor(statement.color) };
    case "gradient":
      return {
        kind: "gradient",
        from: toIrColor(statement.from),
        to: toIrColor(statement.to),
        direction: "top to bottom",
      };
  }
}

function toIrBorder(statement: BorderStatement): IrBorder {
  if (statement.mode === "none" || statement.width.value === 0) {
    return { kind: "none" };
  }
  return {
    kind: "solid",
    width: toIrLength(statement.width),
    color: toIrColor(statement.color),
  };
}

function toIrCorners(statement: CornersStatement): IrCorners {
  switch (statement.mode) {
    case "default":
      return { kind: "length", value: length(GLOBAL_TOKENS.defaultRadius) };
    case "full":
      return { kind: "pill" };
    case "custom":
      return { kind: "length", value: toIrLength(statement.radius) };
  }
}

function copyBackground(background: IrBackground): IrBackground {
  if (background.kind !== "gradient") return { ...background };
  return {
    ...background,
    from: { ...background.from },
    to: { ...background.to },
  };
}

function copyBorder(border: IrBorder): IrBorder {
  if (border.kind === "none") return { kind: "none" };
  return { ...border, width: { ...border.width }, color: { ...border.color } };
}

function copyCorners(corners: IrCorners): IrCorners {
  if (corners.kind !== "length") return { ...corners };
  return { ...corners, value: { ...corners.value } };
}

function collectSourceMap(elements: readonly IrElement[]): readonly IrSourceMapping[] {
  const result: IrSourceMapping[] = [];
  const visit = (element: IrElement): void => {
    result.push({
      nodeId: element.nodeId,
      name: element.name,
      kind: element.kind,
      span: element.span,
      nameSpan: element.nameSpan,
      ...(element.componentOrigin === undefined
        ? {}
        : { componentOrigin: element.componentOrigin }),
    });
    for (const child of element.children) visit(child);
  };
  for (const element of elements) visit(element);
  return result;
}

function collectAssets(elements: readonly IrElement[]): readonly IrAsset[] {
  const result: IrAsset[] = [];
  const visit = (element: IrElement): void => {
    if (element.image !== null) {
      result.push({
        sourcePath: element.image.sourcePath,
        url: element.image.url,
        span: element.nameSpan,
      });
    }
    for (const child of element.children) visit(child);
  };
  for (const element of elements) visit(element);
  return result;
}

function usesMotion(element: IrElement): boolean {
  if (element.motion !== null) return true;
  return element.children.some(usesMotion);
}
