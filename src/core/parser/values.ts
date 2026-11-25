import type {
  ColorValue,
  DurationValue,
  LengthValue,
  PercentageValue,
} from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Span } from "../source/source-file.js";
import type { Token } from "../lexer/token.js";
import { NAMED_COLORS } from "../lexer/lexicon.js";

export function spanFromTokens(tokens: readonly Token[]): Span {
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  return {
    file: first.span.file,
    start: first.span.start,
    end: last.span.end,
  };
}

export function lower(token: Token): string {
  return token.text.toLowerCase();
}

export function isKeyword(token: Token | undefined, word: string): boolean {
  return token?.kind === "keyword" && lower(token) === word;
}

export function isAnyWord(token: Token | undefined, word: string): boolean {
  return (
    token !== undefined &&
    (token.kind === "keyword" ||
      token.kind === "identifier" ||
      token.kind === "word") &&
    lower(token) === word
  );
}

export function isString(token: Token | undefined): token is Token & {
  value: string;
} {
  return token?.kind === "string" && typeof token.value === "string";
}

export function isIdentifier(token: Token | undefined): boolean {
  return token?.kind === "identifier";
}

export function isLength(token: Token | undefined): token is Token & {
  value: number;
  unit: "px" | "rem" | null;
} {
  return token?.kind === "length" && typeof token.value === "number";
}

export function isDuration(token: Token | undefined): token is Token & {
  value: number;
  unit: "ms" | "s";
} {
  return token?.kind === "duration" && typeof token.value === "number";
}

export function isPercentage(token: Token | undefined): token is Token & {
  value: number;
} {
  return token?.kind === "percentage" && typeof token.value === "number";
}

export function readColor(token: Token): ColorValue | null {
  if (token.kind === "color" && typeof token.value === "string") {
    return {
      type: "color",
      kind: "named",
      value: token.value,
      raw: token.text,
    };
  }
  if (token.kind === "hex-color" && isValidHex(token.text)) {
    return {
      type: "color",
      kind: "hex",
      value: token.text.toLowerCase(),
      raw: token.text,
    };
  }
  return null;
}

export function colorDiagnostic(token: Token): DiagnosticSpec {
  if (token.kind === "string") {
    return {
      code: "KDM3005",
      message: `expected a color, found ${JSON.stringify(token.text)}`,
      span: token.span,
      hint: 'use a color such as blue or #2563EB, or one {$colorName} parameter',
    };
  }
  if (token.kind === "hex-color") {
    return {
      code: "KDM3006",
      message: `invalid hex color ${JSON.stringify(token.text)}`,
      span: token.span,
      hint: "use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA",
    };
  }
  if (lower(token) === "transparent" || lower(token) === "currentcolor") {
    return {
      code: "KDM3006",
      message: `${JSON.stringify(token.text)} is not a Kadam color`,
      span: token.span,
      hint: 'use "has no background" for transparency, or a named color or hex literal',
    };
  }
  return {
    code: "KDM3005",
    message: `expected a color, found ${JSON.stringify(token.text)}`,
    span: token.span,
    hint: "use a CSS named color or a #RGB/#RRGGBB hex literal",
  };
}

const VALUE_REFERENCE = /^\{\$([a-z][A-Za-z0-9]{0,63})\}$/;

export interface ValueReference {
  readonly name: string;
  readonly span: Span;
  readonly raw: string;
}

/** A quoted `"{$name}"` reference whose slot type is resolved later. */
export function readPlaceholderReference(
  token: Token | undefined,
): ValueReference | null {
  if (!isString(token)) return null;
  const match = VALUE_REFERENCE.exec(token.value);
  if (match === null) return null;
  return { name: match[1]!, span: token.span, raw: token.value };
}

const COLOR_REFERENCE = /^\{\$([a-z][A-Za-z0-9]{0,63})\}$/;

/** A color literal or a quoted `"{$name}"` color parameter reference. */
export function readColorArgument(token: Token | undefined): ColorValue | null {
  if (token === undefined) return null;
  const color = readColor(token);
  if (color !== null) return color;
  if (!isString(token)) return null;
  const match = COLOR_REFERENCE.exec(token.value);
  if (match === null) return null;
  return {
    type: "color",
    kind: "named",
    value: "",
    raw: token.value,
    reference: { name: match[1]!, span: token.span },
  };
}

/** Parse a binding or default value as a named color or hex literal. */
export function parseColorText(text: string): ColorValue | null {
  const raw = text.trim();
  const normalized = raw.toLowerCase();
  if (NAMED_COLORS.has(normalized)) {
    return { type: "color", kind: "named", value: normalized, raw: normalized };
  }
  if (isValidHex(raw)) {
    return { type: "color", kind: "hex", value: normalized, raw: normalized };
  }
  return null;
}

export function readLength(token: Token): LengthValue | null {
  if (!isLength(token)) return null;
  return {
    type: "length",
    value: token.value,
    unit: token.unit,
    raw: token.text,
  };
}

const LENGTH_REFERENCE = /^\{\$([a-z][A-Za-z0-9]{0,63})\}$/;

/** A length literal or a quoted `"{$name}"` length parameter reference. */
export function readLengthArgument(token: Token | undefined): LengthValue | null {
  if (token === undefined) return null;
  if (isLength(token)) return readLength(token);
  if (!isString(token)) return null;
  const match = LENGTH_REFERENCE.exec(token.value);
  if (match === null) return null;
  return {
    type: "length",
    value: 0,
    unit: null,
    raw: token.value,
    reference: { name: match[1]!, span: token.span },
  };
}

/** Parse a binding or default value as a length: px, rem, or zero. */
export function parseLengthText(text: string): LengthValue | null {
  const raw = text.trim();
  if (raw === "0") return { type: "length", value: 0, unit: null, raw };
  const match = /^(\d+(?:\.\d+)?)\s*(px|rem)$/i.exec(raw);
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return {
    type: "length",
    value,
    unit: match[2]!.toLowerCase() as "px" | "rem",
    raw,
  };
}

export function lengthDiagnostic(token: Token): DiagnosticSpec {
  if (token.kind === "number") {
    return {
      code: "KDM3005",
      message: `bare number ${JSON.stringify(token.text)} is not a length`,
      span: token.span,
      hint: "add a unit, for example 160px or 1.5rem; zero may be written as 0",
    };
  }
  if (token.kind === "string") {
    return {
      code: "KDM3005",
      message: `expected a length, found ${JSON.stringify(token.text)}`,
      span: token.span,
      hint: 'use a length such as 16px, or one {$lengthName} parameter',
    };
  }
  return {
    code: "KDM3005",
    message: `expected a length, found ${JSON.stringify(token.text)}`,
    span: token.span,
    hint: "use px, rem, or 0; Kadam never assumes pixels",
  };
}

export function readDuration(token: Token): DurationValue | null {
  if (!isDuration(token)) return null;
  return {
    type: "duration",
    value: token.value,
    unit: token.unit,
    raw: token.text,
  };
}

export function durationDiagnostic(token: Token): DiagnosticSpec {
  if (isDuration(token) && token.value <= 0) {
    return {
      code: "KDM3005",
      message: "a duration must be greater than zero",
      span: token.span,
      hint: "use a duration such as 150ms or 0.3s",
    };
  }
  return {
    code: "KDM3005",
    message: `expected a duration, found ${JSON.stringify(token.text)}`,
    span: token.span,
    hint: "use milliseconds or seconds, for example 150ms or 0.3s",
  };
}

export function readPercentage(token: Token): PercentageValue | null {
  if (!isPercentage(token)) return null;
  return { type: "percentage", value: token.value, raw: token.text };
}

export function percentageDiagnostic(token: Token): DiagnosticSpec {
  if (isPercentage(token) && (token.value < 100 || token.value > 200)) {
    return {
      code: "KDM3005",
      message: `scale percentage ${token.text} is outside 100%–200%`,
      span: token.span,
      hint: "use a value from 100% to 200%",
    };
  }
  return {
    code: "KDM3005",
    message: `expected a percentage, found ${JSON.stringify(token.text)}`,
    span: token.span,
    hint: "use a percentage such as 105%",
  };
}

export function isValidHex(text: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
    text,
  );
}

export function describeTokens(tokens: readonly Token[]): string {
  return tokens.map((token) => token.text).join(" ");
}

export function extraTokens(tokens: readonly Token[]): DiagnosticSpec {
  return {
    code: "KDM2010",
    message: `unexpected text ${JSON.stringify(describeTokens(tokens))}`,
    span: spanFromTokens(tokens),
    hint: "one statement occupies one line",
  };
}

export function normalizeWords(tokens: readonly Token[]): string {
  return tokens
    .map((token) => (token.kind === "string" ? token.text : lower(token)))
    .join(" ");
}
