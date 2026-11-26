import type { F6Statement, RawCssAsset, StateType } from "../ast/nodes.js";
import type { DiagnosticCode } from "../diagnostics/diagnostic.js";
import type { Token } from "../lexer/token.js";
import type { StatementMatchBody } from "./statement-types.js";
import { isAnyWord, isKeyword, isString, spanFromTokens } from "./values.js";

/**
 * kadam 0.3 (F6, D-42): escape hatches.
 *
 *     the css "mask-image" is "url(assets/fade.svg)"
 */

type Body = StatementMatchBody | null;

function fail(code: DiagnosticCode, message: string, token: Token | undefined, tokens: readonly Token[], hint: string): StatementMatchBody {
  return { statement: null, diagnostics: [{ code, message, span: token?.span ?? spanFromTokens(tokens), hint }] };
}

/**
 * Properties Kadam already has a sentence for. The escape hatch never becomes
 * a second way to say the same thing (D-42 rule 1), and keeping colors out
 * keeps the contrast check meaningful.
 */
export const RAW_CSS_HAS_SENTENCE: ReadonlyMap<string, string> = new Map([
  ["color", "the text is #1F2937"],
  ["background", "has a #FFFFFF background"],
  ["background-color", "has a #FFFFFF background"],
  ["background-image", 'it has a background image "assets/bg.jpg"'],
  ["font-size", "the text is 18px"],
  ["font-weight", "the text is bold"],
  ["font-style", "the text is italic"],
  ["font-family", "the font is serif"],
  ["line-height", "the line height is 1.5"],
  ["letter-spacing", "the letter spacing is 0.05em"],
  ["text-align", "the text is centered"],
  ["text-decoration", "the text is underlined"],
  ["text-transform", "the text is uppercase"],
  ["padding", "it has 16px padding"],
  ["margin", "it has 16px margin"],
  ["gap", "it has 12px gap between children"],
  ["width", "it is 300px wide"],
  ["height", "it is 200px tall"],
  ["min-width", "it is at least 200px wide"],
  ["max-width", "it is at most 1200px wide"],
  ["min-height", "it is at least 50vh tall"],
  ["max-height", "it is at most 400px tall"],
  ["display", "it arranges its children in a row"],
  ["flex-direction", "it arranges its children in a row"],
  ["flex-wrap", "it wraps its children"],
  ["justify-content", "it spreads its children apart"],
  ["align-items", "it centers its children vertically"],
  ["flex-grow", "it grows to fill the space"],
  ["flex-shrink", "it does not shrink"],
  ["grid-template-columns", "it arranges its children in columns at least 280px wide"],
  ["grid-column", "it spans all columns"],
  ["border", "has a 1px #E5E7EB border"],
  ["border-color", "has a 1px #E5E7EB border"],
  ["border-width", "has a 1px #E5E7EB border"],
  ["border-radius", "has 12px rounded corners"],
  ["box-shadow", "has a soft shadow"],
  ["outline", "has a 2px #2563EB outline"],
  ["position", "it sticks to the top"],
  ["top", "it is pinned to the top"],
  ["right", "it is pinned to the right"],
  ["bottom", "it is pinned to the bottom"],
  ["left", "it is pinned to the left"],
  ["z-index", "the layer is 10"],
  ["overflow", "it hides anything outside it"],
  ["aspect-ratio", "it keeps a 16 by 9 shape"],
  ["object-fit", "the image covers its box"],
  ["object-position", "the image is focused on the top"],
  ["opacity", "the opacity is 50%"],
  ["filter", "it is blurred by 4px"],
  ["backdrop-filter", "it blurs the background behind it by 12px"],
  ["rotate", "it rotates by 10deg"],
  ["scale", "it scales to 105%"],
  ["translate", "it moves by 4px to the right"],
  ["transform", "it rotates by 10deg"],
  ["transition", "when hovered, the background turns blue over 200ms"],
  ["animation", "it floats forever"],
  ["visibility", "it is hidden"],
  ["content", "the text says \"...\""],
]);

const PROPERTY = /^[a-z]+(-[a-z]+)*$/;
const FORBIDDEN = /[;{}<>@\\!"`]/;

export function matchRawCss(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "the") || tokens[1]?.text.toLowerCase() !== "css") return null;
  const hint = 'for example: the css "mask-image" is "url(assets/fade.svg)"';
  const name = tokens[2];
  if (tokens.length !== 5 || !isString(name) || tokens[3]?.text.toLowerCase() !== "is" || !isString(tokens[4])) {
    return fail("KDM3050", "write the css, a quoted property, is, and a quoted value", tokens[2], tokens, hint);
  }
  const value = tokens[4];
  const property = name.value;
  if (property.startsWith("--")) {
    return fail("KDM3050", "custom properties cannot be set with the css; use theme tokens", name, tokens, "for example: the brand color is #0F766E");
  }
  if (!PROPERTY.test(property)) {
    return fail("KDM3050", `"${property}" is not a CSS property name`, name, tokens, "use a lowercase property such as mask-image or clip-path");
  }
  const sentence = RAW_CSS_HAS_SENTENCE.get(property) ?? sentenceForFamily(property);
  if (sentence !== undefined) {
    return fail("KDM3051", `Kadam has a sentence for ${property}; the css cannot set it`, name, tokens, `write: ${sentence}`);
  }
  const text = value.value.trim();
  if (text === "") return fail("KDM3050", "the css value is empty", value, tokens, hint);
  if (FORBIDDEN.test(text) || /expression\s*\(|javascript:|import/i.test(text)) {
    return fail("KDM3050", "the css value may not contain ; { } < > @ \\ ! quotes, expression(), or javascript:", value, tokens, "write one plain value, such as circle(40%) or url(assets/fade.svg)");
  }
  const assets: RawCssAsset[] = [];
  const urls = /url\(\s*([^)]*)\)/gi;
  for (const found of text.matchAll(urls)) {
    const path = (found[1] ?? "").trim().replace(/^'(.*)'$/, "$1");
    if (path === "" || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
      return fail("KDM3050", `url(${path}) must be a file inside the project`, value, tokens, "for example: url(assets/fade.svg)");
    }
    assets.push({ path, span: value.span });
  }
  if (/url\(/i.test(text.replace(urls, ""))) {
    return fail("KDM3050", "an unclosed url( in the css value", value, tokens, hint);
  }
  const statement: F6Statement = { type: "raw-css", property, value: text, assets, span: spanFromTokens(tokens) };
  return { statement, diagnostics: [] };
}

/** Longhands of a property that has a sentence (padding-top, border-left-color, ...). */
const FAMILIES: ReadonlyMap<string, string> = new Map([
  ["padding-", "it has 16px padding on the top"],
  ["margin-", "it has 16px margin on the top"],
  ["border-", "has a 1px #E5E7EB border on the bottom"],
  ["inset", "it is pinned to the top"],
  ["grid-template-", "it arranges its children in columns at least 280px wide"],
  ["flex", "it arranges its children in a row"],
  ["transition-", "when hovered, the background turns blue over 200ms"],
  ["animation-", "it floats forever"],
  ["background-size", "the background image covers the box"],
  ["background-position", "the background image is focused on the top"],
  ["background-repeat", "the background image covers the box"],
]);

function sentenceForFamily(property: string): string | undefined {
  for (const [prefix, sentence] of FAMILIES) if (property.startsWith(prefix)) return sentence;
  return undefined;
}

const CLASS_NAME = /^-?[_a-zA-Z][_a-zA-Z0-9-]{0,63}$/;

// it also uses the class "legacy-hero" from "styles/legacy.css"
export function matchStylesheetClass(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "also") || !isAnyWord(tokens[2], "uses")) return null;
  const hint = 'for example: it also uses the class "legacy-hero" from "styles/legacy.css"';
  const name = tokens[5];
  const file = tokens[7];
  if (
    tokens.length !== 8 || !isKeyword(tokens[3], "the") || !isAnyWord(tokens[4], "class") ||
    !isString(name) || tokens[6]?.text.toLowerCase() !== "from" || !isString(file)
  ) {
    return fail("KDM3052", "write it also uses the class, a quoted class name, from, and a quoted .css file", undefined, tokens, hint);
  }
  if (!CLASS_NAME.test(name.value)) {
    return fail("KDM3052", `"${name.value}" is not a CSS class name`, name, tokens, "use letters, digits, - and _, such as legacy-hero");
  }
  if (name.value.startsWith("kdm-")) {
    return fail("KDM3052", "classes starting with kdm- belong to Kadam's own output", name, tokens, "rename the class in your stylesheet");
  }
  if (!file.value.endsWith(".css")) {
    return fail("KDM3052", "the class must come from a .css file", file, tokens, hint);
  }
  const statement: F6Statement = {
    type: "stylesheet-class", className: name.value, classSpan: name.span, file: file.value, fileSpan: file.span,
    span: spanFromTokens(tokens),
  };
  return { statement, diagnostics: [] };
}

const EXTERNAL_NAME = /^[a-z][A-Za-z0-9]{0,63}$/;

// external trackEvent from "analytics.js" takes text and a number and returns nothing
export function matchExternal(tokens: readonly Token[]): Body {
  if (tokens[0]?.text !== "external") return null;
  const hint = 'for example: external trackEvent from "analytics.js" takes text and returns nothing';
  const name = tokens[1];
  const file = tokens[3];
  const n = tokens.length;
  if (
    name === undefined || name.kind === "string" || !EXTERNAL_NAME.test(name.text) ||
    tokens[2]?.text.toLowerCase() !== "from" || !isString(file) || !isAnyWord(tokens[4], "takes") ||
    n < 9 || !isKeyword(tokens[n - 3], "and") || !isAnyWord(tokens[n - 2], "returns") || !isAnyWord(tokens[n - 1], "nothing")
  ) {
    return fail("KDM3005", "write external, a name, from, a quoted .js file, takes <types>, and returns nothing", undefined, tokens, hint);
  }
  const path = file.value.replace(/^\.\//, "");
  if (!/\.m?js$/.test(path) || path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.split("/").includes("..")) {
    return fail("KDM3005", "an external comes from a .js file inside the project", file, tokens, hint);
  }
  const middle = tokens.slice(5, n - 3);
  const parameters: StateType[] = [];
  if (!(middle.length === 1 && isAnyWord(middle[0], "nothing"))) {
    let part: Token[] = [];
    const parts: Token[][] = [part];
    for (const token of middle) {
      if (token.kind === "comma" || isKeyword(token, "and")) parts.push((part = []));
      else part.push(token);
    }
    for (const words of parts) {
      const text = words.map((token) => token.text.toLowerCase()).join(" ");
      if (text === "text") parameters.push("text");
      else if (text === "a number" || text === "number") parameters.push("number");
      else if (text === "a boolean" || text === "boolean") parameters.push("boolean");
      else if (text === "") continue;
      else return fail("KDM3005", `"${text}" is not a type; use text, a number, or a boolean`, words[0], tokens, hint);
    }
    if (parameters.length === 0) return fail("KDM3005", "write takes nothing, or list the types", tokens[4], tokens, hint);
  }
  const statement: F6Statement = {
    type: "external", name: name.text, nameSpan: name.span, file: path, fileSpan: file.span, parameters, span: spanFromTokens(tokens),
  };
  return { statement, diagnostics: [] };
}

// D-44: when it is sent, it shows thanksNote / when sending fails, it shows sorryNote
export function matchFormState(tokens: readonly Token[]): Body {
  if (tokens[0]?.text.toLowerCase() !== "when") return null;
  const words = tokens.map((token) => token.text.toLowerCase());
  const sent = words[1] === "it" && words[2] === "is" && words[3] === "sent";
  const failed = words[1] === "sending" && words[2] === "fails";
  if (!sent && !failed) return null;
  const at = sent ? 4 : 3;
  const target = tokens[at + 3];
  if (
    tokens[at]?.kind !== "comma" || words[at + 1] !== "it" || words[at + 2] !== "shows" ||
    tokens.length !== at + 4 || target === undefined || !/^[a-z][A-Za-z0-9]{0,63}$/.test(target.text) || isString(target)
  ) {
    return fail("KDM3005", `write: ${sent ? "when it is sent" : "when sending fails"}, it shows <element name>`, undefined, tokens,
      sent ? "for example: when it is sent, it shows thanksNote" : "for example: when sending fails, it shows sorryNote");
  }
  const statement: F6Statement = { type: "form-state", state: sent ? "sent" : "failed", target: target.text, targetSpan: target.span, span: spanFromTokens(tokens) };
  return { statement, diagnostics: [] };
}
