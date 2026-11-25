import type { Token } from "../lexer/token.js";
import { IDENTIFIER_PATTERN } from "../lexer/lexicon.js";

export interface InvalidNameReport {
  readonly message: string;
  readonly hint: string;
}

/**
 * Describe why an element header name was rejected, with a concrete,
 * deterministic rename suggestion. The parser still opens the element block
 * after reporting this, so one bad name yields one diagnostic instead of a
 * cascade of misattributed statements and unbalanced braces.
 */
export function describeInvalidElementName(token: Token): InvalidNameReport {
  const text = token.text;
  if (token.kind === "keyword" || token.kind === "color") {
    const what = token.kind === "keyword" ? "a reserved word" : "a color name";
    return {
      message: `element name ${JSON.stringify(text)} is ${what}`,
      hint: `rename it, for example ${suggestFrom(text)}1 or ${suggestFrom(text)}Block`,
    };
  }
  const suggestion = suggestFrom(text);
  return {
    message: `invalid element name ${JSON.stringify(text)}`,
    hint: IDENTIFIER_PATTERN.test(suggestion)
      ? `element names are lower camel case, for example ${suggestion}`
      : "use a lower-camel name such as button1 or heroSection",
  };
}

/** Lower-camel form of a name: `Hero_Section` -> `heroSection`. */
function suggestFrom(text: string): string {
  const parts = text.split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0);
  if (parts.length === 0) return "element";
  const [head, ...rest] = parts;
  const first = head!.charAt(0).toLowerCase() + head!.slice(1);
  const camel =
    first + rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return /^[a-z]/.test(camel) ? camel : `element${camel}`;
}
