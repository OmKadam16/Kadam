import type { DiagnosticSpec } from "../core/diagnostics/diagnostic.js";
import { DARK_PAGE_BACKGROUND, DARK_PAGE_TEXT } from "./dark-palette.js";
import type { IrColor, IrElement, IrScopedStyle, PageIR } from "./ir.js";
import { NAMED_COLOR_HEX } from "./named-colors.js";

/**
 * D-39: compile-time contrast check. For every element with text whose color
 * and background are both known statically, compare them against WCAG 2.2 AA
 * (1.4.3): 4.5:1, or 3:1 for large text. A failure is warning KDM3039 in
 * kadam 0.3. Unknown pairs (gradients, images, transparency, opacity) are
 * skipped rather than guessed; the browser tests measure those.
 */

type Mode = "light" | "dark";
type Rgb = readonly [number, number, number];

const DARK_QUERY = "@media (prefers-color-scheme: dark)";

/** Kind defaults the built-in dark palette changes (see dark-palette.ts). */
const DARK_KIND_BACKGROUND: Readonly<Partial<Record<string, string>>> = {
  card: "#1B2028",
  dialog: "#1B2028",
  "navigation bar": "#1B2028",
  "code block": "#1B2028",
  badge: "#1E293B",
};
const DARK_KIND_TEXT: Readonly<Partial<Record<string, string>>> = {
  link: "#60A5FA",
  badge: "#BFDBFE",
  // The dark palette sets code block text to the dark page text.
  "code block": DARK_PAGE_TEXT,
};

function parseHex(value: string): Rgb | null {
  const hex = value.replace(/^#/, "");
  const expand = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(expand)) return null;
  // Semi-transparent colors depend on what is behind them: not known statically.
  if (expand.length === 8 && expand.slice(6).toLowerCase() !== "ff") return null;
  return [0, 2, 4].map((i) => parseInt(expand.slice(i, i + 2), 16)) as unknown as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

export function checkContrast(page: PageIR): DiagnosticSpec[] {
  const tokens = new Map((page.colorTokens ?? []).map((token) => [token.name, token]));
  const style = page.pageStyle;
  const usesDark =
    style.autoDark === true ||
    style.dark !== undefined ||
    (page.colorTokens ?? []).some((token) => token.dark !== null) ||
    flatten(page.elements).some((element) => darkScope(element) !== undefined);
  const modes: readonly Mode[] = usesDark ? ["light", "dark"] : ["light"];

  const resolve = (color: IrColor, mode: Mode): Rgb | null => {
    if (color.kind === "token") {
      const token = tokens.get(color.token ?? "");
      if (token === undefined) return null;
      return parseHex(mode === "dark" && token.dark !== null ? token.dark : token.light);
    }
    if (color.kind === "named") {
      const hex = NAMED_COLOR_HEX[color.value];
      return hex === undefined ? null : parseHex(hex);
    }
    return parseHex(color.value);
  };

  const pageBackground = (mode: Mode): Rgb | null => {
    if (mode === "dark") {
      if (style.dark?.background !== undefined) return resolve(style.dark.background, mode);
      if (style.autoDark === true && !style.authored.background) return parseHex(DARK_PAGE_BACKGROUND);
    }
    return resolve(style.background, mode);
  };
  const pageText = (mode: Mode): Rgb | null => {
    if (mode === "dark") {
      if (style.dark?.text !== undefined) return resolve(style.dark.text, mode);
      if (style.autoDark === true && !style.authored.text) return parseHex(DARK_PAGE_TEXT);
    }
    return resolve(style.text, mode);
  };

  /** The element's own background: a color, "none" (see through), or unknown. */
  const ownBackground = (element: IrElement, mode: Mode): Rgb | "none" | "unknown" => {
    const declarations = [...(element.authored.declarations ?? []), ...(mode === "dark" ? darkScope(element)?.authored.declarations ?? [] : [])];
    if (declarations.some((d) => d.property === "background-image" || d.property === "opacity" || d.property === "backdrop-filter")) {
      return "unknown";
    }
    const scope = mode === "dark" ? darkScope(element) : undefined;
    const background = scope?.authored.background !== undefined ? scope.style.background : element.style.background;
    if (background.kind === "none") return "none";
    if (background.kind === "gradient") return "unknown";
    const authored = scope?.authored.background !== undefined || element.authored.background !== undefined;
    if (mode === "dark" && !authored && style.autoDark === true) {
      const mapped = DARK_KIND_BACKGROUND[element.kind];
      if (mapped !== undefined) return parseHex(mapped) ?? "unknown";
    }
    return resolve(background.color, mode) ?? "unknown";
  };

  const textColor = (element: IrElement, mode: Mode): Rgb | null => {
    const typography = element.style.typography;
    if (typography === null) return null;
    const scope = mode === "dark" ? darkScope(element) : undefined;
    if (scope?.authored.typography?.color !== undefined && scope.style.typography !== null) {
      return resolve(scope.style.typography.color, mode);
    }
    if (element.authored.typography?.color !== undefined) return resolve(typography.color, mode);
    if (mode === "dark" && style.autoDark === true) {
      const mapped = DARK_KIND_TEXT[element.kind];
      if (mapped !== undefined) return parseHex(mapped);
    }
    // An unauthored color equal to the page text follows the page text.
    if (typography.color.value.toLowerCase() === style.text.value.toLowerCase()) return pageText(mode);
    return resolve(typography.color, mode);
  };

  const warnings: DiagnosticSpec[] = [];
  const visit = (element: IrElement, ancestors: readonly IrElement[]): void => {
    if (element.text !== null && element.style.typography !== null) {
      for (const mode of modes) {
        const text = textColor(element, mode);
        let background: Rgb | null = null;
        let unknown = false;
        for (const candidate of [element, ...[...ancestors].reverse()]) {
          const own = ownBackground(candidate, mode);
          if (own === "none") continue;
          if (own === "unknown") unknown = true;
          else background = own;
          break;
        }
        if (!unknown && background === null) background = pageBackground(mode);
        if (text === null || background === null || unknown) continue;
        const ratio = contrastRatio(text, background);
        const size = fontPx(element);
        const weight = element.style.typography.fontWeight;
        const large = size !== null && (size >= 24 || (size >= 18.66 && weight >= 700));
        const needed = large ? 3 : 4.5;
        if (ratio + 1e-9 < needed) {
          warnings.push({
            code: "KDM3039",
            message: `text in ${element.name} has a contrast ratio of ${ratio.toFixed(2)}:1${mode === "dark" ? " in dark mode" : ""}; WCAG AA needs ${needed}:1`,
            span: element.nameSpan,
            hint:
              mode === "dark"
                ? "set a lighter text color or a darker background with in dark mode, ..."
                : "use a darker text color or a lighter background (or the reverse)",
          });
        }
      }
    }
    for (const child of element.children) visit(child, [...ancestors, element]);
  };
  for (const element of page.elements) visit(element, []);
  return warnings;
}

function darkScope(element: IrElement): IrScopedStyle | undefined {
  return element.scopes?.find((scope) => scope.query === DARK_QUERY);
}

function fontPx(element: IrElement): number | null {
  const size = element.style.typography?.fontSize;
  if (size === undefined) return null;
  if (size.unit === "px") return size.value;
  if (size.unit === "rem" || size.unit === "em") return size.value * 16;
  return null;
}

function flatten(elements: readonly IrElement[]): IrElement[] {
  return elements.flatMap((element) => [element, ...flatten(element.children)]);
}
