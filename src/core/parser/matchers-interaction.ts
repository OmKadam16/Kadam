import type {
  ClickStatement,
  DurationValue,
  HoverEffect,
  HoverStatement,
  MotionStatement,
} from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Span } from "../source/source-file.js";
import type { Token } from "../lexer/token.js";
import type { StatementMatchBody } from "./statement-types.js";
import { isEffectList, isF4ClickAction } from "./matchers-f4.js";
import {
  colorDiagnostic,
  describeTokens,
  durationDiagnostic,
  extraTokens,
  isKeyword,
  isString,
  lengthDiagnostic,
  percentageDiagnostic,
  readColor,
  readColorArgument,
  readDuration,
  readLengthArgument,
  readPercentage,
  spanFromTokens,
} from "./values.js";

/** `when hovered, <effect> [over <duration>]` */
export function matchHover(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "when") || !isKeyword(tokens[1], "hovered")) {
    return null;
  }
  // kadam 0.3: `when hovered, it rotates by 10deg` is an F3 state sentence.
  if (isKeyword(tokens[3], "it") && tokens[4]?.text.toLowerCase() === "rotates") return null;
  const span = spanFromTokens(tokens);
  if (!isComma(tokens[2])) {
    return {
      statement: null,
      diagnostics: [
        {
          code: "KDM2010",
          message: "a comma is required after when hovered",
          span: tokens[2]?.span ?? span,
          hint: "write: when hovered, the background turns blue",
        },
      ],
    };
  }

  const rest = tokens.slice(3);
  const diagnostics: DiagnosticSpec[] = [];
  const effect = parseHoverEffect(rest, span, diagnostics);
  if (effect === null) return { statement: null, diagnostics };

  const duration = parseOptionalDuration(rest, effect.length, diagnostics);
  if (diagnostics.length > 0) return { statement: null, diagnostics };

  const statement: HoverStatement = {
    type: "hover",
    effect: effect.effect,
    ...(duration === undefined ? {} : { duration }),
    span,
  };
  return { statement, diagnostics };
}

type HoverEffectResult = {
  readonly effect: HoverEffect;
  /** Number of tokens consumed by the effect, before `over <duration>`. */
  readonly length: number;
};

export function parseHoverEffect(
  tokens: readonly Token[],
  fallbackSpan: Span,
  diagnostics: DiagnosticSpec[],
): HoverEffectResult | null {
  if (
    isKeyword(tokens[0], "the") &&
    (isKeyword(tokens[1], "background") ||
      isKeyword(tokens[1], "text") ||
      isKeyword(tokens[1], "border")) &&
    isKeyword(tokens[2], "turns")
  ) {
    const valueToken = tokens[3];
    if (valueToken === undefined) {
      diagnostics.push({
        code: "KDM3005",
        message: `hover ${tokens[1]!.text.toLowerCase()} effect requires a color`,
        span: spanFromTokens(tokens.slice(0, 3)),
        hint: "use a CSS named color or a #RGB/#RRGGBB hex literal",
      });
      return null;
    }
    const color = readColorArgument(valueToken);
    if (color === null) {
      diagnostics.push(colorDiagnostic(valueToken));
      return null;
    }
    const type = tokens[1]!.text.toLowerCase() as "background" | "text" | "border";
    return {
      effect: type === "background"
        ? { type: "background", color }
        : type === "text"
          ? { type: "text", color }
          : { type: "border", color },
      length: 4,
    };
  }

  if (
    isKeyword(tokens[0], "it") &&
    isKeyword(tokens[1], "lifts") &&
    isKeyword(tokens[2], "by")
  ) {
    const valueToken = tokens[3];
    if (valueToken === undefined) {
      diagnostics.push({
        code: "KDM3005",
        message: "hover lift requires a length",
        span: spanFromTokens(tokens.slice(0, 3)),
        hint: "use a length such as 2px",
      });
      return null;
    }
    const distance = readLengthArgument(valueToken);
    if (distance === null) {
      diagnostics.push(lengthDiagnostic(valueToken));
      return null;
    }
    const effect: HoverEffect = { type: "lift", distance };
    return { effect, length: 4 };
  }

  if (
    isKeyword(tokens[0], "it") &&
    isKeyword(tokens[1], "scales") &&
    isKeyword(tokens[2], "to")
  ) {
    const valueToken = tokens[3];
    if (valueToken === undefined) {
      diagnostics.push({
        code: "KDM3005",
        message: "hover scale requires a percentage",
        span: spanFromTokens(tokens.slice(0, 3)),
        hint: "use a value from 100% to 200%",
      });
      return null;
    }
    const percentage = readPercentage(valueToken);
    if (percentage === null || percentage.value < 100 || percentage.value > 200) {
      diagnostics.push(percentageDiagnostic(valueToken));
      return null;
    }
    const effect: HoverEffect = { type: "scale", percentage };
    return { effect, length: 4 };
  }

  diagnostics.push({
    code: "KDM3005",
    message: `invalid hover effect ${JSON.stringify(describeTokens(tokens))}`,
    span: tokens.length > 0 ? spanFromTokens(tokens) : fallbackSpan,
    hint:
      "use the background/text/border turns form, it lifts by <length>, or it scales to <percentage>",
  });
  return null;
}

/** `when clicked, go to page <title>` or `when clicked, open <url> in a new tab` */
export function matchClick(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "when") || !isKeyword(tokens[1], "clicked")) {
    return null;
  }
  const span = spanFromTokens(tokens);
  if (!isComma(tokens[2])) {
    return {
      statement: null,
      diagnostics: [
        {
          code: "KDM2010",
          message: "a comma is required after when clicked",
          span: tokens[2]?.span ?? span,
          hint: 'write: when clicked, go to page "About"',
        },
      ],
    };
  }

  const rest = tokens.slice(3);
  const diagnostics: DiagnosticSpec[] = [];
  // kadam 0.3 (F4): in-page, email, phone, and download links.
  if (isF4ClickAction(rest) || isEffectList(rest)) return null;

  if (isKeyword(rest[0], "go") && isKeyword(rest[1], "to") && isKeyword(rest[2], "page")) {
    const target = rest[3];
    if (rest.length !== 4 || !isString(target)) {
      diagnostics.push({
        code: "KDM3005",
        message: "navigation requires one quoted page title",
        span: target?.span ?? span,
        hint: 'for example: when clicked, go to page "About"',
      });
      return { statement: null, diagnostics };
    }
    if (target.value.length === 0) {
      diagnostics.push({
        code: "KDM3005",
        message: "a navigation target cannot be empty",
        span: target.span,
        hint: "use the exact title of a page in the project",
      });
      return { statement: null, diagnostics };
    }
    const statement: ClickStatement = {
      type: "click",
      action: {
        type: "navigate",
        pageTitle: target.value,
        pageTitleSpan: target.span,
      },
      span,
    };
    return { statement, diagnostics };
  }

  if (isKeyword(rest[0], "open")) {
    const target = rest[1];
    const wellFormed =
      rest.length === 6 &&
      isKeyword(rest[2], "in") &&
      isKeyword(rest[3], "a") &&
      isKeyword(rest[4], "new") &&
      isKeyword(rest[5], "tab");
    if (!wellFormed || !isString(target)) {
      diagnostics.push({
        code: "KDM3005",
        message: "external navigation must be written as open <url> in a new tab",
        span: target?.span ?? span,
        hint: 'for example: when clicked, open "https://example.com" in a new tab',
      });
      return { statement: null, diagnostics };
    }
    // A component parameter may stand in for the whole URL. The component
    // layer checks that the placeholder names a `url` parameter; page-owned
    // URLs must stay literal.
    const isParameter = /^\{\$[a-z][A-Za-z0-9]{0,63}\}$/.test(target.value);
    if (!isAbsoluteHttpUrl(target.value) && !isParameter) {
      diagnostics.push({
        code: "KDM3005",
        message: `external URL ${JSON.stringify(target.value)} is not an absolute http or https URL`,
        span: target.span,
        hint: "use an absolute URL with a host, such as https://example.com",
      });
      return { statement: null, diagnostics };
    }
    const statement: ClickStatement = {
      type: "click",
      action: { type: "external", url: target.value, urlSpan: target.span },
      span,
    };
    return { statement, diagnostics };
  }

  diagnostics.push({
    code: "KDM3005",
    message: "click action must be navigation or an external link",
    span: rest.length > 0 ? spanFromTokens(rest) : span,
    hint:
      'use when clicked, go to page "About" or when clicked, open "https://example.com" in a new tab',
  });
  return { statement: null, diagnostics };
}

/** `it fades in ...` or `it slides in from <side> ...` */
export function matchMotion(tokens: readonly Token[]): StatementMatchBody | null {
  if (!isKeyword(tokens[0], "it")) return null;
  // kadam 0.3: `... when it scrolls into view` is an F3 scroll entrance.
  if (endsWithScrollIntoView(tokens)) return null;

  const span = spanFromTokens(tokens);
  const diagnostics: DiagnosticSpec[] = [];
  let effect: "fade" | "slide";
  let direction: "left" | "right" | "top" | "bottom" | undefined;
  let index: number;

  if (isKeyword(tokens[1], "fades")) {
    if (!isKeyword(tokens[2], "in")) return null;
    effect = "fade";
    index = 3;
  } else if (isKeyword(tokens[1], "slides")) {
    if (
      !isKeyword(tokens[2], "in") ||
      !isKeyword(tokens[3], "from") ||
      !isKeyword(tokens[4], "the")
    ) {
      return null;
    }
    const side = tokens[5];
    if (
      !isKeyword(side, "left") &&
      !isKeyword(side, "right") &&
      !isKeyword(side, "top") &&
      !isKeyword(side, "bottom")
    ) {
      return {
        statement: null,
        diagnostics: [
          {
            code: "KDM3005",
            message: "slide direction must be left, right, top, or bottom",
            span: side?.span ?? span,
            hint: "use it slides in from the left when the page loads",
          },
        ],
      };
    }
    effect = "slide";
    direction = side!.text.toLowerCase() as "left" | "right" | "top" | "bottom";
    index = 6;
  } else {
    return null;
  }

  let duration: DurationValue | undefined;
  if (isKeyword(tokens[index], "over")) {
    const durationToken = tokens[index + 1];
    if (durationToken === undefined) {
      diagnostics.push({
        code: "KDM3005",
        message: "missing duration after over",
        span: tokens[index]!.span,
        hint: "use a duration such as 400ms",
      });
      return { statement: null, diagnostics };
    }
    const parsed = readDuration(durationToken);
    if (parsed === null || parsed.value <= 0) {
      diagnostics.push(durationDiagnostic(durationToken));
      return { statement: null, diagnostics };
    }
    duration = parsed;
    index += 2;
  }

  const hasLoadClause =
    isKeyword(tokens[index], "when") &&
    isKeyword(tokens[index + 1], "the") &&
    isKeyword(tokens[index + 2], "page") &&
    isKeyword(tokens[index + 3], "loads");
  if (!hasLoadClause) {
    diagnostics.push({
      code: "KDM3005",
      message: "entrance animation must end with when the page loads",
      span:
        tokens[index] === undefined
          ? span
          : spanFromTokens(tokens.slice(index)),
      hint: "write: it fades in over 600ms when the page loads",
    });
    return { statement: null, diagnostics };
  }
  index += 4;
  if (index < tokens.length) {
    diagnostics.push(extraTokens(tokens.slice(index)));
    return { statement: null, diagnostics };
  }

  const statement: MotionStatement = {
    type: "motion",
    effect,
    ...(direction === undefined ? {} : { direction }),
    ...(duration === undefined ? {} : { duration }),
    span,
  };
  return { statement, diagnostics };
}

export function parseOptionalDuration(
  tokens: readonly Token[],
  index: number,
  diagnostics: DiagnosticSpec[],
): DurationValue | undefined {
  if (index >= tokens.length) return undefined;
  if (!isKeyword(tokens[index], "over")) {
    diagnostics.push(extraTokens(tokens.slice(index)));
    return undefined;
  }
  const durationToken = tokens[index + 1];
  if (durationToken === undefined) {
    diagnostics.push({
      code: "KDM3005",
      message: "missing duration after over",
      span: tokens[index]!.span,
      hint: "use a duration such as 150ms",
    });
    return undefined;
  }
  const duration = readDuration(durationToken);
  if (duration === null || duration.value <= 0) {
    diagnostics.push(durationDiagnostic(durationToken));
    return undefined;
  }
  if (index + 2 < tokens.length) {
    diagnostics.push(extraTokens(tokens.slice(index + 2)));
    return undefined;
  }
  return duration;
}

/** `... when it scrolls into view` (kadam 0.3). */
export function endsWithScrollIntoView(tokens: readonly Token[]): boolean {
  const tail = tokens.slice(-5).map((token) => token.text.toLowerCase()).join(" ");
  return tail === "when it scrolls into view";
}

function isComma(token: Token | undefined): boolean {
  return token?.kind === "comma";
}

export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}
