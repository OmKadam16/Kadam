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

export type IrLengthUnit = "px" | "rem" | null;

export interface IrLength {
  readonly value: number;
  readonly unit: IrLengthUnit;
}

export interface IrColor {
  readonly kind: "named" | "hex";
  readonly value: string;
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
  readonly fontWeight: 300 | 400 | 500 | 600 | 700;
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
  readonly display: "block" | "inline" | "inline-flex" | "flex";
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
  | { readonly kind: "external"; readonly url: string };

export interface IrTextContent {
  readonly text: string;
}

export interface IrImageContent {
  readonly sourcePath: string;
  readonly url: string;
  readonly alt: string | null;
  readonly decorative: boolean;
}

export interface IrFieldContent {
  readonly label: string;
  readonly placeholder: string | null;
  readonly inputType: FieldType;
  readonly required: boolean;
  readonly inputId: string;
  readonly labelFor: string;
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
    | "separator";
  readonly name: string | null;
  readonly headingLevel?: 1 | 2 | 3;
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
}
