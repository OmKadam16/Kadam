import type { LengthUnit } from "./token.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { DiagnosticBag } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../source/source-file.js";
import { KEYWORDS, NAMED_COLORS, isIdentifierCandidate } from "./lexicon.js";
import type { Token, TokenKind } from "./token.js";

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly comments: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

export function lex(source: SourceFile): LexResult {
  const tokens: Token[] = [];
  const comments: Token[] = [];
  const diagnostics = new DiagnosticBag();
  const text = source.text;
  let index = 0;

  const push = (
    kind: TokenKind,
    start: number,
    end: number,
    extra: Pick<Token, "value" | "unit"> = {},
  ): Token => {
    const token: Token = {
      kind,
      text: text.slice(start, end),
      span: source.span(start, end),
      ...extra,
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

    if (character === " " || character === "\t") {
      index += 1;
      continue;
    }

    if (character === "/" && text[index + 1] === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n") index += 1;
      const token = push("comment", start, index);
      comments.push(token);
      continue;
    }

    if (character === '"') {
      const result = scanString(source, text, index, diagnostics);
      const token: Token = {
        kind: "string",
        text: text.slice(start, result.end),
        value: result.value,
        span: source.span(start, result.end),
      };
      tokens.push(token);
      index = result.end;
      continue;
    }

    if (character === "{") {
      index += 1;
      push("lbrace", start, index);
      continue;
    }
    if (character === "}") {
      index += 1;
      push("rbrace", start, index);
      continue;
    }
    if (character === ",") {
      index += 1;
      push("comma", start, index);
      continue;
    }
    if (character === ".") {
      index += 1;
      push("period", start, index);
      continue;
    }

    if (isDigit(character)) {
      const result = scanNumber(source, text, index, diagnostics);
      const extra =
        result.unit === undefined
          ? { value: result.value }
          : { value: result.value, unit: result.unit };
      push(result.kind, start, result.end, extra);
      index = result.end;
      continue;
    }

    if (character === "#") {
      index += 1;
      while (index < text.length && isAsciiAlphaNumeric(text[index]!)) {
        index += 1;
      }
      if (index === start + 1) {
        diagnostics.error(
          "KDM1001",
          "unexpected '#'; expected a hex color such as #2563EB",
          source.span(start, index),
        );
        push("invalid", start, index, { value: "#" });
      } else {
        push("hex-color", start, index);
      }
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
        push("keyword", start, index, { value: normalized });
      } else if (NAMED_COLORS.has(normalized)) {
        push("color", start, index, { value: normalized });
      } else if (isIdentifierCandidate(raw)) {
        push("identifier", start, index, { value: raw });
      } else {
        push("word", start, index, { value: raw });
      }
      continue;
    }

    index += 1;
    const message =
      character === ";"
        ? "semicolons are not valid in Kadam; use one statement per line"
        : character === "'"
          ? "single-quoted strings are not valid; use double quotes"
          : `unexpected character ${JSON.stringify(character)}`;
    diagnostics.error("KDM1001", message, source.span(start, index));
    push("invalid", start, index, { value: character });
  }

  push("eof", text.length, text.length);
  return { tokens, comments, diagnostics: diagnostics.sorted() };
}

interface NumberResult {
  readonly kind: "number" | "length" | "duration" | "percentage";
  readonly value: number;
  readonly end: number;
  readonly unit?: LengthUnit | "ms" | "s";
}

function scanNumber(
  source: SourceFile,
  text: string,
  start: number,
  diagnostics: DiagnosticBag,
): NumberResult {
  let index = start;
  while (index < text.length && isDigit(text[index]!)) index += 1;
  if (text[index] === "." && isDigit(text[index + 1] ?? "")) {
    index += 1;
    while (index < text.length && isDigit(text[index]!)) index += 1;
  }
  const value = Number(text.slice(start, index));

  if (text[index] === "%") {
    return { kind: "percentage", value, end: index + 1 };
  }

  const immediate = matchUnit(text, index) ?? matchNewUnit(text, index);
  if (immediate !== null) {
    return {
      kind: immediate.unit === "ms" || immediate.unit === "s" ? "duration" : "length",
      value,
      end: immediate.end,
      unit: immediate.unit,
    };
  }

  // One optional horizontal space is allowed between number and unit.
  const spaced = text[index] === " " || text[index] === "\t";
  if (spaced && !isHorizontalWhitespace(text[index + 1] ?? "")) {
    const afterSpace = matchUnit(text, index + 1);
    if (afterSpace !== null) {
      return {
        kind: afterSpace.unit === "px" || afterSpace.unit === "rem" ? "length" : "duration",
        value,
        end: afterSpace.end,
        unit: afterSpace.unit,
      };
    }
  }

  if (!spaced) {
    const unitEnd = scanLetters(text, index);
    if (unitEnd > index) {
      diagnostics.error(
        "KDM1004",
        `malformed unit ${JSON.stringify(text.slice(index, unitEnd))}`,
        source.span(start, unitEnd),
        "supported units are px, rem, em, vw, vh, dvh, %, ms, and s; a length needs a unit unless it is 0",
      );
    }
  }

  // `0` is a length literal; other bare numbers are numbers, never pixels.
  return value === 0
    ? { kind: "length", value, end: index }
    : { kind: "number", value, end: index };
}

function scanLetters(text: string, start: number): number {
  let index = start;
  while (index < text.length && isAsciiLetter(text[index]!)) index += 1;
  return index;
}

function matchUnit(
  text: string,
  start: number,
): { readonly unit: "px" | "rem" | "ms" | "s"; readonly end: number } | null {
  const candidates: ReadonlyArray<"rem" | "px" | "ms" | "s"> = [
    "rem",
    "px",
    "ms",
    "s",
  ];
  for (const unit of candidates) {
    const candidate = text.slice(start, start + unit.length).toLowerCase();
    if (candidate !== unit) continue;
    const after = text[start + unit.length];
    if (after !== undefined && isAsciiAlphaNumeric(after)) continue;
    return { unit, end: start + unit.length };
  }
  return null;
}

/**
 * kadam 0.3 length units. Only accepted directly after the number (`50vw`),
 * never after a space, so no existing `<number> <word>` phrase changes meaning.
 */
function matchNewUnit(
  text: string,
  start: number,
): { readonly unit: "em" | "vw" | "vh" | "dvh"; readonly end: number } | null {
  for (const unit of ["dvh", "em", "vw", "vh"] as const) {
    if (text.slice(start, start + unit.length).toLowerCase() !== unit) continue;
    const after = text[start + unit.length];
    if (after !== undefined && isAsciiAlphaNumeric(after)) continue;
    return { unit, end: start + unit.length };
  }
  return null;
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
        "KDM1003",
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
        "KDM1003",
        "invalid Unicode escape; expected exactly four hex digits",
        source.span(escapeStart, Math.min(index + 6, text.length)),
      );
      index += 2;
      continue;
    }
    diagnostics.error(
      "KDM1003",
      `invalid escape sequence \\${escaped}`,
      source.span(escapeStart, index + 2),
      'supported escapes are \\" \\\\ \\n \\r \\t and \\uXXXX',
    );
    value += escaped;
    index += 2;
  }

  if (!terminated) {
    diagnostics.error(
      "KDM1002",
      "unterminated string; add a closing double quote",
      source.span(start, index),
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

function isHorizontalWhitespace(character: string): boolean {
  return character === " " || character === "\t";
}
