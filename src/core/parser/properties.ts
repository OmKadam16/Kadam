import type {
  ColorValue,
  FontFamily,
  FontWeight,
  LengthValue,
  NumberValue,
  PropertyStatement,
  StatementNode,
  TextAlign,
} from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Token } from "../lexer/token.js";
import type { Span } from "../source/source-file.js";
import type { StatementMatchBody } from "./statement-types.js";
import {
  colorDiagnostic,
  describeTokens,
  isKeyword,
  isString,
  lengthDiagnostic,
  normalizeWords,
  readColorArgument,
  readLengthArgument,
  spanFromTokens,
} from "./values.js";
import { isFluidText } from "./matchers-f2.js";

/**
 * D-32: the regular property sentence (kadam 0.3).
 *
 *     the <property> is <value>
 *
 * Every property the regular form accepts is one row in this table. A row is
 * one of two shapes:
 *
 * - **Shorthand-backed** (`build`): the property already has a hand-written
 *   sentence. The row builds exactly the AST node that shorthand builds, so
 *   kind capability, duplicate keys (`the text size is 18px` and
 *   `the text is 20px` are one property), responsive rules, component
 *   interpolation, and CSS output are shared and byte-identical.
 * - **Native** (`css`): the property exists only in the regular form and
 *   lowers to a `property` statement emitted as one CSS declaration.
 *
 * A name that is not in the table is never claimed and stays an unrecognized
 * statement (KDM2001). Rows are never inferred.
 */

export type PropertyValueType = "length" | "number" | "percentage" | "color" | "choice";

/** The parsed value handed to a row's builder. */
export type PropertyValue =
  | LengthValue
  | NumberValue
  | ColorValue
  | { readonly type: "choice"; readonly value: string };

interface RowBase {
  /** Canonical lower-case name as written in source, e.g. "line height". */
  readonly name: string;
  readonly value: PropertyValueType;
  /** Inclusive bounds for numeric values. */
  readonly min?: number;
  readonly max?: number;
  /** Numeric values must be whole numbers. */
  readonly integer?: boolean;
  /** Accepted words for a choice value, mapped to the stored value. */
  readonly choices?: Readonly<Record<string, string>>;
  readonly description: string;
  readonly example: string;
}

export interface ShorthandPropertyDefinition extends RowBase {
  /** The existing sentence this row is equivalent to, for documentation. */
  readonly shorthand: string;
  readonly build: (value: PropertyValue, span: Span) => StatementNode;
}

export interface NativePropertyDefinition extends RowBase {
  /** Which element kinds accept the property (mirrors spec Appendix A.5). */
  readonly applies: "text-bearing" | "all";
  /** Generated CSS property. */
  readonly css: string;
}

export type PropertyDefinition = ShorthandPropertyDefinition | NativePropertyDefinition;

export function isNativeProperty(
  definition: PropertyDefinition,
): definition is NativePropertyDefinition {
  return "css" in definition;
}

const ALL_SIDES = ["top", "right", "bottom", "left"] as const;

const length = (value: PropertyValue): LengthValue => value as LengthValue;
const color = (value: PropertyValue): ColorValue => value as ColorValue;
const choice = (value: PropertyValue): string =>
  (value as { readonly value: string }).value;

/** Table order is documentation order; CSS is emitted in source order. */
export const PROPERTIES: readonly PropertyDefinition[] = [
  // Typography
  {
    name: "text size",
    value: "length",
    description: "Font size",
    example: "the text size is 18px",
    shorthand: "the text is 18px",
    build: (value, span) => ({ type: "typography", property: "size", value: length(value), span }),
  },
  {
    name: "text color",
    value: "color",
    description: "Text color",
    example: "the text color is #171717",
    shorthand: "the text is #171717",
    build: (value, span) => ({ type: "typography", property: "color", value: color(value), span }),
  },
  {
    name: "text weight",
    value: "choice",
    choices: { light: "light", regular: "regular", medium: "medium", semibold: "semibold", bold: "bold" },
    description: "Font weight",
    example: "the text weight is semibold",
    shorthand: "the text is semibold",
    build: (value, span) => ({
      type: "typography",
      property: "weight",
      value: /^\d+$/.test(choice(value)) ? Number(choice(value)) : (choice(value) as FontWeight),
      span,
    }),
  },
  {
    name: "text style",
    value: "choice",
    choices: { italic: "italic" },
    description: "Font style",
    example: "the text style is italic",
    shorthand: "the text is italic",
    build: (_value, span) => ({ type: "typography", property: "style", value: "italic", span }),
  },
  {
    name: "text alignment",
    value: "choice",
    choices: { left: "left", centered: "center", right: "right" },
    description: "Horizontal text alignment",
    example: "the text alignment is centered",
    shorthand: "the text is centered",
    build: (value, span) => ({
      type: "typography",
      property: "align",
      value: choice(value) as TextAlign,
      span,
    }),
  },
  {
    name: "font family",
    value: "choice",
    choices: { "sans serif": "sans serif", serif: "serif", monospace: "monospace" },
    description: "Font family preset",
    example: "the font family is monospace",
    shorthand: "the font is monospace",
    build: (value, span) => ({ type: "font-family", value: choice(value) as FontFamily, span }),
  },
  {
    name: "line height",
    value: "number",
    min: 0.5,
    max: 4,
    applies: "text-bearing",
    css: "line-height",
    description: "Line height as a multiple of the font size",
    example: "the line height is 1.6",
  },
  {
    name: "letter spacing",
    value: "length",
    applies: "text-bearing",
    css: "letter-spacing",
    description: "Extra space between letters",
    example: "the letter spacing is 1px",
  },
  // Layering (kadam 0.3, F2)
  {
    name: "layer",
    value: "number",
    min: 0,
    max: 1000,
    integer: true,
    applies: "all",
    css: "z-index",
    description: "Stacking order; higher layers are drawn on top",
    example: "the layer is 10",
  },
  {
    name: "opacity",
    value: "percentage",
    min: 0,
    max: 100,
    applies: "all",
    css: "opacity",
    description: "Opacity, from 0% (invisible) to 100% (solid)",
    example: "the opacity is 50%",
  },
  // Box
  {
    name: "width",
    value: "length",
    description: "Width",
    example: "the width is 320px",
    shorthand: "it is 320px wide",
    build: (value, span) => ({ type: "size", mode: "width", width: length(value), span }),
  },
  {
    name: "height",
    value: "length",
    description: "Height",
    example: "the height is 48px",
    shorthand: "it is 48px tall",
    build: (value, span) => ({ type: "size", mode: "height", height: length(value), span }),
  },
  {
    name: "padding",
    value: "length",
    description: "Padding on all four sides",
    example: "the padding is 24px",
    shorthand: "it has 24px padding",
    build: (value, span) => ({
      type: "spacing",
      property: "padding",
      value: length(value),
      sides: ALL_SIDES,
      span,
    }),
  },
  {
    name: "margin",
    value: "length",
    description: "Margin on all four sides",
    example: "the margin is 16px",
    shorthand: "it has 16px margin",
    build: (value, span) => ({
      type: "spacing",
      property: "margin",
      value: length(value),
      sides: ALL_SIDES,
      span,
    }),
  },
  {
    name: "gap",
    value: "length",
    description: "Space between a container's children",
    example: "the gap is 16px",
    shorthand: "it has 16px gap between children",
    build: (value, span) => ({ type: "layout", property: "gap", value: length(value), span }),
  },
  {
    name: "background color",
    value: "color",
    description: "Solid background color",
    example: "the background color is #F7F5F0",
    shorthand: "has a #F7F5F0 background",
    build: (value, span) => ({ type: "background", mode: "solid", color: color(value), span }),
  },
  {
    name: "corner radius",
    value: "length",
    description: "Corner radius",
    example: "the corner radius is 12px",
    shorthand: "has 12px rounded corners",
    build: (value, span) => ({ type: "corners", mode: "custom", radius: length(value), span }),
  },
];

const BY_WORDS: ReadonlyMap<string, PropertyDefinition> = new Map(
  PROPERTIES.map((definition) => [definition.name, definition]),
);

/** Longest property name, in words; bounds the lookahead in the matcher. */
const MAX_NAME_WORDS = Math.max(...PROPERTIES.map((p) => p.name.split(" ").length));

export function findProperty(name: string): PropertyDefinition | undefined {
  return BY_WORDS.get(name);
}

/** The table row a `the <name> is ...` line names, if any. */
export function propertyNamed(tokens: readonly Token[]): PropertyDefinition | undefined {
  if (!isKeyword(tokens[0], "the")) return undefined;
  for (let words = MAX_NAME_WORDS; words >= 1; words -= 1) {
    const candidate = tokens.slice(1, 1 + words);
    if (candidate.length !== words || !isKeyword(tokens[1 + words], "is")) continue;
    const found = BY_WORDS.get(candidate.map((t) => t.text.toLowerCase()).join(" "));
    if (found !== undefined) return found;
  }
  return undefined;
}

export function matchPropertySentence(tokens: readonly Token[]): StatementMatchBody | null {
  // The property name is the words between `the` and `is`. Only a name in the
  // table is claimed; everything else is left to the other templates.
  const definition = propertyNamed(tokens);
  if (definition === undefined) return null;
  // kadam 0.3: `the text size is between 1rem and 2rem` is fluid text.
  if (isFluidText(tokens)) return null;
  const isIndex = 1 + definition.name.split(" ").length;

  const span = spanFromTokens(tokens);
  const valueTokens = tokens.slice(isIndex + 1);
  const diagnostics: DiagnosticSpec[] = [];

  if (valueTokens.length === 0) {
    diagnostics.push(invalid(definition, `the ${definition.name} needs a value`, span));
    return { statement: null, diagnostics };
  }

  const value = readValue(definition, valueTokens, diagnostics);
  if (value === null) return { statement: null, diagnostics };

  if (!isNativeProperty(definition)) {
    return { statement: definition.build(value, span), diagnostics };
  }
  const statement: PropertyStatement = {
    type: "property",
    name: definition.name,
    value: value as LengthValue | NumberValue,
    span,
  };
  return { statement, diagnostics };
}

function readValue(
  definition: PropertyDefinition,
  tokens: readonly Token[],
  diagnostics: DiagnosticSpec[],
): PropertyValue | null {
  if (definition.value === "choice") return readChoice(definition, tokens, diagnostics);

  if (tokens.length !== 1) {
    diagnostics.push(
      invalid(
        definition,
        `the ${definition.name} expects one value, found ${JSON.stringify(describeTokens(tokens))}`,
        spanFromTokens(tokens),
      ),
    );
    return null;
  }
  const token = tokens[0]!;

  // Component parameter placeholders ("{$size}") are accepted exactly where the
  // equivalent shorthand accepts them, because the row builds the same node.
  if (isString(token) && isNativeProperty(definition)) {
    diagnostics.push(
      invalid(definition, `the ${definition.name} cannot be a parameter placeholder yet`, token.span),
    );
    return null;
  }

  switch (definition.value) {
    case "number":
      return readNumber(definition, token, diagnostics);
    case "percentage": {
      if (token.kind !== "percentage" || typeof token.value !== "number") {
        diagnostics.push(invalid(definition, `the ${definition.name} is a percentage such as 50%, found ${JSON.stringify(token.text)}`, token.span));
        return null;
      }
      if (token.value < (definition.min ?? 0) || token.value > (definition.max ?? 100)) {
        diagnostics.push(invalid(definition, `the ${definition.name} must be between ${definition.min}% and ${definition.max}%, found ${token.text}`, token.span));
        return null;
      }
      return { type: "number", value: token.value / 100, raw: token.text };
    }
    case "length": {
      const value = readLengthArgument(token);
      if (value !== null) return value;
      diagnostics.push(
        token.kind === "number"
          ? lengthDiagnostic(token)
          : invalid(
              definition,
              `the ${definition.name} is a length such as 16px or 1rem, found ${JSON.stringify(token.text)}`,
              token.span,
            ),
      );
      return null;
    }
    case "color": {
      const value = readColorArgument(token);
      if (value !== null) return value;
      diagnostics.push(
        token.kind === "hex-color"
          ? colorDiagnostic(token)
          : invalid(
              definition,
              `the ${definition.name} is a color such as #2563EB or blue, found ${JSON.stringify(token.text)}`,
              token.span,
            ),
      );
      return null;
    }
  }
}

function readChoice(
  definition: PropertyDefinition,
  tokens: readonly Token[],
  diagnostics: DiagnosticSpec[],
): PropertyValue | null {
  const choices = definition.choices ?? {};
  // kadam 0.3: a numeric weight, `the text weight is 420`.
  if (definition.name === "text weight" && tokens.length === 1 && tokens[0]!.kind === "number") {
    const weight = Number(tokens[0]!.value);
    if (Number.isInteger(weight) && weight >= 100 && weight <= 900) return { type: "choice", value: String(weight) };
    diagnostics.push(invalid(definition, `text weight ${tokens[0]!.text} must be a whole number from 100 to 900`, tokens[0]!.span));
    return null;
  }
  const words = normalizeWords(tokens);
  const stored = choices[words];
  if (stored !== undefined) return { type: "choice", value: stored };
  diagnostics.push(
    invalid(
      definition,
      `invalid ${definition.name} ${JSON.stringify(describeTokens(tokens))}; use ${Object.keys(choices).join(", ")}`,
      spanFromTokens(tokens),
    ),
  );
  return null;
}

function readNumber(
  definition: PropertyDefinition,
  token: Token,
  diagnostics: DiagnosticSpec[],
): NumberValue | null {
  if (token.kind !== "number" || typeof token.value !== "number") {
    diagnostics.push(
      invalid(definition, `the ${definition.name} is a plain number, found ${JSON.stringify(token.text)}`, token.span),
    );
    return null;
  }
  const value = token.value;
  if (definition.integer === true && !Number.isInteger(value)) {
    diagnostics.push(invalid(definition, `the ${definition.name} is a whole number, found ${token.text}`, token.span));
    return null;
  }
  if (
    (definition.min !== undefined && value < definition.min) ||
    (definition.max !== undefined && value > definition.max)
  ) {
    diagnostics.push(
      invalid(
        definition,
        `the ${definition.name} must be between ${definition.min} and ${definition.max}, found ${token.text}`,
        token.span,
      ),
    );
    return null;
  }
  return { type: "number", value, raw: token.text };
}

function invalid(definition: PropertyDefinition, message: string, span: Span): DiagnosticSpec {
  return { code: "KDM3005", message, span, hint: `write it like: ${definition.example}` };
}
