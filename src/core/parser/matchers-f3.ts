import { isHoverEffect } from "./matchers-effects.js";
import type {
  BorderStatement,
  ColorValue,
  Corner,
  DurationValue,
  F3Statement,
  InteractionState,
  LengthValue,
  Side,
  StateEffect,
} from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Token } from "../lexer/token.js";
import type { StatementMatchBody } from "./statement-types.js";
import { MIN_SCALE_03, endsWithScrollIntoView, parseHoverEffect, parseOptionalDuration } from "./matchers-interaction.js";
import {
  colorDiagnostic,
  describeTokens,
  isAnyWord,
  isKeyword,
  isLength,
  isPercentage,
  isString,
  readColor,
  readDuration,
  readLength,
  spanFromTokens,
} from "./values.js";

/**
 * kadam 0.3 (F3) styling sentences. Every template that uses these matchers
 * declares `since: "0.3"`; new words are contextual (`isAnyWord`), never
 * reserved, so existing 0.1 element names stay valid.
 */

type Body = StatementMatchBody | null;

function fail(message: string, tokens: readonly Token[], hint: string): StatementMatchBody {
  return {
    statement: null,
    diagnostics: [{ code: "KDM3005", message, span: spanFromTokens(tokens), hint }],
  };
}

function ok(statement: F3Statement | BorderStatement): StatementMatchBody {
  return { statement, diagnostics: [] };
}

function words(tokens: readonly Token[], ...expected: string[]): boolean {
  return expected.length <= tokens.length && expected.every((word, index) => isAnyWord(tokens[index], word));
}

const text = (token: Token | undefined): string => token?.text.toLowerCase() ?? "";

function readAngle(token: Token | undefined): number | null {
  return token?.kind === "angle" && typeof token.value === "number" ? token.value : null;
}

// ---------------------------------------------------------------------------
// Borders, corners, outline

const LINES: ReadonlySet<string> = new Set(["dashed", "dotted", "solid"]);

/**
 * `has a [width] [dashed|dotted] <color> border [on the <sides>]` shapes that
 * are new in 0.3. `matchBorder` (0.1) steps aside for them.
 */
export function isF3Border(tokens: readonly Token[]): boolean {
  if (!isKeyword(tokens[0], "has") || !isKeyword(tokens[1], "a")) return false;
  const borderIndex = tokens.findIndex((token) => isKeyword(token, "border"));
  if (borderIndex === -1) return false;
  const head = tokens.slice(2, borderIndex);
  return head.some((token) => LINES.has(text(token))) || isKeyword(tokens[borderIndex + 1], "on");
}

const BORDER_HINT = "for example: has a 2px dashed red border, or has a 1px #E5E5E5 border on the bottom";

function readSides(tokens: readonly Token[]): Side[] | null {
  // on the top | on the left and right | on the top and bottom
  if (!isKeyword(tokens[0], "on")) return null;
  const rest = isKeyword(tokens[1], "the") ? tokens.slice(2) : tokens.slice(1);
  const sides: Side[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const word = text(rest[index]);
    if (index % 2 === 1) {
      if (word !== "and") return null;
      continue;
    }
    if (word !== "top" && word !== "right" && word !== "bottom" && word !== "left") return null;
    if (sides.includes(word)) return null;
    sides.push(word);
  }
  return sides.length === 0 || rest.length % 2 === 0 ? null : sides;
}

export function matchF3Border(tokens: readonly Token[]): Body {
  // D-50: `has no border on the top` removes one side (a card without the top line).
  if (isKeyword(tokens[0], "has") && text(tokens[1]) === "no" && isKeyword(tokens[2], "border") && isKeyword(tokens[3], "on")) {
    const sides = readSides(tokens.slice(3));
    if (sides === null) return fail("write: has no border on the top, the bottom, the left or the right", tokens, "for example: has no border on the top");
    return ok({ type: "side-border", sides, width: { type: "length", value: 0, unit: null, raw: "0" }, color: { type: "color", kind: "hex", value: "#00000000", raw: "#00000000" }, line: "solid", span: spanFromTokens(tokens) });
  }
  if (!isF3Border(tokens)) return null;
  const borderIndex = tokens.findIndex((token) => isKeyword(token, "border"));
  const head = tokens.slice(2, borderIndex);
  let index = 0;
  let width: LengthValue = { type: "length", value: 1, unit: "px", raw: "1px" };
  if (isLength(head[0])) {
    width = readLength(head[0])!;
    index += 1;
  }
  let line: "solid" | "dashed" | "dotted" = "solid";
  if (LINES.has(text(head[index]))) {
    line = text(head[index]) as typeof line;
    index += 1;
  }
  const color = head[index] === undefined ? null : readColor(head[index]!);
  if (color === null || index !== head.length - 1) {
    if (head[index] !== undefined && color === null && index === head.length - 1) {
      return { statement: null, diagnostics: [colorDiagnostic(head[index]!)] };
    }
    return fail("a border is [width] [dashed or dotted] <color> border", tokens, BORDER_HINT);
  }
  const span = spanFromTokens(tokens);
  const after = tokens.slice(borderIndex + 1);
  if (after.length === 0) {
    return ok({
      type: "border",
      mode: "solid",
      width,
      color,
      ...(line === "solid" ? {} : { line }),
      span,
    });
  }
  const sides = readSides(after);
  if (sides === null) {
    return fail("a side border names sides such as on the bottom, or on the left and right", after, BORDER_HINT);
  }
  return ok({ type: "side-border", sides, width, color, line, span });
}

const CORNERS: Readonly<Record<string, readonly Corner[]>> = {
  top: ["top-left", "top-right"],
  bottom: ["bottom-left", "bottom-right"],
  left: ["top-left", "bottom-left"],
  right: ["top-right", "bottom-right"],
  "top left": ["top-left"],
  "top right": ["top-right"],
  "bottom left": ["bottom-left"],
  "bottom right": ["bottom-right"],
};

/** `has 12px rounded corners on the top` (0.3). `matchCorners` steps aside. */
export function isF3Corners(tokens: readonly Token[]): boolean {
  if (!isKeyword(tokens[0], "has")) return false;
  const index = tokens.findIndex((token) => isKeyword(token, "corners"));
  return index !== -1 && index < tokens.length - 1 && isKeyword(tokens[index + 1], "on");
}

export function matchF3Corners(tokens: readonly Token[]): Body {
  if (!isF3Corners(tokens)) return null;
  const index = tokens.findIndex((token) => isKeyword(token, "corners"));
  const head = tokens.slice(1, index).map(text).join(" ");
  const hint = "for example: has 12px rounded corners on the top, or has fully rounded corners on the left";
  let radius: LengthValue | null;
  if (head === "fully rounded") {
    radius = null;
  } else if (tokens.length > 2 && isLength(tokens[1]) && text(tokens[2]) === "rounded" && index === 3) {
    radius = readLength(tokens[1])!;
  } else {
    return fail("per-corner rounding is <length> rounded corners on the <corner>", tokens, hint);
  }
  const spot = tokens.slice(index + 2).filter((token) => !isKeyword(token, "the")).map(text).join(" ");
  const corners = CORNERS[spot];
  if (corners === undefined) {
    return fail(`invalid corner ${JSON.stringify(spot)}`, tokens.slice(index + 1), hint);
  }
  return ok({ type: "corner-radius", corners, radius, span: spanFromTokens(tokens) });
}

// has a 2px blue outline
export function matchOutline(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "has") || !isAnyWord(tokens[tokens.length - 1], "outline")) return null;
  const hint = "for example: has a 2px blue outline";
  if (!isKeyword(tokens[1], "a") || tokens.length !== 5 || !isLength(tokens[2])) {
    return fail("an outline is has a <width> <color> outline", tokens, hint);
  }
  const color = readColor(tokens[3]!);
  if (color === null) return { statement: null, diagnostics: [colorDiagnostic(tokens[3]!)] };
  return ok({ type: "outline", width: readLength(tokens[2])!, color, span: spanFromTokens(tokens) });
}

// ---------------------------------------------------------------------------
// Backgrounds

/** Gradients new in 0.3: three or more colors, or radial. */
export function isF3Gradient(tokens: readonly Token[]): boolean {
  if (!isKeyword(tokens[0], "has") || !isKeyword(tokens[1], "a")) return false;
  if (!isKeyword(tokens[tokens.length - 1], "gradient")) return false;
  return isAnyWord(tokens[2], "radial") || tokens.length > 6;
}

export function matchF3Gradient(tokens: readonly Token[]): Body {
  if (!isF3Gradient(tokens)) return null;
  const radial = isAnyWord(tokens[2], "radial");
  const list = tokens.slice(radial ? 3 : 2, -1);
  const hint = "for example: has a blue and white and red gradient, or has a radial white and blue gradient";
  const colors: ColorValue[] = [];
  for (let index = 0; index < list.length; index += 1) {
    if (index % 2 === 1) {
      if (!isKeyword(list[index], "and") && !isKeyword(list[index], "to")) {
        return fail("gradient colors are separated by and", list, hint);
      }
      continue;
    }
    const color = readColor(list[index]!);
    if (color === null) return { statement: null, diagnostics: [colorDiagnostic(list[index]!)] };
    colors.push(color);
  }
  if (colors.length < 2 || list.length % 2 === 0) return fail("a gradient needs at least two colors", tokens, hint);
  if (colors.length > 8) return fail("a gradient has at most 8 colors", tokens, hint);
  return ok({ type: "gradient", shape: radial ? "radial" : "linear", colors, span: spanFromTokens(tokens) });
}

// the gradient goes at 45deg
export function matchGradientAngle(tokens: readonly Token[]): Body {
  if (!words(tokens, "the", "gradient", "goes", "at")) return null;
  const degrees = readAngle(tokens[4]);
  if (tokens.length !== 5 || degrees === null || degrees > 360) {
    return fail("a gradient angle is from 0deg to 360deg", tokens, "for example: the gradient goes at 135deg");
  }
  return ok({ type: "gradient-angle", degrees, span: spanFromTokens(tokens) });
}

// has a "assets/bg.jpg" background image | has an "..." background image
export function matchBackgroundImage(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "has")) return null;
  if (!isKeyword(tokens[1], "a") && !isKeyword(tokens[1], "an")) return null;
  // `has a "{$fill}" background` is a 0.1 color placeholder, not an image.
  if (!isString(tokens[2]) || !isKeyword(tokens[3], "background") || !isAnyWord(tokens[4], "image")) return null;
  if (tokens.length !== 5) {
    return fail("a background image is has a \"assets/...\" background image", tokens, 'for example: has a "assets/hero.jpg" background image');
  }
  if (tokens[2].value.trim() === "") return fail("a background image needs a path", tokens, 'for example: has a "assets/hero.jpg" background image');
  return ok({ type: "background-image", value: tokens[2].value, valueSpan: tokens[2].span, span: spanFromTokens(tokens) });
}

// the background image covers its box | fits inside its box | repeats | keeps the top in view
export function matchBackgroundImageRule(tokens: readonly Token[]): Body {
  if (!words(tokens, "the", "background", "image")) return null;
  const rest = tokens.slice(3);
  const span = spanFromTokens(tokens);
  const hint = "use covers its box, fits inside its box, repeats, or keeps the top in view";
  if (rest.length === 3 && words(rest, "covers", "its", "box")) return ok({ type: "background-fit", fit: "cover", span });
  if (rest.length === 4 && words(rest, "fits", "inside", "its", "box")) return ok({ type: "background-fit", fit: "contain", span });
  if (rest.length === 1 && isAnyWord(rest[0], "repeats")) return ok({ type: "background-fit", fit: "repeat", span });
  if (words(rest, "keeps", "the") && words(rest.slice(-2), "in", "view")) {
    const spot = rest.slice(2, -2).map(text);
    const vertical = spot.find((word) => word === "top" || word === "bottom") as "top" | "bottom" | undefined;
    const horizontal = spot.find((word) => word === "left" || word === "right") as "left" | "right" | undefined;
    const valid =
      (spot.length === 1 && (spot[0] === "center" || vertical !== undefined || horizontal !== undefined)) ||
      (spot.length === 2 && vertical === spot[0] && horizontal === spot[1]);
    if (valid) {
      return ok({ type: "background-focus", vertical: vertical ?? "center", horizontal: horizontal ?? "center", span });
    }
  }
  return fail(`invalid background image rule ${JSON.stringify(describeTokens(rest))}`, tokens, hint);
}

// ---------------------------------------------------------------------------
// Typography

const DECORATIONS: Readonly<Record<string, "underline" | "line-through" | "none">> = {
  underlined: "underline",
  "struck through": "line-through",
  "not underlined": "none",
};
const CASES: Readonly<Record<string, "uppercase" | "lowercase" | "capitalize">> = {
  uppercase: "uppercase",
  lowercase: "lowercase",
  capitalized: "capitalize",
};

/** `the text is underlined|uppercase|at most 65 characters wide` (0.3). */
export function isF3Text(tokens: readonly Token[]): boolean {
  if (!isKeyword(tokens[0], "the") || !isKeyword(tokens[1], "text") || !isKeyword(tokens[2], "is")) return false;
  const rest = tokens.slice(3).map(text).join(" ");
  return rest in DECORATIONS || rest in CASES || (isAnyWord(tokens[3], "at") && isAnyWord(tokens[4], "most"));
}

export function matchF3Text(tokens: readonly Token[]): Body {
  if (!isF3Text(tokens)) return null;
  const rest = tokens.slice(3).map(text).join(" ");
  const span = spanFromTokens(tokens);
  const decoration = DECORATIONS[rest];
  if (decoration !== undefined) return ok({ type: "text-decoration", value: decoration, span });
  const textCase = CASES[rest];
  if (textCase !== undefined) return ok({ type: "text-case", value: textCase, span });
  // the text is at most 65 characters wide
  const count = tokens[5];
  if (
    tokens.length !== 8 ||
    count?.kind !== "number" ||
    typeof count.value !== "number" ||
    !Number.isInteger(count.value) ||
    count.value < 10 ||
    count.value > 200 ||
    !isAnyWord(tokens[6], "characters") ||
    !isKeyword(tokens[7], "wide")
  ) {
    return fail("a line length is the text is at most <10 to 200> characters wide", tokens, "for example: the text is at most 65 characters wide");
  }
  return ok({ type: "text-measure", characters: count.value, span });
}

// it shows at most 2 lines
export function matchLineClamp(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "shows") || !isAnyWord(tokens[2], "at")) return null;
  const count = tokens[4];
  const lines =
    count?.kind === "number" && typeof count.value === "number" && Number.isInteger(count.value) ? count.value : null;
  const nounOk = lines === 1 ? isAnyWord(tokens[5], "line") : isAnyWord(tokens[5], "lines");
  if (tokens.length !== 6 || !isAnyWord(tokens[3], "most") || lines === null || lines < 1 || lines > 10 || !nounOk) {
    return fail("truncation is it shows at most <1 to 10> lines", tokens, "for example: it shows at most 2 lines");
  }
  return ok({ type: "line-clamp", lines, span: spanFromTokens(tokens) });
}

// the font is "Inter"
export function matchCustomFont(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "the") || !isKeyword(tokens[1], "font") || !isKeyword(tokens[2], "is")) return null;
  if (!isString(tokens[3])) return null;
  if (tokens.length !== 4 || tokens[3].value.trim() === "") {
    return fail("a custom font is the font is \"Name\"", tokens, 'for example: the font is "Inter", declared in kadam.json fonts');
  }
  return ok({ type: "custom-font", name: tokens[3].value, nameSpan: tokens[3].span, span: spanFromTokens(tokens) });
}

// ---------------------------------------------------------------------------
// Shadows, filters, transforms

/** Shadows new in 0.3: inner, colored, or custom. `matchShadow` steps aside. */
export function isF3Shadow(tokens: readonly Token[]): boolean {
  if (!isKeyword(tokens[0], "has")) return false;
  const index = tokens.findIndex((token) => isKeyword(token, "shadow"));
  if (index === -1) return false;
  const head = tokens.slice(1, index);
  return (
    head.some((token) => isAnyWord(token, "inner") || token.kind === "color" || token.kind === "hex-color") ||
    index < tokens.length - 1
  );
}

const SHADOW_HINT =
  "for example: has a soft blue shadow, has an inner shadow, or has a #00000033 shadow that is 24px blurred and 8px down";

export function matchF3Shadow(tokens: readonly Token[]): Body {
  if (!isF3Shadow(tokens)) return null;
  const index = tokens.findIndex((token) => isKeyword(token, "shadow"));
  if (!isKeyword(tokens[1], "a") && !isKeyword(tokens[1], "an")) return fail("expected has a ... shadow", tokens, SHADOW_HINT);
  const head = tokens.slice(2, index);
  let cursor = 0;
  let inner = false;
  let preset: "soft" | "medium" | "strong" | null = null;
  let color: ColorValue | null = null;
  if (isAnyWord(head[cursor], "inner")) {
    inner = true;
    cursor += 1;
  }
  const presetWord = text(head[cursor]);
  if (presetWord === "soft" || presetWord === "medium" || presetWord === "strong") {
    preset = presetWord;
    cursor += 1;
  }
  if (head[cursor] !== undefined) {
    color = readColor(head[cursor]!);
    if (color === null) return { statement: null, diagnostics: [colorDiagnostic(head[cursor]!)] };
    cursor += 1;
  }
  if (cursor !== head.length) return fail(`invalid shadow ${JSON.stringify(describeTokens(head))}`, tokens, SHADOW_HINT);

  // that is 24px blurred and 8px down [and 4px right]
  let blur: LengthValue | null = null;
  let x: LengthValue | null = null;
  let y: LengthValue | null = null;
  const tail = tokens.slice(index + 1);
  if (tail.length > 0) {
    if (!words(tail, "that", "is") || preset !== null) {
      return fail("a custom shadow is has a <color> shadow that is <blur> blurred [and <distance> down]", tokens, SHADOW_HINT);
    }
    const parts = tail.slice(2);
    for (let i = 0; i < parts.length; i += 3) {
      if (i > 0 && !isKeyword(parts[i - 1], "and")) return fail("separate shadow parts with and", tail, SHADOW_HINT);
      const amount = readLength(parts[i] as Token);
      const word = text(parts[i + 1]);
      if (amount === null) return fail("each shadow part starts with a length", tail, SHADOW_HINT);
      if (word === "blurred" && blur === null) blur = amount;
      else if ((word === "down" || word === "up") && y === null) y = word === "up" ? { ...amount, value: -amount.value } : amount;
      else if ((word === "right" || word === "left") && x === null) x = word === "left" ? { ...amount, value: -amount.value } : amount;
      else return fail(`invalid shadow part ${JSON.stringify(word)}`, tail, SHADOW_HINT);
      if (i + 2 < parts.length && !isKeyword(parts[i + 2], "and")) return fail("separate shadow parts with and", tail, SHADOW_HINT);
    }
    if (blur === null) return fail("a custom shadow says how blurred it is", tail, SHADOW_HINT);
    if (color === null) return fail("a custom shadow needs a color", tokens, SHADOW_HINT);
  }
  if (!inner && preset === null && color === null) return fail("expected a shadow preset or color", tokens, SHADOW_HINT);
  return ok({ type: "custom-shadow", inner, preset, color, blur, x, y, span: spanFromTokens(tokens) });
}

/** `it is blurred|rotated|moved|scaled ...` (0.3). `matchSizeState` steps aside. */
export function isF3State(tokens: readonly Token[]): boolean {
  if (!isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "is")) return false;
  const word = text(tokens[2]);
  return word === "blurred" || word === "rotated" || word === "moved" || word === "scaled";
}

export function matchF3ItIs(tokens: readonly Token[]): Body {
  if (!isF3State(tokens)) return null;
  const span = spanFromTokens(tokens);
  const word = text(tokens[2]);
  if (word === "blurred") {
    const amount = readLength(tokens[4] as Token);
    if (tokens.length !== 5 || !isKeyword(tokens[3], "by") || amount === null) {
      return fail("a blur is it is blurred by <length>", tokens, "for example: it is blurred by 4px");
    }
    return ok({ type: "filter", mode: "blur", amount, span });
  }
  if (word === "rotated") {
    const degrees = readAngle(tokens[4]);
    if (tokens.length !== 5 || !isKeyword(tokens[3], "by") || degrees === null || degrees > 360) {
      return fail("a rotation is it is rotated by <0deg to 360deg>", tokens, "for example: it is rotated by 10deg");
    }
    return ok({ type: "rotate", degrees, span });
  }
  if (word === "scaled") {
    const value = tokens[4];
    if (tokens.length !== 5 || !isKeyword(tokens[3], "to") || !isPercentage(value) || value.value <= 0 || value.value > 500) {
      return fail("a scale is it is scaled to <1% to 500%>", tokens, "for example: it is scaled to 110%");
    }
    return ok({ type: "scale", percentage: value.value, span });
  }
  // it is moved 8px down [and 4px right]
  let x: LengthValue | null = null;
  let y: LengthValue | null = null;
  const parts = tokens.slice(3);
  const hint = "for example: it is moved 8px down, or it is moved 4px left and 2px up";
  if (parts.length !== 2 && parts.length !== 5) return fail("a move is it is moved <length> <direction>", tokens, hint);
  for (let i = 0; i < parts.length; i += 3) {
    if (i > 0 && !isKeyword(parts[i - 1], "and")) return fail("separate the two moves with and", tokens, hint);
    const amount = readLength(parts[i] as Token);
    const direction = text(parts[i + 1]);
    if (amount === null) return fail("a move starts with a length", tokens, hint);
    if ((direction === "down" || direction === "up") && y === null) y = direction === "up" ? { ...amount, value: -amount.value } : amount;
    else if ((direction === "right" || direction === "left") && x === null) x = direction === "left" ? { ...amount, value: -amount.value } : amount;
    else return fail(`invalid direction ${JSON.stringify(direction)}`, tokens, hint);
  }
  return ok({ type: "move", x, y, span });
}

// it blurs the background behind it by 12px
export function matchBackdropBlur(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "blurs")) return null;
  const amount = readLength(tokens[7] as Token);
  if (tokens.length !== 8 || !words(tokens.slice(2), "the", "background", "behind", "it", "by") || amount === null) {
    return fail("a backdrop blur is it blurs the background behind it by <length>", tokens, "for example: it blurs the background behind it by 12px");
  }
  return ok({ type: "filter", mode: "backdrop-blur", amount, span: spanFromTokens(tokens) });
}

// ---------------------------------------------------------------------------
// States and motion

const STATES: Readonly<Record<string, InteractionState>> = {
  focused: "focused",
  pressed: "pressed",
  disabled: "disabled",
  checked: "checked",
  invalid: "invalid",
};

/**
 * `when focused|pressed|disabled|checked|invalid, <effect>` and
 * `when hovered, it rotates by 10deg`, with the hover effect grammar.
 */
export function matchState(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "when")) return null;
  // D-50: hover effects and cursor effects have their own sentences.
  if (isHoverEffect(tokens) || tokens[1]?.text.toLowerCase() === "the") return null;
  const word = text(tokens[1]);
  const hoverRotate = word === "hovered" && isKeyword(tokens[3], "it") && (text(tokens[4]) === "rotates" || text(tokens[4]) === "tilts" || (text(tokens[4]) === "is" && text(tokens[5]) === "in"));
  const state = hoverRotate ? "hovered" : STATES[word];
  if (state === undefined) return null;
  const span = spanFromTokens(tokens);
  if (tokens[2]?.kind !== "comma") {
    return {
      statement: null,
      diagnostics: [{
        code: "KDM2010",
        message: `a comma is required after when ${word}`,
        span: tokens[2]?.span ?? span,
        hint: `write: when ${word}, the border turns blue`,
      }],
    };
  }
  const rest = tokens.slice(3);
  const diagnostics: DiagnosticSpec[] = [];
  let effect: StateEffect;
  let length: number;
  // F8: when hovered, it tilts by 8deg
  if (isKeyword(rest[0], "it") && text(rest[1]) === "tilts") {
    const degrees = readAngle(rest[3]);
    if (rest.length !== 4 || !isKeyword(rest[2], "by") || degrees === null || degrees > 45) {
      return fail("a tilt is it tilts by <1deg to 45deg>", tokens, `for example: when ${word}, it tilts by 8deg`);
    }
    return ok({ type: "state", state, effect: { type: "tilt", degrees }, span });
  }
  // F8: when hovered, it is in color
  if (isKeyword(rest[0], "it") && isKeyword(rest[1], "is") && text(rest[2]) === "in" && text(rest[3]) === "color") {
    if (rest.length !== 4) return fail("write: when hovered, it is in color", tokens, "for example: when hovered, it is in color");
    return ok({ type: "state", state, effect: { type: "in-color" }, span });
  }
  if (isKeyword(rest[0], "it") && text(rest[1]) === "rotates") {
    const degrees = readAngle(rest[3]);
    if (!isKeyword(rest[2], "by") || degrees === null || degrees > 360) {
      return fail("a rotation is it rotates by <0deg to 360deg>", tokens, `for example: when ${word}, it rotates by 10deg`);
    }
    effect = { type: "rotate", degrees };
    length = 4;
  } else {
    const parsed = parseHoverEffect(rest, span, diagnostics, MIN_SCALE_03);
    if (parsed === null) return { statement: null, diagnostics };
    effect = parsed.effect;
    length = parsed.length;
  }
  const duration: DurationValue | undefined = parseOptionalDuration(rest, length, diagnostics);
  if (diagnostics.length > 0) return { statement: null, diagnostics };
  return ok({ type: "state", state, effect, ...(duration === undefined ? {} : { duration }), span });
}

function readEntrance(tokens: readonly Token[]): {
  effect: "fade" | "slide";
  direction?: "left" | "right" | "top" | "bottom";
  length: number;
} | null {
  // fade(s) in | slide(s) in from the <side>
  const verb = text(tokens[0]);
  if ((verb === "fades" || verb === "fade") && isKeyword(tokens[1], "in")) return { effect: "fade", length: 2 };
  if ((verb === "slides" || verb === "slide") && isKeyword(tokens[1], "in") && words(tokens.slice(2), "from", "the")) {
    const side = text(tokens[4]);
    if (side === "left" || side === "right" || side === "top" || side === "bottom") {
      return { effect: "slide", direction: side, length: 5 };
    }
  }
  return null;
}

// it fades in when it scrolls into view | it slides in from the left when it scrolls into view
export function matchScrollEntrance(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !endsWithScrollIntoView(tokens)) return null;
  const entrance = readEntrance(tokens.slice(1));
  if (entrance === null || 1 + entrance.length !== tokens.length - 5) {
    return fail("a scroll entrance is it fades in, or it slides in from the <side>, when it scrolls into view", tokens,
      "for example: it fades in when it scrolls into view");
  }
  return ok({
    type: "scroll-entrance",
    effect: entrance.effect,
    ...(entrance.direction === undefined ? {} : { direction: entrance.direction }),
    span: spanFromTokens(tokens),
  });
}

const LOOPS: Readonly<Record<string, "spin" | "pulse" | "bounce" | "float" | "zoom">> = {
  spins: "spin",
  pulses: "pulse",
  bounces: "bounce",
  floats: "float",
  // F8: a slow pan and zoom (Ken Burns), for images and hero backgrounds.
  zooms: "zoom",
};

// it spins [forever] [every 2s]
export function matchLoop(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it")) return null;
  const effect = LOOPS[text(tokens[1])];
  if (effect === undefined) return null;
  const hint = "for example: it spins forever, or it pulses every 2s";
  let index = 2;
  if (effect === "zoom" && isAnyWord(tokens[index], "slowly")) index += 1;
  if (isAnyWord(tokens[index], "forever")) index += 1;
  let duration: DurationValue | null = null;
  if (isAnyWord(tokens[index], "every")) {
    duration = readDuration(tokens[index + 1] as Token);
    if (duration === null || duration.value <= 0) return fail("expected a duration after every", tokens, hint);
    index += 2;
  }
  if (index !== tokens.length) return fail(`invalid loop ${JSON.stringify(describeTokens(tokens.slice(1)))}`, tokens, hint);
  return ok({ type: "loop", effect, duration, span: spanFromTokens(tokens) });
}

// its children fade in one after another | its children slide in from the bottom one after another
export function matchStagger(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "its") || !isKeyword(tokens[1], "children")) return null;
  if (!words(tokens.slice(-3), "one", "after", "another")) return null;
  const entrance = readEntrance(tokens.slice(2));
  if (entrance === null || 2 + entrance.length !== tokens.length - 3) {
    return fail("a stagger is its children fade in, or slide in from the <side>, one after another", tokens,
      "for example: its children fade in one after another");
  }
  return ok({
    type: "stagger",
    effect: entrance.effect,
    ...(entrance.direction === undefined ? {} : { direction: entrance.direction }),
    span: spanFromTokens(tokens),
  });
}

// ---------------------------------------------------------------------------
// Theme colors and dark mode (D-38)

const TOKEN_NAME = /^[a-z][a-z0-9]{0,31}$/;

/** `the <name> color is ...`: a theme color declaration. */
export function isColorTokenDeclaration(tokens: readonly Token[]): boolean {
  return (
    isKeyword(tokens[0], "the") &&
    (tokens[1]?.kind === "identifier" || tokens[1]?.kind === "word") &&
    isAnyWord(tokens[2], "color") &&
    isKeyword(tokens[3], "is")
  );
}

// the brand color is #FF0066
export function matchColorToken(tokens: readonly Token[]): Body {
  if (!isColorTokenDeclaration(tokens)) return null;
  const nameToken = tokens[1]!;
  const name = nameToken.text;
  const hint = "for example: the brand color is #FF0066";
  if (!TOKEN_NAME.test(name)) {
    return fail(`invalid color name ${JSON.stringify(name)}; use one lower-case word`, [nameToken], hint);
  }
  const value = tokens[4];
  if (tokens.length !== 5 || value === undefined) return fail("a theme color is the <name> color is <color>", tokens, hint);
  const color = readColor(value);
  if (color === null || color.kind === "token") {
    return { statement: null, diagnostics: [colorDiagnostic(value)] };
  }
  return {
    statement: {
      type: "page-setting",
      property: "color token",
      name,
      nameSpan: nameToken.span,
      value: color,
      span: spanFromTokens(tokens),
    },
    diagnostics: [],
  };
}

// the page is dark when the system is dark
export function matchAutoDark(tokens: readonly Token[]): Body {
  if (!words(tokens, "the", "page", "is", "dark")) return null;
  if (tokens.length !== 9 || !words(tokens.slice(4), "when", "the", "system", "is", "dark")) {
    return fail("write: the page is dark when the system is dark", tokens, "the page follows the system color scheme");
  }
  return { statement: { type: "page-setting", property: "auto dark", span: spanFromTokens(tokens) }, diagnostics: [] };
}

/** `in dark mode, ...` */
export function isDarkModeLine(tokens: readonly Token[]): boolean {
  return isKeyword(tokens[0], "in") && isAnyWord(tokens[1], "dark") && isAnyWord(tokens[2], "mode");
}
