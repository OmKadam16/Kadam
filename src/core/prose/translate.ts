import type { StatementNode } from "../ast/nodes.js";
import type { Diagnostic, DiagnosticFix } from "../diagnostics/diagnostic.js";
import { lex } from "../lexer/lexer.js";
import { KEYWORDS, NAMED_COLORS } from "../lexer/lexicon.js";
import { matchLine } from "../parser/registry.js";
import { propertyKeys } from "../parser/validate.js";
import { closestMatches, editDistance } from "../parser/suggest.js";
import { SourceFile, type Span } from "../source/source-file.js";

/**
 * D-50: kadam 0.4, pages written as paragraphs.
 *
 * A paragraph page is translated, line for line, into the block form of
 * kadam 0.3. Every generated line remembers the sentence it came from, so the
 * normal parser, checker and compiler build it and every diagnostic points at
 * the sentence the author wrote. The translation never guesses: a sentence is
 * either in the language or an error with fixes.
 */

export type ProseFix = DiagnosticFix;

export interface ProseDiagnostic extends Diagnostic {
  readonly fixes?: readonly ProseFix[];
}

export interface ProseTranslation {
  /** The block-form (kadam 0.3) source. */
  readonly text: string;
  /** Index = generated line number; the sentence that line came from. */
  readonly lineSpans: readonly (Span | null)[];
  readonly diagnostics: readonly ProseDiagnostic[];
  /** Components the page made for its `For each ... in ...:` groups, in the block form. */
  readonly components?: readonly { readonly name: string; readonly text: string; readonly lineSpans: readonly (Span | null)[] }[];
}

export interface ProseOptions {
  /** The page title when the page does not say `The page is called "..."`. */
  readonly title: string;
  /** Component names the page may use (from components.kdm and the library). */
  readonly components?: ReadonlyMap<string, ProseComponentInfo>;
  /** The project theme's color names (`muted`, `brand`), usable as describing words. */
  readonly colorTokens?: ReadonlySet<string>;
}

export interface ProseComponentInfo {
  /** The blank that `says "..."` fills, if the component has one. */
  readonly saysBlank: string | null;
  /** Every blank, in order. */
  readonly blanks: readonly string[];
  /** Library components are written `a Card from kadam`. */
  readonly library?: boolean;
  /** Components from components.kdm: their body, so `but` can change one thing. */
  readonly body?: ProseComponentBody;
}

export interface ProseComponentBody {
  readonly kind: string;
  readonly statements: readonly string[];
  readonly children: readonly { readonly base: string; readonly kind: string; readonly statements: readonly string[] }[];
}

export interface ProseComponentDefinition {
  readonly name: string;
  readonly span: Span;
  readonly info: ProseComponentInfo;
  /** The component in the block form. */
  readonly text: string;
  readonly lineSpans: readonly (Span | null)[];
}

// ---------------------------------------------------------------------------
// Words

interface Word {
  readonly text: string;
  /** Lower case, quotes kept for strings. */
  readonly lower: string;
  readonly quoted: boolean;
  readonly start: number;
  readonly end: number;
}

interface Sentence {
  readonly words: readonly Word[];
  readonly start: number;
  readonly end: number;
  /** The sentence as written, without its full stop. */
  readonly text: string;
}

/** Kinds, by the nouns people use for them. Longest phrases first. */
const KIND_NOUNS: readonly (readonly [string, string, string])[] = [
  // [noun phrase, block kind, base name]
  ["navigation bar", "navigation bar", "nav"],
  ["nav bar", "navigation bar", "nav"],
  ["navbar", "navigation bar", "nav"],
  ["menu bar", "navigation bar", "nav"],
  ["numbered list", "numbered list", "list"],
  ["expandable section", "expandable section", "question"],
  ["header row", "header row", "headerRow"],
  ["dialog", "dialog", "dialog"],
  ["modal", "dialog", "dialog"],
  ["popup", "dialog", "dialog"],
  ["question", "expandable section", "question"],
  ["table row", "row", "tableRow"],
  ["table", "table", "table"],
  ["cell", "cell", "cell"],
  ["list item", "list item", "item"],
  ["code block", "code block", "code"],
  ["text field", "text field", "field"],
  ["text area", "text area", "textArea"],
  ["input field", "text field", "field"],
  ["heading", "section heading", "heading"],
  ["headline", "section heading", "heading"],
  ["title", "main heading", "title"],
  ["paragraph", "paragraph", "text"],
  ["text", "paragraph", "text"],
  ["sentence", "paragraph", "text"],
  ["button", "button", "button"],
  ["link", "link", "link"],
  ["image", "image", "image"],
  ["picture", "image", "image"],
  ["photo", "image", "photo"],
  ["logo", "image", "logo"],
  ["mark", "image", "logo"],
  ["screenshot", "image", "image"],
  ["illustration", "image", "image"],
  ["graphic", "image", "image"],
  ["avatar", "image", "image"],
  ["chart", "image", "image"],
  ["icon", "icon", "icon"],
  ["video", "video", "video"],
  ["card", "card", "card"],
  ["box", "container", "box"],
  ["container", "container", "box"],
  ["panel", "container", "panel"],
  ["menu", "container", "menu"],
  ["drawer", "container", "drawer"],
  ["note", "container", "note"],
  ["callout", "container", "callout"],
  ["tip", "container", "tip"],
  ["row", "container", "row"],
  ["column", "container", "column"],
  ["grid", "container", "grid"],
  ["list", "list", "list"],
  ["item", "list item", "item"],
  ["divider", "divider", "divider"],
  ["line", "divider", "divider"],
  ["badge", "badge", "badge"],
  ["tag", "badge", "tag"],
  ["form", "form", "form"],
  ["input", "text field", "field"],
  ["checkbox", "checkbox", "checkbox"],
  ["dropdown", "dropdown", "dropdown"],
  ["section", "section", "section"],
  ["header", "header", "header"],
  ["footer", "footer", "footer"],
  ["sidebar", "sidebar", "sidebar"],
  ["article", "article", "article"],
];

const TEXT_KINDS = new Set(["main heading", "section heading", "minor heading", "paragraph", "link", "list item", "badge", "code block"]);
const BOX_KINDS = new Set(["card", "container", "section", "header", "footer", "sidebar", "article", "navigation bar", "form", "list", "numbered list"]);
const MEDIA_KINDS = new Set(["image", "icon", "video"]);

/** Accepted spellings (D-50: synonyms are vocabulary, not guesses). */
const SPELLINGS: Readonly<Record<string, string>> = {
  grey: "gray",
  colour: "color",
  centred: "centered",
  centre: "center",
  pixels: "px",
  pixel: "px",
  rounded: "rounded",
};

const SIZE_WORDS = new Set(["tiny", "small", "big", "large", "huge", "giant"]);
const TEXT_SIZE: Readonly<Record<string, number>> = { tiny: 12, small: 14, big: 20, large: 20, huge: 28, giant: 36 };
const STYLE_WORDS: Readonly<Record<string, string>> = {
  bold: "the text is bold",
  semibold: "the text is semibold",
  light: "the text is light",
  italic: "the text is italic",
  uppercase: "the text is uppercase",
  underlined: "the text is underlined",
  centered: "the text is centered",
};
const BOX_WORDS: Readonly<Record<string, readonly string[]>> = {
  rounded: ["has rounded corners"],
  pill: ["has fully rounded corners"],
  shadowed: ["has a soft shadow"],
  outlined: ["has a 1px #6B728040 border"],
};

const VOCABULARY: readonly string[] = [
  ...KIND_NOUNS.map(([noun]) => noun),
  ...SIZE_WORDS,
  ...Object.keys(STYLE_WORDS),
  ...Object.keys(BOX_WORDS),
  ...NAMED_COLORS,
  "says", "shows", "called", "with", "without", "and", "on", "the", "left", "right", "after", "that", "gap", "of", "decorative", "but",
];

function words(text: string, offset: number): Word[] {
  const out: Word[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (character === " " || character === "\t") {
      index += 1;
      continue;
    }
    const start = index;
    if (character === '"') {
      index += 1;
      while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
      index = Math.min(text.length, index + 1);
      const raw = text.slice(start, index);
      out.push({ text: raw, lower: raw, quoted: true, start: offset + start, end: offset + index });
      continue;
    }
    if (character === ",") {
      index += 1;
      out.push({ text: ",", lower: ",", quoted: false, start: offset + start, end: offset + index });
      continue;
    }
    while (index < text.length && !" \t,\"".includes(text[index]!)) index += 1;
    const raw = text.slice(start, index);
    out.push({ text: raw, lower: raw.toLowerCase(), quoted: false, start: offset + start, end: offset + index });
  }
  // `18 px` and `18 pixels` are one length; `dark gray` and `light blue` are one color.
  const merged: Word[] = [];
  for (const word of out) {
    const previous = merged.at(-1);
    const joined = `${previous?.lower ?? ""}${SPELLINGS[word.lower] ?? word.lower}`;
    if (previous !== undefined && !word.quoted && !previous.quoted && /^(dark|light|medium)$/.test(previous.lower) && NAMED_COLORS.has(joined)) {
      merged[merged.length - 1] = { text: `${previous.text} ${word.text}`, lower: joined, quoted: false, start: previous.start, end: word.end };
      continue;
    }
    const unit = SPELLINGS[word.lower] ?? word.lower;
    if (previous !== undefined && /^\d+(\.\d+)?$/.test(previous.lower) && (unit === "px" || unit === "rem" || unit === "%")) {
      merged[merged.length - 1] = { text: `${previous.text}${unit}`, lower: `${previous.lower}${unit}`, quoted: false, start: previous.start, end: word.end };
      continue;
    }
    // `pixels` means px only after a number (`18 pixels`); alone it is a word.
    const respell = SPELLINGS[word.lower] !== undefined && !word.quoted && word.lower !== "pixels" && word.lower !== "pixel";
    merged.push(respell ? { ...word, lower: SPELLINGS[word.lower]! } : word);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// The paragraph tree

interface Line {
  readonly indent: number;
  readonly text: string;
  readonly start: number;
  readonly lineNumber: number;
}


/** Lines that end a sentence where a full stop is outside quotes. */
function splitSentences(text: string, offset: number): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "\\" && quoted) {
      index += 1;
      continue;
    }
    if (character === '"') quoted = !quoted;
    // `says "Meet Lumen." It ...`: a quote that ends a sentence ends it here too.
    if (character === '"' && !quoted && /[.!?]/.test(text[index - 1] ?? "") && (index + 1 === text.length || (text[index + 1] === " " && /[A-Z]/.test(text[index + 2] ?? "")))) {
      const piece = text.slice(start, index + 1);
      if (piece.trim() !== "") out.push({ text: piece.trim(), start: offset + start + (piece.length - piece.trimStart().length), end: offset + index + 1 });
      start = index + 1;
      continue;
    }
    if (!quoted && character === "." && (index + 1 === text.length || text[index + 1] === " ")) {
      const piece = text.slice(start, index);
      if (piece.trim() !== "") out.push({ text: piece.trim(), start: offset + start + (piece.length - piece.trimStart().length), end: offset + index });
      start = index + 1;
    }
  }
  const rest = text.slice(start);
  if (rest.trim() !== "") out.push({ text: rest.trim(), start: offset + start + (rest.length - rest.trimStart().length), end: offset + start + rest.trimEnd().length });
  return out;
}

// ---------------------------------------------------------------------------
// Translation

interface Out {
  readonly lines: string[];
  readonly spans: (Span | null)[];
}

interface Element {
  name: string;
  readonly kind: string;
  readonly span: Span;
  readonly statements: { readonly line: string; readonly span: Span }[];
  readonly children: Element[];
  /** A component instance: `a PrimaryButton` (with bindings in statements). */
  readonly component?: string;
  /** A block written as blocks inside a paragraph page, copied line for line. */
  readonly raw?: readonly { readonly text: string; readonly span: Span }[];
  /** A centered group: its text is centered too, unless it says otherwise. */
  centered?: boolean;
  /** The words a header named it with (`sign up dialog`), for references. */
  alias?: string;
  /** `For each product in products:` collects its body here. */
  repeat?: { readonly item: string; readonly source: string; readonly shaping: { line: string; span: Span }[] };
}

/** A component made from a `For each` group, and the instance that repeats it. */
interface MadeComponent {
  readonly name: string;
  readonly item: string;
  readonly root: Element;
  readonly instance: Element;
  readonly span: Span;
}

/** A reference to another thing, resolved once the whole page is read. */
const REF = "\u0001";

export function isProseSource(text: string, byDefault = false): boolean {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//")) continue;
    if (/^kadam\s+0\.4\s*$/.test(trimmed)) return true;
    // In a paragraph site (kadam.json says 0.4, or there is none), the line is optional.
    return byDefault && !/^kadam\s/.test(trimmed) && looksLikeParagraphs(text);
  }
  return false;
}

/** A file with no blocks: no line ends in `{` and none is `page "..."`. */
export function looksLikeParagraphs(text: string): boolean {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("//"));
  return lines.length > 0 && !lines.some((line) => line.endsWith("{") || /^page\s+"/.test(line) || /^component\s/.test(line) || /^kadam\s/.test(line));
}

/** The theme's color names, for the translation in progress (it runs to completion synchronously). */
let themeColors: ReadonlySet<string> = new Set();

/** A color word: a CSS name, a hex color, or a color of the project's theme. */
function isColor(value: string): boolean {
  return NAMED_COLORS.has(value) || /^#[0-9a-f]{3,8}$/i.test(value) || themeColors.has(value);
}

export function translateProse(source: SourceFile, options: ProseOptions): ProseTranslation {
  const previous = themeColors;
  themeColors = new Set([...(options.colorTokens ?? [])].map((name) => name.toLowerCase()));
  try {
    return new Translator(source, options).run();
  } finally {
    themeColors = previous;
  }
}

/** D-50: read the component definitions of a kadam 0.4 components.kdm. */
export function translateProseComponents(source: SourceFile, colorTokens: ReadonlySet<string> = new Set()): { definitions: ProseComponentDefinition[]; diagnostics: readonly ProseDiagnostic[] } {
  const previous = themeColors;
  themeColors = new Set([...colorTokens].map((name) => name.toLowerCase()));
  try {
    return new Translator(source, { title: "" }).definitions();
  } finally {
    themeColors = previous;
  }
}

/** What `with a ___ title` makes inside a component. */
const CHILD_ROLES: Readonly<Record<string, { readonly kind: string; readonly statements: readonly string[] }>> = {
  title: { kind: "minor heading", statements: [] },
  heading: { kind: "minor heading", statements: [] },
  name: { kind: "minor heading", statements: [] },
  description: { kind: "paragraph", statements: [] },
  text: { kind: "paragraph", statements: [] },
  body: { kind: "paragraph", statements: [] },
  summary: { kind: "paragraph", statements: [] },
  quote: { kind: "paragraph", statements: ["the text is italic"] },
  price: { kind: "paragraph", statements: ["the text is 32px", "the text is bold"] },
  note: { kind: "paragraph", statements: ["the text is 14px"] },
  caption: { kind: "paragraph", statements: ["the text is 14px"] },
  label: { kind: "paragraph", statements: ["the text is 14px", "the text is #6B7280"] },
  value: { kind: "paragraph", statements: ["the text is 32px", "the text is bold"] },
  number: { kind: "paragraph", statements: ["the text is 32px", "the text is bold"] },
};

/** The properties a block sentence sets, so a change can replace them. */
function keysOf(line: string): string[] {
  const tokens = lex(new SourceFile("line.kdm", line)).tokens.filter((token) => token.kind !== "newline" && token.kind !== "eof" && token.kind !== "comment");
  const statement = matchLine(tokens, { allowResponsive: true, languageVersion: "0.3", quick: true }).selected?.body.statement;
  return statement === null || statement === undefined || statement.type === "kind" ? [] : propertyKeys(statement as StatementNode);
}

function braces(text: string): number {
  let depth = 0;
  let quoted = false;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "{") depth += 1;
    else if (!quoted && character === "}") depth -= 1;
  }
  return depth;
}

class Translator {
  readonly #source: SourceFile;
  readonly #options: ProseOptions;
  readonly #diagnostics: ProseDiagnostic[] = [];
  readonly #names = new Map<string, number>();
  readonly #used = new Set<string>();
  #title: string;
  #titleSpan: Span | null = null;
  readonly #settings: { readonly line: string; readonly span: Span }[] = [];
  #mainHeading = false;
  readonly #rightOf = new Set<Element>();
  readonly #explicit = new Set<string>();
  readonly #made: MadeComponent[] = [];
  /** Sentences about a thing named elsewhere: `The menu starts hidden.` */
  readonly #later: { target: string; line: string; span: Span }[] = [];

  constructor(source: SourceFile, options: ProseOptions) {
    this.#source = source;
    this.#options = options;
    this.#title = options.title;
  }

  run(): ProseTranslation {
    const lines = this.#lines();
    const root: Element = { name: "", kind: "", span: this.#source.span(0, 0), statements: [], children: [] };
    this.#group(lines, 0, lines.length, root, true);
    const out: Out = { lines: [], spans: [null] };
    let sink = out;
    const emit = (text: string, span: Span | null): void => {
      sink.lines.push(text);
      sink.spans.push(span);
    };
    const headerSpan = this.#titleSpan ?? this.#source.span(0, 0);
    // References by name or by the words of a header, resolved now that the page is read.
    const named = new Map<string, Element>();
    const visit = (element: Element): void => {
      if (element.name !== "") named.set(element.name.toLowerCase(), element);
      if (element.alias !== undefined && element.alias !== "" && !named.has(element.alias)) named.set(element.alias, element);
      element.children.forEach(visit);
    };
    visit(root);
    const find = (words: string): Element | undefined => {
      const plain = words.trim().toLowerCase();
      return named.get(plain) ?? named.get(plain.replace(/\s+/g, "")) ?? named.get(camel(plain.split(/\s+/)).toLowerCase())
        ?? named.get(plain.replace(/ (dialog|menu|panel|section|box|popup|modal)$/, "")) ?? named.get(`${camel(plain.split(/\s+/)).toLowerCase()}1`);
    };
    const resolve = (line: string, span: Span): string | null => {
      if (!line.startsWith(REF)) return line;
      const [, verb, words] = line.split(REF) as [string, string, string];
      const target = find(words);
      if (target === undefined) {
        // Only what the author named: headers and `called` names.
        const known = [...new Set([...named.entries()].filter(([key, element]) => key === element.alias || this.#explicit.has(element.name)).map(([key]) => key))].sort();
        const near = known.filter((candidate) => editDistance(candidate, words) <= Math.max(2, Math.floor(words.length * 0.25)));
        this.#error("KDM3012", `nothing on this page is called "${words}"`, span,
          known.length > 0 ? `the things named on this page: ${known.join(", ")}` : `name it with a header such as ${capitalize(words)}:, or with called ${camel(words.split(/\s+/))}`,
          near.map((candidate) => ({ label: `the ${candidate}`, span, text: this.#source.text.slice(span.start.offset, span.end.offset).replace(new RegExp(`${words}(?=\\W*$)`, "i"), candidate) })));
        return null;
      }
      const quoted = JSON.stringify(target.name);
      if (verb === "focuses" || verb === "moves focus to") return `when clicked, focus ${quoted}`;
      if (verb === "toggles" || verb === "opens and closes" || verb === "shows and hides") return `when clicked, flip ${quoted}`;
      if (verb === "hides" || verb === "closes") return `when clicked, hide ${quoted}`;
      return target.kind === "dialog" ? `when clicked, open dialog ${quoted}` : `when clicked, show ${quoted}`;
    };
    for (const later of this.#later) {
      const target = find(later.target);
      if (target === undefined) this.#error("KDM3012", `nothing on this page is called "${later.target}"`, later.span, "name it first, for example with a header such as Menu:");
      else target.statements.push({ line: later.line, span: later.span });
    }
    const parentCentered = new Set<Element>();
    const inRow = new Set<Element>();
    const inGrid = new Set<Element>();
    const stacked = new Set<Element>(root.children);
    const darkPage = this.#settings.some((setting) => /^the page is dark when/.test(setting.line));
    // A page whose own background is dark: cards are see-through and gray text is the light gray.
    const canvas = this.#settings.map((setting) => /^the page background is (\S+)$/.exec(setting.line)?.[1]).find((value) => value !== undefined);
    const darkCanvas = canvas !== undefined && isDarkColor(canvas);
    const render = (element: Element, depth: number): void => {
      const pad = "    ".repeat(depth);
      if (element.raw !== undefined) {
        for (const line of element.raw) emit(`${pad}${line.text}`, line.span);
        return;
      }
      emit(`${pad}${element.name} {`, element.span);
      // A section is a named landmark; with no heading inside to name it, it is a plain box.
      const hasHeading = (candidate: Element): boolean => candidate.children.some((child) => child.kind.endsWith("heading") || child.raw !== undefined || hasHeading(child));
      const kind = element.kind === "section" && !hasHeading(element) ? "container" : element.kind;
      emit(`${pad}    ${element.component === undefined ? article(kind) : `a ${element.component}`}`, element.span);
      for (const written of element.statements) {
        const resolved = resolve(written.line, written.span);
        if (resolved === null) continue;
        const statement = { line: resolved, span: written.span };
        // In a row, full width means taking the space that is left.
        if (inRow.has(element) && statement.line === "it is full width") {
          emit(`${pad}    it grows to fill the space`, statement.span);
          continue;
        }
        const rowGap = inRow.has(element) ? /^it has (\S+) margin on the top$/.exec(statement.line) : null;
        if (rowGap !== null) {
          emit(`${pad}    it has ${rowGap[1]} margin on the left`, statement.span);
          continue;
        }
        if (darkCanvas && statement.line === "the text is #6B7280") {
          emit(`${pad}    the text is #9CA3AF`, statement.span);
          continue;
        }
        emit(`${pad}    ${statement.line}`, statement.span);
        // The readable gray has a lighter partner on a page that turns dark.
        if (statement.line === "the text is #6B7280" && darkPage && !element.statements.some((other) => other.line.startsWith("in dark mode, the text is"))) {
          emit(`${pad}    in dark mode, the text is #9CA3AF`, statement.span);
        }
      }
      const box = kind === "container" || element.kind === "card" || element.kind === "form" || element.kind === "list" || element.kind === "numbered list" || element.kind === "table";
      if (box && element.component === undefined && stacked.has(element) && !inRow.has(element) && !inGrid.has(element) && !parentCentered.has(element)
        && !element.statements.some((statement) => /^it is (?:\S+ wide|full width|as wide as its content)$|^it grows to fill the space$/.test(statement.line))) {
        emit(`${pad}    it is full width`, element.span);
      }
      if (parentCentered.has(element) && !TEXT_KINDS.has(element.kind) && element.statements.some((statement) => /^it is at most \S+ wide$/.test(statement.line))
        && !element.statements.some((statement) => statement.line === "it is centered")) {
        emit(`${pad}    it is centered`, element.span);
      }
      if (darkCanvas && element.kind === "card" && element.component === undefined && !element.statements.some((statement) => /background/.test(statement.line))) {
        emit(`${pad}    has no background`, element.span);
        emit(`${pad}    has no shadow`, element.span);
      }
      // Pictures never grow wider than their box, and a circle is round.
      if (MEDIA_KINDS.has(element.kind) && element.kind !== "icon") {
        if (!element.statements.some((statement) => /^it is at most .* wide$|^it is full width$/.test(statement.line))) emit(`${pad}    it is at most 100% wide`, element.span);
        if (element.statements.some((statement) => statement.line === "it is shaped like a circle")) {
          if (!element.statements.some((statement) => /^it keeps an? .* shape$/.test(statement.line))) emit(`${pad}    it keeps a square shape`, element.span);
          if (element.kind === "image" && !element.statements.some((statement) => /^it (fills|fits inside) its box$/.test(statement.line))) emit(`${pad}    it fills its box`, element.span);
        }
      }
      if (parentCentered.has(element) && TEXT_KINDS.has(element.kind) && !element.statements.some((statement) => /^the text is (centered|left aligned|right aligned)$/.test(statement.line))) {
        emit(`${pad}    the text is centered`, element.span);
      }
      // Links next to each other need room to tap (WCAG 2.2 target size): 8px unless a gap is said.
      if (element.kind !== "navigation bar" && element.children.filter((child) => child.kind === "link").length >= 2 && !element.statements.some((statement) => /gap between children$/.test(statement.line))) {
        emit(`${pad}    it has 8px gap between children`, element.span);
      }
      const row = element.kind === "navigation bar" || element.statements.some((statement) => statement.line === "it arranges its children in a row");
      const grid = element.statements.some((statement) => / columns$/.test(statement.line) && statement.line.startsWith("it arranges"));
      for (const child of element.children) {
        if (row) inRow.add(child);
        if (grid) inGrid.add(child);
        if (element.centered === true) parentCentered.add(child);
        if (!row && !grid && element.centered !== true) stacked.add(child);
        render(child, depth + 1);
      }
      emit(`${pad}}`, element.span);
    };
    // Components made from `For each` groups: each field the lines read is a blank.
    const components: { name: string; text: string; lineSpans: (Span | null)[] }[] = [];
    for (const made of this.#made) {
      const fields = new Map<string, "text" | "image">();
      const field = new RegExp(`\\{(?:the )?([a-z][A-Za-z0-9]*)(?: of (?:the )?${made.item})?\\}`, "g");
      const rewrite = (element: Element): void => {
        for (const statement of element.statements) {
          const picture = /^it shows "\{[^}]*\}"$/.test(statement.line);
          (statement as { line: string }).line = statement.line.replace(field, (_whole: string, name: string) => {
            if (!fields.has(name) || picture) fields.set(name, picture ? "image" : fields.get(name) ?? "text");
            return `{$${name}}`;
          });
        }
        element.children.forEach(rewrite);
      };
      rewrite(made.root);
      const body: Out = { lines: [], spans: [null] };
      sink = body;
      emit("kadam 0.3", made.span);
      const takes = [...fields].map(([name, type]) => `${article(name)} as ${type}`).join(", ");
      emit(`component ${made.name}${fields.size === 0 ? "" : ` takes ${takes}`} {`, made.span);
      render(made.root, 1);
      emit("}", made.span);
      sink = out;
      components.push({ name: made.name, text: `${body.lines.join("\n")}\n`, lineSpans: body.spans });
      for (const name of fields.keys()) made.instance.statements.push({ line: `with ${article(name)} of the ${name} of ${made.item}`, span: made.span });
    }
    emit("kadam 0.3", headerSpan);
    emit(`page ${JSON.stringify(this.#title)} {`, headerSpan);
    for (const setting of this.#settings) emit(`    ${setting.line}`, setting.span);
    for (const child of root.children) render(child, 1);
    emit("}", headerSpan);
    return { text: `${out.lines.join("\n")}\n`, lineSpans: out.spans, diagnostics: this.#diagnostics, ...(components.length === 0 ? {} : { components }) };
  }

  #lines(): Line[] {
    const out: Line[] = [];
    const text = this.#source.text;
    let offset = 0;
    let sawVersion = false;
    const raw = text.split("\n");
    raw.forEach((line, index) => {
      const start = offset;
      offset += line.length + 1;
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("//")) {
        out.push({ indent: -1, text: "", start, lineNumber: index + 1 });
        return;
      }
      if (!sawVersion) {
        sawVersion = true;
        if (/^kadam\s+0\.4$/.test(trimmed)) return;
      }
      const leading = line.length - line.trimStart().length;
      const indent = line.slice(0, leading).replaceAll("\t", "    ").length;
      out.push({ indent, text: trimmed, start: start + leading, lineNumber: index + 1 });
    });
    return out;
  }

  /** Read lines [from, to) at one indent into `parent`. */
  #group(given: readonly Line[], from: number, to: number, parent: Element, top: boolean): void {
    let lines = given;
    let index = from;
    let paragraph: Line[] = [];
    let subject: Element | null = null;
    let gap: { length: string; span: Span } | null = null;
    const flush = (): void => {
      if (paragraph.length === 0) return;
      // A paragraph is lines joined by spaces; offsets stay exact per line.
      for (const line of paragraph) {
        // A quote that is never closed: say so, offer to close it, and skip the line.
        if (insideQuotes(line.text)) {
          const closed = line.text.endsWith(".") ? `${line.text.slice(0, -1)}".` : `${line.text}"`;
          const span = this.#span(line.start, line.start + line.text.length);
          this.#error("KDM1002", "a quote is opened on this line but never closed", span, "add the closing double quote", [{ label: closed, span, text: closed }]);
          continue;
        }
        for (const piece of splitSentences(line.text, line.start)) {
          const result = this.#sentence(piece, parent, subject, top, gap);
          if (result.gap !== undefined) gap = result.gap;
          if (result.element !== undefined) {
            subject = result.element;
            gap = null;
          }
        }
      }
      paragraph = [];
    };
    while (index < to) {
      const line = lines[index]!;
      if (line.indent === -1) {
        flush();
        index += 1;
        continue;
      }
      // A block, written as blocks, inside a paragraph page.
      if (/^[a-z][A-Za-z0-9]*\s*\{$/.test(line.text)) {
        flush();
        let depth = 0;
        let end = index;
        const raw: { text: string; span: Span }[] = [];
        while (end < to) {
          const current = lines[end]!;
          if (current.indent !== -1) {
            depth += braces(current.text);
            raw.push({ text: `${" ".repeat(Math.max(0, current.indent - line.indent))}${current.text}`, span: this.#span(current.start, current.start + current.text.length) });
          }
          end += 1;
          if (depth <= 0 && current.indent !== -1) break;
        }
        if (depth > 0) this.#error("KDM2002", "this block is not closed", this.#span(line.start, line.start + line.text.length), "add } at the end of the block");
        const name = line.text.replace(/\s*\{$/, "");
        this.#used.add(name);
        const element: Element = { name, kind: "", span: this.#span(line.start, line.start + line.text.length), statements: [], children: [], raw };
        const pending = gap as { length: string; span: Span } | null;
        if (pending !== null) {
          raw.splice(2, 0, { text: `    it has ${pending.length} margin on the top`, span: pending.span });
          gap = null;
        }
        parent.children.push(element);
        subject = null;
        index = end;
        continue;
      }
      // `For each product in products:` repeats its lines once per record of a data file.
      const each = /^for (?:each|every) ([a-z][A-Za-z0-9]*) in ([a-z][A-Za-z0-9]*):$/i.exec(line.text);
      if (each !== null) {
        flush();
        let end = index + 1;
        while (end < to && (lines[end]!.indent === -1 || lines[end]!.indent > line.indent)) end += 1;
        const span = this.#span(line.start, line.start + line.text.length);
        const item = each[1]!;
        const collector: Element = { name: "", kind: "container", span, statements: [], children: [], repeat: { item, source: each[2]!, shaping: [] } };
        this.#group(lines, index + 1, end, collector, false);
        const single = collector.children.length === 1 && collector.children[0]!.component === undefined && collector.children[0]!.raw === undefined;
        const root: Element = single ? collector.children[0]! : { name: `${item}Item`, kind: "container", span, statements: [], children: collector.children };
        const titleWords = this.#title.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part.toLowerCase());
        let name = `${capitalize(camel(titleWords))}Each${capitalize(item)}`;
        while (this.#made.some((made) => made.name === name)) name = `${name}2`;
        const instance: Element = { name: this.#name(item, null, span), kind: "", span, statements: [...collector.repeat!.shaping], children: [], component: `${name} for each ${item} in ${each[2]}` };
        const pending = gap as { length: string; span: Span } | null;
        if (pending !== null) {
          instance.statements.unshift({ line: `it has ${pending.length} margin on the top`, span: pending.span });
          gap = null;
        }
        this.#made.push({ name, item, root, instance, span });
        parent.children.push(instance);
        subject = null;
        index = end;
        continue;
      }
      // `Is Orbit free?` with indented lines under it: a question that opens to its answer.
      const next = lines.slice(index + 1, to).find((candidate) => candidate.indent !== -1);
      if (line.text.endsWith("?") && !insideQuotes(line.text) && next !== undefined && next.indent > line.indent) {
        flush();
        let end = index + 1;
        while (end < to && (lines[end]!.indent === -1 || lines[end]!.indent > line.indent)) end += 1;
        const span = this.#span(line.start, line.start + line.text.length);
        const question: Element = { name: this.#name("question", null, span), kind: "expandable section", span, statements: [{ line: `the title says ${JSON.stringify(line.text)}`, span }], children: [] };
        if (gap !== null) {
          question.statements.push({ line: `it has ${(gap as { length: string }).length} margin on the top`, span: (gap as { span: Span }).span });
          gap = null;
        }
        parent.children.push(question);
        this.#group(lines, index + 1, end, question, false);
        subject = question;
        index = end;
        continue;
      }
      if (line.text.endsWith(":") && !insideQuotes(line.text)) {
        flush();
        // The group's own lines are the indented ones after it.
        let end = index + 1;
        while (end < to && (lines[end]!.indent === -1 || lines[end]!.indent > line.indent)) end += 1;
        const header = { text: line.text.slice(0, -1).trim(), start: line.start, end: line.start + line.text.length - 1 };
        const group = this.#groupElement(header, gap, parent);
        gap = null;
        if (group !== null) {
          parent.children.push(group);
          this.#group(lines, index + 1, end, group, false);
          subject = group;
        }
        index = end;
        continue;
      }
      // Lines indented under one that does not end with a colon: say so, and read it as a header.
      const under = lines.slice(index + 1, to).find((candidate) => candidate.indent !== -1);
      if (under !== undefined && under.indent > line.indent && !line.text.endsWith(":") && !line.text.endsWith("?")) {
        const fixed = `${line.text.replace(/\.$/, "")}:`;
        this.#error("KDM2001", `the lines under "${line.text}" are indented, but it does not end with a colon`, this.#span(line.start, line.start + line.text.length),
          "to put things inside it, end the line with a colon; otherwise do not indent the lines under it", [{ label: fixed, span: this.#span(line.start, line.start + line.text.length), text: fixed }]);
        lines = [...lines.slice(0, index), { ...line, text: fixed }, ...lines.slice(index + 1)];
        continue;
      }
      paragraph.push(line);
      index += 1;
    }
    flush();
    if (gap !== null) this.#error("KDM2001", "a gap must come before something", (gap as { span: Span }).span, "put the gap between two things, or remove it");
  }

  #span(start: number, end: number): Span {
    return this.#source.span(start, end);
  }

  #error(code: Diagnostic["code"], message: string, span: Span, hint?: string, fixes?: readonly ProseFix[]): void {
    this.#diagnostics.push({ code, severity: "error", message, span, ...(hint === undefined ? {} : { hint }), ...(fixes === undefined || fixes.length === 0 ? {} : { fixes }) });
  }

  #name(base: string, explicit: string | null, span: Span): string {
    if (explicit !== null && KEYWORDS.has(explicit.toLowerCase())) {
      const instead = [`${explicit}1`, `${explicit}${capitalize(base.replace(/\d+$/, ""))}`].filter((name) => name !== explicit && !this.#used.has(name));
      this.#error("KDM2007", `the name ${explicit} is a word of the language, so it cannot name something`, span, `call it ${instead.join(" or ")}`,
        instead.map((name) => ({ label: `called ${name}`, span, text: this.#source.text.slice(span.start.offset, span.end.offset).replace(new RegExp(`\\bcalled ${explicit}\\b`), `called ${name}`) })));
      explicit = instead[0] ?? `${explicit}1`;
    }
    if (explicit !== null) this.#explicit.add(explicit);
    if (explicit !== null) {
      if (this.#used.has(explicit)) this.#error("KDM2004", `the name ${explicit} is used twice`, span, "give each thing its own name");
      this.#used.add(explicit);
      return explicit;
    }
    let count = this.#names.get(base) ?? 0;
    let name = "";
    do {
      count += 1;
      name = `${base}${count}`;
    } while (this.#used.has(name));
    this.#names.set(base, count);
    this.#used.add(name);
    return name;
  }

  /** `Hero section:`, `Nav bar:`, `Pricing cards:` open a group. */
  #groupElement(header: { text: string; start: number; end: number }, gap: { length: string; span: Span } | null, parent: Element): Element | null {
    const span = this.#span(header.start, header.end);
    // Layout headers: `Side by side:`, `In 3 columns:`, `Plans, side by side with 24px gap:`.
    const layout: string[] = [];
    let headerText = numbersToDigits(header.text);
    // Side by side wraps on small screens; columns step down to 2 on tablets and 1 on phones.
    let centered = false;
    const layouts: readonly [RegExp, (m: RegExpExecArray) => readonly string[]][] = [
      [/(?:^|,\s*|\s)(?:side by side|in a row|next to each other)\b/i, () => ["it arranges its children in a row", "it wraps its children", "it stretches its children"]],
      [/(?:^|,\s*|\s)(?:stacked|in a column|one under another|on top of each other)\b/i, () => ["it arranges its children in a column"]],
      [/(?:^|,\s*|\s)(?:in )?(\d+) columns\b/i, (m) => {
        const count = Number(m[1]);
        return [`it arranges its children in ${count} columns`, ...(count >= 3 ? ["on tablets, it arranges its children in 2 columns"] : []), ...(count >= 2 ? ["on phones, it arranges its children in 1 column"] : [])];
      }],
      [/(?:^|,\s*|\s)(?:centered|centred|in the middle)\b/i, () => {
        centered = true;
        return ["it centers its children"];
      }],
      [/(?:^|,\s*|\s)with (?:an? )?(\d+(?:px|rem)) gap(?: between them)?\b/i, (m) => [`it has ${m[1]} gap between children`]],
    ];
    for (const [pattern, line] of layouts) {
      const m = pattern.exec(headerText);
      if (m !== null) {
        layout.push(...line(m));
        headerText = `${headerText.slice(0, m.index)} ${headerText.slice(m.index + m[0].length)}`.replace(/\s*,\s*$/, "").trim();
      }
    }
    // Things side by side, or in columns, get 16px between them unless the header says a gap.
    if (layout.some((line) => line === "it arranges its children in a row" || / columns$/.test(line)) && !layout.some((line) => line.endsWith("gap between children"))) {
      layout.push("it has 16px gap between children");
    }
    const list = words(headerText, header.start).filter((word) => word.lower !== "the" && word.lower !== "a" && word.lower !== "an" && word.lower !== "and" && word.lower !== ",");
    const plural = list.length > 0 && list.every((word) => /s$/.test(word.lower)) && findKind(list.map((word) => ({ ...word, lower: word.lower.replace(/s$/, "") }))) !== null;
    let found = plural ? null : findKind(list);
    if (found !== null && parent.kind === "table" && (found.base === "row" || found.kind === "header")) {
      found = { ...found, kind: found.kind === "header" ? "header row" : "row", base: found.kind === "header" ? "headerRow" : "tableRow" };
    }
    // A layout header, or a plural (`Cards:`), is a plain box; a header that names no kind is a section.
    // A header that names no kind is a section at the top of the page, and a plain box inside one.
    // A header holds lines, so a word for a single thing (`Picture:`, `Heading:`) names a box.
    const leaf = found !== null && (MEDIA_KINDS.has(found.kind) || TEXT_KINDS.has(found.kind) || found.kind === "button" || found.kind === "divider");
    const kind = (leaf ? undefined : found?.kind) ?? (layout.length > 0 || plural || parent.kind !== "" ? "container" : "section");
    const rest = list.filter((_, index) => found === null || index < found.at || index >= found.at + found.length);
    const named = rest.filter((word) => /^[A-Za-z][A-Za-z0-9]*$/.test(word.text)).map((word) => word.text.toLowerCase());
    const base = named.length > 0 ? camel(named) : found?.base ?? (kind === "container" ? "group" : "section");
    const element: Element = { name: this.#name(base, null, span), kind, span, statements: [], children: [], alias: list.map((word) => word.lower).join(" ") };
    if (found?.base === "row") element.statements.push({ line: "it arranges its children in a row", span });
    // Centered things are not stretched.
    const placed = centered ? layout.filter((line) => line !== "it stretches its children") : layout;
    for (const line of placed) element.statements.push({ line, span });
    if (centered) element.centered = true;
    // `A table of recent orders:` / `Orders table:` names the table: its caption.
    if (kind === "table") {
      const of = /\bof (.+)$/i.exec(headerText);
      const words = of !== null ? of[1]! : rest.map((word) => word.text).join(" ");
      if (words.trim() !== "") element.statements.push({ line: `the caption says ${JSON.stringify(capitalize(words.trim()))}`, span });
    }
    if (gap !== null) element.statements.push({ line: `it has ${gap.length} margin on the top`, span: gap.span });
    return element;
  }

  #sentence(
    piece: { text: string; start: number; end: number },
    parent: Element,
    subject: Element | null,
    top: boolean,
    gap: { length: string; span: Span } | null,
  ): { element?: Element; gap?: { length: string; span: Span } } {
    const span = this.#span(piece.start, piece.end);
    // Inside `For each product in products:`, lines that shape the list.
    const shaping = shapingLine(piece.text);
    const listShaping = parent.repeat?.shaping ?? (subject?.component?.includes(" for each ") === true ? subject.statements : undefined);
    if (shaping !== null && listShaping !== undefined) {
      listShaping.push({ line: shaping, span });
      return {};
    }
    // Other ways to say an effect or a hover become the canonical sentence first.
    piece = normalizedPiece(piece);
    const list = words(piece.text, piece.start);
    const lower = list.map((word) => word.lower).join(" ");

    // The page is called "Lumen". The page background is white.
    if (lower.startsWith("the page is called ") && list.length === 5 && list[4]!.quoted) {
      this.#title = JSON.parse(list[4]!.text) as string;
      this.#titleSpan = span;
      return {};
    }
    if (lower.startsWith("the page ") || lower.startsWith("pages ") || lower.startsWith("the heading font ")) {
      if (!top) this.#error("KDM2001", "page settings go at the top level, not inside a section", span, "move this sentence out of the section");
      else this.#settings.push({ line: lowerFirst(piece.text), span });
      return {};
    }

    // After that, a 50px gap.  Below that, a small gap.  Leave 50px of space.
    const gapWords: Readonly<Record<string, string>> = { tiny: "8px", small: "16px", medium: "32px", big: "64px", large: "64px", huge: "120px" };
    const gapLead = "(?:(?:after that|after it|below that|below it|under that|under it|then|and then|next)(?: ,)? )?(?:(?:leave|add|put|there is|there's) )?";
    const named = new RegExp(`^${gapLead}an? (tiny|small|medium|big|large|huge) (?:gap|space)$`).exec(lower);
    const measured = new RegExp(`^${gapLead}(?:an? )?(\\d+(?:\\.\\d+)?(?:px|rem))(?: gap| of space| space)$`).exec(lower);
    const gapMatch = measured ?? (named === null ? null : ([named[0], gapWords[named[1]!]!] as unknown as RegExpExecArray));
    if (gapMatch !== null || new RegExp(`^${gapLead}(?:an? )?[^ ]+ gap$`).test(lower)) {
      if (gapMatch === null) {
        this.#error("KDM2001", "a gap needs a length", span, "for example: After that, a 50px gap.");
        return {};
      }
      return { gap: { length: gapMatch[1]!, span } };
    }

    // Sentences about the thing just named (or the section they are in).
    const target = subject ?? (parent.kind === "" ? null : parent);
    // A line that is only words in quotes is a paragraph.
    if (/^"(?:[^"\\]|\\.)*"$/.test(piece.text.trim())) {
      const element = this.#element(`Text says ${piece.text.trim()}`, words(`Text says ${piece.text.trim()}`, piece.start), span, parent);
      if (element === null) return {};
      if (gap !== null) element.statements.unshift({ line: `it has ${gap.length} margin on the top`, span: gap.span });
      parent.children.push(element);
      return { element };
    }
    // The menu starts hidden.
    const startsHidden = /^the (.+?) (?:starts hidden|is hidden at first|is hidden to begin with)$/.exec(lower);
    if (startsHidden !== null && !/^(page|background|text|gradient|words?|border|corners|image|description)\b/.test(startsHidden[1]!)) {
      this.#later.push({ target: startsHidden[1]!, line: "it starts hidden", span });
      return {};
    }
    // The word "Lumen" in bold: a short text (a span sentence says "the words ... are").
    if (/^the words? "/.test(lower) && !/^the words? "[^"]*" (are|is|go|goes)\b/.test(lower)) {
      const element = this.#element(piece.text.replace(/^the words? ("(?:[^"\\]|\\.)*")/i, "Text says $1"), words(piece.text.replace(/^the words? ("(?:[^"\\]|\\.)*")/i, "Text says $1"), piece.start), span, parent);
      if (element === null) return {};
      if (gap !== null) element.statements.unshift({ line: `it has ${gap.length} margin on the top`, span: gap.span });
      parent.children.push(element);
      return { element };
    }
    const effect = /^(an? (\S+ )?highlight sweeps under |an? (\S+ )?(glow|spotlight) follows the cursor$|grain surrounds the cursor|(\S+ )?pixels pop out around the cursor$)/.test(lower);
    const background = /^(?:add|put|use|set)\b.* (?:as|in|for) the background$/.test(lower);
    if (effect || background || /^(it|its|when|while|on|in|everything|the background|the text|the gradient|the words|the corners|the border|each|every|the image|the description)\b/.test(lower)) {
      if (target === null) {
        this.#error("KDM2001", `"${firstWords(piece.text)}" has nothing to describe yet`, span, "name the thing first, for example: A card says \"...\".");
        return {};
      }
      this.#describe(piece.text, list, span, target);
      return {};
    }

    // A sentence the block form has as written (`The letter spacing is -1.9px.`) describes it too.
    if (target !== null && /^the /.test(lower) && accepts(lowerFirst(piece.text))) {
      this.#statement(lowerFirst(piece.text), span, target);
      return {};
    }
    // Anything else names a new thing.
    const element = this.#element(piece.text, list, span, parent);
    if (element === null) return {};
    if (gap !== null && element.component !== undefined) {
      // A component takes only its blanks, so the gap goes on a box around it.
      const holder: Element = { name: this.#name(`${element.name}Space`, null, span), kind: "container", span, statements: [{ line: `it has ${gap.length} margin on the top`, span: gap.span }], children: [element] };
      parent.children.push(holder);
      return { element };
    }
    if (gap !== null) element.statements.unshift({ line: `it has ${gap.length} margin on the top`, span: gap.span });
    parent.children.push(element);
    return { element };
  }

  /** A sentence about an element: try the block sentences it can mean. */
  #describe(text: string, list: readonly Word[], span: Span, target: Element): void {
    const lower = list.map((word) => word.lower).join(" ");
    // When clicked, it opens the menu. / It toggles the sign up dialog. / It closes the dialog.
    const reference = /^(?:when clicked, )?(?:it|clicking it) (opens and closes|shows and hides|toggles|opens|shows|reveals|displays|hides|closes|focuses|goes to|moves focus to) (?:the )?([a-z][a-z0-9 ]*)$/.exec(lowerFirstWords(text, list).replace(/ ,/g, ","));
    // A sentence the language already has (`it opens larger when clicked`) is never a reference.
    if (reference !== null && !(reference[1] === "goes to" && / page$/.test(reference[2]!)) && !accepts(lowerFirst(text))) {
      if (reference[2] === "dialog" && (reference[1] === "closes" || reference[1] === "hides")) {
        this.#statement("when clicked, close the dialog", span, target);
        return;
      }
      target.statements.push({ line: `${REF}${reference[1]}${REF}${reference[2]}`, span });
      return;
    }
    // `It is decorative.` after `A photo of a desk shows ...`: no description, then.
    if (lower === "it is decorative" && MEDIA_KINDS.has(target.kind)) {
      const at = target.statements.findIndex((statement) => statement.line.startsWith("the description says "));
      if (at !== -1) target.statements.splice(at, 1);
    }
    if (/^it (?:is hidden at first|is hidden to begin with)$/.test(lower)) {
      this.#statement("it starts hidden", span, target);
      return;
    }
    // Other ways to say a sentence the language has (the phrase table, spec 17.6).
    const said = rephrase(lowerFirstWords(text, list).replace(/ ,/g, ","));
    if (said !== null) {
      for (const line of said) this.#statement(line, span, target);
      return;
    }
    // The background is a blue to white gradient from left to right.
    const background = /^the background is (.+)$/.exec(lowerFirstWords(text, list));
    if (background !== null) {
      for (const line of backgroundLines(background[1]!)) this.#statement(line, span, target);
      return;
    }
    // It has rounded corners and a soft shadow.
    const clauses = splitAnd(text.replace(/^(It|it) has /, ""));
    const whole = lowerFirst(text);
    if (/^it has /.test(lower) && clauses.length > 1 && !accepts(whole) && !accepts(whole.replace(/^it has /, "has "))) {
      for (const clause of clauses) this.#statement(`it has ${clause}`, span, target, [`has ${clause}`]);
      return;
    }
    const plain = lowerFirst(text);
    const candidates = [plain];
    if (/^it has /.test(plain)) candidates.push(plain.replace(/^it has /, "has "));
    if (/^it is /.test(plain)) candidates.push(plain.replace(/^it is /, "the text is "));
    if (/^its text is /.test(plain)) candidates.push(plain.replace(/^its text is /, "the text is "));
    this.#statement(candidates[0]!, span, target, candidates.slice(1));
  }

  /** Add the first candidate the block grammar accepts; report the first one otherwise. */
  #statement(line: string, span: Span, target: Element, alternatives: readonly string[] = []): void {
    for (const candidate of [line, ...alternatives]) {
      if (accepts(candidate)) {
        target.statements.push({ line: candidate, span });
        return;
      }
    }
    // Let the block parser report it, with its own hint, at this sentence.
    target.statements.push({ line, span });
  }

  /** `A big black button called download says "Download for macOS".` */
  #element(text: string, list: readonly Word[], span: Span, parent: Element): Element | null {
    let tokens = [...list];
    if (tokens.length > 0 && ["a", "an", "the", "then", "and"].includes(tokens[0]!.lower)) tokens = tokens.slice(1);
    if (tokens.length > 0 && tokens[0]!.lower === "a") tokens = tokens.slice(1);
    // A component: a capitalised name that the project defines.
    const component = tokens.find((word) => /^[A-Z][A-Za-z0-9]+$/.test(word.text) && this.#options.components?.has(word.text));
    // `A ProjectCard for each project in projects, with the title of the project.`
    let each: { item: string; source: string } | null = null;
    const eachAt = tokens.findIndex((word, index) => word.lower === "for" && (tokens[index + 1]?.lower === "each" || tokens[index + 1]?.lower === "every") && tokens[index + 3]?.lower === "in");
    if (eachAt !== -1 && tokens[eachAt + 2] !== undefined && tokens[eachAt + 4] !== undefined) {
      each = { item: tokens[eachAt + 2]!.text, source: tokens[eachAt + 4]!.text };
      tokens.splice(eachAt, 5);
    }
    let explicit: string | null = null;
    const statements: { line: string; span: Span }[] = [];
    const add = (line: string): void => {
      statements.push({ line, span });
    };

    // called <name>
    const calledAt = tokens.findIndex((word) => word.lower === "called" || word.lower === "named");
    if (calledAt !== -1) {
      const name = tokens[calledAt + 1];
      if (name === undefined || !/^[a-z][A-Za-z0-9]*$/.test(name.text)) {
        this.#error("KDM2004", "a name after called is one word that starts with a small letter", name === undefined ? span : this.#span(name.start, name.end), "for example: called download");
        return null;
      }
      explicit = name.text;
      tokens.splice(calledAt, 2);
    }

    // says "..."  /  that says "..."  /  saying "..."
    let says: Word | null = null;
    const cells: Word[] = [];
    const saysAt = tokens.findIndex((word) => word.lower === "says" || word.lower === "saying" || word.lower === "reads");
    if (saysAt !== -1) {
      says = tokens[saysAt + 1] ?? null;
      if (says === null || !says.quoted) {
        const after = tokens.slice(saysAt + 1).filter((word) => word.lower !== ",");
        const words = after.map((word) => word.text).join(" ");
        const fixed = words === "" ? [] : [{ label: `${text.slice(0, text.length - text.slice(text.toLowerCase().lastIndexOf(after[0]!.text.toLowerCase())).length)}${JSON.stringify(words)}`, span, text: "" }];
        for (const fix of fixed) (fix as { text: string }).text = fix.label;
        this.#error("KDM2001", "the words after says go in quotes", span, 'for example: says "Download for macOS"', fixed);
        return null;
      }
      const from = saysAt > 0 && tokens[saysAt - 1]!.lower === "that" ? saysAt - 1 : saysAt;
      // `says "Welcome" Text says ...`: a new sentence began without a full stop.
      const nextWord = tokens[saysAt + 2];
      if (nextWord !== undefined && !nextWord.quoted && /^[A-Z]/.test(nextWord.text) && !(this.#options.components?.has(nextWord.text) ?? false)) {
        const at = says.end - span.start.offset;
        this.#error("KDM2001", `a new sentence seems to start at "${nextWord.text}"; sentences end with a full stop`, this.#span(nextWord.start, nextWord.end),
          `put a full stop after ${says.text}`, [{ label: `${text.slice(0, at)}. ${text.slice(nextWord.start - span.start.offset)}`, span, text: `${text.slice(0, at)}. ${text.slice(nextWord.start - span.start.offset)}` }]);
        return null;
      }
      // `A row says "#1042", "Paid".`: more quoted words after the first, one per cell.
      let stop = saysAt + 2;
      while (tokens[stop]?.lower === "," && tokens[stop + 1]?.quoted === true) {
        cells.push(tokens[stop + 1]!);
        stop += 2;
      }
      if (cells.length > 0) cells.unshift(says);
      tokens.splice(from, stop - from);
    }

    // shows "assets/..."  /  shows the icon "..."
    let shows: Word | null = null;
    let icon: Word | null = null;
    // An image ... from "assets/desk.jpg" says where the picture comes from.
    const fromAt = tokens.findIndex((word, index) => word.lower === "from" && tokens[index + 1]?.quoted === true);
    if (fromAt !== -1) tokens[fromAt] = { ...tokens[fromAt]!, lower: "shows", text: "shows" };
    const showsAt = tokens.findIndex((word) => word.lower === "shows");
    if (showsAt !== -1) {
      if (tokens[showsAt + 1]?.lower === "the" && tokens[showsAt + 2]?.lower === "icon" && tokens[showsAt + 3]?.quoted === true) {
        icon = tokens[showsAt + 3]!;
        tokens.splice(showsAt, 4);
      } else if (tokens[showsAt + 1]?.quoted === true) {
        shows = tokens[showsAt + 1]!;
        tokens.splice(showsAt, 2);
      }
    }

    // ... that goes to page "Pricing" / goes to the pricing page / links to "https://..." / opens "https://..."
    for (let at = 0; at < tokens.length; at += 1) {
      const word = tokens[at]!.lower;
      if (word !== "goes" && word !== "go" && word !== "links" && word !== "opens" && word !== "leads") continue;
      let from = at > 0 && (tokens[at - 1]!.lower === "that" || tokens[at - 1]!.lower === "and" || tokens[at - 1]!.lower === "which") ? at - 1 : at;
      if (from > 0 && tokens[from - 1]!.lower === ",") from -= 1;
      const rest = tokens.slice(at + 1);
      let line: string | null = null;
      let length = 0;
      if (rest[0]?.lower === "to" && rest[1]?.lower === "page" && rest[2]?.quoted === true) {
        line = `when clicked, go to page ${rest[2].text}`;
        length = 3;
      } else if (rest[0]?.lower === "to" && rest[1]?.lower === "the" && rest[3]?.lower === "page" && rest[2] !== undefined && !rest[2].quoted) {
        line = `when clicked, go to page ${JSON.stringify(capitalize(rest[2].text))}`;
        length = 4;
      } else if (rest[0]?.lower === "to" && rest[1]?.quoted === true) {
        line = `when clicked, open ${rest[1].text} in a new tab`;
        length = 2;
      } else if (word === "opens" && rest[0]?.quoted === true) {
        line = `when clicked, open ${rest[0].text} in a new tab`;
        length = 1;
        if (rest[1]?.lower === "in" && rest[2]?.lower === "a" && rest[3]?.lower === "new" && rest[4]?.lower === "tab") length = 5;
      }
      if (line !== null) {
        add(line);
        tokens.splice(from, at - from + 1 + length);
        break;
      }
    }
    // labelled "Email" (a field's label) and with the placeholder "..."
    const labelAt = tokens.findIndex((word) => word.lower === "labelled" || word.lower === "labeled");
    let label: Word | null = null;
    if (labelAt !== -1 && tokens[labelAt + 1]?.quoted === true) {
      label = tokens[labelAt + 1]!;
      tokens.splice(labelAt, 2);
    }
    // `in 14px`, `in gray`: the word in is only joining.
    tokens = tokens.filter((word, index) => !(word.lower === "in" && tokens[index + 1] !== undefined && knownDescribing(tokens[index + 1]!.lower)));
    // full-width / full width
    let fullWidth = false;
    for (const phrase of [["full-width"], ["full", "width"]]) {
      const at = indexOfPhrase(tokens, phrase);
      if (at !== -1) {
        fullWidth = true;
        tokens.splice(at, phrase.length);
      }
    }

    // on the left / on the right / at the end
    let end = false;
    for (const phrase of [["on", "the", "right"], ["at", "the", "end"], ["on", "the", "left"], ["at", "the", "start"]]) {
      const at = indexOfPhrase(tokens, phrase);
      if (at !== -1) {
        if (phrase[2] === "right" || phrase[2] === "end") end = true;
        tokens.splice(at, phrase.length);
      }
    }

    // with ... / without ...
    const withAt = tokens.findIndex((word) => word.lower === "with" || word.lower === "without");
    const clauses = withAt === -1 ? [] : tokens.splice(withAt);

    // A component instance.
    if (component !== undefined) {
      const info = this.#options.components!.get(component.text)!;
      // A PrimaryButton, but blue, says "...".  A FeatureCard without a shadow.
      const butAt = tokens.findIndex((word) => word.lower === "but");
      const overrides: Word[] = [];
      if (butAt !== -1) {
        let stop = butAt + 1;
        while (stop < tokens.length && tokens[stop]!.lower !== ",") stop += 1;
        overrides.push(...tokens.slice(butAt + 1, stop));
      }
      const withoutClauses = clauses.filter((_, index) => clauses.slice(0, index + 1).some((word) => word.lower === "without") &&
        !clauses.slice(clauses.findIndex((word) => word.lower === "without"), index + 1).some((word) => word.lower === "with"));
      if (overrides.length > 0 || withoutClauses.length > 0) {
        return this.#changedComponent(component.text, info, explicit, says, clauses.filter((word) => !withoutClauses.includes(word)), overrides, withoutClauses, end, span);
      }
      const name = this.#name(lowerFirst(component.text), explicit, span);
      const written = info.library === true ? `${component.text} from kadam` : component.text;
      const element: Element = { name, kind: "", span, statements, children: [], component: each === null ? written : `${written} for each ${each.item} in ${each.source}` };
      if (says !== null) {
        if (info.saysBlank === null) this.#error("KDM3023", `${component.text} has no blank for says`, span, info.blanks.length === 0 ? `${component.text} takes no blanks` : `its blanks: ${info.blanks.join(", ")}`);
        else add(`with ${article(info.saysBlank)} of ${says.text}`);
      }
      // with the title "Fast" and the description "..."
      this.#bindings(clauses, info, component.text, span, add);
      if (end && !this.#rightOf.has(parent)) {
        add("it sits at the end");
        this.#rightOf.add(parent);
      }
      return element;
    }

    let found = findKind(tokens);
    // `The Northwind wordmark shows "assets/mark.svg"`: a picture file makes an image.
    if (found === null && shows !== null && /\.(svg|png|jpe?g|gif|webp|avif)"$/i.test(shows.text)) {
      const last = [...tokens].reverse().find((word) => !word.quoted && /^[a-z]+$/i.test(word.text));
      if (last !== undefined) found = { kind: "image", base: "image", noun: last.text, at: tokens.indexOf(last), length: 1 };
    }
    // Inside a table, a row is a table row and a header is its header row.
    if (found !== null && parent.kind === "table" && (found.base === "row" || found.kind === "header")) {
      found = { ...found, kind: found.kind === "header" ? "header row" : "row", base: found.kind === "header" ? "headerRow" : "tableRow" };
    }
    if (found === null) {
      // A misspelt kind word: offer the kinds it is close to.
      for (const word of tokens) {
        if (word.quoted || word.lower.length < 3) continue;
        const near = KIND_NOUNS.map(([noun]) => noun).filter((noun) => !noun.includes(" ") && editDistance(word.lower, noun) <= (word.lower.length > 5 ? 2 : 1));
        if (near.length > 0) {
          const unique = [...new Set(near)].slice(0, 3);
          this.#error("KDM2001", `I don't know "${word.text}" in: ${text}`, this.#span(word.start, word.end), `did you mean: ${unique.join(" | ")}`,
            unique.map((noun) => ({ label: text.replace(word.text, noun), span: this.#span(word.start, word.end), text: noun })));
          return null;
        }
      }
      const near = closestMatches(text, sentenceSuggestions(), 3);
      this.#error("KDM2001", `I don't know what to make from: ${text}`, span,
        `a sentence that makes something names it, for example: A button says "Go". ${near.length > 0 ? `Close sentences: ${near.join(" | ")}` : ""}`.trim(),
        near.map((label) => ({ label, span, text: label })));
      return null;
    }
    let kind = found.kind;
    const before = tokens.slice(0, found.at);
    const after = tokens.slice(found.at + found.length);
    // Describing words mean the same in any order: they are read by class.
    const rank = (word: Word): number => {
      const value = word.lower;
      if (SIZE_WORDS.has(value) || value === "main") return 0;
      if (/^\d+(\.\d+)?(px|rem)$/.test(value)) return 1;
      if (isColor(value)) return 2;
      if (STYLE_WORDS[value] !== undefined) return 3;
      if (BOX_WORDS[value] !== undefined) return 4;
      return 5;
    };
    const describing = [...before, ...after].filter((word) => word.lower !== ",").map((word, order) => ({ word, order }))
      .sort((a, b) => rank(a.word) - rank(b.word) || a.order - b.order).map((entry) => entry.word);
    const descriptionWords: Word[] = [];

    // Heading level: a big heading is the page's main heading.
    // The first big heading is the page's main heading; later ones are big section headings.
    let bigSection = false;
    if (kind === "section heading") {
      if (describing.some((word) => ["big", "large", "huge", "main", "giant"].includes(word.lower))) {
        if (this.#mainHeading) bigSection = true;
        else kind = "main heading";
      } else if (describing.some((word) => ["small", "tiny"].includes(word.lower))) kind = "minor heading";
    }
    if (kind === "main heading") {
      if (this.#mainHeading && found.kind === "main heading") {
        kind = "section heading";
        bigSection = true;
      }
      this.#mainHeading = true;
    }
    const textual = TEXT_KINDS.has(kind) || kind === "button";
    // Several unknown words mean the sentence is not one Kadam knows: say so once.
    const unknownWords = describing.filter((word) => !knownDescribing(word.lower) && !MEDIA_KINDS.has(kind));
    if (unknownWords.length > 1) {
      this.#error("KDM2001", `I don't know the sentence: ${text}`, span,
        `the words I don't know: ${unknownWords.map((word) => word.text).join(", ")}. A sentence that makes something is: [a] [describing words] <kind> [called name] [says "..."], and a new sentence starts after a full stop`);
      return null;
    }
    // An exact size wins over small or big for the text.
    const exactSize = describing.some((word) => /^\d+(\.\d+)?(px|rem)$/.test(word.lower));
    for (const word of describing) {
      const value = word.lower;
      if (value === "main") continue;
      if (SIZE_WORDS.has(value)) {
        if (kind.endsWith("heading")) continue;
        if (kind === "button") {
          const small = value === "small" || value === "tiny";
          add(small ? "it has 8px padding on the top and bottom" : "it has 16px padding on the top and bottom");
          add(small ? "it has 14px padding on the left and right" : "it has 28px padding on the left and right");
          if (!exactSize) add(small ? "the text is 14px" : "the text is 18px");
        } else if (TEXT_KINDS.has(kind)) {
          if (!exactSize) add(`the text is ${TEXT_SIZE[value]}px`);
        }
        else this.#error("KDM3005", `"${word.text}" does not say how big ${article(kind)} is`, this.#span(word.start, word.end), `say a size, for example: it is 320px wide`);
        continue;
      }
      if (/^\d+(\.\d+)?(px|rem)$/.test(value)) {
        if (textual) add(`the text is ${value}`);
        else {
          const fixes = [`${value} tall`, `${value} wide`, `${value} padding`];
          this.#error("KDM3005", `"${value}" on ${article(kind)} could mean its height, its width or its padding`, this.#span(word.start, word.end),
            `say which: ${fixes.join(" | ")}`, fixes.map((fix) => ({ label: text.replace(word.text, fix), span: this.#span(word.start, word.end), text: fix })));
        }
        continue;
      }
      // A colored badge is a pale tint with dark text of the same hue, so it stays readable.
      if (kind === "badge" && BADGE_TINTS[value] !== undefined) {
        add(`has a ${BADGE_TINTS[value]![0]} background`);
        add(`the text is ${BADGE_TINTS[value]![1]}`);
        continue;
      }
      if (isColor(value)) {
        add(textual && kind !== "button" && kind !== "badge" ? `the text is ${textColor(value)}` : `has a ${value} background`);
        continue;
      }
      if (STYLE_WORDS[value] !== undefined) {
        add(STYLE_WORDS[value]!);
        continue;
      }
      if (value === "outlined" && kind === "button") {
        // An outlined button is light, with a thin border and dark text.
        add("has a white background");
        add("has a 1px #D1D5DB border");
        add("the text is #111827");
        continue;
      }
      if (BOX_WORDS[value] !== undefined) {
        for (const line of BOX_WORDS[value]!) add(line);
        continue;
      }
      if (value === "decorative") {
        add("it is decorative");
        continue;
      }
      if (MEDIA_KINDS.has(kind)) {
        descriptionWords.push(word);
        continue;
      }
      const near = closeWords(value);
      this.#error("KDM2001", `I don't know "${word.text}" in: ${text}`, this.#span(word.start, word.end),
        near.length > 0 ? `did you mean: ${near.join(" | ")}` : "remove it, or see the words in the language spec, section 17",
        near.map((option) => ({ label: text.replace(word.text, option), span: this.#span(word.start, word.end), text: option })));
    }

    // with white text, rounded corners and a soft shadow / without a shadow
    let mode: "with" | "without" = "with";
    let clause: Word[] = [];
    const flushClause = (): void => {
      if (clause.length === 0) return;
      const phrase = clause.map((word) => word.quoted ? word.text : word.lower).join(" ");
      const lines = mode === "with" ? withLines(phrase) : withoutLines(phrase);
      if (lines.length === 0) {
        this.#error("KDM2001", `I don't know "${mode} ${phrase}"`, this.#span(clause[0]!.start, clause.at(-1)!.end),
          mode === "with" ? "for example: with white text, with rounded corners, with a soft shadow, with 24px padding" : "for example: without a shadow, without a border, without a top border");
      }
      for (const line of lines) add(line);
      clause = [];
    };
    for (const word of clauses) {
      if (word.lower === "with" || word.lower === "without") {
        flushClause();
        mode = word.lower;
        continue;
      }
      if (word.lower === "and" || word.lower === ",") {
        flushClause();
        continue;
      }
      clause.push(word);
    }
    flushClause();

    if (found.base === "row") statements.unshift({ line: "it arranges its children in a row", span });
    if ((kind === "row" || kind === "header row") && says !== null) {
      const element: Element = { name: this.#name(found.base, explicit, span), kind, span, statements, children: [] };
      for (const cell of cells.length > 0 ? cells : [says]) {
        element.children.push({ name: this.#name("cell", null, span), kind: "cell", span, statements: [{ line: `the text says ${cell.text}`, span }], children: [] });
      }
      return element;
    }
    if (bigSection && !exactSize) add("the text is 40px");
    if (fullWidth) add("it is full width");
    const field = kind === "text field" || kind === "text area" || kind === "checkbox" || kind === "dropdown";
    if (label !== null) add(`the label says ${label.text}`);
    // A field "says" its label.
    if (says !== null && field && label === null) add(`the label says ${says.text}`);
    else if (says !== null) add(`the text says ${says.text}`);
    if (shows !== null) add(`it shows ${shows.text}`);
    if (icon !== null) add(`it shows the icon ${icon.text}`);
    if (MEDIA_KINDS.has(kind) && !statements.some((statement) => statement.line === "it is decorative")) {
      // Words stay where they were written: "Lumen logo", "photo of a hill".
      const nounAt = list.findIndex((word) => word.lower === found.noun.split(" ")[0]);
      const ahead = descriptionWords.filter((word) => word.start < (list[nounAt]?.start ?? 0)).map((word) => word.text);
      const behind = descriptionWords.filter((word) => word.start > (list[nounAt]?.start ?? 0)).map((word) => word.text);
      if (descriptionWords.length > 0) add(`the description says ${JSON.stringify(capitalize([...ahead, found.noun, ...behind].join(" ")))}`);
    }
    // Several things on the right: the first one pushes them all to the end.
    if (end && !this.#rightOf.has(parent)) {
      add("it sits at the end");
      this.#rightOf.add(parent);
    }
    const base = found.base === "logo" && descriptionWords.length > 0 ? "logo" : found.base;
    return { name: this.#name(base, explicit, span), kind, span, statements, children: [] };
  }

  /**
   * `but` and `without` at the place a component is used: the component's body
   * is copied here with its blanks filled, and each change replaces what the
   * component said about the same thing (the same property).
   */
  #changedComponent(name: string, info: ProseComponentInfo, explicit: string | null, says: Word | null, withClauses: readonly Word[],
    overrides: readonly Word[], withoutClauses: readonly Word[], end: boolean, span: Span): Element | null {
    if (info.body === undefined) {
      this.#error("KDM2001", `${name} is not from components.kdm, so it cannot be changed with but or without`, span, `run kadam eject ${name} to make it part of the project, or write the change in its own file`);
      return null;
    }
    const values = new Map<string, string>();
    if (says !== null && info.saysBlank !== null) values.set(info.saysBlank, says.text.slice(1, -1));
    for (let index = 0; index < withClauses.length; index += 1) {
      const word = withClauses[index]!;
      const value = withClauses[index + 1];
      if (info.blanks.includes(word.text) && value?.quoted === true) values.set(word.text, value.text.slice(1, -1));
    }
    for (const blank of info.blanks) {
      if (!values.has(blank)) this.#error("KDM3023", `${name} needs its ${blank}`, span, `add: with the ${blank} "..."`);
    }
    const fill = (line: string): string => line.replace(/\{\$([a-z][A-Za-z0-9]*)\}/g, (whole, blank: string) => values.get(blank) ?? whole);
    const changes: string[] = [];
    const scratch: Element = { name: "", kind: info.body.kind, span, statements: [], children: [] };
    for (const word of overrides) this.#describingWord(word, info.body.kind, false, (line) => changes.push(line), overrides.map((item) => item.text).join(" "));
    let clause: Word[] = [];
    const flushClause = (): void => {
      if (clause.length === 0) return;
      const phrase = clause.map((word) => (word.quoted ? word.text : word.lower)).join(" ");
      const lines = withoutLines(phrase);
      if (lines.length === 0) this.#error("KDM2001", `I don't know "without ${phrase}"`, span, "for example: without a shadow, without a border, without a top border");
      changes.push(...lines);
      clause = [];
    };
    for (const word of withoutClauses) {
      if (word.lower === "without" || word.lower === "and" || word.lower === ",") flushClause();
      else clause.push(word);
    }
    flushClause();
    void scratch;
    const changed = new Set(changes.flatMap(keysOf));
    const statements = [
      ...info.body.statements.map(fill).filter((line) => !keysOf(line).some((key) => changed.has(key))),
      ...changes,
      ...(end ? ["it sits at the end"] : []),
    ].map((line) => ({ line, span }));
    const element: Element = { name: this.#name(lowerFirst(name), explicit, span), kind: info.body.kind, span, statements, children: [] };
    for (const child of info.body.children) {
      element.children.push({ name: this.#name(child.base, null, span), kind: child.kind, span, statements: child.statements.map((line) => ({ line: fill(line), span })), children: [] });
    }
    return element;
  }

  /** One describing word (from `but ...`) as block sentences. */
  #describingWord(word: Word, kind: string, exactSize: boolean, add: (line: string) => void, text: string): void {
    const value = word.lower;
    const textual = TEXT_KINDS.has(kind) || kind === "button";
    if (SIZE_WORDS.has(value) && TEXT_KINDS.has(kind)) {
      if (!exactSize) add(`the text is ${TEXT_SIZE[value]}px`);
    } else if (/^\d+(\.\d+)?(px|rem)$/.test(value) && textual) add(`the text is ${value}`);
    else if (isColor(value)) add(textual && kind !== "button" && kind !== "badge" ? `the text is ${textColor(value)}` : `has a ${value} background`);
    else if (STYLE_WORDS[value] !== undefined) add(STYLE_WORDS[value]!);
    else if (BOX_WORDS[value] !== undefined) for (const line of BOX_WORDS[value]!) add(line);
    else if (value !== "," && value !== "and") {
      const near = closeWords(value);
      this.#error("KDM2001", `I don't know "${word.text}" in: ${text}`, this.#span(word.start, word.end), near.length > 0 ? `did you mean: ${near.join(" | ")}` : undefined,
        near.map((option) => ({ label: option, span: this.#span(word.start, word.end), text: option })));
    }
  }

  /**
   * components.kdm: `A PrimaryButton is a big black button that says ___.`
   * Each definition, with the sentences after it, becomes one component.
   */
  definitions(): { definitions: ProseComponentDefinition[]; diagnostics: readonly ProseDiagnostic[] } {
    const definitions: ProseComponentDefinition[] = [];
    let current: { name: string; span: Span; root: Element; blanks: string[]; saysBlank: string | null } | null = null;
    const finish = (): void => {
      if (current === null) return;
      const { name, span, root, blanks, saysBlank } = current;
      const out: Out = { lines: [], spans: [null] };
      const emit = (text: string, at: Span): void => {
        out.lines.push(text);
        out.spans.push(at);
      };
      emit("kadam 0.3", span);
      emit(`component ${name}${blanks.length === 0 ? "" : ` takes ${blanks.map((blank) => `${article(blank)} as text`).join(", ")}`} {`, span);
      emit(`    ${root.name} {`, span);
      emit(`        ${article(root.kind)}`, span);
      for (const statement of root.statements) emit(`        ${statement.line}`, statement.span);
      for (const child of root.children) {
        emit(`        ${child.name} {`, child.span);
        emit(`            ${article(child.kind)}`, child.span);
        for (const statement of child.statements) emit(`            ${statement.line}`, statement.span);
        emit("        }", child.span);
      }
      emit("    }", span);
      emit("}", span);
      const body: ProseComponentBody = {
        kind: root.kind,
        statements: root.statements.map((statement) => statement.line),
        children: root.children.map((child) => ({ base: child.name.replace(/\d+$/, ""), kind: child.kind, statements: child.statements.map((statement) => statement.line) })),
      };
      definitions.push({ name, span, info: { saysBlank, blanks, body }, text: `${out.lines.join("\n")}\n`, lineSpans: out.spans });
      current = null;
    };
    for (const line of this.#lines()) {
      if (line.indent === -1) continue;
      for (const piece of splitSentences(line.text, line.start)) {
        const span = this.#span(piece.start, piece.end);
        const definition = /^(?:A|An) ([A-Z][A-Za-z0-9]*) is (.+)$/.exec(piece.text);
        if (definition !== null) {
          finish();
          const name = definition[1]!;
          let phrase = definition[2]!;
          const blanks: string[] = [];
          let saysBlank: string | null = null;
          // that says ___
          phrase = phrase.replace(/(?:,?\s*that)?\s*says ___/, () => {
            saysBlank = "label";
            blanks.push("label");
            return ' says "{$label}"';
          });
          // with a ___ title and a ___ description
          const children: { role: string }[] = [];
          phrase = phrase.replace(/(?:,?\s*(?:with|and)\s+|,\s*)an? ___ ([a-z][A-Za-z0-9]*)/g, (_whole, role: string) => {
            children.push({ role });
            blanks.push(role);
            return "";
          });
          if (/___/.test(phrase)) {
            this.#error("KDM2001", "a blank is written says ___ or with a ___ title", span, 'for example: A Badge is a small badge that says ___. or A Card is a card with a ___ title.');
            continue;
          }
          this.#used.clear();
          this.#names.clear();
          const host: Element = { name: "", kind: "", span, statements: [], children: [] };
          const sentence = { text: `A ${phrase.trim()}`, start: piece.start, end: piece.end };
          const root = this.#element(sentence.text, words(sentence.text, piece.start), span, host);
          if (root === null) continue;
          root.name = this.#name(lowerFirst(name), null, span);
          for (const child of children) {
            // A blank with another name is plain text.
            const kind = CHILD_ROLES[child.role] ?? { kind: "paragraph", statements: [] };
            root.children.push({ name: this.#name(child.role, null, span), kind: kind.kind, span, statements: [...kind.statements.map((line) => ({ line, span })), { line: `the text says "{$${child.role}}"`, span }], children: [] });
          }
          current = { name, span, root, blanks, saysBlank };
          continue;
        }
        if (current === null) {
          this.#error("KDM2001", "components.kdm holds definitions such as: A PrimaryButton is a black button that says ___.", span, "start each component with A <Name> is ...");
          continue;
        }
        const said = normalizedPiece(piece);
        this.#describe(said.text, words(said.text, said.start), span, current.root);
      }
    }
    finish();
    return { definitions, diagnostics: this.#diagnostics };
  }

  /** `with the title "Fast" and the description "..."` on a component. */
  #bindings(clauses: readonly Word[], info: ProseComponentInfo, component: string, span: Span, add: (line: string) => void): void {
    let index = 0;
    while (index < clauses.length) {
      const word = clauses[index]!;
      if (["with", "and", ",", "the", "a", "an"].includes(word.lower)) {
        index += 1;
        continue;
      }
      const value = clauses[index + 1];
      // with the title of the project: a field of each record.
      if (value?.lower === "of" && clauses[index + 2] !== undefined) {
        const record = clauses[index + 2]!.lower === "the" ? clauses[index + 3] : clauses[index + 2];
        if (record !== undefined && !record.quoted) {
          if (!info.blanks.includes(word.text)) {
            this.#error("KDM3023", `${component} has no blank called ${word.text}`, this.#span(word.start, word.end), `its blanks: ${info.blanks.join(", ") || "none"}`);
          } else add(`with ${article(word.text)} of the ${word.text} of ${record.text}`);
          index += clauses[index + 2]!.lower === "the" ? 4 : 3;
          continue;
        }
      }
      if (value === undefined || !value.quoted) {
        this.#error("KDM2001", `after ${word.text} I expected its words in quotes`, span, `for example: with the ${word.text} "...", or with the ${word.text} of the project`);
        return;
      }
      if (!info.blanks.includes(word.text)) {
        this.#error("KDM3023", `${component} has no blank called ${word.text}`, this.#span(word.start, word.end), `its blanks: ${info.blanks.join(", ") || "none"}`,
          closestMatches(word.text, info.blanks, 2).map((option) => ({ label: option, span: this.#span(word.start, word.end), text: option })));
      } else add(`with ${article(word.text)} of ${value.text}`);
      index += 2;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers

function findKind(list: readonly Word[]): { kind: string; base: string; noun: string; at: number; length: number } | null {
  for (let at = 0; at < list.length; at += 1) {
    for (const [noun, kind, base] of KIND_NOUNS) {
      const parts = noun.split(" ");
      if (parts.every((part, offset) => list[at + offset]?.lower === part && list[at + offset]?.quoted === false)) {
        return { kind, base, noun, at, length: parts.length };
      }
    }
  }
  return null;
}

function indexOfPhrase(list: readonly Word[], phrase: readonly string[]): number {
  for (let at = 0; at + phrase.length <= list.length; at += 1) {
    if (phrase.every((part, offset) => list[at + offset]!.lower === part)) return at;
  }
  return -1;
}

function insideQuotes(text: string): boolean {
  return (text.split('"').length - 1) % 2 === 1;
}

function article(kind: string): string {
  return `${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}`;
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toLowerCase()}${text.slice(1)}`;
}

function lowerFirstWords(text: string, list: readonly Word[]): string {
  return list.map((word) => (word.quoted ? word.text : word.lower)).join(" ").replace(/ ,/g, ",") || text;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`;
}

function camel(parts: readonly string[]): string {
  return parts.map((part, index) => (index === 0 ? part : capitalize(part))).join("");
}

function firstWords(text: string): string {
  return text.split(" ").slice(0, 3).join(" ");
}

/**
 * Split `rounded corners, a soft shadow and 24px padding` into its clauses. An
 * `and` only starts a new clause before a number, `a`/`an`, `no`, `rounded` or
 * `fully`, so `on the top and bottom` stays together.
 */
function splitAnd(text: string): string[] {
  return text.split(/,\s*(?:and\s+)?|\s+and\s+(?=\d|an?\s|no\s|rounded\b|fully\b|square\b)/i).map((part) => part.trim()).filter((part) => part !== "");
}

const accepted = new Map<string, boolean>();

/** True when the block grammar accepts the line as exactly one statement. Cached: the same lines repeat. */
export function accepts(line: string): boolean {
  const known = accepted.get(line);
  if (known !== undefined) return known;
  const tokens = lex(new SourceFile("line.kdm", line)).tokens.filter((token) => token.kind !== "newline" && token.kind !== "eof" && token.kind !== "comment");
  const result = matchLine(tokens, { allowResponsive: true, languageVersion: "0.3", quick: true });
  const yes = result.selected !== null && result.diagnostics.length === 0;
  if (accepted.size > 20000) accepted.clear();
  accepted.set(line, yes);
  return yes;
}

function backgroundLines(value: string): string[] {
  // a blue to white gradient [going] from left to right
  const gradient = /^an? (.+?) gradient(?: (?:going |that goes )?from (left|right|top|bottom) to (left|right|top|bottom))?$/.exec(value);
  if (gradient !== null) {
    const colors = gradient[1]!.replace(/\bto\b/g, "and").replace(/,/g, " and").replace(/\s+/g, " ").trim();
    const lines = [`has a ${colors} gradient`];
    if (gradient[2] !== undefined) lines.push(`the gradient goes from ${gradient[2]} to ${gradient[3]}`);
    return lines;
  }
  if (/^"[^"]+"$/.test(value)) return [`has a ${value} background image`];
  return [`has a ${value.replace(/^an? /, "")} background`];
}

function withLines(phrase: string): string[] {
  const color = /^([#a-z0-9]+) text$/.exec(phrase);
  if (color !== null) return [`the text is ${textColor(color[1]!)}`];
  const size = /^(\d+(?:\.\d+)?(?:px|rem)) text$/.exec(phrase);
  if (size !== null) return [`the text is ${size[1]}`];
  const gap = /^(?:a )?(\d+(?:\.\d+)?(?:px|rem)) gap(?: between (?:them|its children|children))?$/.exec(phrase);
  if (gap !== null) return [`it has ${gap[1]} gap between children`];
  for (const candidate of [`has ${phrase}`, `it has ${phrase}`, `has a ${phrase}`]) if (accepts(candidate)) return [candidate];
  return [];
}

function withoutLines(phrase: string): string[] {
  const table: Readonly<Record<string, string>> = {
    "a shadow": "has no shadow",
    shadow: "has no shadow",
    "a border": "has no border",
    border: "has no border",
    "a background": "has no background",
    background: "has no background",
    "rounded corners": "has 0px rounded corners",
    "a top border": "has no border on the top",
    "a top line": "has no border on the top",
    "the top line": "has no border on the top",
    "a bottom border": "has no border on the bottom",
    "a bottom line": "has no border on the bottom",
    "a left border": "has no border on the left",
    "a right border": "has no border on the right",
    underline: "the text is not underlined",
    "an underline": "the text is not underlined",
  };
  const line = table[phrase];
  return line === undefined ? [] : [line];
}

let suggestions: readonly string[] | null = null;
function sentenceSuggestions(): readonly string[] {
  if (suggestions !== null) return suggestions;
  suggestions = [
    'A big heading says "..."',
    'Small gray text says "..."',
    'A black button says "..."',
    'A link says "..."',
    'A photo of a desk shows "assets/desk.jpg"',
    'A card says "..."',
    "After that, a 50px gap",
    "A divider",
  ];
  return suggestions;
}

/** Vocabulary words within a small edit distance; anything further would be a guess. */
function closeWords(value: string): string[] {
  const limit = value.length <= 4 ? 1 : 2;
  return closestMatches(value, VOCABULARY, 3).filter((candidate) => editDistance(value, candidate) <= limit).slice(0, 2);
}

function knownDescribing(value: string): boolean {
  return value === "main" || value === "," || value === "decorative" || SIZE_WORDS.has(value) || /^\d+(\.\d+)?(px|rem)$/.test(value) ||
    isColor(value) || STYLE_WORDS[value] !== undefined || BOX_WORDS[value] !== undefined;
}

/** D-50: sentence starters for editors, in the paragraph form. */
export const PROSE_SENTENCES: readonly { readonly text: string; readonly detail: string }[] = [
  { text: 'A big heading says "..."', detail: "The page's main heading" },
  { text: 'A heading says "..."', detail: "A section heading" },
  { text: 'Text says "..."', detail: "A paragraph" },
  { text: 'Small gray text, 18px, says "..."', detail: "A paragraph with describing words" },
  { text: 'A big black button called download says "..."', detail: "A named button" },
  { text: 'A link says "...". When clicked, go to page "..."', detail: "A link to another page" },
  { text: 'A photo of a desk shows "assets/desk.jpg"', detail: "An image and its description" },
  { text: 'An icon shows the icon "arrow right". It is decorative', detail: "A built-in icon" },
  { text: "After that, a 50px gap", detail: "Space before the next thing" },
  { text: "Hero section:", detail: "A section; indent the lines that belong to it" },
  { text: "Nav bar:", detail: "A navigation bar; indent its links" },
  { text: "The background is a blue to white gradient from left to right", detail: "Background" },
  { text: "It has rounded corners and a soft shadow", detail: "Describes the thing just named" },
  { text: "When hovered, a white fill slides in from the left", detail: "Button effect" },
  { text: "When hovered, a shine sweeps across it", detail: "Button effect" },
  { text: "It pulls toward the cursor", detail: "Button effect" },
  { text: "It ripples when pressed", detail: "Button effect" },
  { text: "When the cursor moves over it, white pixels pop out around the cursor", detail: "Cursor effect" },
  { text: "When the cursor moves over it, grain surrounds the cursor within 10px", detail: "Cursor effect" },
  { text: "When the cursor moves over it, a glow follows the cursor", detail: "Cursor effect" },
  { text: "It appears word by word", detail: "Text effect" },
  { text: "It types itself", detail: "Text effect" },
  { text: "It scrambles into place", detail: "Text effect" },
  { text: "Its text is a blue to purple gradient", detail: "Text effect" },
  { text: 'A highlight sweeps under "..."', detail: "Text effect" },
  { text: "It tilts as you scroll", detail: "Scroll effect" },
  { text: "It appears as you scroll", detail: "Scroll effect" },
  { text: "The page fades in when it opens", detail: "Page effect" },
  { text: "Pages fade into each other when you move between them", detail: "Page effect" },
  { text: 'The page is called "..."', detail: "The page title (otherwise the file name)" },
];

/**
 * D-50 phrase table: other ways people say a sentence the language has. Each
 * row is a fixed rewrite, so this is vocabulary, not guessing (spec 17.6).
 * Returns the block sentences, or null when the sentence is not in the table.
 */
export function rephrase(sentence: string): string[] | null {
  const s = sentence.replace(/\s+/g, " ").trim();
  let m: RegExpExecArray | null;
  // the background is a gradient with blue on the left and white on the right
  if ((m = /^the background is an? gradient (?:with|of|from) (\S+) on the (left|top|right|bottom) (?:and|to) (\S+) on the (left|top|right|bottom)$/.exec(s)) !== null) {
    return [`has a ${m[1]} and ${m[3]} gradient`, `the gradient goes from ${m[2]} to ${m[4]}`];
  }
  // the background is blue on the left fading to white on the right
  if ((m = /^the background is (\S+) on the (left|top|right|bottom),? (?:fading|going|turning) (?:in)?to (\S+) on the (left|top|right|bottom)$/.exec(s)) !== null) {
    return [`has a ${m[1]} and ${m[3]} gradient`, `the gradient goes from ${m[2]} to ${m[4]}`];
  }
  // it has a background image "assets/hero.jpg" / its background is "..."
  if ((m = /^(?:it has a background image|its background(?: image)? is|the background image is) ("[^"]+")$/.exec(s)) !== null) return [`has a ${m[1]} background image`];
  // the text is gray: the readable gray (see textColor)
  if ((m = /^(?:the text|its text|it) is (gray|grey)$/.exec(s)) !== null) return [`the text is ${textColor(m[1]!)}`];
  // it has some padding / plenty of padding / a little padding
  if ((m = /^it has (some|a little|a bit of|plenty of|a lot of|lots of) (padding|space inside|room inside)$/.exec(s)) !== null) {
    return [`it has ${m[1] === "a little" || m[1] === "a bit of" ? 8 : m[1] === "some" ? 16 : 48}px padding`];
  }
  // add "assets/hero.jpg" as the background / put the image "..." in the background
  if ((m = /^(?:add|put|use|set)(?: the image)? ("[^"]+") (?:as|in|for) the background$/.exec(s)) !== null) return [`has a ${m[1]} background image`];
  if ((m = /^the background is the (?:image|picture|photo) ("[^"]+")$/.exec(s)) !== null) return [`has a ${m[1]} background image`];
  // its children are centered / everything in it is centered
  if (/^(?:its children are|everything in it is|its content is) cent(?:ere|re)d$/.test(s)) return ["it centers its children"];
  // its children sit side by side / are in a row
  if (/^its children (?:sit|are|go|line up) (?:side by side|in a row|next to each other)$/.test(s)) return ["it arranges its children in a row"];
  if (/^its children (?:are stacked|stack|sit on top of each other|are in a column)$/.test(s)) return ["it arranges its children in a column"];
  if ((m = /^its children (?:are|sit) in (\d+) columns$/.exec(s)) !== null) return [`it arranges its children in ${m[1]} columns`];
  // it takes the full width
  if (/^it (?:takes|fills|uses) the (?:full|whole) width$/.test(s)) return ["it is full width"];
  if (/^it (?:takes|fills|uses) (?:the rest(?: of the space)?|the remaining space|the space left|what is left)$/.test(s)) return ["it grows to fill the space"];
  // it has a border / a shadow / big rounded corners
  if (/^it has an? (?:thin )?border$/.test(s)) return ["has a 1px #6B728040 border"];
  if (/^it has an? shadow$/.test(s)) return ["has a soft shadow"];
  if ((m = /^it has (big|large|small|slightly) rounded corners$/.exec(s)) !== null) return [`has ${m[1] === "small" || m[1] === "slightly" ? 4 : 16}px rounded corners`];
  // it is hidden on phones / on phones, its children are stacked
  if ((m = /^(.+) on (phones|tablets|desktops)$/.exec(s)) !== null && !s.startsWith("on ")) {
    const inner = rephrase(m[1]!) ?? [m[1]!];
    return inner.map((line) => `on ${m![2]}, ${line}`);
  }
  if ((m = /^on (phones|tablets|desktops), (.+)$/.exec(s)) !== null) {
    const inner = rephrase(m[2]!);
    if (inner !== null) return inner.map((line) => `on ${m![1]}, ${line}`);
  }
  // when hovered, it gets bigger / grows / shrinks; its background turns black
  if (/^when hovered, it (?:gets bigger|grows(?: a little)?|grows slightly|gets a little bigger)$/.test(s)) return ["when hovered, it scales to 105%"];
  if (/^when hovered, it (?:gets smaller|shrinks(?: a little)?)$/.test(s)) return ["when hovered, it scales to 95%"];
  if ((m = /^when (hovered|focused|pressed), its (background|text|border) (turns|becomes|goes) (.+)$/.exec(s)) !== null) return [`when ${m[1]}, the ${m[2]} turns ${m[4]}`];
  // when clicked, it goes to the pricing page / it goes to page "Pricing"
  if ((m = /^(?:when clicked, )?it (?:goes|takes you|leads) to the (\S+) page$/.exec(s)) !== null) return [`when clicked, go to page ${JSON.stringify(m[1]![0]!.toUpperCase() + m[1]!.slice(1))}`];
  if ((m = /^(?:when clicked, )?it (?:goes|takes you|leads) to page ("[^"]+")$/.exec(s)) !== null) return [`when clicked, go to page ${m[1]}`];
  // it opens "https://..." [in a new tab] [when clicked] / it links to "https://..."
  if ((m = /^it (?:opens|links to|goes to) ("[^"]+")(?: in a new tab)?(?: when clicked)?$/.exec(s)) !== null) return [`when clicked, open ${m[1]} in a new tab`];
  // it slides in from the left / it fades in (when the page loads is understood)
  if ((m = /^it (slides in from the (?:left|right|top|bottom)|fades in)$/.exec(s)) !== null) return [`it ${m[1]} when the page loads`];
  return null;
}

/**
 * D-50 phrase table for motion (spec 17.6): the mouse is the cursor, "on hover"
 * is "when hovered", and the everyday ways to say each effect. Null when the
 * sentence needs no change.
 */
export function normalizeMotion(sentence: string): string | null {
  let s = sentence.replace(/\s+/g, " ").trim();
  const before = s;
  s = s.replace(/\bthe (mouse|pointer)\b/g, "the cursor");
  s = s.replace(/^when the cursor (?:goes|moves|hovers|passes|is|comes) over (?:it|this section|that section|the section|this|them)(?: section)?,/, "when the cursor moves over it,");
  s = s.replace(/^(?:on hover|when you hover over it|when hovering|on mouse over|when the cursor is on it),/, "when hovered,");
  // ... on hover  →  when hovered, ...
  const onHover = /^(.+?),? (?:on hover|when hovered|when you hover over it)$/.exec(s);
  if (onHover !== null && !onHover[1]!.startsWith("when ")) s = `when hovered, ${onHover[1]}`;
  const table: readonly [RegExp, string][] = [
    [/^when hovered, it lifts$/, "when hovered, it lifts by 4px"],
    [/^when hovered, it (?:has|gets|plays) a sliding (?:animation|fill|effect)$/, "when hovered, a fill slides in from the left"],
    [/^when hovered, it shines$|^when hovered, it has a shine(?: effect)?$/, "when hovered, a shine sweeps across it"],
    [/^it ripples (?:when you click it|when clicked|when you press it|when tapped|on click)$/, "it ripples when pressed"],
    [/^it (?:tilts|leans) (?:when you scroll|on scroll|while you scroll|as the page scrolls)$/, "it tilts as you scroll"],
    [/^it (?:appears|fades in|shows up) (?:when you scroll to it|on scroll|as you scroll|when it scrolls into view|when you reach it)$/, "it appears as you scroll"],
    [/^it slides in from the (left|right|top|bottom) (?:as you scroll|on scroll|when you scroll to it)$/, "it slides in from the $1 when it scrolls into view"],
    [/^it (?:types itself out|types out|is typed out|types)$/, "it types itself"],
    [/^(?:its words appear one by one|it appears one word at a time|its words come in one by one|it appears word by word)$/, "it appears word by word"],
    [/^it (?:scrambles|unscrambles)(?: in| itself)?$/, "it scrambles into place"],
    [/^it (?:follows|leans toward|moves toward|is pulled toward) the cursor$|^it is magnetic$/, "it pulls toward the cursor"],
  ];
  for (const [pattern, canonical] of table) {
    if (pattern.test(s)) {
      s = s.replace(pattern, canonical);
      break;
    }
  }
  return s === before ? null : s;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/**
 * D-50: number words outside quotes become digits: `fifty pixel` is `50 pixel`,
 * `twenty-four` is `24`, `two hundred` is `200`, `two columns` is `2 columns`.
 * `a`, `an` and `one` before a noun stay words.
 */
export function numbersToDigits(text: string): string {
  return text.split(/("(?:[^"\\]|\\.)*")/).map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(/\b(?:(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](one|two|three|four|five|six|seven|eight|nine))?|(one))(?: (hundred))?\b(?=\s*(?:px|pixels?|rem|columns?|%|percent|hundred|deg|degrees)\b|\s+hundred\b)?/gi,
      (whole, tens: string | undefined, ones: string | undefined, single: string | undefined, hundred: string | undefined, offset: number, all: string) => {
        // Only numbers that measure something: followed by a unit, columns, or hundred.
        const after = all.slice(offset + whole.length);
        if (!/^\s*(?:px|pixels?|rem|columns?|%|percent|deg|degrees)\b/i.test(after) && hundred === undefined) return whole;
        let value = (NUMBER_WORDS[(tens ?? single ?? "").toLowerCase()] ?? 0) + (ones === undefined ? 0 : NUMBER_WORDS[ones.toLowerCase()] ?? 0);
        if (hundred !== undefined) value *= 100;
        return String(value);
      });
  }).join("");
}

/**
 * D-50 phrase table for instructions (spec 17.6): `Add a heading that says ...`,
 * `Make it bold`, `Give it rounded corners`, `Center the text`, `Hide it on
 * phones`, `Make sure it tilts as you scroll`. Null when nothing changes.
 */
export function normalizeImperative(sentence: string): string | null {
  const before = sentence.replace(/\s+/g, " ").trim();
  let s = before;
  s = s.replace(/^(?:please,? )?/, "");
  s = s.replace(/^make sure (?:that )?(it|its|the) /, "$1 ");
  const table: readonly [RegExp, string][] = [
    [/^make it (\d+(?:\.\d+)?(?:px|rem|%) (?:wide|tall))$/, "it is $1"],
    [/^make it (.+)$/, "it is $1"],
    [/^make (?:the|its) (text|background|border|corners|gradient) (.+)$/, "the $1 is $2"],
    [/^give it (.+)$/, "it has $1"],
    [/^cent(?:er|re) it$/, "it is centered"],
    [/^cent(?:er|re) (?:the|its) text$/, "the text is centered"],
    [/^cent(?:er|re) (?:its children|everything in it|its content)$/, "it centers its children"],
    [/^hide it(?: on (phones|tablets|desktops))?$/, "it is hidden on $1"],
    // Add a heading ...; but `Add "..." as the background` is a background sentence.
    [/^(?:add|put|place|show|insert|include|there is|there's|we have|have|then add|then put) (?:a |an |the )?(?!.*\b(?:as|in|for) the background$)(.+)$/, "a $1"],
  ];
  for (const [pattern, replacement] of table) {
    if (pattern.test(s)) {
      s = s.replace(pattern, replacement).replace(/ on $/, "");
      break;
    }
  }
  // A bare "a <noun>" from "Add gray text ..." reads "A gray text": drop the article before text.
  s = s.replace(/^a ((?:(?!says\b|saying\b)[a-z0-9#,-]+ )*)text\b/, (match) => match.replace(/^a /, ""));
  return s === before ? null : s;
}

/** Number words, instructions and motion phrasings become the canonical sentence. */
function normalizedPiece(piece: { text: string; start: number; end: number }): { text: string; start: number; end: number } {
  // D-51: `The page font is Lora.` names a font without quotes; the name keeps its capitals.
  const font = /^(the page font is|the (?:heading|headings) font (?:is|are)|the font is|its font is|the text font is)\s+([^"].*?)\.?$/i.exec(piece.text.trim());
  if (font !== null && !/^(?:sans[ -]serif|serif|monospace)$/i.test(font[2]!.trim())) {
    const lead = font[1]!.toLowerCase();
    const canonical = lead.startsWith("the page") ? "The page font is" : lead.startsWith("the head") ? "The heading font is" : "The font is";
    return { text: `${canonical} "${font[2]!.trim()}"`, start: piece.start, end: piece.end };
  }
  const casePreserved = words(numbersToDigits(piece.text), piece.start).map((word) => (word.quoted || /^[A-Z][a-z0-9]*[A-Z]/.test(word.text) ? word.text : word.lower)).join(" ").replace(/ ,/g, ",");
  const plain = normalizeImperative(casePreserved) ?? casePreserved;
  const said = normalizeMotion(plain) ?? (plain === casePreserved && numbersToDigits(piece.text) === piece.text ? null : plain);
  return said === null ? piece : { text: capitalize(said), start: piece.start, end: piece.end };
}

/**
 * D-50: in a paragraph page, gray text is a gray that stays readable on white
 * (#6B7280, 4.8:1). CSS's own gray (#808080) fails WCAG AA for body text; write
 * #808080 to get it.
 */
function textColor(value: string): string {
  return value === "gray" || value === "grey" ? "#6B7280" : value;
}

/** D-50: badge colors as readable tints: background, then text. */
const BADGE_TINTS: Readonly<Record<string, readonly [string, string]>> = {
  green: ["#DCFCE7", "#166534"],
  red: ["#FEE2E2", "#991B1B"],
  yellow: ["#FEF9C3", "#854D0E"],
  orange: ["#FFEDD5", "#9A3412"],
  blue: ["#DBEAFE", "#1E40AF"],
  purple: ["#F3E8FF", "#6B21A8"],
  pink: ["#FCE7F3", "#9D174D"],
  gray: ["#F3F4F6", "#374151"],
  grey: ["#F3F4F6", "#374151"],
};

/**
 * D-50: a line that shapes a data list, in the block form: `Only where the
 * featured of the project is true.`, `Sorted by the year of the project from
 * highest to lowest.`, `Showing at most 3.` Null when the line is not one.
 */
export function shapingLine(text: string): string | null {
  let s = text.trim().replace(/\.$/, "");
  s = `${s[0]?.toLowerCase() ?? ""}${s.slice(1)}`;
  s = s.replace(/^(?:only if|only when|keep only those where|where)\b/, "only where").replace(/^(?:ordered by|sort by|sorted on)\b/, "sorted by")
    .replace(/^(?:show at most|showing only|show only|only show|at most)\s+(\d+)\b.*$/, "showing at most $1");
  if (!/^(only where|sorted by|showing at most)\b/.test(s)) return null;
  s = s.replace(/ of the ([a-z][A-Za-z0-9]*)\b/g, " of $1").replace(/,\s*/g, " ").replace(/\b(newest|biggest|largest|highest) first$/, "from highest to lowest").replace(/\s*\b(oldest|smallest|lowest) first$/, "");
  return s.trim();
}

/** True for black and for colors dark enough that text on them should be light. */
function isDarkColor(value: string): boolean {
  if (value === "black") return true;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex === undefined) return false;
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.25;
}
