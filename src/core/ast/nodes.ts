import type { LengthUnit } from "../lexer/token.js";
import type { Span } from "../source/source-file.js";

export type Breakpoint = "phones" | "tablets" | "desktops";
export type FontFamily = "sans serif" | "serif" | "monospace";
export type FontWeight = "light" | "regular" | "medium" | "semibold" | "bold";
export type TextAlign = "left" | "center" | "right";
export type Side = "top" | "right" | "bottom" | "left";
export type GradientDirection =
  | "left to right"
  | "right to left"
  | "top to bottom"
  | "bottom to top";
export type FieldType =
  | "text"
  | "email"
  | "password"
  | "number"
  // kadam 0.3
  | "tel"
  | "date"
  | "time"
  | "url"
  | "search";
import type { UiLanguageVersion } from "../../version.js";

export type BuiltinKindName =
  | "button"
  | "link"
  | "main heading"
  | "section heading"
  | "minor heading"
  | "paragraph"
  | "text field"
  | "image"
  | "card"
  | "container"
  | "navigation bar"
  | "divider"
  // kadam 0.3 (F1)
  | "small heading"
  | "header"
  | "footer"
  | "section"
  | "article"
  | "sidebar"
  | "list"
  | "numbered list"
  | "list item"
  | "table"
  | "header row"
  | "row"
  | "cell"
  | "video"
  | "audio clip"
  | "icon"
  | "code block"
  | "form"
  | "text area"
  | "checkbox"
  | "dropdown"
  | "radio group";

export type KindCategory = "leaf" | "container";

export interface NodeBase {
  readonly span: Span;
}

export interface ColorValue {
  readonly type: "color";
  readonly kind: "named" | "hex";
  readonly value: string;
  readonly raw: string;
  /** An unresolved `{$name}` color parameter, replaced during expansion. */
  readonly reference?: { readonly name: string; readonly span: Span } | undefined;
}

export interface LengthValue {
  readonly type: "length";
  readonly value: number;
  /** `%` only from kadam 0.3 size sentences (`it is 50% wide`). */
  readonly unit: LengthUnit | "%" | null;
  readonly raw: string;
  /** An unresolved `{$name}` length parameter, replaced during expansion. */
  readonly reference?: { readonly name: string; readonly span: Span } | undefined;
}

export interface DurationValue {
  readonly type: "duration";
  readonly value: number;
  readonly unit: "ms" | "s";
  readonly raw: string;
}

export interface PercentageValue {
  readonly type: "percentage";
  readonly value: number;
  readonly raw: string;
}

export type BuiltinKindReference = NodeBase & {
  readonly type: "builtin-kind";
  readonly name: BuiltinKindName;
  readonly category: KindCategory;
};

export interface VariantSelection {
  readonly name: string;
  readonly nameSpan: Span;
  readonly span: Span;
}

/** Reserved for the component system; resolved before lowering. */
export type ComponentKindReference = NodeBase & {
  readonly type: "component-kind";
  readonly name: string;
  /** Library namespace from `a Button from ui`; null in the project namespace. */
  readonly namespace: string | null;
  readonly namespaceSpan: Span | null;
};

/**
 * Placeholder for instance-supplied child elements. It is a component-only
 * marker and never reaches the IR: expansion replaces it with caller content.
 */
export type SlotKindReference = NodeBase & {
  readonly type: "slot-kind";
  /** Null for the unnamed slot; `header` in `a header slot`. */
  readonly name: string | null;
  readonly nameSpan: Span | null;
};

export type UnknownKindReference = NodeBase & {
  readonly type: "unknown-kind";
  readonly name: string;
};

export type KindReference =
  | BuiltinKindReference
  | ComponentKindReference
  | SlotKindReference
  | UnknownKindReference;

export interface KindNode extends NodeBase {
  readonly type: "kind";
  readonly article: "a" | "an";
  readonly reference: KindReference;
  /** Present only when a component kind selects a named variant. */
  readonly variant?: VariantSelection | undefined;
  readonly width?: LengthValue;
  readonly height?: LengthValue;
}

export interface DocumentNode extends NodeBase {
  readonly type: "document";
  readonly version: string | null;
  readonly versionSpan: Span | null;
  /**
   * Effective UI language version: the directive, else the project default,
   * else 0.1. Version-dependent behaviour reads this, never `version`.
   */
  readonly languageVersion: UiLanguageVersion;
  readonly page: PageNode | null;
  readonly component: ComponentNode | null;
}

export interface PageNode extends NodeBase {
  readonly type: "page";
  readonly title: string;
  readonly titleSpan: Span;
  readonly settings: PageSettingNode[];
  readonly elements: ElementNode[];
}

export type ComponentParameterType =
  | "text"
  | "page"
  | "url"
  | "image"
  | "length"
  | "color";

export interface ComponentParameterNode extends NodeBase {
  readonly type: "component-parameter";
  readonly name: string;
  readonly nameSpan: Span;
  readonly valueType: ComponentParameterType;
  readonly typeSpan: Span;
  readonly defaultValue: string | null;
  readonly defaultValueSpan: Span | null;
}

export interface ComponentVariantNode extends NodeBase {
  readonly type: "component-variant";
  readonly name: string;
  readonly nameSpan: Span;
  readonly elements: ElementNode[];
}

export interface ComponentNode extends NodeBase {
  readonly type: "component";
  readonly name: string;
  readonly nameSpan: Span;
  readonly parameters: ComponentParameterNode[];
  /** The implicit default body. Exactly one root is required by validation. */
  readonly elements: ElementNode[];
  readonly variants: ComponentVariantNode[];
}

export interface PropertyBindingNode extends NodeBase {
  readonly type: "property-binding";
  readonly name: string;
  readonly nameSpan: Span;
  readonly value: string;
  readonly valueSpan: Span;
}

export interface ComponentInstanceOrigin {
  /** Component being instantiated. */
  readonly component: string;
  /** Library namespace, present only for namespaced components. */
  readonly namespace?: string | undefined;
  /** null means the default body. */
  readonly variant: string | null;
  /** Name of the instance at the call site. */
  readonly instanceName: string;
  readonly instanceSpan: Span;
  /** Declaration span of the component. */
  readonly componentSpan: Span;
  /** Span of the component name in its declaration. */
  readonly componentNameSpan: Span;
}

export interface ComponentElementOrigin {
  /** Component that owns this expanded element. */
  readonly component: string;
  /** Library namespace, present only for namespaced components. */
  readonly namespace?: string | undefined;
  readonly variant: string | null;
  /** Instance-name path from the page to this component. */
  readonly instancePath: readonly string[];
  /** Outer-to-inner instance chain, including the current instance. */
  readonly instances: readonly ComponentInstanceOrigin[];
}

export interface ElementNode extends NodeBase {
  readonly type: "element";
  readonly name: string;
  readonly nameSpan: Span;
  readonly kind: KindNode | null;
  readonly statements: StatementNode[];
  readonly properties: PropertyBindingNode[];
  readonly children: ElementNode[];
  readonly componentOrigin?: ComponentElementOrigin | undefined;
  /** Deterministic suffix when a component body uses length parameters. */
  readonly styleKey?: string | undefined;
}

export type PageSettingNode =
  | (NodeBase & {
      readonly type: "page-setting";
      readonly property: "background" | "text";
      readonly value: ColorValue;
    })
  | (NodeBase & {
      readonly type: "page-setting";
      readonly property: "font";
      readonly value: FontFamily;
    })
  // kadam 0.3 page metadata
  | (NodeBase & {
      readonly type: "page-setting";
      readonly property: "description" | "language" | "icon" | "share image";
      readonly value: string;
      readonly valueSpan: Span;
    });

export type StatementNode =
  | SizeStatement
  | BackgroundStatement
  | GradientDirectionStatement
  | BorderStatement
  | CornersStatement
  | ShadowStatement
  | TypographyStatement
  | FontFamilyStatement
  | SpacingStatement
  | LayoutStatement
  | VisibilityStatement
  | TextStatement
  | ImageSourceStatement
  | ImageDescriptionStatement
  | DecorativeStatement
  | FieldLabelStatement
  | FieldPlaceholderStatement
  | FieldTypeStatement
  | RequiredStatement
  | HoverStatement
  | ClickStatement
  | MotionStatement
  | PropertyStatement
  | F1Statement
  | F2Statement
  | ResponsiveStatement
  | ScopedStatement;

/** kadam 0.3 (F1) statements; matched in `src/core/parser/matchers-f1.ts`. */
export type F1Statement =
  | (NodeBase & { readonly type: "caption"; readonly value: string; readonly valueSpan: Span })
  | (NodeBase & { readonly type: "media-source"; readonly value: string; readonly valueSpan: Span })
  | (NodeBase & { readonly type: "captions"; readonly value: string; readonly valueSpan: Span })
  | (NodeBase & { readonly type: "poster"; readonly value: string; readonly valueSpan: Span })
  | (NodeBase & { readonly type: "no-speech" })
  | (NodeBase & {
      readonly type: "options";
      readonly values: readonly string[];
      readonly valueSpans: readonly Span[];
    })
  | (NodeBase & { readonly type: "checked" })
  | (NodeBase & { readonly type: "disabled" })
  | (NodeBase & {
      readonly type: "length-limit";
      readonly bound: "min" | "max";
      readonly value: number;
    })
  | (NodeBase & { readonly type: "form-action"; readonly url: string; readonly urlSpan: Span })
  | (NodeBase & { readonly type: "submit" })
  | (NodeBase & {
      readonly type: "text-span";
      readonly target: string;
      readonly targetSpan: Span;
      readonly effect: TextSpanEffect;
    });

/** kadam 0.3 (F2) layout statements; matched in `src/core/parser/matchers-f2.ts`. */
export type F2Statement =
  | (NodeBase & {
      readonly type: "size-limit";
      readonly bound: "min" | "max";
      readonly axis: "width" | "height";
      readonly value: LengthValue;
    })
  | (NodeBase & { readonly type: "aspect-ratio"; readonly width: number; readonly height: number })
  | (NodeBase & { readonly type: "fluid-text"; readonly min: LengthValue; readonly max: LengthValue })
  | (NodeBase & { readonly type: "flex-rule"; readonly rule: "wrap" | "spread" | "even" })
  | (NodeBase & { readonly type: "child-rule"; readonly rule: "grow" | "no-shrink" | "end" })
  | (NodeBase & {
      readonly type: "grid";
      /** A fixed column count, or null for `columns at least <minWidth> wide`. */
      readonly columns: number | null;
      readonly minWidth: LengthValue | null;
    })
  | (NodeBase & { readonly type: "column-span"; readonly columns: number | "all" })
  | (NodeBase & {
      readonly type: "sticky";
      readonly edge: "top" | "bottom";
      readonly offset: LengthValue | null;
    })
  | (NodeBase & {
      readonly type: "position";
      /** pinned: fixed to the viewport. placed: absolute inside the parent. */
      readonly mode: "pinned" | "placed";
      /** Null edges with mode "placed" means over the whole parent. */
      readonly vertical: "top" | "bottom" | null;
      readonly horizontal: "left" | "right" | null;
      readonly offset: LengthValue | null;
    })
  | (NodeBase & { readonly type: "overflow"; readonly mode: "scroll-y" | "scroll-x" | "hidden" })
  | (NodeBase & { readonly type: "image-fit"; readonly fit: "cover" | "contain" })
  | (NodeBase & {
      readonly type: "image-focus";
      readonly vertical: "top" | "center" | "bottom";
      readonly horizontal: "left" | "center" | "right";
    })
  | (NodeBase & { readonly type: "loading"; readonly mode: "lazy" | "eager" });

/**
 * kadam 0.3 scoped statement: `on wide screens, ...` (a breakpoint from
 * kadam.json) or `when its parent is narrower than 400px, ...` (a container
 * query on the parent element).
 */
export interface ScopedStatement extends NodeBase {
  readonly type: "scoped";
  readonly scope: StatementScope;
  readonly statement: StatementNode;
}

export type StatementScope =
  | { readonly kind: "breakpoint"; readonly name: string; readonly minWidth: number }
  | {
      readonly kind: "container";
      readonly comparison: "narrower" | "wider";
      readonly width: LengthValue;
    };

export type TextSpanEffect =
  | { readonly type: "bold" }
  | { readonly type: "italic" }
  | { readonly type: "navigate"; readonly pageTitle: string; readonly pageSpan: Span }
  | { readonly type: "external"; readonly url: string; readonly urlSpan: Span };

export interface SizeStatement extends NodeBase {
  readonly type: "size";
  readonly mode: "both" | "width" | "height" | "full-width" | "full-height";
  readonly width?: LengthValue;
  readonly height?: LengthValue;
}

export type BackgroundStatement =
  | (NodeBase & {
      readonly type: "background";
      readonly mode: "solid";
      readonly color: ColorValue;
    })
  | (NodeBase & {
      readonly type: "background";
      readonly mode: "none";
    })
  | (NodeBase & {
      readonly type: "background";
      readonly mode: "gradient";
      readonly from: ColorValue;
      readonly to: ColorValue;
      readonly conjunction: "and" | "to";
    });

export interface GradientDirectionStatement extends NodeBase {
  readonly type: "gradient-direction";
  readonly direction: GradientDirection;
}

export type BorderStatement =
  | (NodeBase & {
      readonly type: "border";
      readonly mode: "none";
    })
  | (NodeBase & {
      readonly type: "border";
      readonly mode: "solid";
      readonly width: LengthValue;
      readonly color: ColorValue;
    });

export type CornersStatement =
  | (NodeBase & {
      readonly type: "corners";
      readonly mode: "default" | "full";
    })
  | (NodeBase & {
      readonly type: "corners";
      readonly mode: "custom";
      readonly radius: LengthValue;
    });

export interface ShadowStatement extends NodeBase {
  readonly type: "shadow";
  readonly preset: "soft" | "medium" | "strong" | "none";
}

export type TypographyStatement =
  | (NodeBase & {
      readonly type: "typography";
      readonly property: "size";
      readonly value: LengthValue;
    })
  | (NodeBase & {
      readonly type: "typography";
      readonly property: "color";
      readonly value: ColorValue;
    })
  | (NodeBase & {
      readonly type: "typography";
      readonly property: "weight";
      readonly value: FontWeight;
    })
  | (NodeBase & {
      readonly type: "typography";
      readonly property: "style";
      readonly value: "italic";
    })
  | (NodeBase & {
      readonly type: "typography";
      readonly property: "align";
      readonly value: TextAlign;
    })
  | (NodeBase & {
      readonly type: "typography";
      readonly property: "reference";
      readonly value: { readonly name: string; readonly span: Span; readonly raw: string };
    });

export interface FontFamilyStatement extends NodeBase {
  readonly type: "font-family";
  readonly value: FontFamily;
}

export interface SpacingStatement extends NodeBase {
  readonly type: "spacing";
  readonly property: "padding" | "margin";
  readonly value: LengthValue;
  readonly sides: readonly Side[];
}

export type LayoutStatement =
  | (NodeBase & {
      readonly type: "layout";
      readonly property: "direction";
      readonly value: "row" | "column";
    })
  | (NodeBase & {
      readonly type: "layout";
      readonly property: "gap";
      readonly value: LengthValue;
    })
  | (NodeBase & {
      readonly type: "layout";
      readonly property: "align";
      readonly axis: "both" | "horizontal" | "vertical";
    });

/** A unitless number, e.g. a line height of 1.6. */
export interface NumberValue {
  readonly type: "number";
  readonly value: number;
  readonly raw: string;
}

/**
 * D-32 regular property sentence: `the <property> is <value>`. `name` is a
 * row of the property table in `src/core/parser/properties.ts`.
 */
export interface PropertyStatement extends NodeBase {
  readonly type: "property";
  readonly name: string;
  readonly value: LengthValue | NumberValue;
}

export interface VisibilityStatement extends NodeBase {
  readonly type: "visibility";
  readonly hidden: true;
}

export interface TextStatement extends NodeBase {
  readonly type: "text";
  /** `text` is the generic form; the other values are noun-qualified. */
  readonly noun: "text" | "button" | "link" | "heading" | "paragraph";
  readonly value: string;
  readonly valueSpan: Span;
}

export interface ImageSourceStatement extends NodeBase {
  readonly type: "image-source";
  readonly value: string;
  readonly valueSpan: Span;
}

export interface ImageDescriptionStatement extends NodeBase {
  readonly type: "image-description";
  readonly value: string;
  readonly valueSpan: Span;
}

export interface DecorativeStatement extends NodeBase {
  readonly type: "decorative";
}

export interface FieldLabelStatement extends NodeBase {
  readonly type: "field-label";
  readonly value: string;
  readonly valueSpan: Span;
}

export interface FieldPlaceholderStatement extends NodeBase {
  readonly type: "field-placeholder";
  readonly value: string;
  readonly valueSpan: Span;
}

export interface FieldTypeStatement extends NodeBase {
  readonly type: "field-type";
  readonly value: FieldType;
}

export interface RequiredStatement extends NodeBase {
  readonly type: "required";
}

export type HoverEffect =
  | { readonly type: "background"; readonly color: ColorValue }
  | { readonly type: "text"; readonly color: ColorValue }
  | { readonly type: "border"; readonly color: ColorValue }
  | { readonly type: "lift"; readonly distance: LengthValue }
  | { readonly type: "scale"; readonly percentage: PercentageValue };

export interface HoverStatement extends NodeBase {
  readonly type: "hover";
  readonly effect: HoverEffect;
  readonly duration?: DurationValue;
}

export type ClickAction =
  | {
      readonly type: "navigate";
      readonly pageTitle: string;
      readonly pageTitleSpan: Span;
    }
  | {
      readonly type: "external";
      readonly url: string;
      readonly urlSpan: Span;
    };

export interface ClickStatement extends NodeBase {
  readonly type: "click";
  readonly action: ClickAction;
}

export interface MotionStatement extends NodeBase {
  readonly type: "motion";
  readonly effect: "fade" | "slide";
  readonly direction?: "left" | "right" | "top" | "bottom";
  readonly duration?: DurationValue;
}

export interface ResponsiveStatement extends NodeBase {
  readonly type: "responsive";
  readonly breakpoint: Breakpoint;
  readonly statement: StatementNode;
}
