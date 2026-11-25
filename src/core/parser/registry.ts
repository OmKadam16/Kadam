import type {
  Breakpoint,
  PageSettingNode,
  ResponsiveStatement,
  StatementNode,
} from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Token } from "../lexer/token.js";
import type { Span } from "../source/source-file.js";
import {
  matchBackground,
  matchBorder,
  matchCorners,
  matchFieldAccepts,
  matchFieldLabel,
  matchFieldPlaceholder,
  matchFont,
  matchGradientDirection,
  matchImageDescription,
  matchImageSource,
  matchLayoutAlign,
  matchLayoutDirection,
  matchPageSetting,
  matchShadow,
  matchSizeState,
  matchSpacing,
  matchGap,
  matchText,
  matchTypography,
} from "./matchers-appearance.js";
import { matchClick, matchHover, matchMotion } from "./matchers-interaction.js";
import { matchKindStatement } from "./kind.js";
import { PROPERTIES, matchPropertySentence, propertyNamed } from "./properties.js";
import { closestMatches } from "./suggest.js";
import type {
  StatementMatchBody,
  StatementTemplate,
  TemplateContext,
} from "./statement-types.js";
import { describeTokens, isKeyword, spanFromTokens } from "./values.js";
import {
  LATEST_UI_LANGUAGE_VERSION,
  uiVersionAtLeast,
  type UiLanguageVersion,
} from "../../version.js";

export interface ResponsiveTemplate extends StatementTemplate {
  readonly id: "responsive";
}

const DEFAULT_CONTEXT: TemplateContext = { allowResponsive: true };

/**
 * The finite statement table. Each entry is one canonical family from the
 * language specification. A line must match exactly one entry; the parser
 * never picks a best candidate.
 */
export const STATEMENT_TEMPLATES: readonly StatementTemplate[] = [
  {
    id: "kind",
    description: "Element kind declaration",
    examples: [
      "a button",
      "an image that is 560px by 360px",
      "a text field",
      "a navigation bar",
    ],
    match: (tokens) => {
      const result = matchKindStatement(tokens);
      return result === null
        ? null
        : { statement: result.kind, diagnostics: result.diagnostics };
    },
  },
  {
    id: "page-background",
    description: "Page background color",
    examples: ["the page background is #F7F5F0"],
    match: (tokens) =>
      isKeyword(tokens[2], "background") ? matchPageSetting(tokens) : null,
  },
  {
    id: "page-text",
    description: "Page default text color",
    examples: ["the page text is #171717"],
    match: (tokens) =>
      isKeyword(tokens[2], "text") ? matchPageSetting(tokens) : null,
  },
  {
    id: "page-font",
    description: "Page default font family",
    examples: ["the page font is sans serif"],
    match: (tokens) =>
      isKeyword(tokens[2], "font") ? matchPageSetting(tokens) : null,
  },
  {
    id: "text",
    description: "Text content",
    examples: [
      'the text says "Get Started"',
      'the button text says "Get Started"',
      'the heading text says "Welcome"',
    ],
    match: (tokens) => matchText(tokens),
  },
  {
    id: "size-state",
    description: "Size, visibility, decorative, or required state",
    examples: [
      "it is 160px by 48px",
      "it is 160px wide",
      "it is full width",
      "it is hidden",
      "it is decorative",
      "it is required",
    ],
    match: (tokens) => matchSizeState(tokens),
  },
  {
    id: "background",
    description: "Solid, absent, or gradient background",
    examples: [
      "has a blue background",
      "has no background",
      "has a blue and black gradient",
    ],
    match: (tokens) => matchBackground(tokens),
  },
  {
    id: "gradient-direction",
    description: "Gradient direction",
    examples: ["the gradient goes from left to right"],
    match: (tokens) => matchGradientDirection(tokens),
  },
  {
    id: "border",
    description: "Border",
    examples: ["has a white border", "has a 2px white border", "has no border"],
    match: (tokens) => matchBorder(tokens),
  },
  {
    id: "corners",
    description: "Corner radius",
    examples: [
      "has rounded corners",
      "has 12px rounded corners",
      "has fully rounded corners",
    ],
    match: (tokens) => matchCorners(tokens),
  },
  {
    id: "shadow",
    description: "Shadow preset",
    examples: ["has a soft shadow", "has a medium shadow", "has no shadow"],
    match: (tokens) => matchShadow(tokens),
  },
  {
    id: "typography",
    description: "Text typography",
    examples: [
      "the text is 18px",
      "the text is blue",
      "the text is semibold",
      "the text is italic",
      "the text is centered",
      "the text is left aligned",
    ],
    match: (tokens) => matchTypography(tokens),
  },
  {
    id: "font-family",
    description: "Font family preset",
    examples: ["the font is sans serif"],
    match: (tokens) => matchFont(tokens),
  },
  {
    id: "spacing",
    description: "Padding or margin",
    examples: [
      "it has 24px padding",
      "it has 16px padding on the left",
      "it has 16px padding on the left and right",
      "it has 32px margin",
      "it has 16px margin on top and bottom",
    ],
    match: (tokens) => matchSpacing(tokens),
  },
  {
    id: "layout-direction",
    description: "Child layout direction",
    examples: ["it arranges its children in a row"],
    match: (tokens) => matchLayoutDirection(tokens),
  },
  {
    id: "layout-gap",
    description: "Gap between children",
    examples: ["it has 16px gap between children"],
    match: (tokens) => matchGap(tokens),
  },
  {
    id: "layout-align",
    description: "Alignment of children",
    examples: [
      "it centers its children",
      "it centers its children horizontally",
    ],
    match: (tokens) => matchLayoutAlign(tokens),
  },
  {
    id: "image-source",
    description: "Image source path",
    examples: ['it shows "assets/hero.png"'],
    match: (tokens) => matchImageSource(tokens),
  },
  {
    id: "image-description",
    description: "Image description",
    examples: ['the description says "A person using the Kadam editor"'],
    match: (tokens) => matchImageDescription(tokens),
  },
  {
    id: "field-label",
    description: "Text field label",
    examples: ['the label says "Email"'],
    match: (tokens) => matchFieldLabel(tokens),
  },
  {
    id: "field-placeholder",
    description: "Text field placeholder",
    examples: ['the placeholder says "you@example.com"'],
    match: (tokens) => matchFieldPlaceholder(tokens),
  },
  {
    id: "field-type",
    description: "Text field input type",
    examples: ["it accepts email addresses"],
    match: (tokens) => matchFieldAccepts(tokens),
  },
  {
    id: "hover",
    description: "Hover effect",
    examples: [
      "when hovered, the background turns blue",
      "when hovered, it lifts by 2px",
      "when hovered, it scales to 105%",
      "when hovered, the border turns black over 200ms",
    ],
    match: (tokens) => matchHover(tokens),
  },
  {
    id: "click",
    description: "Click action",
    examples: [
      'when clicked, go to page "About"',
      'when clicked, open "https://example.com" in a new tab',
    ],
    match: (tokens) => matchClick(tokens),
  },
  {
    id: "motion",
    description: "Entrance animation",
    examples: [
      "it fades in when the page loads",
      "it fades in over 600ms when the page loads",
      "it slides in from the left when the page loads",
    ],
    match: (tokens) => matchMotion(tokens),
  },
  {
    id: "property",
    description: "Regular property sentence",
    examples: PROPERTIES.map((property) => property.example),
    since: "0.3",
    match: (tokens) => matchPropertySentence(tokens),
  },
];

export const RESPONSIVE_TEMPLATE: ResponsiveTemplate = {
  id: "responsive",
  description: "Breakpoint-scoped statement",
  examples: [
    "on phones, the text is 24px",
    "on tablets, it has 16px padding",
    "on phones, it is hidden",
    "on desktops, it centers its children horizontally",
  ],
  // The registry handles the responsive prefix directly in `matchLine`.
  match: () => null,
};

const RESPONSIVE_ALLOWED: ReadonlySet<string> = new Set([
  "size",
  "background",
  "gradient-direction",
  "border",
  "corners",
  "shadow",
  "typography",
  "font-family",
  "spacing",
  "layout",
  "visibility",
  "property",
]);

const BREAKPOINTS: ReadonlySet<string> = new Set([
  "phones",
  "tablets",
  "desktops",
]);

export interface TemplateMatch {
  readonly template: StatementTemplate;
  readonly body: StatementMatchBody;
}

export interface MatchLineResult {
  /** All templates that claimed the line. More than one is a compiler defect. */
  readonly matches: readonly TemplateMatch[];
  /** Diagnostics produced by the selected template, or by matching itself. */
  readonly diagnostics: readonly DiagnosticSpec[];
  /** Present only when exactly one template matched. */
  readonly selected: TemplateMatch | null;
}

/**
 * Match one logical line. The template table is intentionally exhaustible so
 * tests can inject overlapping entries and prove ambiguity is never resolved.
 */
export function matchLine(
  tokens: readonly Token[],
  context: TemplateContext = DEFAULT_CONTEXT,
  templates: readonly StatementTemplate[] = STATEMENT_TEMPLATES,
): MatchLineResult {
  if (tokens.length === 0) {
    return { matches: [], diagnostics: [], selected: null };
  }

  if (context.allowResponsive && isKeyword(tokens[0], "on")) {
    return matchResponsiveLine(tokens, context, templates);
  }

  const matches = collectMatches(tokens, context, templates);

  if (matches.length === 0) {
    return {
      matches,
      diagnostics: [unrecognizedStatement(tokens)],
      selected: null,
    };
  }
  if (matches.length > 1) {
    return {
      matches,
      diagnostics: [ambiguousStatement(tokens, matches)],
      selected: null,
    };
  }
  return {
    matches,
    diagnostics: matches[0]!.body.diagnostics,
    selected: matches[0]!,
  };
}

function collectMatches(
  tokens: readonly Token[],
  context: TemplateContext,
  templates: readonly StatementTemplate[],
): TemplateMatch[] {
  const matches: TemplateMatch[] = [];
  const version = context.languageVersion ?? LATEST_UI_LANGUAGE_VERSION;
  for (const template of templates) {
    const body = template.match(tokens, context);
    if (body === null) continue;
    if (body.statement === null && body.diagnostics.length === 0) continue;
    const since = template.since ?? "0.1";
    if (!uiVersionAtLeast(version, since)) {
      // The line is well-formed newer syntax. Claim it (so it is not reported
      // as unrecognized) but reject it with an explicit version diagnostic.
      matches.push({
        template,
        body: {
          statement: null,
          diagnostics: [requiresVersion(tokens, constructName(template, tokens), since, version)],
        },
      });
      continue;
    }
    matches.push({ template, body });
  }
  return matches;
}

/** What a version diagnostic calls the construct: the property, if known. */
function constructName(template: StatementTemplate, tokens: readonly Token[]): string {
  if (template.id === "property") {
    const property = propertyNamed(tokens);
    if (property !== undefined) return `the ${property.name}`;
  }
  return template.description.toLowerCase();
}

function requiresVersion(
  tokens: readonly Token[],
  construct: string,
  since: UiLanguageVersion,
  version: UiLanguageVersion,
): DiagnosticSpec {
  return {
    code: "KDM2013",
    message: `${construct} requires kadam ${since}; this file is kadam ${version}`,
    span: spanFromTokens(tokens),
    hint: `put kadam ${since} on the first line of the file, or set "kadam": "${since}" in kadam.json`,
  };
}

function matchResponsiveLine(
  tokens: readonly Token[],
  context: TemplateContext,
  templates: readonly StatementTemplate[],
): MatchLineResult {
  const span = spanFromTokens(tokens);
  const scopeToken = tokens[1];
  const diagnostics: DiagnosticSpec[] = [];

  if (!isKeyword(scopeToken, "phones") &&
      !isKeyword(scopeToken, "tablets") &&
      !isKeyword(scopeToken, "desktops")) {
    diagnostics.push({
      code: "KDM3005",
      message: `invalid breakpoint ${JSON.stringify(scopeToken?.text ?? "")}`,
      span: scopeToken?.span ?? span,
      hint: "use phones, tablets, or desktops",
    });
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }

  const breakpoint = scopeToken!.text.toLowerCase() as Breakpoint;
  const comma = tokens[2];
  if (comma?.kind !== "comma") {
    diagnostics.push({
      code: "KDM2010",
      message: `a comma is required after on ${breakpoint}`,
      span: comma?.span ?? scopeToken!.span,
      hint: `write: on ${breakpoint}, it is hidden`,
    });
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }

  const innerTokens = tokens.slice(3);
  if (innerTokens.length === 0) {
    diagnostics.push({
      code: "KDM2010",
      message: `expected a statement after on ${breakpoint},`,
      span: comma.span,
      hint: "responsive statements wrap one ordinary element statement",
    });
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }

  if (isKeyword(innerTokens[0], "on")) {
    diagnostics.push({
      code: "KDM3013",
      message: "a responsive statement cannot be nested inside another responsive scope",
      span: spanFromTokens(innerTokens),
      hint: "use one breakpoint prefix per line",
    });
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }

  if (isKeyword(innerTokens[0], "a") || isKeyword(innerTokens[0], "an")) {
    diagnostics.push({
      code: "KDM3013",
      message: "kind declarations are not allowed in a responsive scope",
      span: spanFromTokens(innerTokens),
      hint: "declare the kind once, outside any breakpoint",
    });
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }

  const innerContext: TemplateContext = {
    allowResponsive: false,
    languageVersion: context.languageVersion,
  };
  const innerMatches = collectMatches(innerTokens, innerContext, templates);
  if (innerMatches.length === 0) {
    diagnostics.push(unrecognizedStatement(innerTokens));
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }
  if (innerMatches.length > 1) {
    diagnostics.push(ambiguousStatement(innerTokens, innerMatches));
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }

  const innerBody = innerMatches[0]!.body;
  diagnostics.push(...innerBody.diagnostics);
  const innerStatement = innerBody.statement;
  if (innerStatement === null) {
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }
  if (innerStatement.type === "page-setting") {
    diagnostics.push({
      code: "KDM3013",
      message: "page settings are not allowed in a responsive scope",
      span: innerStatement.span,
      hint: "page settings apply to the whole page; use an element statement",
    });
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }
  if (innerStatement.type === "kind") {
    diagnostics.push({
      code: "KDM3013",
      message: "kind declarations are not allowed in a responsive scope",
      span: innerStatement.span,
      hint: "declare the kind once, outside any breakpoint",
    });
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }
  if (!RESPONSIVE_ALLOWED.has(innerStatement.type)) {
    diagnostics.push({
      code: "KDM3013",
      message: `${innerStatement.type} statements are not allowed in a responsive scope`,
      span: innerStatement.span,
      hint:
        "responsive scopes allow size, background, border, corners, shadow, typography, spacing, layout, and visibility",
    });
    return {
      matches: [{ template: RESPONSIVE_TEMPLATE, body: { statement: null, diagnostics } }],
      diagnostics,
      selected: null,
    };
  }

  const statement: ResponsiveStatement = {
    type: "responsive",
    breakpoint,
    statement: innerStatement as StatementNode,
    span,
  };
  return {
    matches: [
      {
        template: RESPONSIVE_TEMPLATE,
        body: { statement, diagnostics },
      },
    ],
    diagnostics,
    selected: {
      template: RESPONSIVE_TEMPLATE,
      body: { statement, diagnostics },
    },
  };
}

function unrecognizedStatement(tokens: readonly Token[]): DiagnosticSpec {
  const suggestions = closestMatches(
    describeTokens(tokens),
    templateExamples(),
    3,
  );
  return {
    code: "KDM2001",
    message: `unrecognized statement ${JSON.stringify(describeTokens(tokens))}`,
    span: spanFromTokens(tokens),
    ...(suggestions.length > 0
      ? { hint: `did you mean: ${suggestions.join(" | ")}?` }
      : {}),
  };
}

function ambiguousStatement(
  tokens: readonly Token[],
  matches: readonly TemplateMatch[],
): DiagnosticSpec {
  const ids = matches.map((match) => match.template.id);
  return {
    code: "KDM9001",
    message: `${JSON.stringify(describeTokens(tokens))} matches more than one statement template: ${ids.join(", ")}`,
    span: spanFromTokens(tokens),
    hint: "this is a compiler defect, not a source error; the line was not parsed",
  };
}

/** Every canonical example, in template-table order. */
export function templateExamples(): string[] {
  const examples: string[] = [];
  for (const template of [...STATEMENT_TEMPLATES, RESPONSIVE_TEMPLATE]) {
    examples.push(...template.examples);
  }
  return examples;
}

export function isPageSettingNode(
  node: StatementNode | PageSettingNode,
): node is PageSettingNode {
  return node.type === "page-setting";
}
