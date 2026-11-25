import type { F2Statement, LengthValue, SizeStatement } from "../ast/nodes.js";
import type { Token } from "../lexer/token.js";
import type { StatementMatchBody } from "./statement-types.js";
import {
  describeTokens,
  isAnyWord,
  isKeyword,
  isLength,
  isPercentage,
  readLength,
  spanFromTokens,
} from "./values.js";

/**
 * kadam 0.3 (F2) layout and sizing sentences. Every template that uses these
 * matchers declares `since: "0.3"`. Like F1, the new words are contextual
 * (`isAnyWord`), never reserved, so existing 0.1 element names stay valid.
 */

type Body = StatementMatchBody | null;

function fail(message: string, tokens: readonly Token[], hint: string): StatementMatchBody {
  return {
    statement: null,
    diagnostics: [{ code: "KDM3005", message, span: spanFromTokens(tokens), hint }],
  };
}

function ok(statement: F2Statement | SizeStatement): StatementMatchBody {
  return { statement, diagnostics: [] };
}

function words(tokens: readonly Token[], ...expected: string[]): boolean {
  return expected.length <= tokens.length && expected.every((word, index) => isAnyWord(tokens[index], word));
}

/** A length (any unit) or a percentage, as a LengthValue (`%` unit). */
function readSizeValue(token: Token | undefined): LengthValue | null {
  if (token === undefined) return null;
  if (isPercentage(token)) {
    return { type: "length", value: token.value, unit: "%", raw: token.text };
  }
  return readLength(token);
}

function positiveInteger(token: Token | undefined, max: number): number | null {
  if (token?.kind !== "number" || typeof token.value !== "number") return null;
  if (!Number.isInteger(token.value) || token.value < 1 || token.value > max) return null;
  return token.value;
}

// ---------------------------------------------------------------------------
// it is ... (sizes, limits, positions)

/**
 * The `it is <...>` sentences added in F2. `matchSizeState` (0.1) steps aside
 * for exactly these shapes so a line never matches two templates.
 */
export function isF2State(tokens: readonly Token[]): boolean {
  if (!isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "is")) return false;
  const third = tokens[2];
  if (isPercentage(third)) return true;
  if (isAnyWord(third, "pinned") || isAnyWord(third, "placed")) return true;
  if (isAnyWord(third, "as")) return true;
  if (tokens.length === 3 && isAnyWord(third, "centered")) return true;
  if (
    isAnyWord(third, "at") &&
    (isAnyWord(tokens[3], "least") || isAnyWord(tokens[3], "most")) &&
    !isAnyWord(tokens[tokens.length - 1], "characters")
  ) {
    return true;
  }
  return false;
}

const SIZE_HINT = "for example: it is 50% wide, it is at most 1200px wide, or it is at least 50vh tall";

// it is 50% wide | it is 50% tall | it is 50% by 300px
export function matchPercentSize(tokens: readonly Token[]): Body {
  if (!isF2State(tokens) || !isPercentage(tokens[2])) return null;
  const span = spanFromTokens(tokens);
  const first = readSizeValue(tokens[2])!;
  if (first.value <= 0 || first.value > 1000) {
    return fail("a percentage size must be greater than 0% and at most 1000%", [tokens[2]!], SIZE_HINT);
  }
  if (tokens.length === 4 && (isKeyword(tokens[3], "wide") || isKeyword(tokens[3], "tall"))) {
    const wide = isKeyword(tokens[3], "wide");
    return ok({
      type: "size",
      mode: wide ? "width" : "height",
      ...(wide ? { width: first } : { height: first }),
      span,
    });
  }
  if (tokens.length === 5 && isKeyword(tokens[3], "by")) {
    const height = readSizeValue(tokens[4]);
    if (height === null) return fail("expected a height after by", tokens.slice(4), SIZE_HINT);
    return ok({ type: "size", mode: "both", width: first, height, span });
  }
  return fail(`invalid size ${JSON.stringify(describeTokens(tokens.slice(2)))}`, tokens.slice(2), SIZE_HINT);
}

// it is at most 1200px wide | it is at least 50vh tall
export function matchSizeLimit(tokens: readonly Token[]): Body {
  if (!isF2State(tokens) || !isAnyWord(tokens[2], "at")) return null;
  const bound = isAnyWord(tokens[3], "least") ? "min" : "max";
  const value = readSizeValue(tokens[4]);
  const axis = tokens[5];
  if (
    tokens.length !== 6 ||
    value === null ||
    value.reference !== undefined ||
    (!isKeyword(axis, "wide") && !isKeyword(axis, "tall"))
  ) {
    return fail(
      `invalid size limit ${JSON.stringify(describeTokens(tokens.slice(2)))}`,
      tokens.slice(2),
      SIZE_HINT,
    );
  }
  return ok({
    type: "size-limit",
    bound,
    axis: isKeyword(axis, "wide") ? "width" : "height",
    value,
    span: spanFromTokens(tokens),
  });
}

type Vertical = "top" | "bottom" | null;
type Horizontal = "left" | "right" | null;

/** `top`, `bottom right`, `left`, ...: one or two edge words. */
function readEdges(tokens: readonly Token[]): { vertical: Vertical; horizontal: Horizontal } | null {
  const names = tokens.map((token) => token.text.toLowerCase());
  const verticalOf = (word: string | undefined): Vertical =>
    word === "top" || word === "bottom" ? word : null;
  const horizontalOf = (word: string | undefined): Horizontal =>
    word === "left" || word === "right" ? word : null;
  if (names.length === 1) {
    const vertical = verticalOf(names[0]);
    const horizontal = horizontalOf(names[0]);
    return vertical === null && horizontal === null ? null : { vertical, horizontal };
  }
  if (names.length === 2) {
    const vertical = verticalOf(names[0]);
    const horizontal = horizontalOf(names[1]);
    return vertical === null || horizontal === null ? null : { vertical, horizontal };
  }
  return null;
}

/** `to the <edges>` or `<length> from the <edges>`; returns the rest. */
function readPlacement(tokens: readonly Token[]): {
  offset: LengthValue | null;
  edges: { vertical: Vertical; horizontal: Horizontal } | null;
} | null {
  let offset: LengthValue | null = null;
  let rest: readonly Token[];
  if (words(tokens, "to", "the") || words(tokens, "at", "the")) {
    rest = tokens.slice(2);
  } else if (isLength(tokens[0]) && words(tokens.slice(1), "from", "the")) {
    offset = readLength(tokens[0]);
    rest = tokens.slice(3);
  } else {
    return null;
  }
  return { offset, edges: readEdges(rest) };
}

const PINNED_HINT = "for example: it is pinned to the bottom right, or it is pinned 24px from the top";
const PLACED_HINT =
  "for example: it is placed over its parent, or it is placed 16px from the top right of its parent";

// it is pinned to the bottom right | it is pinned 24px from the top
// it is placed over its parent | it is placed at the top right of its parent
export function matchPosition(tokens: readonly Token[]): Body {
  if (!isF2State(tokens)) return null;
  const pinned = isAnyWord(tokens[2], "pinned");
  if (!pinned && !isAnyWord(tokens[2], "placed")) return null;
  const span = spanFromTokens(tokens);
  let rest = tokens.slice(3);

  if (!pinned) {
    if (words(rest, "over", "its", "parent") && rest.length === 3) {
      return ok({ type: "position", mode: "placed", vertical: null, horizontal: null, offset: null, span });
    }
    if (!words(rest.slice(-3), "of", "its", "parent")) {
      return fail("a placed element names a spot in its parent", tokens, PLACED_HINT);
    }
    rest = rest.slice(0, -3);
  }

  const placement = readPlacement(rest);
  if (placement === null || placement.edges === null) {
    return fail(
      `invalid position ${JSON.stringify(describeTokens(tokens.slice(2)))}`,
      tokens.slice(2),
      pinned ? PINNED_HINT : PLACED_HINT,
    );
  }
  return ok({
    type: "position",
    mode: pinned ? "pinned" : "placed",
    vertical: placement.edges.vertical,
    horizontal: placement.edges.horizontal,
    offset: placement.offset,
    span,
  });
}

// it sticks to the top | it sticks 16px from the top
export function matchSticky(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "sticks")) return null;
  const placement = readPlacement(tokens.slice(2));
  const edges = placement?.edges;
  if (placement === null || edges == null || edges.horizontal !== null || edges.vertical === null) {
    return fail(
      "a sticky element sticks to the top or the bottom",
      tokens,
      "for example: it sticks to the top, or it sticks 16px from the top",
    );
  }
  return ok({ type: "sticky", edge: edges.vertical, offset: placement.offset, span: spanFromTokens(tokens) });
}

// ---------------------------------------------------------------------------
// shape and text

// it keeps a 16 by 9 shape | it keeps a square shape
// it is as wide as its content
export function matchContentWidth(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "is") || !isAnyWord(tokens[2], "as")) return null;
  const words = tokens.slice(3).map((token) => token.text.toLowerCase());
  if (words.join(" ") !== "wide as its content") {
    return fail("write: it is as wide as its content", tokens, "it is as wide as its content makes a box hug what is inside it");
  }
  return ok({ type: "content-width", span: spanFromTokens(tokens) });
}

// it is centered
export function matchSelfCenter(tokens: readonly Token[]): Body {
  if (tokens.length !== 3 || !isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "is") || !isAnyWord(tokens[2], "centered")) return null;
  return ok({ type: "self-center", span: spanFromTokens(tokens) });
}

export function matchAspectRatio(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "keeps")) return null;
  if (!isKeyword(tokens[2], "a")) return null;
  const span = spanFromTokens(tokens);
  const hint = "for example: it keeps a 16 by 9 shape, or it keeps a square shape";
  if (tokens.length === 5 && isAnyWord(tokens[3], "square") && isAnyWord(tokens[4], "shape")) {
    return ok({ type: "aspect-ratio", width: 1, height: 1, span });
  }
  const width = positiveInteger(tokens[3], 100);
  const height = positiveInteger(tokens[5], 100);
  if (tokens.length !== 7 || !isKeyword(tokens[4], "by") || !isAnyWord(tokens[6], "shape")) {
    return fail("expected a shape such as 16 by 9", tokens, hint);
  }
  if (width === null || height === null) {
    return fail("a shape uses whole numbers from 1 to 100", tokens.slice(3, 6), hint);
  }
  return ok({ type: "aspect-ratio", width, height, span });
}

/** `the text is between ...` and `the text size is between ...`. */
export function isFluidText(tokens: readonly Token[]): boolean {
  if (!isKeyword(tokens[0], "the") || !isKeyword(tokens[1], "text")) return false;
  const index = isAnyWord(tokens[2], "size") ? 3 : 2;
  return isKeyword(tokens[index], "is") && isAnyWord(tokens[index + 1], "between");
}

/** Pixels per rem for the fluid formula; matches the browser default. */
export const ROOT_FONT_PX = 16;

// the text is between 1rem and 2.5rem
export function matchFluidText(tokens: readonly Token[]): Body {
  if (!isFluidText(tokens)) return null;
  const start = isAnyWord(tokens[2], "size") ? 5 : 4;
  const rest = tokens.slice(start);
  const hint = "for example: the text is between 1rem and 2.5rem";
  const min = readLength(rest[0] as Token);
  const max = rest[2] === undefined ? null : readLength(rest[2]);
  if (rest.length !== 3 || !isKeyword(rest[1], "and") || min === null || max === null) {
    return fail("fluid text needs two sizes: between <smallest> and <largest>", tokens, hint);
  }
  const px = (length: LengthValue): number | null =>
    length.unit === "px" ? length.value : length.unit === "rem" ? length.value * ROOT_FONT_PX : null;
  const minPx = px(min);
  const maxPx = px(max);
  if (minPx === null || maxPx === null) {
    return fail("fluid text sizes use px or rem", [rest[0]!, rest[1]!, rest[2]!], hint);
  }
  if (minPx <= 0 || minPx >= maxPx) {
    return fail("the first size must be smaller than the second and greater than 0", rest, hint);
  }
  return ok({ type: "fluid-text", min, max, span: spanFromTokens(tokens) });
}

// ---------------------------------------------------------------------------
// flex and grid

// it wraps its children | it spreads its children apart | it spaces its children evenly
export function matchFlexRule(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it")) return null;
  const span = spanFromTokens(tokens);
  if (tokens.length === 4 && words(tokens.slice(1), "wraps", "its", "children")) {
    return ok({ type: "flex-rule", rule: "wrap", span });
  }
  if (tokens.length === 5 && words(tokens.slice(1), "spreads", "its", "children", "apart")) {
    return ok({ type: "flex-rule", rule: "spread", span });
  }
  if (tokens.length === 5 && words(tokens.slice(1), "spaces", "its", "children", "evenly")) {
    return ok({ type: "flex-rule", rule: "even", span });
  }
  return null;
}

// it grows to fill the space | it does not shrink | it sits at the end
export function matchChildRule(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it")) return null;
  const span = spanFromTokens(tokens);
  if (words(tokens.slice(1), "grows")) {
    if (tokens.length === 6 && words(tokens.slice(2), "to", "fill", "the", "space")) {
      return ok({ type: "child-rule", rule: "grow", span });
    }
    return fail("expected it grows to fill the space", tokens, "write: it grows to fill the space");
  }
  if (tokens.length === 4 && words(tokens.slice(1), "does", "not", "shrink")) {
    return ok({ type: "child-rule", rule: "no-shrink", span });
  }
  if (words(tokens.slice(1), "sits")) {
    if (tokens.length === 5 && words(tokens.slice(2), "at", "the", "end")) {
      return ok({ type: "child-rule", rule: "end", span });
    }
    return fail("expected it sits at the end", tokens, "write: it sits at the end");
  }
  return null;
}

const GRID_HINT =
  "for example: it arranges its children in 3 columns, or in columns at least 240px wide";

/** `it arranges its children in <n> columns | in columns at least ...`. */
export function isGridLayout(tokens: readonly Token[]): boolean {
  return (
    isKeyword(tokens[0], "it") &&
    isKeyword(tokens[1], "arranges") &&
    isKeyword(tokens[2], "its") &&
    isKeyword(tokens[3], "children") &&
    isKeyword(tokens[4], "in") &&
    !isKeyword(tokens[5], "a") &&
    (tokens[5]?.kind === "number" || isAnyWord(tokens[5], "columns"))
  );
}

export function matchGrid(tokens: readonly Token[]): Body {
  if (!isGridLayout(tokens)) return null;
  const span = spanFromTokens(tokens);
  if (tokens[5]?.kind === "number") {
    const count = positiveInteger(tokens[5], 12);
    const noun = tokens[6];
    const nounOk = count === 1 ? isAnyWord(noun, "column") : isAnyWord(noun, "columns");
    if (tokens.length !== 7 || count === null || !nounOk) {
      return fail("a grid has 1 column or 2 to 12 columns", tokens.slice(5), GRID_HINT);
    }
    return ok({ type: "grid", columns: count, minWidth: null, span });
  }
  // in columns at least 240px wide
  const minWidth = readLength(tokens[8] as Token);
  if (
    tokens.length !== 10 ||
    !words(tokens.slice(6), "at", "least") ||
    minWidth === null ||
    !isKeyword(tokens[9], "wide")
  ) {
    return fail("expected in columns at least <width> wide", tokens.slice(5), GRID_HINT);
  }
  if (minWidth.value <= 0) return fail("a column width must be greater than 0", [tokens[8]!], GRID_HINT);
  return ok({ type: "grid", columns: null, minWidth, span });
}

// it spans 2 columns | it spans all columns
export function matchColumnSpan(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "spans")) return null;
  const span = spanFromTokens(tokens);
  const hint = "for example: it spans 2 columns, or it spans all columns";
  if (tokens.length === 4 && isAnyWord(tokens[2], "all") && isAnyWord(tokens[3], "columns")) {
    return ok({ type: "column-span", columns: "all", span });
  }
  const count = positiveInteger(tokens[2], 12);
  const nounOk = count === 1 ? isAnyWord(tokens[3], "column") : isAnyWord(tokens[3], "columns");
  if (tokens.length !== 4 || count === null || !nounOk) {
    return fail("a span is 1 to 12 columns, or all columns", tokens, hint);
  }
  return ok({ type: "column-span", columns: count, span });
}

// ---------------------------------------------------------------------------
// overflow and images

// it scrolls vertically | it scrolls horizontally | it hides overflow | it hides its overflow
export function matchOverflow(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it")) return null;
  const span = spanFromTokens(tokens);
  if (isAnyWord(tokens[1], "scrolls")) {
    if (tokens.length === 3 && (isAnyWord(tokens[2], "vertically") || isAnyWord(tokens[2], "horizontally"))) {
      return ok({ type: "overflow", mode: isAnyWord(tokens[2], "vertically") ? "scroll-y" : "scroll-x", span });
    }
    return fail("an element scrolls vertically or horizontally", tokens, "write: it scrolls vertically");
  }
  if (isAnyWord(tokens[1], "hides") && isAnyWord(tokens[tokens.length - 1], "overflow")) {
    if (tokens.length === 3 || (tokens.length === 4 && isKeyword(tokens[2], "its"))) {
      return ok({ type: "overflow", mode: "hidden", span });
    }
  }
  return null;
}

// it fills its box | it fits inside its box
export function matchImageFit(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it")) return null;
  const span = spanFromTokens(tokens);
  if (tokens.length === 4 && words(tokens.slice(1), "fills", "its", "box")) {
    return ok({ type: "image-fit", fit: "cover", span });
  }
  if (tokens.length === 5 && words(tokens.slice(1), "fits", "inside", "its", "box")) {
    return ok({ type: "image-fit", fit: "contain", span });
  }
  return null;
}

// it keeps the top right in view | it keeps the center in view
export function matchImageFocus(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "keeps") || !isKeyword(tokens[2], "the")) {
    return null;
  }
  if (!words(tokens.slice(-2), "in", "view")) return null;
  const span = spanFromTokens(tokens);
  const spot = tokens.slice(3, -2).map((token) => token.text.toLowerCase());
  const hint = "for example: it keeps the top in view, or it keeps the bottom right in view";
  if (spot.length === 1 && spot[0] === "center") {
    return ok({ type: "image-focus", vertical: "center", horizontal: "center", span });
  }
  const edges = readEdges(tokens.slice(3, -2));
  if (edges === null) return fail(`invalid focus point ${JSON.stringify(spot.join(" "))}`, tokens, hint);
  return ok({
    type: "image-focus",
    vertical: edges.vertical ?? "center",
    horizontal: edges.horizontal ?? "center",
    span,
  });
}

// it loads lazily | it loads right away
export function matchLoading(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "loads")) return null;
  const span = spanFromTokens(tokens);
  if (tokens.length === 3 && isAnyWord(tokens[2], "lazily")) return ok({ type: "loading", mode: "lazy", span });
  if (tokens.length === 4 && words(tokens.slice(2), "right", "away")) {
    return ok({ type: "loading", mode: "eager", span });
  }
  return fail("an image loads lazily or right away", tokens, "write: it loads lazily, or it loads right away");
}
