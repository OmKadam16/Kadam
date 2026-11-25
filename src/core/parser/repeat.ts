import type { RecordFieldReference, RepeatFilter, RepeatSort } from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Token } from "../lexer/token.js";
import { isAnyWord, isKeyword, isString, spanFromTokens } from "./values.js";

/**
 * kadam 0.3 (F5 step 2, D-40): lines that shape a data list. They are only
 * read inside an element whose kind sentence repeats for each record.
 *
 *     only where the featured of project is true
 *     only where the status of project is not "archived"
 *     sorted by the year of project from highest to lowest
 *     showing at most 3
 */
export type RepeatModifier =
  | { readonly type: "filter"; readonly filter: RepeatFilter }
  | { readonly type: "sort"; readonly sort: RepeatSort }
  | { readonly type: "limit"; readonly count: number; readonly span: import("../source/source-file.js").Span };

export interface RepeatModifierMatch {
  readonly modifier: RepeatModifier | null;
  readonly diagnostics: readonly DiagnosticSpec[];
}

const NAME = /^[a-z][A-Za-z0-9]{0,63}$/;

function isName(token: Token | undefined): boolean {
  return token !== undefined && (token.kind === "identifier" || token.kind === "keyword") && NAME.test(token.text);
}

/** `the <field> of <item>` at `index`, or null. */
function fieldAt(tokens: readonly Token[], index: number): RecordFieldReference | null {
  if (!isAnyWord(tokens[index], "the") || !isName(tokens[index + 1]) || !isKeyword(tokens[index + 2], "of") || !isName(tokens[index + 3])) return null;
  return { name: tokens[index + 1]!.text, item: tokens[index + 3]!.text, span: spanFromTokens(tokens.slice(index, index + 4)) };
}

export function matchRepeatModifier(tokens: readonly Token[]): RepeatModifierMatch | null {
  const first = tokens[0];
  const span = spanFromTokens(tokens);
  const malformed = (hint: string): RepeatModifierMatch => ({
    modifier: null,
    diagnostics: [{ code: "KDM2002", message: "malformed data list line", span, hint }],
  });

  if (isAnyWord(first, "only") && isAnyWord(tokens[1], "where")) {
    const hint = 'use: only where the featured of project is true, or only where the status of project is not "archived"';
    const field = fieldAt(tokens, 2);
    if (field === null || !isKeyword(tokens[6], "is")) return malformed(hint);
    const negated = isAnyWord(tokens[7], "not");
    const valueToken = tokens[negated ? 8 : 7];
    if (valueToken === undefined || tokens.length !== (negated ? 9 : 8)) return malformed(hint);
    let value: string | number | boolean;
    if (isString(valueToken)) value = valueToken.value;
    else if (valueToken.kind === "number" && typeof valueToken.value === "number") value = valueToken.value;
    else if (isAnyWord(valueToken, "true")) value = true;
    else if (isAnyWord(valueToken, "false")) value = false;
    else return malformed(hint);
    return { modifier: { type: "filter", filter: { field, negated, value, valueSpan: valueToken.span, span } }, diagnostics: [] };
  }

  if (isAnyWord(first, "sorted") && isAnyWord(tokens[1], "by")) {
    const hint = "use: sorted by the year of project, optionally followed by from highest to lowest";
    const field = fieldAt(tokens, 2);
    if (field === null) return malformed(hint);
    if (tokens.length === 6) return { modifier: { type: "sort", sort: { field, descending: false, span } }, diagnostics: [] };
    const direction = tokens.slice(6).map((token) => token.text.toLowerCase()).join(" ");
    if (direction === "from lowest to highest") return { modifier: { type: "sort", sort: { field, descending: false, span } }, diagnostics: [] };
    if (direction === "from highest to lowest") return { modifier: { type: "sort", sort: { field, descending: true, span } }, diagnostics: [] };
    return malformed(hint);
  }

  if (isAnyWord(first, "showing") && isAnyWord(tokens[1], "at") && isAnyWord(tokens[2], "most")) {
    const count = tokens[3];
    if (tokens.length !== 4 || count?.kind !== "number" || typeof count.value !== "number" || !Number.isInteger(count.value) || count.value < 1 || count.value > 1000) {
      return malformed("use: showing at most 3, with a whole number from 1 to 1000");
    }
    return { modifier: { type: "limit", count: count.value, span }, diagnostics: [] };
  }
  return null;
}
