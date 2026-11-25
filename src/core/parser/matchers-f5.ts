import type { F4Statement, ShapeField, ShapeFieldType } from "../ast/nodes.js";
import type { Token } from "../lexer/token.js";
import type { StatementMatchBody } from "./statement-types.js";
import { isAnyWord, isKeyword, isString, spanFromTokens } from "./values.js";

/**
 * kadam 0.3 (F5 step 6, D-41): runtime data.
 *
 *     it loads products from "https://api.example.com/products"
 *     each product has a name as text, a price as a number, and a link as a url
 *     while loading, it shows loadingNote
 *     when there are none, it shows emptyNote
 *     when loading fails, it shows errorNote
 */

type Body = StatementMatchBody | null;
const NAME = /^[a-z][A-Za-z0-9]{0,63}$/;

function fail(message: string, tokens: readonly Token[], hint: string): StatementMatchBody {
  return { statement: null, diagnostics: [{ code: "KDM3005", message, span: spanFromTokens(tokens), hint }] };
}
function ok(statement: F4Statement): StatementMatchBody {
  return { statement, diagnostics: [] };
}
function isName(token: Token | undefined): token is Token {
  return token !== undefined && (token.kind === "identifier" || token.kind === "keyword" || token.kind === "word") && NAME.test(token.text);
}

// it loads products from "https://api.example.com/products"
export function matchDataLoad(tokens: readonly Token[]): Body {
  if (!isKeyword(tokens[0], "it") || !isAnyWord(tokens[1], "loads") || !isAnyWord(tokens[3], "from")) return null;
  const hint = 'for example: it loads products from "https://api.example.com/products"';
  const name = tokens[2];
  const url = tokens[4];
  if (tokens.length !== 5 || !isName(name) || !isAnyWord(tokens[3], "from") || !isString(url) || url.value.trim() === "") {
    return fail("write: it loads <name> from \"<url>\"", tokens, hint);
  }
  return ok({ type: "data-load", name: name.text, nameSpan: name.span, url: url.value, urlSpan: url.span, span: spanFromTokens(tokens) });
}

const TYPES: Readonly<Record<string, ShapeFieldType>> = { text: "text", number: "number", url: "url", "true or false": "yes/no" };
const SHAPE_HINT = "for example: each product has a name as text, a price as a number, a link as a url, and an inStock as true or false";

// each product has a name as text, a price as a number, and a link as a url
export function matchDataShape(tokens: readonly Token[]): Body {
  if (!isAnyWord(tokens[0], "each") || !isAnyWord(tokens[2], "has")) return null;
  const item = tokens[1];
  if (!isName(item)) return fail("write: each <record> has a <field> as <type>, ...", tokens, SHAPE_HINT);
  // Split the field list at commas and a final `and`.
  const parts: Token[][] = [[]];
  for (const token of tokens.slice(3)) {
    if (token.kind === "comma") parts.push([]);
    else parts.at(-1)!.push(token);
  }
  const fields: ShapeField[] = [];
  for (let part of parts) {
    if (isKeyword(part[0], "and")) part = part.slice(1);
    // `a name as text and a price as a number` without a comma.
    const pieces: Token[][] = [[]];
    for (const token of part) {
      if (isKeyword(token, "and") && pieces.at(-1)!.some((t) => isAnyWord(t, "as"))) pieces.push([]);
      else pieces.at(-1)!.push(token);
    }
    for (const piece of pieces) {
      const article = piece[0];
      const name = piece[1];
      if ((!isKeyword(article, "a") && !isKeyword(article, "an")) || !isName(name) || !isAnyWord(piece[2], "as")) {
        return fail("each field is a <name> as <type>", piece.length > 0 ? piece : tokens, SHAPE_HINT);
      }
      let typeWords = piece.slice(3).map((token) => token.text.toLowerCase());
      if (typeWords[0] === "a" || typeWords[0] === "an") typeWords = typeWords.slice(1);
      const type = TYPES[typeWords.join(" ")];
      if (type === undefined) return fail(`the type of ${name.text} is text, a number, a url, or true or false`, piece, SHAPE_HINT);
      if (fields.some((field) => field.name === name.text)) return fail(`${name.text} is listed twice`, piece, "list each field once");
      fields.push({ name: name.text, type, span: spanFromTokens(piece) });
    }
  }
  if (fields.length === 0) return fail("a shape lists at least one field", tokens, SHAPE_HINT);
  return ok({ type: "data-shape", item: item.text, itemSpan: item.span, fields, span: spanFromTokens(tokens) });
}

// while loading, it shows loadingNote | when there are none, ... | when loading fails, ...
export function matchDataState(tokens: readonly Token[]): Body {
  const comma = tokens.findIndex((token) => token.kind === "comma");
  if (comma === -1) return null;
  const lead = tokens.slice(0, comma).map((token) => token.text.toLowerCase()).join(" ");
  const state = lead === "while loading" ? "loading" : lead === "when there are none" ? "empty" : lead === "when loading fails" ? "error" : null;
  if (state === null) return null;
  const rest = tokens.slice(comma + 1);
  const target = rest[2];
  if (rest.length !== 3 || !isKeyword(rest[0], "it") || !isAnyWord(rest[1], "shows") || !isName(target)) {
    return fail(`write: ${lead}, it shows <element name>`, tokens, `for example: ${lead}, it shows ${state}Note`);
  }
  return ok({ type: "data-state", state, target: target.text, targetSpan: target.span, span: spanFromTokens(tokens) });
}
