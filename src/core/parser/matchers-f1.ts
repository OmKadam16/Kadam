import type {
  F1Statement,
  FieldType,
  PageSettingNode,
  TextSpanEffect,
} from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Token } from "../lexer/token.js";
import type { StatementMatchBody } from "./statement-types.js";
import { isAbsoluteHttpUrl } from "./matchers-interaction.js";
import {
  describeTokens,
  isAnyWord,
  isKeyword,
  isString,
  normalizeWords,
  readColor,
  spanFromTokens,
} from "./values.js";

/**
 * kadam 0.3 (F1) sentences. Every template that uses these matchers declares
 * `since: "0.3"`; a 0.1 file gets KDM2013 for them, never a new meaning.
 * New words here are contextual (`isAnyWord`), not reserved: adding reserved
 * words would invalidate existing 0.1 element names such as `list1 {`.
 */

type Body = StatementMatchBody | null;

function fail(message: string, tokens: readonly Token[], hint: string): StatementMatchBody {
  return {
    statement: null,
    diagnostics: [{ code: "KDM3005", message, span: spanFromTokens(tokens), hint }],
  };
}

function ok(statement: F1Statement | PageSettingNode): StatementMatchBody {
  return { statement, diagnostics: [] };
}

function words(tokens: readonly Token[], ...expected: string[]): boolean {
  return expected.every((word, index) => isAnyWord(tokens[index], word));
}

/** `<prefix...> "value"`: exactly one string after a fixed word prefix. */
function stringAfter(
  tokens: readonly Token[],
  prefix: readonly string[],
  type: "caption" | "media-source" | "captions" | "poster",
  example: string,
): Body {
  if (!words(tokens, ...prefix)) return null;
  const value = tokens[prefix.length];
  if (tokens.length !== prefix.length + 1 || !isString(value)) {
    return fail(`${prefix.join(" ")} requires one quoted string`, tokens, `for example: ${example}`);
  }
  if (value.value.length === 0) {
    return fail(`${prefix.join(" ")} cannot be empty`, tokens, `for example: ${example}`);
  }
  return ok({ type, value: value.value, valueSpan: value.span, span: spanFromTokens(tokens) });
}

// the caption says "Plans"
export const matchCaption = (tokens: readonly Token[]): Body =>
  stringAfter(tokens, ["the", "caption", "says"], "caption", 'the caption says "Plans"');

// it plays "assets/intro.mp4"
export const matchMediaSource = (tokens: readonly Token[]): Body =>
  stringAfter(tokens, ["it", "plays"], "media-source", 'it plays "assets/intro.mp4"');

// the captions are "assets/intro.vtt"
export const matchCaptions = (tokens: readonly Token[]): Body =>
  stringAfter(tokens, ["the", "captions", "are"], "captions", 'the captions are "assets/intro.vtt"');

// the poster is "assets/poster.jpg"
export const matchPoster = (tokens: readonly Token[]): Body =>
  stringAfter(tokens, ["the", "poster", "is"], "poster", 'the poster is "assets/poster.jpg"');

// it has no speech
export function matchNoSpeech(tokens: readonly Token[]): Body {
  if (!words(tokens, "it", "has", "no", "speech")) return null;
  if (tokens.length !== 4) return fail("unexpected words after it has no speech", tokens, "write: it has no speech");
  return ok({ type: "no-speech", span: spanFromTokens(tokens) });
}

// the options are "Small", "Medium", "Large"
export function matchOptions(tokens: readonly Token[]): Body {
  if (!words(tokens, "the", "options", "are")) return null;
  const rest = tokens.slice(3);
  const values: string[] = [];
  const valueSpans: (typeof rest)[number]["span"][] = [];
  const hint = 'for example: the options are "Small", "Medium", "Large"';
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (index % 2 === 0) {
      if (!isString(token) || token.value.length === 0) {
        return fail("options are non-empty quoted strings separated by commas", tokens, hint);
      }
      if (values.includes(token.value)) {
        return fail(`duplicate option ${JSON.stringify(token.value)}`, [token], "each option must be unique");
      }
      values.push(token.value);
      valueSpans.push(token.span);
    } else if (token.kind !== "comma") {
      return fail("options are separated by commas", [token], hint);
    }
  }
  if (values.length < 2 || rest.length % 2 === 0) {
    return fail("a choice needs at least two options", tokens, hint);
  }
  return ok({ type: "options", values, valueSpans, span: spanFromTokens(tokens) });
}

/**
 * The `it is <state>` sentences added in 0.3. `matchSizeState` (0.1) steps
 * aside for exactly these shapes so one line never matches two templates.
 */
export function isF1State(tokens: readonly Token[]): boolean {
  if (!isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "is")) return false;
  if (tokens.length === 3 && (isAnyWord(tokens[2], "checked") || isAnyWord(tokens[2], "disabled"))) {
    return true;
  }
  return (
    isAnyWord(tokens[2], "at") &&
    (isAnyWord(tokens[3], "least") || isAnyWord(tokens[3], "most")) &&
    isAnyWord(tokens[tokens.length - 1], "characters")
  );
}

// it is checked | it is disabled | it is at least 8 characters | it is at most 200 characters
export function matchF1State(tokens: readonly Token[]): Body {
  if (!isF1State(tokens)) return null;
  const span = spanFromTokens(tokens);
  if (tokens.length === 3) {
    return ok({ type: isAnyWord(tokens[2], "checked") ? "checked" : "disabled", span });
  }
  const count = tokens[4];
  if (
    tokens.length !== 6 ||
    count?.kind !== "number" ||
    typeof count.value !== "number" ||
    !Number.isInteger(count.value) ||
    count.value < 1 ||
    count.value > 100000
  ) {
    return fail(
      "a length limit is a whole number of characters from 1 to 100000",
      tokens,
      "for example: it is at least 8 characters",
    );
  }
  return ok({
    type: "length-limit",
    bound: isAnyWord(tokens[3], "least") ? "min" : "max",
    value: count.value,
    span,
  });
}

// it sends to "https://example.com/subscribe"
export function matchFormAction(tokens: readonly Token[]): Body {
  if (!words(tokens, "it", "sends", "to")) return null;
  const url = tokens[3];
  // D-44: it sends to the server function signUp
  if (isKeyword(tokens[3], "the") && tokens[4]?.text.toLowerCase() === "server") {
    const fn = tokens[6];
    if (tokens.length !== 7 || tokens[5]?.text.toLowerCase() !== "function" || fn === undefined || !/^[a-z][A-Za-z0-9]{0,63}$/.test(fn.text) || isString(fn)) {
      return fail("write: it sends to the server function <function>", tokens, "for example: it sends to the server function signUp");
    }
    return ok({ type: "form-action", url: `/_kadam/${fn.text}`, urlSpan: fn.span, server: fn.text, span: spanFromTokens(tokens) });
  }
  const hint = 'for example: it sends to "https://example.com/subscribe"';
  if (tokens.length !== 4 || !isString(url)) return fail("a form sends to one quoted URL", tokens, hint);
  if (!isAbsoluteHttpUrl(url.value)) {
    return fail(`form destination ${JSON.stringify(url.value)} must be an absolute http or https URL`, [url], hint);
  }
  return ok({ type: "form-action", url: url.value, urlSpan: url.span, span: spanFromTokens(tokens) });
}

// it submits the form
export function matchSubmit(tokens: readonly Token[]): Body {
  if (!words(tokens, "it", "submits", "the", "form")) return null;
  if (tokens.length !== 4) return fail("unexpected words after it submits the form", tokens, "write: it submits the form");
  return ok({ type: "submit", span: spanFromTokens(tokens) });
}

/**
 * Inline spans inside text, one sentence per span:
 *   the words "docs" go to page "Docs"
 *   the words "pricing" open "https://example.com" in a new tab
 *   the words "fast" are bold        the word "now" is italic
 * Singular and plural forms are interchangeable, like `a`/`an`.
 */
export function matchTextSpan(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "the")) return null;
  if (!isAnyWord(tokens[1], "words") && !isAnyWord(tokens[1], "word")) return null;
  const target = tokens[2];
  const hint = 'for example: the words "docs" go to page "Docs"';
  // Only `the word(s) "..."` is a span; `the word spacing is ...` is not ours.
  if (!isString(target)) return null;
  if (target.value.length === 0) {
    return fail("an inline span names its words in quotes", tokens, hint);
  }
  const rest = tokens.slice(3);
  const span = spanFromTokens(tokens);
  let effect: TextSpanEffect | null = null;

  if ((isAnyWord(rest[0], "are") || isKeyword(rest[0], "is")) && rest.length === 2) {
    if (isKeyword(rest[1], "bold")) effect = { type: "bold" };
    else if (isKeyword(rest[1], "italic")) effect = { type: "italic" };
    // `code` and `underlined` are effects even when a theme has a color with that name.
    else if (rest[1]?.text.toLowerCase() === "code") effect = { type: "code" };
    else if (rest[1]?.text.toLowerCase() === "underlined") effect = { type: "underline" };
    else {
      const color = readColor(rest[1]!);
      if (color !== null) effect = { type: "color", color };
    }
  } else if (
    (isKeyword(rest[0], "go") || isKeyword(rest[0], "goes")) &&
    isKeyword(rest[1], "to") &&
    isKeyword(rest[2], "page") &&
    rest.length === 4 &&
    isString(rest[3]) &&
    rest[3].value.length > 0
  ) {
    effect = { type: "navigate", pageTitle: rest[3].value, pageSpan: rest[3].span };
  } else if (
    (isKeyword(rest[0], "open") || isAnyWord(rest[0], "opens")) &&
    rest.length === 6 &&
    isString(rest[1]) &&
    words(rest.slice(2), "in", "a", "new", "tab")
  ) {
    if (!isAbsoluteHttpUrl(rest[1].value)) {
      return fail(`link ${JSON.stringify(rest[1].value)} must be an absolute http or https URL`, [rest[1]], hint);
    }
    effect = { type: "external", url: rest[1].value, urlSpan: rest[1].span };
  }

  if (effect === null) {
    return fail(
      `invalid inline span ${JSON.stringify(describeTokens(rest))}`,
      rest.length > 0 ? rest : tokens,
      'use: are bold, are italic, are code, are underlined, are <color>, go to page "Title", or open "https://..." in a new tab',
    );
  }
  return ok({ type: "text-span", target: target.value, targetSpan: target.span, effect, span });
}

/** Field types added in 0.3; `matchFieldAccepts` (0.1) steps aside for them. */
export const F1_FIELD_TYPES: Readonly<Record<string, FieldType>> = {
  "phone numbers": "tel",
  dates: "date",
  times: "time",
  "web addresses": "url",
  "search terms": "search",
};

export function matchF1FieldType(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "accepts")) return null;
  const value = F1_FIELD_TYPES[normalizeWords(tokens.slice(2))];
  if (value === undefined) return null;
  return { statement: { type: "field-type", value, span: spanFromTokens(tokens) }, diagnostics: [] };
}

const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * Page metadata:
 *   the page description says "..."     the page language is "fr"
 *   the page icon is "assets/icon.png"   the page share image is "assets/og.png"
 */
export function matchPageMetadata(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "the") || !isKeyword(tokens[1], "page")) return null;
  let property: "description" | "language" | "icon" | "share image";
  let valueIndex: number;
  if (words(tokens.slice(2), "description", "says")) {
    property = "description";
    valueIndex = 4;
  } else if (words(tokens.slice(2), "language", "is")) {
    property = "language";
    valueIndex = 4;
  } else if (words(tokens.slice(2), "icon", "is")) {
    property = "icon";
    valueIndex = 4;
  } else if (words(tokens.slice(2), "share", "image", "is")) {
    property = "share image";
    valueIndex = 5;
  } else {
    return null;
  }
  const value = tokens[valueIndex];
  const example =
    property === "description"
      ? 'the page description says "Plans and pricing"'
      : property === "language"
        ? 'the page language is "fr"'
        : `the page ${property} is "assets/${property === "icon" ? "icon.png" : "share.png"}"`;
  if (tokens.length !== valueIndex + 1 || !isString(value) || value.value.length === 0) {
    return fail(`the page ${property} requires one quoted, non-empty string`, tokens, `for example: ${example}`);
  }
  if (property === "language" && !LANGUAGE_TAG.test(value.value)) {
    return fail(
      `invalid language tag ${JSON.stringify(value.value)}`,
      [value],
      'use a language tag such as "en", "fr", or "pt-BR"',
    );
  }
  if (property === "description" && Array.from(value.value).length > 300) {
    return fail("a page description has at most 300 characters", [value], "shorten the description");
  }
  return ok({
    type: "page-setting",
    property,
    value: value.value,
    valueSpan: value.span,
    span: spanFromTokens(tokens),
  });
}
