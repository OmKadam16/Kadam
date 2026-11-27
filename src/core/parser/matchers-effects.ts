import type { ColorValue, F8Statement, StatementNode } from "../ast/nodes.js";
import type { Token } from "../lexer/token.js";
import type { StatementMatchBody } from "./statement-types.js";
import { isKeyword, isString, readColor, spanFromTokens } from "./values.js";

/**
 * D-50: creative effects, one sentence each. Every one turns off for people
 * who prefer reduced motion; cursor effects also stay off on touch screens.
 *
 *   when the cursor moves over it, white pixels pop out around the cursor
 *   when the cursor moves over it, grain surrounds the cursor within 10px
 *   when the cursor moves over it, a glow follows the cursor
 *   when the cursor moves over it, a spotlight follows the cursor
 *   when hovered, a white fill slides in from the left
 *   when hovered, a shine sweeps across it
 *   when hovered, its border draws itself
 *   it pulls toward the cursor          it ripples when pressed
 *   it tilts as you scroll              it moves slower than the page
 *   it appears as you scroll            its children appear one after another
 *   it types itself                     it appears word by word
 *   it scrambles into place             its text is a blue to purple gradient
 *   a highlight sweeps under "words"
 *   the page fades in when it opens     pages fade into each other when you move between them
 */

type Body = StatementMatchBody | null;

const words = (tokens: readonly Token[]): string => tokens.map((token) => token.text.toLowerCase()).join(" ");
/** The words outside quotes, so text that mentions an effect is never the effect. */
const unquoted = (tokens: readonly Token[]): string => tokens.filter((token) => token.kind !== "string").map((token) => token.text.toLowerCase()).join(" ");

function fail(message: string, tokens: readonly Token[], hint: string): StatementMatchBody {
  return { statement: null, diagnostics: [{ code: "KDM3005", message, span: spanFromTokens(tokens), hint }] };
}
function ok(statement: F8Statement | StatementNode): StatementMatchBody {
  return { statement: statement as StatementNode, diagnostics: [] };
}

/** `when hovered, ...` sentences that are effects, so the hover and state matchers step aside. */
export function isHoverEffect(tokens: readonly Token[]): boolean {
  if (!isKeyword(tokens[0], "when") || tokens[1]?.text.toLowerCase() !== "hovered") return false;
  const rest = words(tokens.slice(3));
  return / fill slides in from /.test(` ${rest}`) || rest === "a shine sweeps across it" || rest === "its border draws itself";
}

// when the cursor moves over it, ...   (or the effect on its own)
export function matchCursorEffect(tokens: readonly Token[]): Body {
  let body = tokens;
  if (words(tokens.slice(0, 7)) === "when the cursor moves over it ,") body = tokens.slice(7);
  else if (words(tokens.slice(0, 6)) === "when the cursor moves over it") return fail("a comma goes after when the cursor moves over it", tokens, "write: when the cursor moves over it, a glow follows the cursor");
  const text = words(body);
  const span = spanFromTokens(tokens);
  if (body === tokens && (!/ (follows|surrounds|around) the cursor/.test(` ${unquoted(tokens)}`) || tokens.some((token) => token.kind === "string"))) return null;
  // <color> pixels pop out around the cursor
  const pixels = /^(?:(.+) )?pixels (?:pop out|pop|fly out|appear)(?: around the cursor| of it| from the cursor| around it)?$/.exec(text);
  if (pixels !== null) {
    const color = pixels[1] === undefined ? null : colorOf(body[0]!);
    if (pixels[1] !== undefined && (color === null || pixels[1].includes(" "))) return fail("pixels take one color: white pixels pop out around the cursor", tokens, "for example: white pixels pop out around the cursor");
    return ok({ type: "cursor-effect", effect: "pixels", color, radius: null, span });
  }
  // grain surrounds the cursor within 10px
  const grain = /^(?:grain|a grainy texture|grainy texture|noise) surrounds the cursor(?: (?:within|with a radius of(?: around| about)?) (\d+)px)?$/.exec(text);
  if (grain !== null) {
    const radius = grain[1] === undefined ? 60 : Number(grain[1]);
    if (radius < 4 || radius > 400) return fail("the grain reaches 4px to 400px from the cursor", tokens, "for example: grain surrounds the cursor within 60px");
    return ok({ type: "cursor-effect", effect: "grain", color: null, radius, span });
  }
  // a [color] glow follows the cursor / a spotlight follows the cursor
  const follows = /^an? (?:(.+) )?(glow|spotlight) follows the cursor$/.exec(text);
  if (follows !== null) {
    const color = follows[1] === undefined ? null : colorOf(body[1]!);
    if (follows[1] !== undefined && (color === null || body.length !== 6)) return fail("a glow takes one color: a blue glow follows the cursor", tokens, "for example: a blue glow follows the cursor");
    return ok({ type: "cursor-effect", effect: follows[2] as "glow" | "spotlight", color, radius: null, span });
  }
  return fail("the cursor effects are: pixels pop out, grain surrounds, a glow follows, or a spotlight follows the cursor", tokens,
    "for example: when the cursor moves over it, white pixels pop out around the cursor");
}

// when hovered, a white fill slides in from the left | a shine sweeps across it | its border draws itself
export function matchHoverEffect(tokens: readonly Token[]): Body {
  if (!isHoverEffect(tokens)) return null;
  const rest = tokens.slice(3);
  const text = words(rest);
  const span = spanFromTokens(tokens);
  if (text === "a shine sweeps across it") return ok({ type: "button-effect", effect: "shine", color: null, side: null, span });
  if (text === "its border draws itself") return ok({ type: "button-effect", effect: "draw-border", color: null, side: null, span });
  const fill = /^an? (?:(.+) )?fill slides in from the (left|right|top|bottom)$/.exec(text);
  if (fill === null) return fail("write: when hovered, a white fill slides in from the left", tokens, "the side is left, right, top or bottom");
  const color = fill[1] === undefined ? null : colorOf(rest[1]!);
  if (fill[1] !== undefined && (color === null || rest.length !== 8)) return fail("a fill takes one color", tokens, "for example: when hovered, a white fill slides in from the left");
  return ok({ type: "button-effect", effect: "slide-fill", color, side: fill[2] as "left" | "right" | "top" | "bottom", span });
}

// it pulls toward the cursor | it ripples when pressed
export function matchPressEffect(tokens: readonly Token[]): Body {
  const text = words(tokens);
  const span = spanFromTokens(tokens);
  if (text === "it pulls toward the cursor" || text === "it pulls towards the cursor") return ok({ type: "button-effect", effect: "magnetic", color: null, side: null, span });
  if (text === "it ripples when pressed" || text === "it ripples when clicked") return ok({ type: "button-effect", effect: "ripple", color: null, side: null, span });
  return null;
}

// it tilts as you scroll | it moves slower than the page | it appears as you scroll | its children appear one after another
export function matchScrollMotion(tokens: readonly Token[]): Body {
  const text = words(tokens);
  const span = spanFromTokens(tokens);
  if (text === "it tilts as you scroll") return ok({ type: "scroll-effect", effect: "tilt", span });
  if (text === "it moves slower than the page") return ok({ type: "scroll-effect", effect: "parallax", span });
  if (text === "it appears as you scroll") return ok({ type: "scroll-entrance", effect: "fade", span } as StatementNode);
  return null;
}

// it types itself | it appears word by word | it scrambles into place | its text is a blue to purple gradient
export function matchTextEffect(tokens: readonly Token[]): Body {
  const text = words(tokens);
  const span = spanFromTokens(tokens);
  if (text === "it types itself") return ok({ type: "text-effect", effect: "type", colors: [], span });
  if (text === "it appears word by word") return ok({ type: "text-effect", effect: "words", colors: [], span });
  if (text === "it scrambles into place") return ok({ type: "text-effect", effect: "scramble", colors: [], span });
  const gradient = /^(?:its text|the text) is an? (.+) gradient$/.exec(text);
  if (gradient === null) return null;
  // its text is a blue to purple gradient: the colors are separated by "to" or "and".
  const colors: ColorValue[] = [];
  const parts = tokens.slice(tokens.findIndex((token) => token.text.toLowerCase() === "a" || token.text.toLowerCase() === "an") + 1, -1);
  let expectColor = true;
  for (const token of parts) {
    const value = token.text.toLowerCase();
    if (!expectColor && (value === "to" || value === "and" || value === ",")) {
      expectColor = true;
      continue;
    }
    const color = expectColor ? colorOf(token) : null;
    if (color === null) return fail("a text gradient is colors separated by to: its text is a blue to purple gradient", tokens, "for example: its text is a blue to purple gradient");
    colors.push(color);
    expectColor = false;
  }
  if (expectColor || colors.length < 2 || colors.length > 4) return fail("a text gradient takes 2 to 4 colors", tokens, "for example: its text is a blue to purple gradient");
  return ok({ type: "text-effect", effect: "gradient", colors, span });
}

// a highlight sweeps under "words"  |  a yellow highlight sweeps under "words"
export function matchHighlight(tokens: readonly Token[]): Body {
  const text = words(tokens);
  if (!/^an? (?:\S+ )?highlight sweeps under /.test(text)) return null;
  const target = tokens.at(-1);
  const named = tokens.length === 6;
  const color = named ? colorOf(tokens[1]!) : null;
  if (!isString(target) || target.value === "" || (named && color === null) || (tokens.length !== 5 && tokens.length !== 6)) {
    return fail('write: a highlight sweeps under "the words"', tokens, 'for example: a yellow highlight sweeps under "least spent"');
  }
  return ok({
    type: "text-span",
    target: target.value,
    targetSpan: target.span,
    effect: { type: "highlight", color: color ?? { type: "color", kind: "hex", value: "#FDE68A", raw: "#FDE68A" } },
    span: spanFromTokens(tokens),
  } as unknown as StatementNode);
}

// the page fades in when it opens | the page slides up when it opens | pages fade into each other when you move between them
export function matchPageMotion(tokens: readonly Token[]): Body {
  const text = words(tokens);
  const span = spanFromTokens(tokens);
  const setting = (property: "enter" | "transition", value: string): StatementMatchBody =>
    ok({ type: "page-setting", property, value, valueSpan: span, span } as unknown as StatementNode);
  if (text === "the page fades in when it opens") return setting("enter", "fade");
  if (text === "the page slides up when it opens") return setting("enter", "slide");
  if (text === "pages fade into each other when you move between them") return setting("transition", "cross-fade");
  return null;
}

function colorOf(token: Token): ColorValue | null {
  if (token.text.toLowerCase() === "white") return { type: "color", kind: "hex", value: "#FFFFFF", raw: "white" };
  return readColor(token);
}
