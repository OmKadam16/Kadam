/** Length units. em, vw, vh, dvh are kadam 0.3; the parser rejects them in 0.1 files. */
export type LengthUnit = "px" | "rem" | "em" | "vw" | "vh" | "dvh";

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
  /** kadam 0.3: an angle such as `10deg`. */
  | "angle"
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
  readonly unit?: LengthUnit | "ms" | "s" | "deg";
  readonly span: Span;
}
