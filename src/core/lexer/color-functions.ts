/**
 * kadam 0.3 color functions: `rgb(255, 0, 0)`, `rgb(255 0 0 / 50%)`,
 * `rgba(...)`, `hsl(210, 80%, 40%)`, `hsla(...)`. The lexer turns each one into
 * a hex color token whose value is the normalized hex (`#ff0000`, or
 * `#ff000080` with alpha), so everything downstream treats it as a hex color
 * and the generated CSS is deterministic.
 */

export const COLOR_FUNCTIONS: ReadonlySet<string> = new Set(["rgb", "rgba", "hsl", "hsla"]);

export type ColorFunctionResult =
  | { readonly ok: true; readonly hex: string }
  | { readonly ok: false; readonly message: string };

const hex2 = (value: number): string => Math.round(value).toString(16).padStart(2, "0");

/** Parse the text between the parentheses. */
export function parseColorFunction(name: string, inner: string): ColorFunctionResult {
  const fail = (message: string): ColorFunctionResult => ({ ok: false, message });
  const usage =
    name.startsWith("rgb")
      ? `${name}() takes red, green, and blue from 0 to 255 (or 0% to 100%) and an optional alpha, e.g. rgb(37, 99, 235)`
      : `${name}() takes a hue in degrees and saturation and lightness percentages, e.g. hsl(220, 83%, 53%)`;
  const slash = inner.split("/");
  if (slash.length > 2) return fail(usage);
  const main = slash[0]!.trim();
  const parts = main.includes(",") ? main.split(",").map((part) => part.trim()) : main.split(/\s+/);
  let alphaText = slash[1]?.trim();
  if (alphaText === undefined && parts.length === 4) alphaText = parts.pop();
  if (parts.length !== 3 || parts.some((part) => part === "")) return fail(usage);

  const number = (text: string): number | null => (/^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null);
  const percent = (text: string): number | null =>
    text.endsWith("%") ? number(text.slice(0, -1)) : null;

  let alpha = 1;
  if (alphaText !== undefined) {
    const value = percent(alphaText) ?? null;
    const plain = value === null ? number(alphaText) : null;
    if (value !== null && value <= 100) alpha = value / 100;
    else if (plain !== null && plain <= 1) alpha = plain;
    else return fail("alpha is a number from 0 to 1 or a percentage from 0% to 100%");
  }

  let rgb: [number, number, number];
  if (name.startsWith("rgb")) {
    const channels = parts.map((part) => {
      const pct = percent(part);
      if (pct !== null) return pct <= 100 ? (pct / 100) * 255 : null;
      const plain = number(part);
      return plain !== null && plain <= 255 ? plain : null;
    });
    if (channels.some((channel) => channel === null)) return fail(usage);
    rgb = channels as [number, number, number];
  } else {
    const hue = number(parts[0]!.replace(/deg$/, ""));
    const saturation = percent(parts[1]!);
    const lightness = percent(parts[2]!);
    if (hue === null || saturation === null || lightness === null || saturation > 100 || lightness > 100) {
      return fail(usage);
    }
    rgb = hslToRgb(hue % 360, saturation / 100, lightness / 100);
  }
  const opaque = `#${rgb.map(hex2).join("")}`;
  return { ok: true, hex: alpha >= 1 ? opaque : `${opaque}${hex2(alpha * 255)}` };
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] =
    hue < 60 ? [chroma, x, 0] :
    hue < 120 ? [x, chroma, 0] :
    hue < 180 ? [0, chroma, x] :
    hue < 240 ? [0, x, chroma] :
    hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
