import type { ClickStatement, Effect, ElementReference, F4Statement, StateLiteral, StateReference, StateType } from "../ast/nodes.js";
import type { Token } from "../lexer/token.js";
import type { StatementMatchBody } from "./statement-types.js";
import { isAnyWord, isKeyword, isString, spanFromTokens } from "./values.js";

/**
 * kadam 0.3 (F4 step 1): interactions plain HTML can do without JavaScript.
 * Every template that uses these matchers declares `since: "0.3"`.
 */

type Body = StatementMatchBody | null;

function fail(message: string, tokens: readonly Token[], hint: string): StatementMatchBody {
  return { statement: null, diagnostics: [{ code: "KDM3005", message, span: spanFromTokens(tokens), hint }] };
}

function ok(statement: F4Statement | ClickStatement): StatementMatchBody {
  return { statement, diagnostics: [] };
}

/** The click actions added in 0.3. `matchClick` (0.1) steps aside for them. */
export function isF4ClickAction(rest: readonly Token[]): boolean {
  if (isKeyword(rest[0], "go") && isKeyword(rest[1], "to") && isString(rest[2])) return true;
  const verb = rest[0]?.text.toLowerCase();
  return verb === "send" || verb === "call" || verb === "download";
}

const EMAIL = /^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/;
const PHONE = /^\+?[0-9][0-9 ().-]{2,30}$/;
const NAME = /^[a-z][A-Za-z0-9]{0,63}$/;

/**
 * when clicked, go to "features"            (an element on this page)
 * when clicked, send an email to "hi@acme.com"
 * when clicked, call "+1 555 0100"
 * when clicked, download "assets/guide.pdf"
 */
export function matchF4Click(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "when") || !isKeyword(tokens[1], "clicked") || tokens[2]?.kind !== "comma") return null;
  const rest = tokens.slice(3);
  if (!isF4ClickAction(rest)) return null;
  const span = spanFromTokens(tokens);
  const verb = rest[0]!.text.toLowerCase();

  if (verb === "go") {
    const target = rest[2] as Token & { value: string };
    if (rest.length !== 3 || !NAME.test(target.value)) {
      return fail("an in-page link names one element on this page", tokens, 'for example: when clicked, go to "features"');
    }
    return ok({ type: "click", action: { type: "anchor", elementName: target.value, elementSpan: target.span }, span });
  }
  if (verb === "send") {
    const address = rest[4];
    const hint = 'for example: when clicked, send an email to "hello@acme.com"';
    if (rest.length !== 5 || !isAnyWord(rest[1], "an") || !isAnyWord(rest[2], "email") || !isKeyword(rest[3], "to") || !isString(address)) {
      return fail('an email link is send an email to "address"', tokens, hint);
    }
    if (!EMAIL.test(address.value)) return fail("expected an email address such as hello@acme.com", [address], hint);
    return ok({ type: "click", action: { type: "email", address: address.value, valueSpan: address.span }, span });
  }
  const value = rest[1];
  if (verb === "call") {
    if (rest.length !== 2 || !isString(value) || !PHONE.test(value.value)) {
      return fail("a phone link is call \"number\"", tokens, 'for example: when clicked, call "+1 555 0100"');
    }
    return ok({ type: "click", action: { type: "phone", number: value.value, valueSpan: value.span }, span });
  }
  if (rest.length !== 2 || !isString(value) || value.value.trim() === "") {
    return fail("a download link is download \"path\"", tokens, 'for example: when clicked, download "assets/guide.pdf"');
  }
  return ok({ type: "click", action: { type: "download", path: value.value, valueSpan: value.span }, span });
}

function stringSentence(
  tokens: readonly Token[],
  words: readonly string[],
  type: "summary" | "field-error",
  example: string,
): Body {
  if (!words.every((word, index) => isAnyWord(tokens[index], word))) return null;
  const value = tokens[words.length];
  if (tokens.length !== words.length + 1 || !isString(value) || value.value.trim() === "") {
    return fail(`${words.join(" ")} requires one quoted, non-empty string`, tokens, `for example: ${example}`);
  }
  return ok({ type, value: value.value, valueSpan: value.span, span: spanFromTokens(tokens) });
}

// the title says "What is Kadam?"   (an expandable section's summary)
export const matchSummary = (tokens: readonly Token[]): Body =>
  stringSentence(tokens, ["the", "title", "says"], "summary", 'the title says "What is Kadam?"');

// the error says "Enter a valid email address"
export const matchFieldError = (tokens: readonly Token[]): Body =>
  stringSentence(tokens, ["the", "error", "says"], "field-error", 'the error says "Enter a valid email address"');

// it starts open
export function matchStartsOpen(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "starts") || isAnyWord(tokens[2], "hidden")) return null;
  if (tokens.length !== 3 || !isAnyWord(tokens[2], "open")) return fail("write: it starts open", tokens, "an expandable section starts closed unless it starts open");
  return ok({ type: "starts-open", span: spanFromTokens(tokens) });
}

// ---------------------------------------------------------------------------
// Step 2 (D-36): state, events, effects, and bindings.


const STATE_NAME = /^[a-z][A-Za-z0-9]{0,63}$/;
const ELEMENT_NAME = /^[a-z][A-Za-z0-9]{0,63}$/;

function isWordToken(token: Token | undefined): boolean {
  return token !== undefined && (token.kind === "identifier" || token.kind === "word" || token.kind === "keyword");
}

/** true | false | a number | "text" */
export function readStateLiteral(tokens: readonly Token[]): StateLiteral | null {
  if (tokens.length === 1) {
    const token = tokens[0]!;
    const word = token.text.toLowerCase();
    if (word === "true" || word === "false") return { kind: "boolean", value: word === "true", span: token.span };
    if (token.kind === "number" && typeof token.value === "number") return { kind: "number", value: token.value, span: token.span };
    if (token.kind === "length" && token.value === 0 && token.text === "0") return { kind: "number", value: 0, span: token.span };
    if (isString(token)) return { kind: "text", value: token.value, span: token.span };
  }
  return null;
}

/** `count` or `count of cart1`. */
function readStateReference(tokens: readonly Token[]): StateReference | null {
  const name = tokens[0];
  if (name === undefined || !isWordToken(name) || !STATE_NAME.test(name.text)) return null;
  if (tokens.length === 1) return { name: name.text, owner: null, span: name.span };
  if (tokens.length === 3 && isAnyWord(tokens[1], "of") && isWordToken(tokens[2]) && ELEMENT_NAME.test(tokens[2]!.text)) {
    return { name: name.text, owner: tokens[2]!.text, span: spanFromTokens(tokens) };
  }
  return null;
}

/** A quoted element name, or `it`. */
function readTarget(tokens: readonly Token[]): ElementReference | null {
  if (tokens.length !== 1) return null;
  const token = tokens[0]!;
  if (isKeyword(token, "it")) return { name: null, span: token.span };
  if (isString(token) && ELEMENT_NAME.test(token.value)) return { name: token.value, span: token.span };
  return null;
}

/** Split `a and b and c` at top-level `and` words. */
function splitAnd(tokens: readonly Token[]): Token[][] {
  const parts: Token[][] = [[]];
  for (const token of tokens) {
    if (isKeyword(token, "and")) parts.push([]);
    else parts.at(-1)!.push(token);
  }
  return parts;
}

const EFFECT_VERBS: ReadonlySet<string> = new Set(["show", "hide", "flip", "open", "close", "focus", "set", "add", "subtract", "reload"]);

/** The click effects added in step 2. `matchClick` (0.1) steps aside for them. */
export function isEffectList(rest: readonly Token[]): boolean {
  const verb = rest[0]?.text.toLowerCase() ?? "";
  if (verb === "open") return isAnyWord(rest[1], "dialog");
  return EFFECT_VERBS.has(verb) || (isKeyword(rest[0], "it") && isKeyword(rest[1], "is"));
}

const EFFECT_HINT =
  'use show "name", hide "name", flip "name", open dialog "name", close the dialog, focus "name", set count of cart1 to 0, flip isOpen of menu1, add 1 to count of cart1, or it is hidden';

function readEffect(tokens: readonly Token[]): Effect | string {
  const verb = tokens[0]?.text.toLowerCase() ?? "";
  const rest = tokens.slice(1);
  if (isKeyword(tokens[0], "it") && isKeyword(tokens[1], "is") && tokens.length === 3) {
    const word = tokens[2]!.text.toLowerCase();
    if (word === "hidden" || word === "shown") {
      return { type: "visibility", mode: word === "hidden" ? "hide" : "show", target: { name: null, span: tokens[0]!.span } };
    }
  }
  if (verb === "show" || verb === "hide") {
    const target = readTarget(rest);
    if (target !== null) return { type: "visibility", mode: verb, target };
    return `${verb} names one element in quotes`;
  }
  if (verb === "flip") {
    const target = readTarget(rest);
    if (target !== null) return { type: "visibility", mode: "flip", target };
    const state = readStateReference(rest);
    if (state !== null) return { type: "flip-state", state };
    return "flip names an element in quotes or a true-or-false state";
  }
  if (verb === "open" && isAnyWord(tokens[1], "dialog")) {
    const target = readTarget(tokens.slice(2));
    if (target !== null && target.name !== null) return { type: "open-dialog", target };
    return 'open dialog names one dialog in quotes';
  }
  if (verb === "close") {
    if (tokens.length === 3 && isKeyword(tokens[1], "the") && isAnyWord(tokens[2], "dialog")) {
      return { type: "close-dialog", span: spanFromTokens(tokens) };
    }
    return "write: close the dialog";
  }
  if (verb === "reload") {
    const name = tokens[1];
    if (tokens.length === 2 && name !== undefined && isWordToken(name) && STATE_NAME.test(name.text)) {
      return { type: "reload", source: name.text, span: spanFromTokens(tokens) };
    }
    return "reload names the data an element loads, e.g. reload products";
  }
  if (verb === "focus") {
    const target = readTarget(rest);
    if (target !== null && target.name !== null) return { type: "focus", target };
    return "focus names one element in quotes";
  }
  if (verb === "set") {
    const to = rest.findIndex((token) => isKeyword(token, "to"));
    const state = to === -1 ? null : readStateReference(rest.slice(0, to));
    const value = to === -1 ? null : readStateLiteral(rest.slice(to + 1));
    if (state !== null && value !== null) return { type: "set-state", state, value };
    return "set is set <state> [of <element>] to <value>";
  }
  if (verb === "add" || verb === "subtract") {
    const amount = rest[0];
    const joiner = verb === "add" ? "to" : "from";
    const state = readStateReference(rest.slice(2));
    if (amount?.kind === "number" && typeof amount.value === "number" && isKeyword(rest[1], joiner) || (amount?.kind === "number" && isAnyWord(rest[1], joiner))) {
      if (state !== null) {
        const value = amount.value as number;
        return { type: "add-state", state, amount: verb === "add" ? value : -value, amountSpan: amount.span };
      }
    }
    return `${verb} is ${verb} <number> ${joiner} <state> [of <element>]`;
  }
  return EFFECT_HINT;
}

function readEffects(tokens: readonly Token[]): Effect[] | string {
  const effects: Effect[] = [];
  for (const part of splitAnd(tokens)) {
    if (part.length === 0) return "expected an effect";
    const effect = readEffect(part);
    if (typeof effect === "string") return effect;
    effects.push(effect);
  }
  return effects;
}

// when clicked, show "menu1" and hide "promo1"
export function matchClickEffects(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "when") || !isKeyword(tokens[1], "clicked") || tokens[2]?.kind !== "comma") return null;
  const rest = tokens.slice(3);
  if (!isEffectList(rest)) return null;
  const effects = readEffects(rest);
  if (typeof effects === "string") return fail(effects, rest, EFFECT_HINT);
  return ok({ type: "event", trigger: "click", effects, span: spanFromTokens(tokens) });
}

// when the Escape key is pressed, hide "menu1"
export function matchKeyEvent(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "when") || !isKeyword(tokens[1], "the") || !isAnyWord(tokens[3], "key")) return null;
  const key = tokens[2]?.text;
  const hint = 'for example: when the Escape key is pressed, hide "menu1"';
  if (key !== "Escape" && key !== "Enter") return fail("the key is Escape or Enter", tokens, hint);
  if (!isAnyWord(tokens[4], "is") || !isAnyWord(tokens[5], "pressed") || tokens[6]?.kind !== "comma") {
    return fail(`write: when the ${key} key is pressed, <effect>`, tokens, hint);
  }
  const effects = readEffects(tokens.slice(7));
  if (typeof effects === "string") return fail(effects, tokens.slice(7), EFFECT_HINT);
  return ok({ type: "event", trigger: "key", key, effects, span: spanFromTokens(tokens) });
}

const TYPES: Readonly<Record<string, StateType>> = { boolean: "boolean", number: "number", text: "text" };

// it remembers isOpen, a boolean that starts as false
export function matchRemember(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "remembers")) return null;
  const hint = "for example: it remembers isOpen, a boolean that starts as false";
  const name = tokens[2];
  const valueType = TYPES[tokens[5]?.text.toLowerCase() ?? ""];
  if (
    name === undefined || !isWordToken(name) || !STATE_NAME.test(name.text) || tokens[3]?.kind !== "comma" ||
    !isKeyword(tokens[4], "a") || valueType === undefined ||
    !isAnyWord(tokens[6], "that") || !isAnyWord(tokens[7], "starts") || !isAnyWord(tokens[8], "as")
  ) {
    return fail("state is it remembers <name>, a boolean|number|text that starts as <value>", tokens, hint);
  }
  const initial = readStateLiteral(tokens.slice(9));
  if (initial === null) return fail("a state starts as true, false, a number, or quoted text", tokens.slice(9), hint);
  if (initial.kind !== valueType) {
    return fail(`${name.text} is a ${valueType}, so it cannot start as ${describeLiteral(initial)}`, tokens.slice(9), hint);
  }
  return ok({ type: "remember", name: name.text, nameSpan: name.span, valueType, initial, span: spanFromTokens(tokens) });
}

export function describeLiteral(literal: StateLiteral): string {
  return literal.kind === "text" ? JSON.stringify(literal.value) : String(literal.value);
}

// it starts hidden
export function matchStartsHidden(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "starts") || !isKeyword(tokens[2], "hidden")) return null;
  if (tokens.length !== 3) return fail("write: it starts hidden", tokens, "an element shown later by an effect starts hidden");
  return ok({ type: "starts-hidden", span: spanFromTokens(tokens) });
}

// the text shows count of cart1
export function matchTextBinding(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "the") || !isKeyword(tokens[1], "text") || !isAnyWord(tokens[2], "shows")) return null;
  const state = readStateReference(tokens.slice(3));
  if (state === null) return fail("the text shows <state> [of <element>]", tokens, "for example: the text shows count of cart1");
  return ok({ type: "text-binding", state, span: spanFromTokens(tokens) });
}

/** `it is hidden unless ...`: `matchSizeState` (0.1) steps aside. */
export function isVisibilityBinding(tokens: readonly Token[]): boolean {
  return isKeyword(tokens[0], "it") && isKeyword(tokens[1], "is") && isKeyword(tokens[2], "hidden") && isAnyWord(tokens[3], "unless");
}

// it is hidden unless isOpen of menu1 is true
export function matchVisibilityBinding(tokens: readonly Token[]): Body {
  if (!isVisibilityBinding(tokens)) return null;
  const rest = tokens.slice(4);
  const is = rest.findIndex((token) => isKeyword(token, "is"));
  const state = is === -1 ? null : readStateReference(rest.slice(0, is));
  const value = is === -1 ? null : readStateLiteral(rest.slice(is + 1));
  if (state === null || value === null) {
    return fail("write: it is hidden unless <state> [of <element>] is <value>", tokens, "for example: it is hidden unless isOpen of menu1 is true");
  }
  return ok({ type: "visibility-binding", state, value, span: spanFromTokens(tokens) });
}
