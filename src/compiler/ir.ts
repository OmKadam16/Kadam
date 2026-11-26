import type { IrRuntime } from "./lower-f4.js";
import type {
  Breakpoint,
  BuiltinKindName,
  ComponentElementOrigin,
  FieldType,
  FontFamily,
  GradientDirection,
  TextAlign,
} from "../core/ast/nodes.js";
import type { Span } from "../core/source/source-file.js";

export type IrLengthUnit = "px" | "rem" | "em" | "vw" | "vh" | "dvh" | "%" | null;

export interface IrLength {
  readonly value: number;
  readonly unit: IrLengthUnit;
}

export interface IrColor {
  /** `token` (kadam 0.3): `value` is `var(--kdm-color-<name>)`. */
  readonly kind: "named" | "hex" | "token";
  readonly value: string;
  /** The theme color name, for a token. */
  readonly token?: string;
}

export interface IrDuration {
  readonly value: number;
  readonly unit: "ms" | "s";
}

export type IrBackground =
  | { readonly kind: "none" }
  | { readonly kind: "solid"; readonly color: IrColor }
  | {
      readonly kind: "gradient";
      readonly from: IrColor;
      readonly to: IrColor;
      readonly direction: GradientDirection;
    };

export type IrBorder =
  | { readonly kind: "none" }
  | {
      readonly kind: "solid";
      readonly width: IrLength;
      readonly color: IrColor;
    };

export type IrCorners =
  | { readonly kind: "none" }
  | { readonly kind: "length"; readonly value: IrLength }
  | { readonly kind: "pill" };

export type IrShadow = "none" | "soft" | "medium" | "strong";

export type IrSize =
  | { readonly kind: "auto" }
  | { readonly kind: "full" }
  | { readonly kind: "length"; readonly value: IrLength };

export interface IrSides<T> {
  readonly top: T;
  readonly right: T;
  readonly bottom: T;
  readonly left: T;
}

export type IrLayoutAxis = "start" | "center";

export interface IrLayout {
  readonly direction: "row" | "column";
  /** Physical left/right alignment. */
  readonly horizontal: IrLayoutAxis;
  /** Physical top/bottom alignment. */
  readonly vertical: IrLayoutAxis;
}

export interface IrTypography {
  readonly fontFamily: FontFamily;
  readonly fontSize: IrLength;
  readonly fontWeight: number;
  readonly fontStyle: "normal" | "italic";
  readonly textAlign: TextAlign;
  readonly color: IrColor;
  readonly lineHeight: number | null;
}

/**
 * Visual properties of a text field's native input. The surrounding wrapper
 * owns width, margin, layout, and visibility; the input owns the box, text,
 * and hover styling the author addresses with element statements.
 */
export interface IrFieldStyle {
  readonly label: IrTypography;
  readonly input: IrTypography;
  readonly placeholder: IrColor;
  readonly height: IrSize;
  readonly padding: IrSides<IrLength>;
  readonly background: IrBackground;
  readonly border: IrBorder;
  readonly corners: IrCorners;
  readonly shadow: IrShadow;
}

export interface IrComputedStyle {
  readonly display: "block" | "inline" | "inline-flex" | "flex" | "inline-block" | "list-item" | "table" | "table-row" | "table-cell";
  readonly width: IrSize;
  readonly height: IrSize;
  readonly minHeight: IrLength | null;
  readonly background: IrBackground;
  readonly border: IrBorder;
  readonly corners: IrCorners;
  readonly shadow: IrShadow;
  readonly padding: IrSides<IrLength>;
  readonly margin: IrSides<IrLength>;
  readonly gap: IrLength | null;
  readonly layout: IrLayout | null;
  readonly typography: IrTypography | null;
  readonly field: IrFieldStyle | null;
  readonly visibility: "visible" | "hidden";
  readonly textDecoration: "none" | "underline";
}

/**
 * The properties an author wrote, as opposed to values inherited from kind or
 * page defaults. The page stylesheet emits only these declarations; the shared
 * base stylesheet owns kind defaults.
 */
export interface IrAuthoredStyle {
  readonly width?: IrSize;
  readonly height?: IrSize;
  readonly background?: IrBackground;
  /** A direction statement was written; emit the resolved gradient. */
  readonly gradientDirection?: true;
  readonly border?: IrBorder;
  readonly corners?: IrCorners;
  readonly shadow?: IrShadow;
  readonly padding?: Partial<IrSides<IrLength>>;
  readonly margin?: Partial<IrSides<IrLength>>;
  readonly typography?: Partial<
    Pick<
      IrTypography,
      "fontSize" | "color" | "fontWeight" | "fontStyle" | "textAlign"
    >
  >;
  readonly fontFamily?: FontFamily;
  readonly layout?: {
    readonly direction?: "row" | "column";
    readonly horizontal?: IrLayoutAxis;
    readonly vertical?: IrLayoutAxis;
    readonly gap?: IrLength;
  };
  readonly visibility?: "hidden";
  /**
   * D-32 table properties in source order. `css` is the generated property
   * name; text properties are emitted wherever typography is emitted.
   */
  readonly properties?: readonly IrTextProperty[];
  /** kadam 0.3 (F2) layout declarations in source order. */
  readonly declarations?: readonly IrDeclaration[];
}

/** A resolved CSS declaration from a kadam 0.3 (F2) layout statement. */
export interface IrDeclaration {
  readonly property: string;
  readonly value: string;
}

/** kadam 0.3 (F3) interaction state: one selector and its declarations. */
export interface IrStateStyle {
  readonly state: "hovered" | "focused" | "pressed" | "disabled" | "checked" | "invalid";
  readonly selector: string;
  readonly declarations: readonly IrDeclaration[];
}

/** A transitioned property for state effects, merged with hover transitions. */
export interface IrTransition {
  readonly property: string;
  readonly duration: string;
}

/** An extra rule an element needs (scroll entrance, staggered children). */
export interface IrRule {
  /** An at-rule wrapper such as `@supports (...)`, or null. */
  readonly at: string | null;
  readonly selector: string;
  readonly declarations: readonly IrDeclaration[];
  /** Turned off (`animation: none`) under prefers-reduced-motion. */
  readonly reducedMotion: boolean;
}

/** A custom font from kadam.json, emitted as @font-face where used. */
export interface IrFontFace {
  readonly family: string;
  readonly url: string;
  readonly format: "woff2" | "woff";
  readonly weight: string;
  readonly style: "normal" | "italic";
}

export interface IrTextProperty {
  readonly css: string;
  /** A unitless number (line height) has a null unit. */
  readonly value: IrLength;
}

export type IrHoverEffect =
  | {
      readonly property: "background-color";
      readonly color: IrColor;
      readonly duration: IrDuration;
    }
  | {
      readonly property: "color";
      readonly color: IrColor;
      readonly duration: IrDuration;
    }
  | {
      readonly property: "border-color";
      readonly color: IrColor;
      readonly duration: IrDuration;
    }
  | {
      readonly property: "translate";
      readonly distance: IrLength;
      readonly duration: IrDuration;
    }
  | {
      readonly property: "scale";
      readonly percentage: number;
      readonly duration: IrDuration;
    };

export interface IrMotion {
  readonly effect: "fade" | "slide";
  readonly direction?: "left" | "right" | "top" | "bottom";
  /** The resolved starting offset for a slide, including the 24px default. */
  readonly distance: IrLength | null;
  readonly duration: IrDuration;
}

export type IrAction =
  | {
      readonly kind: "navigate";
      readonly pageTitle: string;
      readonly route: string;
    }
  | { readonly kind: "external"; readonly url: string }
  /** kadam 0.3 (F4): in-page anchor, mailto:, tel:, or a download. */
  | { readonly kind: "href"; readonly href: string; readonly download: boolean };

export interface IrTextContent {
  readonly text: string;
  /**
   * kadam 0.3: the text split into runs, present only when the text has a
   * line break or inline spans. Emitters prefer it over `text`.
   */
  readonly segments?: readonly IrTextSegment[];
}

export type IrTextSegment =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "break" }
  | { readonly type: "bold" | "italic" | "code" | "underline"; readonly text: string }
  /** kadam 0.3: colored words; `className` names the page CSS rule that colors them. */
  | { readonly type: "color"; readonly text: string; readonly color: string; readonly className: string }
  | { readonly type: "link"; readonly text: string; readonly href: string; readonly external: boolean };

/** kadam 0.3 content for kinds that need more than text, image, or field. */
export type IrKindContent =
  | {
      readonly type: "media";
      readonly media: "video" | "audio";
      readonly url: string;
      readonly captionsUrl: string | null;
      readonly posterUrl: string | null;
      readonly language: string;
    }
  | { readonly type: "table"; readonly caption: string }
  | { readonly type: "section"; readonly labelledBy: string }
  | { readonly type: "dialog"; readonly labelledBy: string }
  | { readonly type: "form"; readonly action: string }
  | { readonly type: "expandable"; readonly title: string; readonly open: boolean };

export interface IrImageContent {
  readonly sourcePath: string;
  readonly url: string;
  readonly alt: string | null;
  readonly decorative: boolean;
  /** kadam 0.3: `lazy` for every image but the first, unless the author says. */
  readonly loading?: "lazy";
}

export interface IrFieldContent {
  readonly label: string;
  readonly placeholder: string | null;
  readonly inputType: FieldType;
  readonly required: boolean;
  readonly inputId: string;
  readonly labelFor: string;
  // kadam 0.3
  /** Form field name: the element name, so submitted data is readable. */
  readonly name?: string;
  readonly disabled?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly options?: readonly string[];
  readonly checked?: boolean;
  /** kadam 0.3 (F4): shown when the field is invalid after the user edits it. */
  readonly error?: string;
}

export interface IrAccessibility {
  readonly role:
    | "button"
    | "link"
    | "heading"
    | "paragraph"
    | "text-field"
    | "image"
    | "container"
    | "navigation"
    | "separator"
    // kadam 0.3
    | "landmark"
    | "structure"
    | "media";
  readonly name: string | null;
  readonly headingLevel?: 1 | 2 | 3 | 4;
  readonly focusable: boolean;
  readonly alt?: string | null;
  readonly decorative?: boolean;
  readonly labelledBy?: string;
}

export interface IrResponsive {
  readonly breakpoint: Breakpoint;
  readonly authored: IrAuthoredStyle;
  readonly style: IrComputedStyle;
}

/** kadam 0.3 custom breakpoint or container query scope. */
export interface IrScopedStyle {
  /** The at-rule, e.g. `@media (min-width: 1440px)` or `@container (width < 400px)`. */
  readonly query: string;
  /** Emission order across the page; more specific scopes come later. */
  readonly order: number;
  readonly authored: IrAuthoredStyle;
  readonly style: IrComputedStyle;
}

export interface IrElement {
  readonly type: "element";
  readonly nodeId: string;
  readonly className: string;
  readonly kindClass: string;
  readonly name: string;
  readonly kind: BuiltinKindName;
  readonly span: Span;
  readonly nameSpan: Span;
  readonly componentOrigin?: ComponentElementOrigin | undefined;
  readonly style: IrComputedStyle;
  readonly authored: IrAuthoredStyle;
  readonly responsive: readonly IrResponsive[];
  readonly hover: readonly IrHoverEffect[];
  readonly motion: IrMotion | null;
  readonly action: IrAction | null;
  readonly text: IrTextContent | null;
  readonly image: IrImageContent | null;
  readonly field: IrFieldContent | null;
  readonly accessibility: IrAccessibility;
  readonly children: readonly IrElement[];
  // kadam 0.3; absent on every 0.1 element.
  readonly content?: IrKindContent;
  /** `id` attribute, set when another element references this one. */
  readonly htmlId?: string;
  /** Button state: disabled, or submits its form. */
  readonly control?: { readonly disabled: boolean; readonly submit: boolean };
  /** kadam 0.3 custom breakpoint and container query styles. */
  readonly scopes?: readonly IrScopedStyle[];
  /** A scroll container: keyboard users can focus and scroll it. */
  readonly scrollable?: true;
  /** kadam 0.3 (D-41): emitted inside a `<template>` the runtime clones per record. */
  readonly template?: true;
  /** kadam 0.3 (F4 step 2): runtime attributes, emitted after data-kdm-id. */
  readonly attributes?: readonly (readonly [string, string])[];
  /** kadam 0.3 (F3) interaction states. */
  readonly states?: readonly IrStateStyle[];
  readonly stateTransitions?: readonly IrTransition[];
  readonly rules?: readonly IrRule[];
  /** Looping animation names used by this element (`spin`, `pulse`, ...). */
  readonly loops?: readonly string[];
}

export interface IrPageStyle {
  readonly background: IrColor;
  readonly text: IrColor;
  readonly font: FontFamily;
  readonly authored: {
    readonly background: boolean;
    readonly text: boolean;
    readonly font: boolean;
  };
  /** kadam 0.3: `in dark mode, the page background|text is ...` (D-38). */
  readonly dark?: { readonly background?: IrColor; readonly text?: IrColor };
  /** kadam 0.3: `the page is dark when the system is dark` (D-38). */
  readonly autoDark?: true;
}

/** A theme color (D-38): a CSS custom property with light and dark values. */
export interface IrColorToken {
  readonly name: string;
  readonly light: string;
  readonly dark: string | null;
}

export interface IrSourceMapping {
  readonly nodeId: string;
  readonly name: string;
  readonly kind: BuiltinKindName;
  readonly span: Span;
  readonly nameSpan: Span;
  readonly componentOrigin?: ComponentElementOrigin | undefined;
}

export interface IrAsset {
  readonly sourcePath: string;
  readonly url: string;
  readonly span: Span;
}

export interface PageIR {
  readonly type: "page-ir";
  readonly route: string;
  readonly routeSlug: string;
  readonly outputPath: string;
  readonly title: string;
  readonly sourceFile: string;
  readonly pageStyle: IrPageStyle;
  readonly elements: readonly IrElement[];
  readonly assets: readonly IrAsset[];
  readonly sourceMap: readonly IrSourceMapping[];
  readonly usesMotion: boolean;
  readonly basePath?: string | undefined;
  /** kadam 0.3 page metadata; absent when the page declares none. */
  readonly meta?: IrPageMeta;
  /** kadam 0.3 custom fonts used on this page. */
  readonly fonts?: readonly IrFontFace[];
  /** kadam 0.3 theme colors available on this page (theme plus page). */
  readonly colorTokens?: readonly IrColorToken[];
  /** kadam 0.3 (F4 step 2, D-36): present only when the page needs JavaScript. */
  readonly runtime?: IrRuntime;
  /** kadam 0.3 (F6, D-42): existing stylesheets, linked before Kadam's CSS. */
  readonly stylesheets?: readonly string[];
}

export interface IrPageMeta {
  readonly description: string | null;
  readonly language: string | null;
  readonly iconUrl: string | null;
  /** Absolute URL (requires the manifest siteUrl). */
  readonly shareImageUrl: string | null;
  /** Absolute canonical URL of this page, when the manifest has a siteUrl. */
  readonly canonicalUrl: string | null;
}
