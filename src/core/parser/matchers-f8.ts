import type { ColorValue, F8Statement, ShapeName } from "../ast/nodes.js";
import type { Token } from "../lexer/token.js";
import type { StatementMatchBody } from "./statement-types.js";
import { isAnyWord, isKeyword, readColor, spanFromTokens } from "./values.js";

/**
 * kadam 0.3 (F8): image and box effects.
 *
 *     it is grayscale                  the brightness is 120%
 *     it has a dark overlay at 40%     it is shaped like a circle
 */

type Body = StatementMatchBody | null;

function fail(message: string, tokens: readonly Token[], hint: string): StatementMatchBody {
  return { statement: null, diagnostics: [{ code: "KDM3005", message, span: spanFromTokens(tokens), hint }] };
}
function ok(statement: F8Statement): StatementMatchBody {
  return { statement, diagnostics: [] };
}
function percent(token: Token | undefined): number | null {
  return token?.kind === "percentage" && typeof token.value === "number" ? token.value : null;
}

// it is grayscale | it is sepia
export function matchColorFilter(tokens: readonly Token[]): Body {
  if (tokens.length !== 3 || !isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "is")) return null;
  const word = tokens[2]!.text.toLowerCase();
  if (word === "grayscale" || word === "greyscale") return ok({ type: "image-filter", fn: "grayscale", percent: 100, span: spanFromTokens(tokens) });
  if (word === "sepia") return ok({ type: "image-filter", fn: "sepia", percent: 100, span: spanFromTokens(tokens) });
  return null;
}

const ADJUSTMENTS: Readonly<Record<string, "brightness" | "contrast" | "saturate">> = {
  brightness: "brightness",
  contrast: "contrast",
  saturation: "saturate",
};

// the brightness is 120% | the contrast is 110% | the saturation is 0%
export function matchAdjustment(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "the")) return null;
  const fn = ADJUSTMENTS[tokens[1]?.text.toLowerCase() ?? ""];
  if (fn === undefined || !isKeyword(tokens[2], "is")) return null;
  const value = percent(tokens[3]);
  if (tokens.length !== 4 || value === null || value < 0 || value > 300) {
    return fail(`the ${tokens[1]!.text.toLowerCase()} is a percentage from 0% to 300%`, tokens, `for example: the ${tokens[1]!.text.toLowerCase()} is 120%`);
  }
  return ok({ type: "image-filter", fn, percent: value, span: spanFromTokens(tokens) });
}

// it has a dark overlay at 40% | it has a light overlay at 20% | it has a #0F766E overlay at 30%
export function matchOverlay(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "has") || !isAnyWord(tokens[4], "overlay")) return null;
  const hint = "for example: it has a dark overlay at 40%, or it has a #0F766E overlay at 30%";
  const word = tokens[3]?.text.toLowerCase();
  let color: ColorValue | null = null;
  if (word === "dark") color = { type: "color", kind: "hex", value: "#000000", raw: "dark" };
  else if (word === "light") color = { type: "color", kind: "hex", value: "#FFFFFF", raw: "light" };
  else if (tokens[3] !== undefined) color = readColor(tokens[3]);
  const value = percent(tokens[6]);
  if (tokens.length !== 7 || !isKeyword(tokens[2], "a") || color === null || !isAnyWord(tokens[5], "at") || value === null || value <= 0 || value > 100) {
    return fail("write: it has a <dark, light or a color> overlay at <1% to 100%>", tokens, hint);
  }
  return ok({ type: "overlay", color, percent: value, span: spanFromTokens(tokens) });
}

const SHAPES: ReadonlySet<string> = new Set(["circle", "ellipse", "hexagon", "diamond", "triangle", "blob", "arch"]);

// it is shaped like a circle | it is shaped like an arch
export function matchShape(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "is") || !isAnyWord(tokens[2], "shaped")) return null;
  const shape = tokens[5]?.text.toLowerCase() ?? "";
  if (tokens.length !== 6 || !isAnyWord(tokens[3], "like") || !(isKeyword(tokens[4], "a") || isKeyword(tokens[4], "an")) || !SHAPES.has(shape)) {
    return fail("write: it is shaped like a circle, an ellipse, a hexagon, a diamond, a triangle, a blob, or an arch", tokens,
      "for example: it is shaped like a circle");
  }
  return ok({ type: "shape", shape: shape as ShapeName, span: spanFromTokens(tokens) });
}

// it plays in the background
export function matchBackgroundPlay(tokens: readonly Token[]): Body {
  if (tokens.length !== 5 || !isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "plays") || !isAnyWord(tokens[2], "in")) return null;
  if (!isKeyword(tokens[3], "the") || !isAnyWord(tokens[4], "background")) return null;
  return ok({ type: "background-play", span: spanFromTokens(tokens) });
}

// it scrolls slower than the page | it shows how far the page has scrolled
export function matchScrollEffect(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it")) return null;
  const words = tokens.map((token) => token.text.toLowerCase()).join(" ");
  if (words === "it scrolls slower than the page") return ok({ type: "scroll-effect", effect: "parallax", span: spanFromTokens(tokens) });
  if (words === "it shows how far the page has scrolled") return ok({ type: "scroll-effect", effect: "progress", span: spanFromTokens(tokens) });
  return null;
}

// it arranges its children in 3 masonry columns
export function matchMasonry(tokens: readonly Token[]): Body {
  if (!isAnyWord(tokens[6], "masonry") || !isAnyWord(tokens[1], "arranges")) return null;
  const count = tokens[5];
  if (tokens.length !== 8 || !isAnyWord(tokens[7], "columns") || count?.kind !== "number" || typeof count.value !== "number" || !Number.isInteger(count.value) || count.value < 2 || count.value > 6) {
    return fail("write: it arranges its children in <2 to 6> masonry columns", tokens, "for example: it arranges its children in 3 masonry columns");
  }
  return ok({ type: "masonry", columns: count.value, span: spanFromTokens(tokens) });
}

// its children snap into place
export function matchSnap(tokens: readonly Token[]): Body {
  const words = tokens.map((token) => token.text.toLowerCase()).join(" ");
  return words === "its children snap into place" ? ok({ type: "snap", span: spanFromTokens(tokens) }) : null;
}

// it opens larger when clicked
export function matchLightbox(tokens: readonly Token[]): Body {
  const words = tokens.map((token) => token.text.toLowerCase()).join(" ");
  return words === "it opens larger when clicked" ? ok({ type: "lightbox", span: spanFromTokens(tokens) }) : null;
}
