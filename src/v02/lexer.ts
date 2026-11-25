import { DiagnosticBag, type Diagnostic } from "../core/diagnostics/diagnostic.js";
import type { SourceFile } from "../core/source/source-file.js";

export type V02TokenKind =
  | "keyword"
  | "identifier"
  | "string"
  | "number"
  | "lbrace"
  | "rbrace"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "comma"
  | "colon"
  | "period"
  | "operator"
  | "newline"
  | "eof";

export interface V02Token {
  readonly kind: V02TokenKind;
  readonly text: string;
  readonly value?: string | number;
  readonly span: import("../core/source/source-file.js").Span;
}

export interface V02LexResult {
  readonly tokens: readonly V02Token[];
  readonly diagnostics: readonly Diagnostic[];
}

const KEYWORDS: ReadonlySet<string> = new Set([
  "affects",
  "and",
  "as",
  "be",
  "boolean",
  "by",
  "external",
  "false",
  "function",
  "if",
  "kadam",
  "let",
  "list",
  "module",
  "not",
  "nothing",
  "number",
  "of",
  "otherwise",
  "or",
  "output",
  "provided",
  "record",
  "return",
  "returns",
  "set",
  "takes",
  "text",
  "to",
  "true",
  "var",
  "while",
]);

export function lexV02(source: SourceFile): V02LexResult {
  const tokens: V02Token[] = [];
  const diagnostics = new DiagnosticBag();
  const text = source.text;
  let index = 0;

  const push = (
    kind: V02TokenKind,
    start: number,
    end: number,
    value?: string | number,
  ): V02Token => {
    const token: V02Token = {
      kind,
      text: text.slice(start, end),
      span: source.span(start, end),
      ...(value === undefined ? {} : { value }),
    };
    tokens.push(token);
    return token;
  };

  while (index < text.length) {
    const start = index;
    const character = text[index]!;

    if (character === "\n") {
      index += 1;
      push("newline", start, index);
      continue;
    }
    if (character === " " || character === "\t" || character === "\r") {
      index += 1;
      continue;
    }
    if (character === "/" && text[index + 1] === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (character === '"') {
      const result = scanString(source, text, index, diagnostics);
      const token: V02Token = {
        kind: "string",
        text: text.slice(start, result.end),
        value: result.value,
        span: source.span(start, result.end),
      };
      tokens.push(token);
      index = result.end;
      continue;
    }
    if (isDigit(character)) {
      const result = scanNumber(source, text, index, diagnostics);
      push("number", start, result.end, result.value);
      index = result.end;
      continue;
    }
    if (isAsciiLetter(character)) {
      index += 1;
      while (index < text.length && isAsciiAlphaNumeric(text[index]!)) {
        index += 1;
      }
      const raw = text.slice(start, index);
      const normalized = raw.toLowerCase();
      if (KEYWORDS.has(normalized)) {
        push("keyword", start, index, normalized);
      } else {
        push("identifier", start, index);
      }
      continue;
    }

    const two = text.slice(index, index + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
      index += 2;
      push("operator", start, index, two);
      continue;
    }

    switch (character) {
      case "{":
        index += 1;
        push("lbrace", start, index);
        continue;
      case "}":
        index += 1;
        push("rbrace", start, index);
        continue;
      case "(":
        index += 1;
        push("lparen", start, index);
        continue;
      case ")":
        index += 1;
        push("rparen", start, index);
        continue;
      case "[":
        index += 1;
        push("lbracket", start, index);
        continue;
      case "]":
        index += 1;
        push("rbracket", start, index);
        continue;
      case ",":
        index += 1;
        push("comma", start, index);
        continue;
      case ":":
        index += 1;
        push("colon", start, index);
        continue;
      case ".":
        index += 1;
        push("period", start, index);
        continue;
      case "<":
      case ">":
      case "+":
      case "-":
      case "*":
      case "/":
        index += 1;
        push("operator", start, index, character);
        continue;
      case ";":
        index += 1;
        diagnostics.error(
          "KDM5002",
          "semicolons are not valid in the core language; use one statement per line",
          source.span(start, index),
        );
        push("operator", start, index);
        continue;
      case "'":
        index += 1;
        diagnostics.error(
          "KDM5002",
          "single-quoted strings are not valid; use double quotes",
          source.span(start, index),
        );
        push("operator", start, index);
        continue;
      default:
        index += 1;
        diagnostics.error(
          "KDM5002",
          `unexpected character ${JSON.stringify(character)}`,
          source.span(start, index),
        );
        push("operator", start, index);
        continue;
    }
  }

  push("eof", text.length, text.length);
  return { tokens, diagnostics: diagnostics.sorted() };
}

export function isKeyword(token: V02Token | undefined, keyword: string): boolean {
  return token?.kind === "keyword" && token.value === keyword;
}

export function isOperator(token: V02Token | undefined, operator: string): boolean {
  return token?.kind === "operator" && token.text === operator;
}

interface StringResult {
  readonly value: string;
  readonly end: number;
}

function scanString(
  source: SourceFile,
  text: string,
  start: number,
  diagnostics: DiagnosticBag,
): StringResult {
  let index = start + 1;
  let value = "";
  let terminated = false;

  while (index < text.length) {
    const character = text[index]!;
    if (character === '"') {
      index += 1;
      terminated = true;
      break;
    }
    if (character === "\n") break;
    if (character !== "\\") {
      value += character;
      index += 1;
      continue;
    }

    const escapeStart = index;
    const escaped = text[index + 1];
    if (escaped === undefined || escaped === "\n") {
      diagnostics.error(
        "KDM5002",
        "backslash at the end of a string",
        source.span(escapeStart, index + 1),
      );
      index += 1;
      break;
    }
    if (escaped === '"' || escaped === "\\") {
      value += escaped;
      index += 2;
      continue;
    }
    if (escaped === "n") {
      value += "\n";
      index += 2;
      continue;
    }
    if (escaped === "r") {
      value += "\r";
      index += 2;
      continue;
    }
    if (escaped === "t") {
      value += "\t";
      index += 2;
      continue;
    }
    if (escaped === "u") {
      const digits = text.slice(index + 2, index + 6);
      if (/^[0-9A-Fa-f]{4}$/.test(digits)) {
        value += String.fromCharCode(Number.parseInt(digits, 16));
        index += 6;
        continue;
      }
      diagnostics.error(
        "KDM5002",
        "invalid Unicode escape; expected exactly four hex digits",
        source.span(escapeStart, Math.min(index + 6, text.length)),
      );
      index += 2;
      continue;
    }
    diagnostics.error(
      "KDM5002",
      `invalid escape sequence \\${escaped}`,
      source.span(escapeStart, index + 2),
      'supported escapes are \\" \\\\ \\n \\r \\t and \\uXXXX',
    );
    value += escaped;
    index += 2;
  }

  if (!terminated) {
    diagnostics.error(
      "KDM5002",
      "unterminated string; add a closing double quote",
      source.span(start, index),
    );
  }
  return { value, end: index };
}

function scanNumber(
  source: SourceFile,
  text: string,
  start: number,
  diagnostics: DiagnosticBag,
): { readonly value: number; readonly end: number } {
  let index = start;
  while (index < text.length && isDigit(text[index]!)) index += 1;
  if (text[index] === "." && isDigit(text[index + 1] ?? "")) {
    index += 1;
    while (index < text.length && isDigit(text[index]!)) index += 1;
  }
  if (text[index] === "e" || text[index] === "E") {
    let exponentEnd = index + 1;
    if (text[exponentEnd] === "+" || text[exponentEnd] === "-") {
      exponentEnd += 1;
    }
    if (isDigit(text[exponentEnd] ?? "")) {
      exponentEnd += 1;
      while (exponentEnd < text.length && isDigit(text[exponentEnd]!)) {
        exponentEnd += 1;
      }
      index = exponentEnd;
    }
  }

  const value = Number(text.slice(start, index));
  if (!Number.isFinite(value)) {
    diagnostics.error(
      "KDM5002",
      "number literal is not finite",
      source.span(start, index),
      "use a value that fits in a finite binary64 number",
    );
  }
  return { value, end: index };
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isAsciiLetter(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z")
  );
}

function isAsciiAlphaNumeric(character: string): boolean {
  return isAsciiLetter(character) || isDigit(character);
}
