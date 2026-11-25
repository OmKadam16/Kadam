import type { BuiltinKindName } from "../core/ast/nodes.js";

/**
 * The built-in dark palette (D-38): dark versions of Kadam's own default
 * colors, used on pages that say `the page is dark when the system is dark`.
 * Colors the author wrote are never remapped. The contrast check (D-39) uses
 * the same table, so what it measures is what the page shows.
 */
export const DARK_PAGE_BACKGROUND = "#111418";
export const DARK_PAGE_TEXT = "#E6E8EB";
const DARK_SURFACE = "#1B2028";
const DARK_LINE = "#2D333D";
const DARK_ACCENT_TEXT = "#60A5FA";

/** Light default color to its dark counterpart, for the contrast check. */
export const DARK_DEFAULTS: Readonly<Record<string, string>> = {
  "#ffffff": DARK_SURFACE,
  "#171717": DARK_PAGE_TEXT,
  "#f5f5f5": DARK_SURFACE,
  "#eef2ff": "#1E293B",
  "#1e3a8a": "#BFDBFE",
  "#737373": "#9AA3AF",
};

export interface DarkRule {
  readonly kinds: readonly BuiltinKindName[] | "always";
  readonly selector: string;
  readonly declarations: readonly (readonly [string, string])[];
}

export const DARK_RULES: readonly DarkRule[] = [
  { kinds: ["link"], selector: ".kdm-kind-link", declarations: [["color", DARK_ACCENT_TEXT]] },
  { kinds: "always", selector: ".kdm-inline-link", declarations: [["color", DARK_ACCENT_TEXT]] },
  { kinds: ["card"], selector: ".kdm-kind-card", declarations: [["background-color", DARK_SURFACE]] },
  { kinds: ["navigation bar"], selector: ".kdm-kind-navigation-bar", declarations: [["background-color", DARK_SURFACE]] },
  { kinds: ["divider"], selector: ".kdm-kind-divider", declarations: [["background-color", DARK_LINE]] },
  { kinds: ["cell"], selector: ".kdm-kind-cell", declarations: [["border-bottom-color", DARK_LINE]] },
  { kinds: ["badge"], selector: ".kdm-kind-badge", declarations: [["background-color", "#1E293B"], ["color", "#BFDBFE"]] },
  { kinds: ["code block"], selector: ".kdm-kind-code-block", declarations: [["background-color", DARK_SURFACE], ["color", DARK_PAGE_TEXT]] },
  {
    kinds: ["text field", "text area", "dropdown"],
    selector: ".kdm-field-input",
    declarations: [["background-color", DARK_SURFACE], ["border-color", "#3F4652"], ["color", DARK_PAGE_TEXT]],
  },
  {
    kinds: ["text field", "text area", "dropdown"],
    selector: ".kdm-field-input::placeholder",
    declarations: [["color", "#9AA3AF"]],
  },
];
