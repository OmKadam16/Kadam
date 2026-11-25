import type { Span } from "../source/source-file.js";

export type TokenKind =
  | "keyword"
  | "identifier"
  | "word"
  | "string"
  | "number"
  | "length"
  | "duration"
  | "percentage"
  | "color"
  | "hex-color"
  | "lbrace"
  | "rbrace"
  | "comma"
  | "period"
  | "newline"
  | "comment"
  | "invalid"
  | "eof";

export interface Token {
  readonly kind: TokenKind;
  /** Raw source text for the token. */
  readonly text: string;
  /** Normalized value: lower-case keyword/color, decoded string, or number. */
  readonly value?: string | number;
  readonly unit?: "px" | "rem" | "ms" | "s";
  readonly span: Span;
}
