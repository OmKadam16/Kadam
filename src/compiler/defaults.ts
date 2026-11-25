import type {
  BuiltinKindName,
  FontFamily,
} from "../core/ast/nodes.js";
import type {
  IrAuthoredStyle,
  IrBackground,
  IrBorder,
  IrColor,
  IrComputedStyle,
  IrCorners,
  IrFieldStyle,
  IrLayout,
  IrLength,
  IrPageStyle,
  IrSides,
  IrSize,
  IrTypography,
} from "./ir.js";

export const GLOBAL_TOKENS = {
  pageBackground: "#FFFFFF",
  pageText: "#171717",
  accent: "#2563EB",
  mutedBorder: "#D4D4D4",
  mutedText: "#737373",
  divider: "#E5E5E5",
  defaultRadius: 8,
  pillRadius: 9999,
  focusRingWidth: 2,
  focusRingOffset: 2,
  hoverDuration: 150,
  entranceDuration: 400,
  slideDistance: 24,
} as const;

export const FONT_STACKS: Readonly<Record<FontFamily, string>> = {
  "sans serif": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  monospace: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export const SHADOW_VALUES: Readonly<Record<"soft" | "medium" | "strong", string>> = {
  soft: "0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.10)",
  medium: "0 4px 6px -1px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.10)",
  strong: "0 10px 15px -3px rgb(0 0 0 / 0.12), 0 4px 6px -4px rgb(0 0 0 / 0.12)",
};

export function hexColor(value: string): IrColor {
  return { kind: "hex", value };
}

export function namedColor(value: string): IrColor {
  return { kind: "named", value };
}

export function length(value: number, unit: "px" | "rem" = "px"): IrLength {
  return { value, unit };
}

export function zeroLength(): IrLength {
  return length(0);
}

export function autoSize(): IrSize {
  return { kind: "auto" };
}

export function noBackground(): IrBackground {
  return { kind: "none" };
}

export function noBorder(): IrBorder {
  return { kind: "none" };
}

export function noCorners(): IrCorners {
  return { kind: "none" };
}

export function allSides<T>(value: T): IrSides<T> {
  return { top: value, right: value, bottom: value, left: value };
}

export function zeroSides(): IrSides<IrLength> {
  return { top: zeroLength(), right: zeroLength(), bottom: zeroLength(), left: zeroLength() };
}

export function defaultPageStyle(): IrPageStyle {
  return {
    background: hexColor(GLOBAL_TOKENS.pageBackground),
    text: hexColor(GLOBAL_TOKENS.pageText),
    font: "sans serif",
    authored: { background: false, text: false, font: false },
  };
}

export function defaultAuthoredStyle(): IrAuthoredStyle {
  return {};
}

export function createDefaultStyle(
  kind: BuiltinKindName,
  page: IrPageStyle,
): IrComputedStyle {
  const base: IrComputedStyle = {
    display: "block",
    width: autoSize(),
    height: autoSize(),
    minHeight: null,
    background: noBackground(),
    border: noBorder(),
    corners: noCorners(),
    shadow: "none",
    padding: zeroSides(),
    margin: zeroSides(),
    gap: null,
    layout: null,
    typography: null,
    field: null,
    visibility: "visible",
    textDecoration: "none",
  };

  switch (kind) {
    case "button":
      return {
        ...base,
        display: "inline-flex",
        background: { kind: "solid", color: hexColor(GLOBAL_TOKENS.accent) },
        corners: { kind: "length", value: length(GLOBAL_TOKENS.defaultRadius) },
        padding: {
          top: length(12),
          right: length(20),
          bottom: length(12),
          left: length(20),
        },
        typography: typography(page.font, 16, 600, "center", "#FFFFFF", null),
      };
    case "link":
      return {
        ...base,
        display: "inline",
        textDecoration: "underline",
        typography: typography(page.font, 16, 400, "left", GLOBAL_TOKENS.accent, null),
      };
    case "main heading":
      return {
        ...base,
        typography: typography(page.font, 48, 700, "left", page.text, 1.1),
      };
    case "section heading":
      return {
        ...base,
        typography: typography(page.font, 32, 700, "left", page.text, 1.2),
      };
    case "minor heading":
      return {
        ...base,
        typography: typography(page.font, 24, 600, "left", page.text, 1.3),
      };
    case "paragraph":
      return {
        ...base,
        typography: typography(page.font, 16, 400, "left", page.text, 1.6),
      };
    case "text field":
      return {
        ...base,
        display: "flex",
        width: { kind: "full" },
        layout: { direction: "column", horizontal: "start", vertical: "start" },
        gap: length(8),
        field: defaultFieldStyle(page),
      };
    case "image":
      return { ...base, display: "block" };
    case "card":
      return {
        ...base,
        display: "flex",
        background: { kind: "solid", color: hexColor("#FFFFFF") },
        corners: { kind: "length", value: length(12) },
        shadow: "soft",
        padding: allSides(length(24)),
        gap: length(16),
        layout: { direction: "column", horizontal: "start", vertical: "start" },
      };
    case "container":
      return {
        ...base,
        display: "flex",
        gap: zeroLength(),
        layout: { direction: "column", horizontal: "start", vertical: "start" },
      };
    case "navigation bar":
      return {
        ...base,
        display: "flex",
        width: { kind: "full" },
        minHeight: length(64),
        background: { kind: "solid", color: hexColor("#FFFFFF") },
        gap: length(24),
        padding: {
          top: zeroLength(),
          right: length(24),
          bottom: zeroLength(),
          left: length(24),
        },
        layout: { direction: "row", horizontal: "start", vertical: "center" },
      };
    case "divider":
      return {
        ...base,
        width: { kind: "full" },
        height: { kind: "length", value: length(1) },
        background: { kind: "solid", color: hexColor(GLOBAL_TOKENS.divider) },
        margin: {
          top: length(24),
          right: zeroLength(),
          bottom: length(24),
          left: zeroLength(),
        },
      };
    // kadam 0.3 (F1). Base rules for these kinds are emitted only when a page
    // uses them, so 0.1 projects keep a byte-identical kadam.css.
    case "small heading":
      return { ...base, typography: typography(page.font, 16, 600, "left", page.text, 1.4) };
    case "header":
    case "footer":
    case "section":
    case "article":
    case "sidebar":
      return { ...base, display: "flex", gap: zeroLength(), layout: COLUMN };
    case "form":
      return { ...base, display: "flex", gap: length(16), layout: COLUMN };
    case "list":
    case "numbered list":
      return {
        ...base,
        display: "flex",
        gap: length(4),
        layout: COLUMN,
        padding: { top: zeroLength(), right: zeroLength(), bottom: zeroLength(), left: length(24) },
      };
    case "list item":
      return { ...base, display: "list-item", typography: typography(page.font, 16, 400, "left", page.text, 1.6) };
    case "table":
      return { ...base, display: "table", width: { kind: "full" } };
    case "header row":
    case "row":
      return { ...base, display: "table-row" };
    case "cell":
      return {
        ...base,
        display: "table-cell",
        padding: { top: length(8), right: length(12), bottom: length(8), left: length(12) },
        typography: typography(page.font, 16, 400, "left", page.text, 1.5),
      };
    case "video":
    case "audio clip":
      return { ...base, width: { kind: "full" } };
    case "icon":
      return {
        ...base,
        display: "inline-block",
        width: { kind: "length", value: length(24) },
        height: { kind: "length", value: length(24) },
      };
    case "code block":
      return {
        ...base,
        background: { kind: "solid", color: hexColor("#F5F5F5") },
        corners: { kind: "length", value: length(GLOBAL_TOKENS.defaultRadius) },
        padding: allSides(length(16)),
        typography: typography("monospace", 14, 400, "left", "#171717", 1.5),
      };
    case "text area":
    case "dropdown":
      return {
        ...base,
        display: "flex",
        width: { kind: "full" },
        layout: COLUMN,
        gap: length(8),
        field: defaultFieldStyle(page),
      };
    case "checkbox":
      return { ...base, display: "flex", gap: length(8), layout: { direction: "row", horizontal: "start", vertical: "center" } };
    case "radio group":
      return { ...base, display: "flex", gap: length(8), layout: COLUMN };
  }
}

const COLUMN: IrLayout = { direction: "column", horizontal: "start", vertical: "start" };

function defaultFieldStyle(page: IrPageStyle): IrFieldStyle {
  return {
    label: typography(page.font, 14, 500, "left", page.text, null),
    input: typography(page.font, 16, 400, "left", "#171717", null),
    placeholder: hexColor(GLOBAL_TOKENS.mutedText),
    height: { kind: "length", value: length(44) },
    padding: {
      top: zeroLength(),
      right: length(12),
      bottom: zeroLength(),
      left: length(12),
    },
    background: { kind: "solid", color: hexColor("#FFFFFF") },
    border: {
      kind: "solid",
      width: length(1),
      color: hexColor(GLOBAL_TOKENS.mutedBorder),
    },
    corners: { kind: "length", value: length(GLOBAL_TOKENS.defaultRadius) },
    shadow: "none",
  };
}

function typography(
  fontFamily: FontFamily,
  size: number,
  weight: 300 | 400 | 500 | 600 | 700,
  align: "left" | "center" | "right",
  color: string | IrColor,
  lineHeight: number | null,
): IrTypography {
  return {
    fontFamily,
    fontSize: length(size),
    fontWeight: weight,
    fontStyle: "normal",
    textAlign: align,
    color: typeof color === "string" ? hexColor(color) : { ...color },
    lineHeight,
  };
}

export function cloneComputedStyle(style: IrComputedStyle): IrComputedStyle {
  return {
    ...style,
    width: { ...style.width },
    height: { ...style.height },
    minHeight: style.minHeight === null ? null : { ...style.minHeight },
    background: cloneBackground(style.background),
    border: cloneBorder(style.border),
    corners: cloneCorners(style.corners),
    padding: { ...style.padding },
    margin: { ...style.margin },
    gap: style.gap === null ? null : { ...style.gap },
    layout: style.layout === null ? null : cloneLayout(style.layout),
    typography: style.typography === null ? null : cloneTypography(style.typography),
    field: style.field === null ? null : cloneField(style.field),
  };
}

function cloneBackground(background: IrBackground): IrBackground {
  if (background.kind !== "gradient") return { ...background };
  return {
    ...background,
    from: { ...background.from },
    to: { ...background.to },
  };
}

function cloneBorder(border: IrBorder): IrBorder {
  if (border.kind === "none") return { kind: "none" };
  return {
    ...border,
    width: { ...border.width },
    color: { ...border.color },
  };
}

function cloneCorners(corners: IrCorners): IrCorners {
  if (corners.kind !== "length") return { ...corners };
  return { ...corners, value: { ...corners.value } };
}

function cloneLayout(layout: IrLayout): IrLayout {
  return { ...layout };
}

function cloneSize(size: IrSize): IrSize {
  if (size.kind !== "length") return { ...size };
  return { ...size, value: { ...size.value } };
}

function cloneTypography(value: IrTypography): IrTypography {
  return {
    ...value,
    fontSize: { ...value.fontSize },
    color: { ...value.color },
  };
}

function cloneField(field: IrFieldStyle): IrFieldStyle {
  return {
    ...field,
    label: cloneTypography(field.label),
    input: cloneTypography(field.input),
    placeholder: { ...field.placeholder },
    height: cloneSize(field.height),
    padding: { ...field.padding },
    background: cloneBackground(field.background),
    border: cloneBorder(field.border),
    corners: cloneCorners(field.corners),
  };
}
