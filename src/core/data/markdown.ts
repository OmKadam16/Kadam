import type { BuiltinKindName, ElementNode, StatementNode, TextSpanEffect } from "../ast/nodes.js";
import type { DiagnosticBag } from "../diagnostics/diagnostic.js";
import type { SourceFile, Span } from "../source/source-file.js";
import { BUILTIN_KIND_INFO } from "../parser/kind.js";

/**
 * kadam 0.3 (F5 step 4, D-40): Markdown documents. `it shows the document
 * "content/intro.md"` turns a Markdown file into ordinary Kadam elements at
 * build time, so every page check (one main heading, contrast, dark mode,
 * links) applies to it. The subset is small and strict: anything it does not
 * support is an error, and raw HTML is never passed through.
 *
 * Blocks: # to #### headings, paragraphs, - / * / + and 1. lists (one level),
 * ``` fenced code, --- dividers, and ![description](assets/x.png) images on
 * their own line. Inline: **bold**, *italic* or _italic_, `code`, and
 * [text](https://...) links. A backslash makes the next punctuation literal.
 */

export type MarkdownInline = {
  readonly text: string;
  readonly spans: readonly { readonly start: number; readonly length: number; readonly effect: InlineEffect }[];
};

type InlineEffect = { readonly type: "bold" | "italic" | "code" } | { readonly type: "link"; readonly url: string };

export type MarkdownBlock =
  | { readonly type: "heading"; readonly level: 1 | 2 | 3 | 4; readonly inline: MarkdownInline; readonly span: Span }
  | { readonly type: "paragraph"; readonly inline: MarkdownInline; readonly span: Span }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: readonly MarkdownInline[]; readonly span: Span }
  | { readonly type: "code"; readonly text: string; readonly span: Span }
  | { readonly type: "divider"; readonly span: Span }
  | { readonly type: "image"; readonly description: string; readonly source: string; readonly span: Span };

export const MAX_DOCUMENT_BLOCKS = 2000;

const ITEM = /^([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const DIVIDER = /^(?:-{3,}|\*{3,}|_{3,})$/;
const LINK_URL = /^(?:https?:\/\/|mailto:)[^\s<>"]+$/;

export function parseMarkdown(source: SourceFile, diagnostics: DiagnosticBag): MarkdownBlock[] | null {
  const lines = source.text.split("\n");
  const blocks: MarkdownBlock[] = [];
  let ok = true;
  const lineSpan = (index: number): Span => source.lineSpan(index + 1);
  const fail = (message: string, index: number, hint: string): void => {
    diagnostics.error("KDM4011", `document '${source.path}': ${message}`, lineSpan(index), hint);
    ok = false;
  };
  const inline = (text: string, index: number): MarkdownInline => {
    const result = parseInline(text);
    if (typeof result === "string") {
      fail(result, index, "write plain text, or one of **bold**, *italic*, `code`, and [text](https://...) without nesting");
      return { text, spans: [] };
    }
    return result;
  };

  let paragraph: { lines: string[]; start: number } | null = null;
  let list: { ordered: boolean; items: { text: string; line: number }[]; start: number } | null = null;
  const flush = (end: number): void => {
    if (paragraph !== null) {
      blocks.push({ type: "paragraph", inline: inline(paragraph.lines.join(" "), paragraph.start), span: source.span(source.lineStart(paragraph.start + 1), source.lineEnd(end + 1)) });
      paragraph = null;
    }
    if (list !== null) {
      const current = list;
      blocks.push({
        type: "list",
        ordered: current.ordered,
        items: current.items.map((item) => inline(item.text, item.line)),
        span: source.span(source.lineStart(current.start + 1), source.lineEnd(end + 1)),
      });
      list = null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!.replace(/\s+$/, "");
    const line = raw.trimStart();
    const indent = raw.length - line.length;
    if (line === "") {
      flush(Math.max(index - 1, 0));
      continue;
    }
    if (line.startsWith("```") || line.startsWith("~~~")) {
      flush(index - 1);
      const fence = line.slice(0, 3);
      const body: string[] = [];
      let end = index + 1;
      while (end < lines.length && !lines[end]!.trimStart().startsWith(fence)) {
        body.push(lines[end]!);
        end += 1;
      }
      if (end >= lines.length) {
        fail("a code block is never closed", index, `end it with ${fence} on its own line`);
        break;
      }
      if (body.length === 0) fail("a code block is empty", index, "put code between the fences, or remove them");
      else blocks.push({ type: "code", text: body.join("\n"), span: source.span(source.lineStart(index + 1), source.lineEnd(end + 1)) });
      index = end;
      continue;
    }
    if (line.startsWith("<")) {
      flush(index - 1);
      fail("raw HTML is not allowed in a document", index, "write it as Markdown, or as Kadam elements on the page");
      continue;
    }
    if (line.startsWith(">")) {
      flush(index - 1);
      fail("quotes (> ...) are not supported yet", index, "write the quote as a paragraph");
      continue;
    }
    if (line.startsWith("|")) {
      flush(index - 1);
      fail("tables are not supported in documents yet", index, "use a Kadam table on the page");
      continue;
    }
    const heading = /^(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*$/.exec(line);
    if (heading !== null && (heading[2] ?? "") !== "") {
      flush(index - 1);
      const level = heading[1]!.length;
      if (level > 4) fail(`a level ${level} heading is deeper than Kadam's four heading levels`, index, "use # to ####");
      else blocks.push({ type: "heading", level: level as 1 | 2 | 3 | 4, inline: inline(heading[2]!, index), span: lineSpan(index) });
      continue;
    }
    if (DIVIDER.test(line.replace(/[ \t]/g, ""))) {
      flush(index - 1);
      blocks.push({ type: "divider", span: lineSpan(index) });
      continue;
    }
    const image = IMAGE_LINE.exec(line);
    if (image !== null) {
      flush(index - 1);
      if (image[1]!.trim() === "") fail("an image needs a description", index, "describe it: ![A chart of build times](assets/chart.png)");
      else blocks.push({ type: "image", description: image[1]!, source: image[2]!, span: lineSpan(index) });
      continue;
    }
    const item = ITEM.exec(line);
    if (item !== null && (paragraph === null || indent === 0)) {
      if (indent >= 2 && list !== null) {
        fail("nested lists are not supported yet", index, "keep list items at one level");
        continue;
      }
      const ordered = /\d/.test(item[1]![0]!);
      if (paragraph !== null) flush(index - 1);
      if (list !== null && list.ordered !== ordered) flush(index - 1);
      if (list === null) list = { ordered, items: [], start: index };
      list.items.push({ text: item[2]!, line: index });
      continue;
    }
    if (list !== null) {
      // A continuation line belongs to the last item.
      const last = list.items[list.items.length - 1]!;
      last.text = `${last.text} ${line}`;
      continue;
    }
    if (paragraph === null) paragraph = { lines: [], start: index };
    paragraph.lines.push(line);
  }
  flush(lines.length - 1);

  if (blocks.length > MAX_DOCUMENT_BLOCKS) {
    fail(`has ${blocks.length} blocks; the limit is ${MAX_DOCUMENT_BLOCKS}`, 0, "split the document into smaller files");
  }
  if (blocks.length === 0 && ok) fail("is empty", 0, "write some Markdown, or remove the document");
  return ok ? blocks : null;
}

/** Parse inline formatting. Returns an error message for unsupported input. */
export function parseInline(input: string): MarkdownInline | string {
  let text = "";
  const spans: { start: number; length: number; effect: InlineEffect }[] = [];
  const isWord = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  const plain = (value: string): string | null => (/[*_`[\]]/.test(value) ? null : value);
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    const next = input[i + 1];
    if (ch === "\\" && next !== undefined && /[!-/:-@[-`{-~]/.test(next)) {
      text += next;
      i += 2;
      continue;
    }
    if (ch === "<" && next !== undefined && /[A-Za-z/!]/.test(next)) return "raw HTML is not allowed in a document";
    if (ch === "!" && next === "[") return "an image must be on its own line";
    if (ch === "`") {
      const end = input.indexOf("`", i + 1);
      if (end === -1) return "inline code is never closed with `";
      const code = input.slice(i + 1, end);
      if (code === "") return "inline code is empty";
      spans.push({ start: text.length, length: code.length, effect: { type: "code" } });
      text += code;
      i = end + 1;
      continue;
    }
    if (ch === "[") {
      const close = input.indexOf("](", i);
      const end = close === -1 ? -1 : input.indexOf(")", close + 2);
      if (close === -1 || end === -1) {
        text += ch;
        i += 1;
        continue;
      }
      const label = plain(input.slice(i + 1, close));
      const url = input.slice(close + 2, end);
      if (label === null || label === "") return "link text cannot be empty or formatted";
      if (!LINK_URL.test(url)) return `the link "${url}" is not a full http, https, or mailto address`;
      spans.push({ start: text.length, length: label.length, effect: { type: "link", url } });
      text += label;
      i = end + 1;
      continue;
    }
    const strong = (ch === "*" && next === "*") || (ch === "_" && next === "_");
    if ((ch === "*" || ch === "_") && input[i + (strong ? 2 : 1)] !== " ") {
      const marker = strong ? ch + ch : ch;
      // _ only emphasizes at word edges, so snake_case stays literal.
      const opens = ch === "*" || !isWord(input[i - 1]);
      let end = opens ? input.indexOf(marker, i + marker.length) : -1;
      while (end !== -1 && (input[end - 1] === " " || (ch === "_" && isWord(input[end + marker.length])) || (!strong && input[end + 1] === ch))) {
        end = input.indexOf(marker, end + 1);
      }
      if (end !== -1) {
        const inner = plain(input.slice(i + marker.length, end));
        if (inner === null) return "formatting cannot be nested";
        if (inner !== "") {
          spans.push({ start: text.length, length: inner.length, effect: { type: strong ? "bold" : "italic" } });
          text += inner;
          i = end + marker.length;
          continue;
        }
      }
    }
    text += ch;
    i += 1;
  }
  return { text, spans };
}

/** Turn blocks into Kadam elements named after the element that shows them. */
export function documentElements(owner: string, blocks: readonly MarkdownBlock[], used: Set<string>, ownerSpan: Span, diagnostics: DiagnosticBag): ElementNode[] | null {
  let ok = true;
  const name = (base: string): string => {
    if (used.has(base)) {
      diagnostics.error("KDM3044", `the document makes an element named "${base}", which is already used`, ownerSpan, `rename "${owner}" or the other "${base}"`);
      ok = false;
    }
    used.add(base);
    return base;
  };
  const kind = (kindName: BuiltinKindName, span: Span) => ({
    type: "kind" as const,
    article: /^[aeiou]/.test(kindName) ? ("an" as const) : ("a" as const),
    reference: { type: "builtin-kind" as const, name: kindName, category: BUILTIN_KIND_INFO[kindName].category, span },
    span,
  });
  const textStatements = (value: MarkdownInline, span: Span): StatementNode[] => [
    { type: "text", noun: "text", value: value.text, valueSpan: span, span },
    ...value.spans.map((part): StatementNode => {
      const effect: TextSpanEffect =
        part.effect.type === "link" ? { type: "external", url: part.effect.url, urlSpan: span } : { type: part.effect.type };
      return { type: "text-span", target: value.text.slice(part.start, part.start + part.length), targetSpan: span, effect, at: part.start, span };
    }),
  ];
  const element = (elementName: string, kindName: BuiltinKindName, span: Span, statements: StatementNode[], children: ElementNode[] = []): ElementNode => ({
    type: "element",
    name: name(elementName),
    nameSpan: span,
    kind: kind(kindName, span),
    statements,
    properties: [],
    children,
    span,
  });
  const HEADINGS: Record<1 | 2 | 3 | 4, BuiltinKindName> = { 1: "main heading", 2: "section heading", 3: "minor heading", 4: "small heading" };
  const elements = blocks.map((block, index) => {
    const base = `${owner}Part${index + 1}`;
    switch (block.type) {
      case "heading":
        return element(base, HEADINGS[block.level], block.span, textStatements(block.inline, block.span));
      case "paragraph":
        return element(base, "paragraph", block.span, textStatements(block.inline, block.span));
      case "code":
        return element(base, "code block", block.span, [{ type: "text", noun: "text", value: block.text, valueSpan: block.span, span: block.span }]);
      case "divider":
        return element(base, "divider", block.span, []);
      case "image":
        return element(base, "image", block.span, [
          { type: "image-source", value: block.source, valueSpan: block.span, span: block.span },
          { type: "image-description", value: block.description, valueSpan: block.span, span: block.span },
        ]);
      case "list":
        return element(
          base,
          block.ordered ? "numbered list" : "list",
          block.span,
          [],
          block.items.map((item, itemIndex) => element(`${base}Item${itemIndex + 1}`, "list item", block.span, textStatements(item, block.span))),
        );
    }
  });
  return ok ? elements : null;
}

/**
 * Replace every `it shows the document "..."` with the document's elements,
 * after the element's own children. `read` is null in a single-file build.
 */
export function expandDocuments(
  page: import("../ast/nodes.js").PageNode,
  read: ((path: string, span: Span) => SourceFile | null) | null,
  diagnostics: DiagnosticBag,
): import("../ast/nodes.js").PageNode {
  const uses = (elements: readonly ElementNode[]): boolean =>
    elements.some((element) => element.statements.some((statement) => statement.type === "document-source") || uses(element.children));
  if (!uses(page.elements)) return page;
  const used = new Set<string>();
  const collect = (elements: readonly ElementNode[]): void => {
    for (const element of elements) {
      used.add(element.name);
      collect(element.children);
    }
  };
  collect(page.elements);
  const parsed = new Map<string, MarkdownBlock[] | null>();

  const visit = (element: ElementNode): ElementNode => {
    const children = element.children.map(visit);
    const sources = element.statements.filter((statement): statement is Extract<StatementNode, { type: "document-source" }> => statement.type === "document-source");
    if (sources.length === 0) return { ...element, children };
    const statements = element.statements.filter((statement) => statement.type !== "document-source");
    if (sources.length > 1) {
      diagnostics.error("KDM3002", "an element shows at most one document", sources[1]!.span, "put each document in its own element");
      return { ...element, statements, children };
    }
    const source = sources[0]!;
    if (read === null) {
      diagnostics.error("KDM3042", "a document needs a project", source.valueSpan, "build a project with kadam.json; the path is relative to the project root");
      return { ...element, statements, children };
    }
    if (!source.value.endsWith(".md")) {
      diagnostics.error("KDM4011", `the document "${source.value}" is not a .md file`, source.valueSpan, "point it at a Markdown file such as content/intro.md");
      return { ...element, statements, children };
    }
    if (!parsed.has(source.value)) {
      const file = read(source.value, source.valueSpan);
      parsed.set(source.value, file === null ? null : parseMarkdown(file, diagnostics));
    }
    const blocks = parsed.get(source.value);
    if (blocks === null || blocks === undefined) return { ...element, statements, children };
    const generated = documentElements(element.name, blocks, used, element.nameSpan, diagnostics) ?? [];
    return { ...element, statements, children: [...children, ...generated] };
  };
  return { ...page, elements: page.elements.map(visit) };
}
