import { F1_FIELD_TYPES, isF1State } from "./matchers-f1.js";
import { isF2State, isFluidText } from "./matchers-f2.js";
import { isVisibilityBinding } from "./matchers-f4.js";
import { isF3Border, isF3Corners, isF3Gradient, isF3Shadow, isF3State, isF3Text } from "./matchers-f3.js";
import type {
  ColorValue,
  FieldType,
  FontFamily,
  FontWeight,
  LengthValue,
  PageSettingNode,
  Side,
  SizeStatement,
  SpacingStatement,
  StatementNode,
  TextStatement,
} from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Token } from "../lexer/token.js";
import type { StatementMatchBody } from "./statement-types.js";
import {
  colorDiagnostic,
  describeTokens,
  extraTokens,
  isKeyword,
  isString,
  lengthDiagnostic,
  normalizeWords,
  readColor,
  readColorArgument,
  readLengthArgument,
  readPlaceholderReference,
  spanFromTokens,
} from "./values.js";

export function matchPageSetting(
  tokens: readonly Token[],
): StatementMatchBody | null {
  // D-51: `the heading font is "Playfair Display"`
  if (isKeyword(tokens[0], "the") && (isKeyword(tokens[1], "heading") || isKeyword(tokens[1], "headings"))
    && isKeyword(tokens[2], "font") && (isKeyword(tokens[3], "is") || isKeyword(tokens[3], "are"))) {
    const name = tokens[4];
    if (tokens.length === 5 && name?.kind === "string" && String(name.value).trim() !== "") {
      return { statement: { type: "page-setting", property: "custom font", target: "headings", name: String(name.value).trim(), nameSpan: name.span, span: spanFromTokens(tokens) }, diagnostics: [] };
    }
    return { statement: null, diagnostics: [{ code: "KDM3005", message: "the heading font needs a font name in quotes", span: spanFromTokens(tokens), hint: 'for example: the heading font is "Playfair Display"' }] };
  }
  if (
    !isKeyword(tokens[0], "the") ||
    !isKeyword(tokens[1], "page") ||
    !isKeyword(tokens[3], "is")
  ) {
    return null;
  }
  const property = tokens[2];
  if (
    !isKeyword(property, "background") &&
    !isKeyword(property, "text") &&
    !isKeyword(property, "font")
  ) {
    return null;
  }

  const rest = tokens.slice(4);
  const span = spanFromTokens(tokens);
  const diagnostics: DiagnosticSpec[] = [];

  if (isKeyword(property, "font")) {
    // D-51: `the page font is "Lora"`
    if (rest.length === 1 && rest[0]!.kind === "string" && String(rest[0]!.value).trim() !== "") {
      return { statement: { type: "page-setting", property: "custom font", target: "page", name: String(rest[0]!.value).trim(), nameSpan: rest[0]!.span, span }, diagnostics };
    }
    const family = normalizeWords(rest);
    if (family === "sans serif" || family === "serif" || family === "monospace") {
      return {
        statement: {
          type: "page-setting",
          property: "font",
          value: family as FontFamily,
          span,
        },
        diagnostics,
      };
    }
    diagnostics.push({
      code: "KDM3005",
      message: `invalid page font ${JSON.stringify(describeTokens(rest))}`,
      span: rest.length > 0 ? spanFromTokens(rest) : span,
      hint: 'use sans serif, serif, monospace, or a font name in quotes: the page font is "Lora"',
    });
    return { statement: null, diagnostics };
  }

  let color: ColorValue | null = null;
  if (rest.length !== 1) {
    diagnostics.push({
      code: "KDM3005",
      message: `page ${property!.text.toLowerCase()} expects exactly one color`,
      span: rest.length > 0 ? spanFromTokens(rest) : span,
      hint: "use a CSS named color or a #RGB/#RRGGBB hex literal",
    });
  } else {
    color = readColor(rest[0]!);
    if (color === null) diagnostics.push(colorDiagnostic(rest[0]!));
  }

  if (color === null) return { statement: null, diagnostics };
  const statement: PageSettingNode = {
    type: "page-setting",
    property: property!.text.toLowerCase() as "background" | "text",
    value: color,
    span,
  };
  return { statement, diagnostics };
}

export function matchText(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "the")) return null;

  let nounToken: Token | undefined;
  let valueIndex: number;
  if (isKeyword(tokens[1], "text") && isKeyword(tokens[2], "says")) {
    nounToken = tokens[1];
    valueIndex = 3;
  } else if (isKeyword(tokens[2], "text") && isKeyword(tokens[3], "says")) {
    nounToken = tokens[1];
    valueIndex = 4;
  } else {
    return null;
  }

  const span = spanFromTokens(tokens);
  const diagnostics: DiagnosticSpec[] = [];
  const valueToken = tokens[valueIndex];
  const nounText = nounToken?.text.toLowerCase() ?? "text";
  const allowedNouns = new Set(["text", "button", "link", "heading", "paragraph"]);
  const statementNoun = allowedNouns.has(nounText) ? nounText : null;

  if (statementNoun === null) {
    diagnostics.push({
      code: "KDM3003",
      message: `text statements do not use the noun ${JSON.stringify(nounText)}`,
      span: nounToken?.span ?? span,
      hint: "use text, button text, link text, heading text, or paragraph text",
    });
  }

  if (valueToken === undefined) {
    diagnostics.push({
      code: "KDM3005",
      message: "text statement requires a quoted string",
      span,
      hint: 'for example: the text says "Hello"',
    });
    return { statement: null, diagnostics };
  }
  if (!isString(valueToken)) {
    diagnostics.push({
      code: "KDM3005",
      message: `expected a quoted string, found ${JSON.stringify(valueToken.text)}`,
      span: valueToken.span,
      hint: "wrap the text in double quotes",
    });
    return { statement: null, diagnostics };
  }
  if (valueIndex + 1 < tokens.length) {
    diagnostics.push({
      code: "KDM2010",
      message: "unexpected text after the quoted string",
      span: spanFromTokens(tokens.slice(valueIndex + 1)),
    });
    return { statement: null, diagnostics };
  }
  if (statementNoun === null) return { statement: null, diagnostics };

  const statement: TextStatement = {
    type: "text",
    noun: statementNoun as TextStatement["noun"],
    value: valueToken.value,
    valueSpan: valueToken.span,
    span,
  };
  return { statement, diagnostics };
}

const WEIGHTS: ReadonlySet<string> = new Set([
  "light",
  "regular",
  "medium",
  "semibold",
  "bold",
]);

export function matchTypography(tokens: readonly Token[]): StatementMatchBody | null {
  if (
    !isKeyword(tokens[0], "the") ||
    !isKeyword(tokens[1], "text") ||
    !isKeyword(tokens[2], "is")
  ) {
    return null;
  }
  // kadam 0.3: `the text is between 1rem and 2rem` is fluid text.
  if (isFluidText(tokens)) return null;
  // kadam 0.3: decoration, case, and line length have their own template.
  if (isF3Text(tokens)) return null;

  const rest = tokens.slice(3);
  const span = spanFromTokens(tokens);
  const diagnostics: DiagnosticSpec[] = [];
  const first = rest[0];

  if (first === undefined) {
    diagnostics.push({
      code: "KDM3005",
      message: "typography statement requires a value",
      span,
      hint: "use a size, color, weight, italic, or alignment",
    });
    return { statement: null, diagnostics };
  }

  if (rest.length === 1) {
    const reference = readPlaceholderReference(first);
    if (reference !== null) {
      return {
        statement: { type: "typography", property: "reference", value: reference, span },
        diagnostics,
      };
    }
    const color = readColorArgument(first);
    if (color !== null) {
      return {
        statement: { type: "typography", property: "color", value: color, span },
        diagnostics,
      };
    }
    const length = readLengthArgument(first);
    if (length !== null) {
      return {
        statement: { type: "typography", property: "size", value: length, span },
        diagnostics,
      };
    }
    if (first.kind === "number") {
      diagnostics.push(lengthDiagnostic(first));
      return { statement: null, diagnostics };
    }
    if (first.kind === "hex-color") {
      diagnostics.push(colorDiagnostic(first));
      return { statement: null, diagnostics };
    }
    const word = first.text.toLowerCase();
    if (WEIGHTS.has(word)) {
      return {
        statement: {
          type: "typography",
          property: "weight",
          value: word as FontWeight,
          span,
        },
        diagnostics,
      };
    }
    if (word === "italic") {
      return {
        statement: { type: "typography", property: "style", value: "italic", span },
        diagnostics,
      };
    }
    if (word === "centered") {
      return {
        statement: { type: "typography", property: "align", value: "center", span },
        diagnostics,
      };
    }
    diagnostics.push({
      code: "KDM3005",
      message: `invalid text value ${JSON.stringify(first.text)}`,
      span: first.span,
      hint:
        "use a length, color, weight (light/regular/medium/semibold/bold), italic, or alignment",
    });
    return { statement: null, diagnostics };
  }

  if (rest.length === 2) {
    const alignment = normalizeWords(rest);
    if (alignment === "left aligned" || alignment === "right aligned") {
      return {
        statement: {
          type: "typography",
          property: "align",
          value: alignment.startsWith("left") ? "left" : "right",
          span,
        },
        diagnostics,
      };
    }
  }

  diagnostics.push({
    code: "KDM3005",
    message: `invalid typography value ${JSON.stringify(describeTokens(rest))}`,
    span: spanFromTokens(rest),
    hint:
      "use a length, color, weight, italic, centered, left aligned, or right aligned",
  });
  return { statement: null, diagnostics };
}

export function matchFont(tokens: readonly Token[]): StatementMatchBody | null {
  if (
    !isKeyword(tokens[0], "the") ||
    !isKeyword(tokens[1], "font") ||
    !isKeyword(tokens[2], "is")
  ) {
    return null;
  }
  // kadam 0.3: `the font is "Inter"` is a custom font.
  if (isString(tokens[3])) return null;
  const rest = tokens.slice(3);
  const span = spanFromTokens(tokens);
  const family = normalizeWords(rest);
  if (family === "sans serif" || family === "serif" || family === "monospace") {
    return {
      statement: {
        type: "font-family",
        value: family as FontFamily,
        span,
      },
      diagnostics: [],
    };
  }
  return {
    statement: null,
    diagnostics: [
      {
        code: "KDM3005",
        message: `invalid font family ${JSON.stringify(describeTokens(rest))}`,
        span: rest.length > 0 ? spanFromTokens(rest) : span,
        hint: "use sans serif, serif, or monospace",
      },
    ],
  };
}

export function matchSizeState(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "is")) return null;
  // kadam 0.3 states (checked, disabled, character limits) have their own template.
  if (isF1State(tokens)) return null;
  // kadam 0.3 sizes, limits, and positions have their own templates.
  if (isF2State(tokens)) return null;
  if (isF3State(tokens)) return null;
  // kadam 0.3 (F8): it is grayscale | it is sepia | it is shaped like a circle
  if (/^(grayscale|greyscale|sepia|shaped)$/.test(tokens[2]?.text.toLowerCase() ?? "") && tokens[0]?.text.toLowerCase() === "it") return null;
  // kadam 0.3 (F4): `it is hidden unless ...` is a binding.
  if (isVisibilityBinding(tokens)) return null;
  const rest = tokens.slice(2);
  const span = spanFromTokens(tokens);
  const diagnostics: DiagnosticSpec[] = [];
  const first = rest[0];

  if (first === undefined) {
    diagnostics.push({
      code: "KDM3005",
      message: "state or size statement requires a value",
      span,
      hint: "use a size, hidden, decorative, or required",
    });
    return { statement: null, diagnostics };
  }

  if (isKeyword(first, "hidden")) {
    if (rest.length !== 1) {
      diagnostics.push(extraTokens(rest.slice(1)));
      return { statement: null, diagnostics };
    }
    return {
      statement: { type: "visibility", hidden: true, span },
      diagnostics,
    };
  }
  if (isKeyword(first, "decorative")) {
    if (rest.length !== 1) {
      diagnostics.push(extraTokens(rest.slice(1)));
      return { statement: null, diagnostics };
    }
    return { statement: { type: "decorative", span }, diagnostics };
  }
  if (isKeyword(first, "required")) {
    if (rest.length !== 1) {
      diagnostics.push(extraTokens(rest.slice(1)));
      return { statement: null, diagnostics };
    }
    return { statement: { type: "required", span }, diagnostics };
  }

  if (isKeyword(first, "full")) {
    if (rest.length !== 2 || (!isKeyword(rest[1], "width") && !isKeyword(rest[1], "height"))) {
      diagnostics.push({
        code: "KDM3005",
        message: "expected full width or full height",
        span: spanFromTokens(rest),
        hint: "use it is full width or it is full height",
      });
      return { statement: null, diagnostics };
    }
    return {
      statement: {
        type: "size",
        mode: isKeyword(rest[1], "width") ? "full-width" : "full-height",
        span,
      },
      diagnostics,
    };
  }

  const width = readLengthArgument(first);
  if (width !== null) {
    if (rest.length === 1) {
      diagnostics.push({
        code: "KDM3005",
        message: "a single length must say wide or tall",
        span: first.span,
        hint: "use it is 160px wide or it is 160px by 48px",
      });
      return { statement: null, diagnostics };
    }
    const second = rest[1]!;
    if (isKeyword(second, "wide") || isKeyword(second, "tall")) {
      if (rest.length !== 2) {
        diagnostics.push(extraTokens(rest.slice(2)));
        return { statement: null, diagnostics };
      }
      const statement: SizeStatement = {
        type: "size",
        mode: isKeyword(second, "wide") ? "width" : "height",
        ...(isKeyword(second, "wide") ? { width } : { height: width }),
        span,
      };
      return { statement, diagnostics };
    }
    if (isKeyword(second, "by")) {
      const heightToken = rest[2];
      if (heightToken === undefined) {
        diagnostics.push({
          code: "KDM3005",
          message: "missing height after by",
          span: second.span,
          hint: "use it is 160px by 48px",
        });
        return { statement: null, diagnostics };
      }
      const height = readLengthArgument(heightToken);
      if (height === null) diagnostics.push(lengthDiagnostic(heightToken));
      if (rest.length > 3) diagnostics.push(extraTokens(rest.slice(3)));
      if (height === null || rest.length > 3) return { statement: null, diagnostics };
      return {
        statement: { type: "size", mode: "both", width, height, span },
        diagnostics,
      };
    }
    diagnostics.push({
      code: "KDM3005",
      message: `expected wide, tall, or by after the length`,
      span: second.span,
      hint: "use it is 160px wide, it is 48px tall, or it is 160px by 48px",
    });
    return { statement: null, diagnostics };
  }

  if (first.kind === "number") {
    diagnostics.push(lengthDiagnostic(first));
    return { statement: null, diagnostics };
  }

  diagnostics.push({
    code: "KDM3005",
    message: `invalid state or size value ${JSON.stringify(describeTokens(rest))}`,
    span: spanFromTokens(rest),
    hint: "use a length, full width, full height, hidden, decorative, or required",
  });
  return { statement: null, diagnostics };
}

export function matchSpacing(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "has")) return null;
  const property = tokens[3];
  if (!isKeyword(property, "padding") && !isKeyword(property, "margin")) {
    return null;
  }

  const rest = tokens.slice(2);
  const span = spanFromTokens(tokens);
  const diagnostics: DiagnosticSpec[] = [];
  const lengthToken = rest[0]!;
  const length = readLengthArgument(lengthToken);
  if (length === null) {
    diagnostics.push(lengthDiagnostic(lengthToken));
    return { statement: null, diagnostics };
  }

  const parsed = parseSides(rest, 2);
  diagnostics.push(...parsed.diagnostics);
  if (parsed.sides === null || parsed.diagnostics.length > 0) {
    return { statement: null, diagnostics };
  }
  const statement: SpacingStatement = {
    type: "spacing",
    property: isKeyword(property, "padding") ? "padding" : "margin",
    value: length,
    sides: parsed.sides,
    span,
  };
  return { statement, diagnostics };
}

export function matchGap(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "has")) return null;
  if (!isKeyword(tokens[3], "gap")) return null;

  const rest = tokens.slice(2);
  const span = spanFromTokens(tokens);
  const diagnostics: DiagnosticSpec[] = [];
  const lengthToken = rest[0]!;
  const length = readLengthArgument(lengthToken);
  if (length === null) {
    diagnostics.push(lengthDiagnostic(lengthToken));
    return { statement: null, diagnostics };
  }

  if (
    rest.length !== 4 ||
    !isKeyword(rest[2], "between") ||
    !isKeyword(rest[3], "children")
  ) {
    diagnostics.push({
      code: "KDM3005",
      message: "gap must be written as it has <length> gap between children",
      span: rest.length > 1 ? spanFromTokens(rest.slice(1)) : lengthToken.span,
      hint: "use it has 16px gap between children",
    });
    return { statement: null, diagnostics };
  }
  return {
    statement: { type: "layout", property: "gap", value: length, span },
    diagnostics,
  };
}

function parseSides(
  tokens: readonly Token[],
  start: number,
): {
  readonly sides: readonly Side[] | null;
  readonly diagnostics: readonly DiagnosticSpec[];
} {
  const diagnostics: DiagnosticSpec[] = [];
  if (start >= tokens.length) {
    return { sides: ["top", "right", "bottom", "left"], diagnostics };
  }
  if (!isKeyword(tokens[start], "on")) {
    diagnostics.push(extraTokens(tokens.slice(start)));
    return { sides: null, diagnostics };
  }

  let index = start + 1;
  if (isKeyword(tokens[index], "the")) index += 1;
  const firstToken = tokens[index];
  if (!isSide(firstToken)) {
    diagnostics.push({
      code: "KDM3005",
      message: "expected a side after on",
      span: firstToken?.span ?? tokens[tokens.length - 1]!.span,
      hint: "sides are top, right, bottom, and left",
    });
    return { sides: null, diagnostics };
  }
  index += 1;
  if (index >= tokens.length) {
    return { sides: [firstToken!.text.toLowerCase() as Side], diagnostics };
  }

  if (!isKeyword(tokens[index], "and")) {
    diagnostics.push(extraTokens(tokens.slice(index)));
    return { sides: null, diagnostics };
  }
  index += 1;
  const second = tokens[index];
  if (!isSide(second)) {
    diagnostics.push({
      code: "KDM3005",
      message: "expected a second side after and",
      span: second?.span ?? tokens[tokens.length - 1]!.span,
      hint: "pairs are left and right, or top and bottom",
    });
    return { sides: null, diagnostics };
  }
  index += 1;
  if (index < tokens.length) diagnostics.push(extraTokens(tokens.slice(index)));

  const firstSide = firstToken!.text.toLowerCase() as Side;
  const secondSide = second!.text.toLowerCase() as Side;
  const validPair =
    (firstSide === "left" && secondSide === "right") ||
    (firstSide === "top" && secondSide === "bottom");
  if (!validPair) {
    diagnostics.push({
      code: "KDM3005",
      message: `unsupported side pair ${firstSide} and ${secondSide}`,
      span: spanFromTokens(tokens.slice(start, index)),
      hint: "only left and right, or top and bottom, may be combined",
    });
    return { sides: null, diagnostics };
  }
  return { sides: [firstSide, secondSide], diagnostics };
}

function isSide(token: Token | undefined): boolean {
  return (
    isKeyword(token, "top") ||
    isKeyword(token, "right") ||
    isKeyword(token, "bottom") ||
    isKeyword(token, "left")
  );
}

export function matchLayoutDirection(
  tokens: readonly Token[],
): StatementMatchBody | null {
  if (
    !isKeyword(tokens[0], "it") ||
    !isKeyword(tokens[1], "arranges") ||
    !isKeyword(tokens[2], "its") ||
    !isKeyword(tokens[3], "children") ||
    !isKeyword(tokens[4], "in") ||
    !isKeyword(tokens[5], "a")
  ) {
    return null;
  }
  const span = spanFromTokens(tokens);
  const value = tokens[6];
  if (tokens.length !== 7 || (!isKeyword(value, "row") && !isKeyword(value, "column"))) {
    return {
      statement: null,
      diagnostics: [
        {
          code: "KDM3005",
          message: "layout direction must be row or column",
          span: value?.span ?? span,
          hint: "use it arranges its children in a row or in a column",
        },
      ],
    };
  }
  return {
    statement: {
      type: "layout",
      property: "direction",
      value: value!.text.toLowerCase() as "row" | "column",
      span,
    },
    diagnostics: [],
  };
}

export function matchLayoutAlign(tokens: readonly Token[]): StatementMatchBody | null {
  if (
    !isKeyword(tokens[0], "it") ||
    !isKeyword(tokens[1], "centers") ||
    !isKeyword(tokens[2], "its") ||
    !isKeyword(tokens[3], "children")
  ) {
    return null;
  }
  const span = spanFromTokens(tokens);
  if (tokens.length === 4) {
    return {
      statement: { type: "layout", property: "align", axis: "both", span },
      diagnostics: [],
    };
  }
  if (tokens.length === 5) {
    const axis = tokens[4];
    if (isKeyword(axis, "horizontally") || isKeyword(axis, "vertically")) {
      return {
        statement: {
          type: "layout",
          property: "align",
          axis: isKeyword(axis, "horizontally") ? "horizontal" : "vertical",
          span,
        },
        diagnostics: [],
      };
    }
  }
  return {
    statement: null,
    diagnostics: [
      {
        code: "KDM3005",
        message: "expected horizontally or vertically",
        span: tokens.length > 4 ? spanFromTokens(tokens.slice(4)) : span,
        hint: "use it centers its children horizontally or vertically",
      },
    ],
  };
}

export function matchImageSource(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "shows")) return null;
  // kadam 0.3: `it shows at most 2 lines` is truncation.
  if (tokens[2]?.text.toLowerCase() === "at") return null;
  // kadam 0.3 (F8): `it shows how far the page has scrolled`.
  if (tokens[2]?.text.toLowerCase() === "how") return null;
  // kadam 0.3: `it shows the document "content/intro.md"`.
  if (tokens[2]?.text.toLowerCase() === "the" && tokens[3]?.text.toLowerCase() === "document") return null;
  // kadam 0.3 (F8): `it shows the icon "arrow right"`.
  if (tokens[2]?.text.toLowerCase() === "the" && tokens[3]?.text.toLowerCase() === "icon") return null;
  const span = spanFromTokens(tokens);
  const value = tokens[2];
  if (tokens.length !== 3 || !isString(value)) {
    return {
      statement: null,
      diagnostics: [
        {
          code: "KDM3005",
          message: "image source requires one quoted path",
          span: value?.span ?? span,
          hint: 'for example: it shows "assets/hero.png"',
        },
      ],
    };
  }
  return {
    statement: { type: "image-source", value: value.value, valueSpan: value.span, span },
    diagnostics: [],
  };
}

/** kadam 0.3 (F5 step 4): `it shows the document "content/intro.md"`. */
export function matchDocumentSource(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "shows")) return null;
  if (tokens[2]?.text.toLowerCase() !== "the" || tokens[3]?.text.toLowerCase() !== "document") return null;
  const span = spanFromTokens(tokens);
  const value = tokens[4];
  if (tokens.length !== 5 || !isString(value) || !(value.value.endsWith(".md") || value.value.includes("{"))) {
    return {
      statement: null,
      diagnostics: [{ code: "KDM3005", message: "a document needs one quoted .md path", span: value?.span ?? span, hint: 'for example: it shows the document "content/intro.md"' }],
    };
  }
  return { statement: { type: "document-source", value: value.value, valueSpan: value.span, span }, diagnostics: [] };
}

export function matchImageDescription(
  tokens: readonly Token[],
): StatementMatchBody | null {
  if (
    !isKeyword(tokens[0], "the") ||
    !isKeyword(tokens[1], "description") ||
    !isKeyword(tokens[2], "says")
  ) {
    return null;
  }
  return matchStringStatement(tokens, "image-description");
}

export function matchFieldLabel(tokens: readonly Token[]): StatementMatchBody | null {
  if (
    !isKeyword(tokens[0], "the") ||
    !isKeyword(tokens[1], "label") ||
    !isKeyword(tokens[2], "says")
  ) {
    return null;
  }
  return matchStringStatement(tokens, "field-label");
}

export function matchFieldPlaceholder(
  tokens: readonly Token[],
): StatementMatchBody | null {
  if (
    !isKeyword(tokens[0], "the") ||
    !isKeyword(tokens[1], "placeholder") ||
    !isKeyword(tokens[2], "says")
  ) {
    return null;
  }
  return matchStringStatement(tokens, "field-placeholder");
}

function matchStringStatement(
  tokens: readonly Token[],
  type: "image-description" | "field-label" | "field-placeholder",
): StatementMatchBody {
  const span = spanFromTokens(tokens);
  const value = tokens[3];
  if (tokens.length !== 4 || !isString(value)) {
    return {
      statement: null,
      diagnostics: [
        {
          code: "KDM3005",
          message: `${tokens[1]!.text.toLowerCase()} requires one quoted string`,
          span: value?.span ?? span,
          hint: `for example: ${tokens[0]!.text} ${tokens[1]!.text} ${tokens[2]!.text} "value"`,
        },
      ],
    };
  }
  const statement: StatementNode =
    type === "image-description"
      ? { type, value: value.value, valueSpan: value.span, span }
      : { type, value: value.value, valueSpan: value.span, span };
  return { statement, diagnostics: [] };
}

const FIELD_TYPES: Readonly<Record<string, FieldType>> = {
  text: "text",
  "email addresses": "email",
  passwords: "password",
  numbers: "number",
};

export function matchFieldAccepts(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "it") || !isKeyword(tokens[1], "accepts")) return null;
  const rest = tokens.slice(2);
  const span = spanFromTokens(tokens);
  // kadam 0.3 field types have their own template.
  if (F1_FIELD_TYPES[normalizeWords(rest)] !== undefined) return null;
  const value = FIELD_TYPES[normalizeWords(rest)];
  if (value === undefined) {
    return {
      statement: null,
      diagnostics: [
        {
          code: "KDM3005",
          message: `invalid field type ${JSON.stringify(describeTokens(rest))}`,
          span: rest.length > 0 ? spanFromTokens(rest) : span,
          hint: "use text, email addresses, passwords, or numbers",
        },
      ],
    };
  }
  return { statement: { type: "field-type", value, span }, diagnostics: [] };
}

export function matchBackground(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "has")) return null;
  if (isF3Gradient(tokens)) return null;
  const last = tokens[tokens.length - 1];
  const span = spanFromTokens(tokens);

  if (isKeyword(tokens[1], "no") && isKeyword(last, "background")) {
    if (tokens.length !== 3) {
      return { statement: null, diagnostics: [extraTokens(tokens.slice(3))] };
    }
    return { statement: { type: "background", mode: "none", span }, diagnostics: [] };
  }

  if (isKeyword(tokens[1], "a") && isKeyword(last, "background")) {
    if (tokens.length !== 4) {
      return {
        statement: null,
        diagnostics: [
          {
            code: "KDM3005",
            message: "solid background expects exactly one color",
            span,
            hint: "use has a blue background, or has a blue and black gradient",
          },
        ],
      };
    }
    const color = readColorArgument(tokens[2]);
    if (color === null) {
      return { statement: null, diagnostics: [colorDiagnostic(tokens[2]!)] };
    }
    return { statement: { type: "background", mode: "solid", color, span }, diagnostics: [] };
  }

  if (isKeyword(tokens[1], "a") && isKeyword(last, "gradient")) {
    if (tokens.length !== 6 || (!isKeyword(tokens[3], "and") && !isKeyword(tokens[3], "to"))) {
      return {
        statement: null,
        diagnostics: [
          {
            code: "KDM3005",
            message: "gradient expects two colors separated by and or to",
            span,
            hint: "use has a blue and black gradient",
          },
        ],
      };
    }
    const from = readColorArgument(tokens[2]);
    const to = readColorArgument(tokens[4]);
    const diagnostics: DiagnosticSpec[] = [];
    if (from === null) diagnostics.push(colorDiagnostic(tokens[2]!));
    if (to === null) diagnostics.push(colorDiagnostic(tokens[4]!));
    if (from === null || to === null) return { statement: null, diagnostics };
    return {
      statement: {
        type: "background",
        mode: "gradient",
        from,
        to,
        conjunction: tokens[3]!.text.toLowerCase() as "and" | "to",
        span,
      },
      diagnostics,
    };
  }

  return null;
}

export function matchBorder(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "has") || !isKeyword(tokens[tokens.length - 1], "border")) {
    return null;
  }
  if (isF3Border(tokens)) return null;
  const span = spanFromTokens(tokens);
  const diagnostics: DiagnosticSpec[] = [];

  if (isKeyword(tokens[1], "no")) {
    if (tokens.length !== 3) {
      return { statement: null, diagnostics: [extraTokens(tokens.slice(3))] };
    }
    return { statement: { type: "border", mode: "none", span }, diagnostics };
  }

  if (!isKeyword(tokens[1], "a")) return null;

  if (tokens.length === 4) {
    const color = readColorArgument(tokens[2]);
    if (color === null) diagnostics.push(colorDiagnostic(tokens[2]!));
    if (color === null) return { statement: null, diagnostics };
    return {
      statement: {
        type: "border",
        mode: "solid",
        width: { type: "length", value: 1, unit: "px", raw: "1px" },
        color,
        span,
      },
      diagnostics,
    };
  }

  if (tokens.length === 5) {
    const width = readLengthArgument(tokens[2]);
    const color = readColorArgument(tokens[3]);
    if (width === null) diagnostics.push(lengthDiagnostic(tokens[2]!));
    if (color === null) diagnostics.push(colorDiagnostic(tokens[3]!));
    if (width === null || color === null) return { statement: null, diagnostics };
    return {
      statement: { type: "border", mode: "solid", width, color, span },
      diagnostics,
    };
  }

  diagnostics.push({
    code: "KDM3005",
    message: "border expects a color, optionally preceded by a width",
    span,
    hint: "use has a white border or has a 2px white border",
  });
  return { statement: null, diagnostics };
}

export function matchCorners(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "has") || !isKeyword(tokens[tokens.length - 1], "corners")) {
    return null;
  }
  if (isF3Corners(tokens)) return null;
  const span = spanFromTokens(tokens);
  const diagnostics: DiagnosticSpec[] = [];

  if (tokens.length === 3 && isKeyword(tokens[1], "rounded")) {
    return { statement: { type: "corners", mode: "default", span }, diagnostics };
  }
  if (
    tokens.length === 4 &&
    isKeyword(tokens[1], "fully") &&
    isKeyword(tokens[2], "rounded")
  ) {
    return { statement: { type: "corners", mode: "full", span }, diagnostics };
  }
  if (tokens.length === 4 && isKeyword(tokens[2], "rounded")) {
    const radius = readLengthArgument(tokens[1]);
    if (radius === null) {
      diagnostics.push(lengthDiagnostic(tokens[1]!));
      return { statement: null, diagnostics };
    }
    return { statement: { type: "corners", mode: "custom", radius, span }, diagnostics };
  }

  diagnostics.push({
    code: "KDM3005",
    message: "invalid corner statement",
    span,
    hint: "use has rounded corners, has 12px rounded corners, or has fully rounded corners",
  });
  return { statement: null, diagnostics };
}

export function matchShadow(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "has") || !isKeyword(tokens[tokens.length - 1], "shadow")) {
    return null;
  }
  if (isF3Shadow(tokens)) return null;
  const span = spanFromTokens(tokens);
  const diagnostics: DiagnosticSpec[] = [];

  if (isKeyword(tokens[1], "no")) {
    if (tokens.length !== 3) {
      return { statement: null, diagnostics: [extraTokens(tokens.slice(3))] };
    }
    return { statement: { type: "shadow", preset: "none", span }, diagnostics };
  }

  if (tokens.length === 4 && isKeyword(tokens[1], "a")) {
    const preset = tokens[2]!.text.toLowerCase();
    if (preset === "soft" || preset === "medium" || preset === "strong") {
      return {
        statement: { type: "shadow", preset: preset as "soft" | "medium" | "strong", span },
        diagnostics,
      };
    }
  }

  diagnostics.push({
    code: "KDM3005",
    message: "shadow expects a preset",
    span,
    hint: "use soft, medium, strong, or has no shadow",
  });
  return { statement: null, diagnostics };
}

export function matchGradientDirection(
  tokens: readonly Token[],
): StatementMatchBody | null {
  if (
    !isKeyword(tokens[0], "the") ||
    !isKeyword(tokens[1], "gradient") ||
    !isKeyword(tokens[2], "goes") ||
    !isKeyword(tokens[3], "from")
  ) {
    return null;
  }
  const span = spanFromTokens(tokens);
  const rest = tokens.slice(4);
  const direction = normalizeWords(rest);
  if (
    direction === "left to right" ||
    direction === "right to left" ||
    direction === "top to bottom" ||
    direction === "bottom to top"
  ) {
    return {
      statement: {
        type: "gradient-direction",
        direction,
        span,
      },
      diagnostics: [],
    };
  }
  return {
    statement: null,
    diagnostics: [
      {
        code: "KDM3005",
        message: `invalid gradient direction ${JSON.stringify(describeTokens(rest))}`,
        span: rest.length > 0 ? spanFromTokens(rest) : span,
        hint: "use left to right, right to left, top to bottom, or bottom to top",
      },
    ],
  };
}
