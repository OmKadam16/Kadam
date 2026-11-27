import type {
  BuiltinKindName,
  ElementNode,
  F1Statement,
  PageSettingNode,
  StatementNode,
  TextStatement,
} from "../core/ast/nodes.js";
import type { UiLanguageVersion } from "../version.js";
import { InternalCompilerError } from "./internal-error.js";
import type {
  IrFieldContent,
  IrKindContent,
  IrPageMeta,
  IrTextSegment,
} from "./ir.js";
import { assetUrl, routeUrl } from "./routes.js";

/**
 * Lowering for kadam 0.3 (F1) kinds and statements. Everything here returns
 * `undefined` for a 0.1 element so the 0.1 IR keeps its exact shape.
 */

export interface F1LowerContext {
  readonly languageVersion: UiLanguageVersion;
  readonly routes: ReadonlyMap<string, string>;
  readonly basePath: string;
  /** Heading elements that label a section, mapped to their `id`. */
  readonly labelIds: ReadonlyMap<ElementNode, string>;
  /** Section elements mapped to the `id` of the heading that names them. */
  readonly sectionLabels: ReadonlyMap<ElementNode, string>;
}

const HEADINGS: ReadonlySet<BuiltinKindName> = new Set([
  "main heading",
  "section heading",
  "minor heading",
  "small heading",
]);

function find<T extends StatementNode["type"]>(
  element: ElementNode,
  type: T,
): Extract<StatementNode, { type: T }> | null {
  for (const statement of element.statements) {
    if (statement.type === type) return statement as Extract<StatementNode, { type: T }>;
  }
  return null;
}

function missing(element: ElementNode, what: string): never {
  throw new InternalCompilerError(
    `${JSON.stringify(element.name)} has no ${what} after analysis`,
    element.nameSpan,
  );
}

/** Find, for every section, the first heading inside it (depth first). */
export function collectSectionLabels(
  elements: readonly ElementNode[],
  idFor: (element: ElementNode) => string,
): { labelIds: Map<ElementNode, string>; sectionLabels: Map<ElementNode, string> } {
  const labelIds = new Map<ElementNode, string>();
  const sectionLabels = new Map<ElementNode, string>();
  const firstHeading = (element: ElementNode): ElementNode | null => {
    for (const child of element.children) {
      const kind = child.kind?.reference.type === "builtin-kind" ? child.kind.reference.name : null;
      if (kind !== null && HEADINGS.has(kind)) return child;
      const nested = firstHeading(child);
      if (nested !== null) return nested;
    }
    return null;
  };
  const visit = (list: readonly ElementNode[]): void => {
    for (const element of list) {
      const kindName = element.kind?.reference.type === "builtin-kind" ? element.kind.reference.name : null;
      if (kindName === "section" || kindName === "dialog") {
        const heading = firstHeading(element);
        if (heading !== null) {
          const id = idFor(heading);
          labelIds.set(heading, id);
          sectionLabels.set(element, id);
        }
      }
      visit(element.children);
    }
  };
  visit(elements);
  return { labelIds, sectionLabels };
}

export function lowerKindContent(
  element: ElementNode,
  kind: BuiltinKindName,
  context: F1LowerContext,
  pageLanguage: string,
): IrKindContent | undefined {
  switch (kind) {
    case "video":
    case "audio clip": {
      const source = find(element, "media-source") ?? missing(element, "media source");
      const captions = find(element, "captions");
      const poster = find(element, "poster");
      return {
        type: "media",
        media: kind === "video" ? "video" : "audio",
        url: assetUrl(source.value, context.basePath),
        captionsUrl: captions === null ? null : assetUrl(captions.value, context.basePath),
        posterUrl: poster === null ? null : assetUrl(poster.value, context.basePath),
        language: pageLanguage,
        ...(find(element, "background-play") === null ? {} : { background: true as const }),
      };
    }
    case "table":
      return { type: "table", caption: (find(element, "caption") ?? missing(element, "caption")).value };
    case "section": {
      const labelledBy = context.sectionLabels.get(element) ?? missing(element, "heading");
      return { type: "section", labelledBy };
    }
    case "dialog": {
      const labelledBy = context.sectionLabels.get(element) ?? missing(element, "heading");
      return { type: "dialog", labelledBy };
    }
    case "form":
      return { type: "form", action: (find(element, "form-action") ?? missing(element, "destination")).url };
    default:
      return undefined;
  }
}

/**
 * Split text into runs for line breaks (`\n`, kadam 0.3 only) and inline
 * spans. Returns undefined when the plain text is enough, so a 0.1 page, or a
 * 0.3 page without breaks or spans, emits exactly as before.
 */
export function lowerTextSegments(
  element: ElementNode,
  text: TextStatement,
  context: F1LowerContext,
): readonly IrTextSegment[] | undefined {
  if (context.languageVersion === "0.1") return undefined;
  const spans = element.statements.filter(
    (statement): statement is Extract<F1Statement, { type: "text-span" }> => statement.type === "text-span",
  );
  if (spans.length === 0 && !text.value.includes("\n")) return undefined;

  const ranged = spans
    .map((span) => ({ span, start: span.at ?? text.value.indexOf(span.target) }))
    .sort((a, b) => a.start - b.start);

  const segments: IrTextSegment[] = [];
  const pushPlain = (value: string): void => {
    value.split("\n").forEach((part, index) => {
      if (index > 0) segments.push({ type: "break" });
      if (part.length > 0) segments.push({ type: "text", text: part });
    });
  };

  let cursor = 0;
  for (const { span, start } of ranged) {
    if (start < cursor) {
      throw new InternalCompilerError("overlapping inline spans reached lowering", span.span);
    }
    pushPlain(text.value.slice(cursor, start));
    const words = span.target;
    const effect = span.effect;
    if (effect.type === "bold" || effect.type === "italic" || effect.type === "code" || effect.type === "underline") {
      segments.push({ type: effect.type, text: words });
    } else if (effect.type === "color") {
      const css = effect.color.kind === "token" ? `var(--kdm-color-${effect.color.value})` : effect.color.value;
      const key = (effect.color.kind === "token" ? effect.color.value : effect.color.value.replace(/^#/, "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      segments.push({ type: "color", text: words, color: css, className: `kdm-words-${key}` });
    } else if (effect.type === "highlight") {
      // D-50: a highlight sweeps under the words.
      const css = effect.color.kind === "token" ? `var(--kdm-color-${effect.color.value})` : effect.color.value;
      const key = (effect.color.kind === "token" ? effect.color.value : effect.color.value.replace(/^#/, "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      segments.push({ type: "highlight", text: words, color: css, className: `kdm-highlight-${key}` });
    } else if (effect.type === "external") {
      segments.push({ type: "link", text: words, href: effect.url, external: true });
    } else {
      const route = context.routes.get(effect.pageTitle);
      if (route === undefined) {
        throw new InternalCompilerError(`page ${JSON.stringify(effect.pageTitle)} was not resolved`, effect.pageSpan);
      }
      segments.push({ type: "link", text: words, href: routeUrl(route, context.basePath), external: false });
    }
    cursor = start + words.length;
  }
  pushPlain(text.value.slice(cursor));
  return segments;
}

/** Field content for the 0.3 form controls, plus 0.3 extras on a text field. */
export function lowerControlField(
  element: ElementNode,
  kind: BuiltinKindName,
  nodeId: string,
): IrFieldContent | null {
  if (kind !== "text area" && kind !== "checkbox" && kind !== "dropdown" && kind !== "radio group") {
    return null;
  }
  const label = find(element, "field-label") ?? missing(element, "label");
  const inputId = kind === "radio group" ? `${nodeId}-1` : `${nodeId}-input`;
  const options = find(element, "options");
  return {
    label: label.value,
    placeholder: find(element, "field-placeholder")?.value ?? null,
    inputType: "text",
    required: find(element, "required") !== null,
    inputId,
    labelFor: inputId,
    ...fieldExtras(element),
    ...(options === null ? {} : { options: options.values }),
    ...(kind === "checkbox" ? { checked: find(element, "checked") !== null } : {}),
  };
}

/** 0.3 field attributes; an empty object when none are written. */
export function fieldExtras(element: ElementNode): {
  disabled?: boolean;
  minLength?: number;
  maxLength?: number;
} {
  const result: { disabled?: boolean; minLength?: number; maxLength?: number } = {};
  if (find(element, "disabled") !== null) result.disabled = true;
  for (const statement of element.statements) {
    if (statement.type !== "length-limit") continue;
    if (statement.bound === "min") result.minLength = statement.value;
    else result.maxLength = statement.value;
  }
  return result;
}

export function lowerButtonControl(
  element: ElementNode,
  kind: BuiltinKindName,
): { disabled: boolean; submit: boolean } | undefined {
  if (kind !== "button") return undefined;
  const disabled = find(element, "disabled") !== null;
  const submit = find(element, "submit") !== null;
  return disabled || submit ? { disabled, submit } : undefined;
}

export function lowerPageMeta(
  settings: readonly PageSettingNode[],
  route: string,
  basePath: string,
  siteUrl: string | undefined,
): IrPageMeta | undefined {
  const value = (property: string): string | null => {
    for (const setting of settings) {
      if (setting.property === property && "value" in setting && typeof setting.value === "string") return setting.value;
    }
    return null;
  };
  const description = value("description");
  const language = value("language");
  const icon = value("icon");
  const shareImage = value("share image");
  const direction = value("direction") as "rtl" | "ltr" | null;
  const enter = value("enter") as "fade" | "slide" | null;
  const transition = value("transition") as "cross-fade" | null;
  const site = siteUrl?.replace(/\/$/, "");
  const canonicalUrl = site === undefined ? null : `${site}${routeUrl(route, basePath)}`;
  if (description === null && language === null && icon === null && shareImage === null && canonicalUrl === null && direction === null && enter === null && transition === null) {
    return undefined;
  }
  return {
    description,
    language,
    iconUrl: icon === null ? null : assetUrl(icon, basePath),
    shareImageUrl: shareImage === null || site === undefined ? null : `${site}${assetUrl(shareImage, basePath)}`,
    canonicalUrl,
    ...(direction === null ? {} : { direction }),
    ...(enter === null ? {} : { enter }),
    ...(transition === null ? {} : { transition }),
  };
}
