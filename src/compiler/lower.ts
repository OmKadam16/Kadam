import { findProperty, isNativeProperty } from "../core/parser/properties.js";
import {
  collectSectionLabels,
  fieldExtras,
  lowerButtonControl,
  lowerControlField,
  lowerKindContent,
  lowerPageMeta,
  lowerTextSegments,
  type F1LowerContext,
} from "./lower-f1.js";
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
  FONT_STACKS,
  GLOBAL_TOKENS,
  cloneComputedStyle,
  createDefaultStyle,
  defaultPageStyle,
  hexColor,
  length,
} from "./defaults.js";
import { lowerRuntime, type RuntimeLowering } from "./lower-f4.js";
import { InternalCompilerError } from "./internal-error.js";
import { tokenVar } from "./lower-f3.js";
import type { ManifestFont } from "./manifest.js";
import type { ThemeColor } from "../core/parser/theme.js";
import {
  f3ScopeDeclarations,
  lowerExtraRules,
  lowerStates,
  type F3Context,
} from "./lower-f3.js";
import {
  allStatements,
  arrangementOf,
  baseTextSelfDeclarations,
  breakpointShiftDeclarations,
  groupScopes,
  parentDeclarations,
  scopeDeclarations,
  type F2ParentInfo,
} from "./lower-f2.js";
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
  IrScopedStyle,
  IrFontFace,
  IrColorToken,
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
  /** kadam 0.3: the manifest siteUrl, for canonical and share URLs. */
  readonly siteUrl?: string | undefined;
  /** kadam 0.3: custom fonts from kadam.json. */
  readonly fonts?: Readonly<Record<string, ManifestFont>> | undefined;
  /** kadam 0.3: colors from the project theme file (D-38). */
  readonly themeColors?: readonly ThemeColor[] | undefined;
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
  const labels = collectSectionLabels(
    pageNode.elements,
    (element) => identityFor(element, slug).nodeId,
  );
  const f1: F1LowerContext = {
    languageVersion: document.languageVersion,
    routes,
    basePath,
    labelIds: labels.labelIds,
    sectionLabels: labels.sectionLabels,
  };
  const meta =
    document.languageVersion === "0.1"
      ? undefined
      : lowerPageMeta(pageNode.settings, route, basePath, options.siteUrl);
  const runtime =
    document.languageVersion === "0.1"
      ? null
      : lowerRuntime(pageNode.elements, slug, (element) => identityFor(element, slug).nodeId);
  const context: LowerContext = {
    runtime,
    pageStyle,
    routes,
    slug,
    basePath,
    f1,
    pageLanguage: meta?.language ?? "en",
    firstImage: document.languageVersion === "0.1" ? null : firstImage(pageNode.elements),
    anchors: anchorTargets(pageNode.elements, slug),
    fontStacks: new Map(
      Object.entries(options.fonts ?? {}).map(([name, font]) => [name, FONT_STACKS[font.fallback]]),
    ),
  };
  const elements = pageNode.elements.map((element) =>
    lowerElement(element, context, PAGE_PARENT),
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
    ...(meta === undefined ? {} : { meta }),
    ...fontFaces(pageNode.elements, options.fonts ?? {}, basePath),
    ...colorTokens(options.themeColors ?? [], pageNode.settings),
    ...(runtime === null ? {} : { runtime: runtime.runtime }),
  };
}

interface LowerContext {
  readonly pageStyle: IrPageStyle;
  readonly routes: ReadonlyMap<string, string>;
  readonly slug: string;
  readonly basePath: string;
  readonly f1: F1LowerContext;
  readonly pageLanguage: string;
  /** kadam 0.3: the first image loads right away; later ones lazily. */
  readonly firstImage: ElementNode | null;
  /** kadam 0.3: custom font fallback stacks by family name. */
  readonly fontStacks: ReadonlyMap<string, string>;
  /** kadam 0.3 (F4): element names that in-page links target, to their id. */
  readonly anchors: ReadonlyMap<string, string>;
  /** kadam 0.3 (F4 step 2): state, events, and bindings; null without them. */
  readonly runtime: RuntimeLowering | null;
}

/** Top-level elements sit in the page, which is a plain block. */
const PAGE_PARENT: F2ParentInfo = { arrangement: null };

function firstImage(elements: readonly ElementNode[]): ElementNode | null {
  for (const element of elements) {
    if (element.kind?.reference.type === "builtin-kind" && element.kind.reference.name === "image") return element;
    const nested = firstImage(element.children);
    if (nested !== null) return nested;
  }
  return null;
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

  let dark: { background?: IrColor; text?: IrColor } | undefined;
  let autoDark = false;
  for (const setting of settings) {
    if (setting.property === "auto dark") {
      autoDark = true;
      continue;
    }
    if ((setting.property === "background" || setting.property === "text") && setting.dark === true) {
      dark = { ...dark, [setting.property]: toIrColor(setting.value) };
      continue;
    }
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
    ...(dark === undefined ? {} : { dark }),
    ...(autoDark ? { autoDark: true as const } : {}),
  };
}

function lowerElement(element: ElementNode, context: LowerContext, parent: F2ParentInfo): IrElement {
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
  const baseStatements = element.statements.filter(
    (statement) => statement.type !== "responsive" && statement.type !== "scoped",
  );
  const f3: F3Context = {
    kind,
    className: identity.className,
    basePath: context.basePath,
    fonts: context.fontStacks,
  };
  const v03 = context.f1.languageVersion !== "0.1";
  const declarations = [
    ...scopeDeclarations(baseStatements, parent, null),
    ...f3ScopeDeclarations(baseStatements, f3),
    ...parentDeclarations(element, baseStatements, parent),
    ...(v03 ? baseTextSelfDeclarations(kind, baseStatements, parent) : []),
  ];
  if (declarations.length > 0) authored.declarations = declarations;
  const responsive = lowerResponsive(element, style, kind, parent, baseStatements, f3, v03);
  const scopes = lowerScopes(element, style, kind, parent, baseStatements, f3);
  const { states, transitions } = lowerStates(element, f3);
  const rules = lowerExtraRules(element, f3);
  const loops = [
    ...new Set(
      allStatements(element).flatMap((statement) => (statement.type === "loop" ? [statement.effect] : [])),
    ),
  ];
  const childArrangement = arrangementOf(baseStatements, style.layout?.direction ?? null);
  const byBreakpoint = v03 ? arrangementByBreakpoint(element, responsive, childArrangement) : {};
  const childParent: F2ParentInfo = {
    arrangement: childArrangement,
    ...(Object.keys(byBreakpoint).length === 0 ? {} : { byBreakpoint }),
  };
  const scrollable = allStatements(element).some(
    (statement) => statement.type === "overflow" && statement.mode !== "hidden",
  );

  const text = findStatement(element, "text") as TextStatement | null;
  const boundText = context.runtime?.texts.get(element);
  const runtimeAttributes = context.runtime?.attributes.get(element);
  const loweredImage = lowerImage(element, kind, context.basePath);
  const image =
    loweredImage !== null && kind === "image" && isLazy(element, context)
      ? { ...loweredImage, loading: "lazy" as const }
      : loweredImage;
  const loweredField =
    lowerField(element, kind, identity.nodeId) ??
    lowerControlField(element, kind, identity.nodeId);
  // kadam 0.3 pages can submit forms, so every control carries a name.
  const fieldError = findStatement(element, "field-error") as { value: string } | null;
  const field =
    loweredField !== null && context.f1.languageVersion !== "0.1"
      ? { ...loweredField, name: element.name, ...(fieldError === null ? {} : { error: fieldError.value }) }
      : loweredField;
  const segments = text === null ? undefined : lowerTextSegments(element, text, context.f1);
  const content =
    kind === "expandable section"
      ? {
          type: "expandable" as const,
          title: (findStatement(element, "summary") as { value: string } | null)?.value ?? "",
          open: findStatement(element, "starts-open") !== null,
        }
      : lowerKindContent(element, kind, context.f1, context.pageLanguage);
  const htmlId =
    context.f1.labelIds.get(element) ??
    (context.anchors.get(element.name) === identity.nodeId || context.runtime?.ids.has(element) === true
      ? identity.nodeId
      : undefined);
  const control = lowerButtonControl(element, kind);
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
    text: boundText !== undefined ? { text: boundText } : text === null ? null : segments === undefined ? { text: text.value } : { text: text.value, segments },
    image,
    field,
    accessibility: accessibilityFor(kind, text, image, field, action),
    children: element.children.map((child) => lowerElement(child, context, childParent)),
    ...(content === undefined ? {} : { content }),
    ...(htmlId === undefined ? {} : { htmlId }),
    ...(control === undefined ? {} : { control }),
    ...(scopes.length === 0 ? {} : { scopes }),
    ...(scrollable ? { scrollable: true as const } : {}),
    ...(states.length === 0 ? {} : { states, stateTransitions: transitions }),
    ...(rules.length === 0 ? {} : { rules }),
    ...(loops.length === 0 ? {} : { loops }),
    ...(runtimeAttributes === undefined ? {} : { attributes: runtimeAttributes }),
    ...(element.runtimeList === undefined ? {} : { template: true as const }),
  };
}

/** In-page link targets (F4): each named element gets its node id as `id`. */
function anchorTargets(elements: readonly ElementNode[], slug: string): Map<string, string> {
  const names = new Set<string>();
  const byName = new Map<string, string>();
  const visit = (list: readonly ElementNode[]): void => {
    for (const element of list) {
      for (const statement of element.statements) {
        if (statement.type === "click" && statement.action.type === "anchor") names.add(statement.action.elementName);
      }
      if (!byName.has(element.name)) byName.set(element.name, identityFor(element, slug).nodeId);
      visit(element.children);
    }
  };
  visit(elements);
  const anchors = new Map<string, string>();
  for (const name of names) {
    const id = byName.get(name);
    if (id !== undefined) anchors.set(name, id);
  }
  return anchors;
}

/** Theme colors (D-38): the project theme, then the page's own, which win. */
function colorTokens(
  theme: readonly ThemeColor[],
  settings: readonly import("../core/ast/nodes.js").PageSettingNode[],
): { colorTokens?: readonly IrColorToken[] } {
  const tokens = new Map<string, { light: string; dark: string | null }>();
  for (const color of theme) {
    tokens.set(color.name, { light: color.light.value, dark: color.dark?.value ?? null });
  }
  for (const setting of settings) {
    if (setting.property !== "color token") continue;
    const current = tokens.get(setting.name);
    if (setting.dark === true) {
      tokens.set(setting.name, { light: current?.light ?? setting.value.value, dark: setting.value.value });
    } else {
      // A page color replaces the theme color, including its dark value.
      tokens.set(setting.name, { light: setting.value.value, dark: null });
    }
  }
  // Page dark values declared before the light one still apply.
  for (const setting of settings) {
    if (setting.property === "color token" && setting.dark === true) {
      const current = tokens.get(setting.name)!;
      tokens.set(setting.name, { ...current, dark: setting.value.value });
    }
  }
  if (tokens.size === 0) return {};
  return { colorTokens: [...tokens].map(([name, value]) => ({ name, ...value })) };
}

/** @font-face entries for the custom fonts a page uses, in first-use order. */
function fontFaces(
  elements: readonly ElementNode[],
  fonts: Readonly<Record<string, ManifestFont>>,
  basePath: string,
): { fonts?: readonly IrFontFace[] } {
  const used: string[] = [];
  const visit = (list: readonly ElementNode[]): void => {
    for (const element of list) {
      for (const statement of allStatements(element)) {
        if (statement.type === "custom-font" && !used.includes(statement.name)) used.push(statement.name);
      }
      visit(element.children);
    }
  };
  visit(elements);
  const faces = used.flatMap((name): IrFontFace[] => {
    const font = fonts[name];
    if (font === undefined) return [];
    return [{
      family: name,
      url: assetUrl(font.source, basePath),
      format: font.source.toLowerCase().endsWith(".woff2") ? "woff2" : "woff",
      weight: font.weight,
      style: font.style,
    }];
  });
  return faces.length === 0 ? {} : { fonts: faces };
}

function isLazy(element: ElementNode, context: LowerContext): boolean {
  if (context.f1.languageVersion === "0.1") return false;
  const loading = findStatement(element, "loading");
  if (loading !== null && loading.type === "loading") return loading.mode === "lazy";
  return element !== context.firstImage;
}

function lowerScopes(
  element: ElementNode,
  baseStyle: IrComputedStyle,
  kind: BuiltinKindName,
  parent: F2ParentInfo,
  baseStatements: readonly StatementNode[],
  f3: F3Context,
): readonly IrScopedStyle[] {
  return groupScopes(element).map((group) => {
    const style = cloneComputedStyle(baseStyle) as MutableStyle;
    const authored: MutableAuthored = {};
    applyScope(group.statements, style, authored, kind);
    const declarations = [
      ...scopeDeclarations(group.statements, parent, baseStatements),
      ...f3ScopeDeclarations(group.statements, f3),
    ];
    if (declarations.length > 0) authored.declarations = declarations;
    return { query: group.query, order: group.order, authored: authored as IrAuthoredStyle, style };
  });
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
  parent: F2ParentInfo,
  baseStatements: readonly StatementNode[],
  f3: F3Context,
  v03: boolean,
): readonly IrResponsive[] {
  const result: IrResponsive[] = [];

  for (const breakpoint of BREAKPOINTS) {
    const scoped = element.statements
      .filter(
        (statement): statement is ResponsiveStatement =>
          statement.type === "responsive" && statement.breakpoint === breakpoint,
      )
      .map((statement) => statement.statement);
    // kadam 0.3: the parent may arrange its children differently here.
    const shift = v03 ? breakpointShiftDeclarations(kind, baseStatements, scoped, parent, breakpoint) : [];
    if (scoped.length === 0 && shift.length === 0) continue;
    const here: F2ParentInfo = { arrangement: parent.byBreakpoint?.[breakpoint] ?? parent.arrangement };

    const style = cloneComputedStyle(baseStyle) as MutableStyle;
    const authored: MutableAuthored = {};
    applyScope(scoped, style, authored, kind);
    const declarations = [
      ...scopeDeclarations(scoped, v03 ? here : parent, baseStatements),
      ...f3ScopeDeclarations(scoped, f3),
      ...shift,
    ];
    if (declarations.length > 0) authored.declarations = declarations;
    result.push({
      breakpoint,
      authored: authored as IrAuthoredStyle,
      style,
    });
  }

  return result;
}

/** kadam 0.3: how this element arranges its children on each breakpoint where that changes. */
function arrangementByBreakpoint(
  element: ElementNode,
  responsive: readonly IrResponsive[],
  base: F2ParentInfo["arrangement"],
): Partial<Record<Breakpoint, F2ParentInfo["arrangement"]>> {
  const result: Partial<Record<Breakpoint, F2ParentInfo["arrangement"]>> = {};
  for (const breakpoint of BREAKPOINTS) {
    const scoped = element.statements.flatMap((statement) =>
      statement.type === "responsive" && statement.breakpoint === breakpoint ? [statement.statement] : [],
    );
    let arrangement = base;
    if (scoped.some((statement) => statement.type === "grid")) arrangement = "grid";
    else if (scoped.some((statement) => statement.type === "layout" && statement.property === "direction")) {
      arrangement = responsive.find((entry) => entry.breakpoint === breakpoint)?.style.layout?.direction ?? base;
    }
    if (arrangement !== base) result[breakpoint] = arrangement;
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
  // kadam 0.3: a multi-color gradient lowers its own direction (lower-f3).
  const f3Gradient = statements.some((statement) => statement.type === "gradient");

  for (const statement of statements) {
    if (statement.type === "responsive" || statement.type === "scoped") continue;
    if (statement.type === "gradient-direction") {
      if (!f3Gradient) gradientDirection = statement.direction;
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
  // Rows that apply to every kind (the layer) lower with the F2 declarations.
  if (definition !== undefined && isNativeProperty(definition) && definition.applies === "all") return;
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
  if (kind !== "image" && kind !== "icon") return null;
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
    ...fieldExtras(element),
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
  // kadam 0.3 (F4 step 1): plain links, no JavaScript.
  switch (click.action.type) {
    case "anchor": {
      const id = context.anchors.get(click.action.elementName);
      if (id === undefined) {
        throw new InternalCompilerError(`in-page target ${JSON.stringify(click.action.elementName)} was not resolved`, click.action.elementSpan);
      }
      return { kind: "href", href: `#${id}`, download: false };
    }
    case "email":
      return { kind: "href", href: `mailto:${click.action.address}`, download: false };
    case "phone":
      return { kind: "href", href: `tel:${click.action.number.replace(/[ ().-]/g, "")}`, download: false };
    case "download":
      return { kind: "href", href: assetUrl(click.action.path, context.basePath), download: true };
    default:
      break;
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
  if (kind === "small heading") {
    return { ...accessibility, headingLevel: 4 };
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
    case "dialog":
      return "container";
    case "navigation bar":
      return "navigation";
    case "divider":
      return "separator";
    case "small heading":
      return "heading";
    case "header":
    case "footer":
    case "section":
    case "article":
    case "sidebar":
      return "landmark";
    case "list":
    case "numbered list":
    case "list item":
    case "table":
    case "header row":
    case "row":
    case "cell":
      return "structure";
    case "video":
    case "audio clip":
      return "media";
    case "icon":
      return "image";
    case "code block":
    case "badge":
      return "paragraph";
    case "expandable section":
      return "structure";
    case "form":
    case "text area":
    case "checkbox":
    case "dropdown":
    case "radio group":
      return "text-field";
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
  if (color.kind === "token") return { kind: "token", value: tokenVar(color.value), token: color.value };
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
