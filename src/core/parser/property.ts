import type { PropertyBindingNode } from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Token } from "../lexer/token.js";
import { isAnyWord, isKeyword, isString, spanFromTokens } from "./values.js";

export interface PropertyBindingMatch {
  readonly binding: PropertyBindingNode | null;
  readonly diagnostics: readonly DiagnosticSpec[];
}

/**
 * Match a component property binding: `with a title of "Starter"`.
 * `with` is contextual, not a new global keyword. This matcher is called only
 * while parsing a statement line, after braces have been handled.
 */
export function matchPropertyBinding(
  tokens: readonly Token[],
): PropertyBindingMatch | null {
  if (!isAnyWord(tokens[0], "with")) return null;

  const span = spanFromTokens(tokens);
  if (
    tokens.length !== 5 ||
    (!isKeyword(tokens[1], "a") && !isKeyword(tokens[1], "an")) ||
    (tokens[2]!.kind !== "identifier" && tokens[2]!.kind !== "keyword") ||
    !/^[a-z][A-Za-z0-9]{0,63}$/.test(tokens[2]!.text) ||
    !isKeyword(tokens[3], "of") ||
    !isString(tokens[4])
  ) {
    return {
      binding: null,
      diagnostics: [
        {
          code: "KDM2002",
          message: "malformed component property binding",
          span,
          hint: 'use: with a title of "Starter"',
        },
      ],
    };
  }

  return {
    binding: {
      type: "property-binding",
      name: tokens[2]!.text,
      nameSpan: tokens[2]!.span,
      value: tokens[4]!.value as string,
      valueSpan: tokens[4]!.span,
      span,
    },
    diagnostics: [],
  };
}