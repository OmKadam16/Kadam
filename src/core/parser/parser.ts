import type {
  DocumentNode,
  ElementNode,
  PageNode,
  PageSettingNode,
  PropertyBindingNode,
  StatementNode,
} from "../ast/nodes.js";
import { DiagnosticBag, type Diagnostic } from "../diagnostics/diagnostic.js";
import { lex } from "../lexer/lexer.js";
import type { Token } from "../lexer/token.js";
import {
  createSourceFile,
  SourceFile,
  type Span,
} from "../source/source-file.js";
import { LANGUAGE_VERSION } from "../../version.js";
import { matchLine } from "./registry.js";
import { matchPropertyBinding } from "./property.js";
import type { TemplateContext } from "./statement-types.js";
import { validateDocument } from "./validate.js";
import { isKeyword } from "./values.js";

export interface ParseResult {
  readonly source: SourceFile;
  readonly tokens: readonly Token[];
  readonly comments: readonly Token[];
  readonly document: DocumentNode;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ParseOptions {
  /** Run structural validation immediately. Defaults to true. */
  readonly validate?: boolean | undefined;
  /** Allow unresolved component kinds for project compilation. */
  readonly allowComponentKinds?: boolean | undefined;
}

export interface LogicalLine {
  readonly tokens: readonly Token[];
  readonly line: number;
  readonly span: Span;
}

interface PageBuilder {
  readonly title: string;
  readonly titleSpan: Span;
  readonly headerSpan: Span;
  readonly settings: PageSettingNode[];
  readonly elements: ElementNode[];
  endSpan: Span;
}

interface ElementBuilder {
  readonly name: string;
  readonly nameSpan: Span;
  readonly headerSpan: Span;
  kind: import("../ast/nodes.js").KindNode | null;
  readonly statements: StatementNode[];
  readonly properties: PropertyBindingNode[];
  readonly children: ElementNode[];
  endSpan: Span;
}

const STATEMENT_CONTEXT: TemplateContext = { allowResponsive: true };

/** Parse one already-loaded source file. No file-system access. */
export function parseSource(
  source: SourceFile,
  options: ParseOptions = {},
): ParseResult {
  const lexed = lex(source);
  const diagnostics = new DiagnosticBag();
  diagnostics.addAll(lexed.diagnostics);

  const lines = splitLogicalLines(lexed.tokens, source);
  const document = new Parser(source, lines, diagnostics).parse();
  if (options.validate !== false) {
    validateDocument(document, diagnostics, {
      allowComponentKinds: options.allowComponentKinds === true,
    });
  }

  return {
    source,
    tokens: lexed.tokens,
    comments: lexed.comments,
    document,
    diagnostics: diagnostics.sorted(),
  };
}

/** Convenience entry point for buffers and tests. */
export function parseText(
  path: string,
  text: string,
  options: ParseOptions = {},
): ParseResult {
  const created = createSourceFile(path, text);
  const parsed = parseSource(created.source, options);
  if (created.diagnostics.length === 0) return parsed;
  const diagnostics = [...created.diagnostics, ...parsed.diagnostics].sort(
    compareDiagnostics,
  );
  return { ...parsed, diagnostics };
}

class Parser {
  readonly #source: SourceFile;
  readonly #lines: readonly LogicalLine[];
  readonly #diagnostics: DiagnosticBag;
  readonly #names = new Map<string, Span>();

  #version: string | null = null;
  #versionSpan: Span | null = null;
  #sawTopLevelLine = false;
  #pageSeen = false;
  #page: PageBuilder | null = null;
  #pageClosed = false;
  #foreignComponentDepth = 0;
  #lastSpan: Span;

  constructor(
    source: SourceFile,
    lines: readonly LogicalLine[],
    diagnostics: DiagnosticBag,
  ) {
    this.#source = source;
    this.#lines = lines;
    this.#diagnostics = diagnostics;
    this.#lastSpan = source.span(source.length, source.length);
  }

  parse(): DocumentNode {
    for (const line of this.#lines) {
      this.#lastSpan = line.span;
      this.#parseLine(line);
      this.#sawTopLevelLine = true;
    }

    this.#finishAtEnd();

    const page = this.#page;
    const startSpan = this.#versionSpan ?? page?.headerSpan ?? this.#lastSpan;
    const endSpan = page?.endSpan ?? startSpan;
    return {
      type: "document",
      version: this.#version,
      versionSpan: this.#versionSpan,
      page: page === null ? null : this.#buildPage(page),
      component: null,
      span: mergeSpans(startSpan, endSpan),
    };
  }

  #parseLine(line: LogicalLine): void {
    const raw = line.tokens;
    const first = raw[0]!;

    if (this.#foreignComponentDepth > 0) {
      for (const token of raw) {
        if (token.kind === "lbrace") this.#foreignComponentDepth += 1;
        else if (token.kind === "rbrace") this.#foreignComponentDepth -= 1;
      }
      return;
    }

    if (first.kind === "rbrace") {
      if (raw.length !== 1) {
        this.#error(
          "KDM2009",
          "a closing brace must be the only token on its line",
          line.span,
          "write } on its own line",
        );
      }
      this.#closeBlock(first.span);
      return;
    }

    if (raw.some((token) => token.kind === "rbrace")) {
      this.#error(
        "KDM2009",
        "a closing brace must be on its own line",
        line.span,
        "write } on its own line",
      );
      return;
    }

    const braceIndex = raw.findIndex((token) => token.kind === "lbrace");
    if (braceIndex !== -1) {
      if (braceIndex !== raw.length - 1) {
        this.#error(
          "KDM2009",
          "an opening brace must end its line",
          raw[braceIndex]!.span,
          "write { at the end of the page or element header",
        );
      }
      this.#parseHeader(raw.slice(0, braceIndex), line, first);
      return;
    }

    if (!this.#pageSeen && this.#isVersionLine(raw)) {
      this.#parseVersion(raw, line);
      return;
    }

    if (isKeyword(first, "kadam")) {
      this.#error(
        "KDM4004",
        "the language version directive must be the first non-comment line",
        line.span,
        `move kadam ${LANGUAGE_VERSION} to the top of the file`,
      );
      return;
    }

    // A page header without its opening brace is a header-shaped line, not a
    // statement. Diagnose it explicitly rather than as an unknown sentence.
    if (isKeyword(first, "page")) {
      this.#error(
        "KDM2002",
        "page declaration is missing its opening brace",
        line.span,
        'add { at the end of the line: page "Home" {',
      );
      return;
    }

    if (isKeyword(first, "component")) {
      this.#error(
        "KDM2012",
        "a source file contains exactly one page or one component",
        line.span,
        "move the component into its own .kdm file",
      );
      return;
    }

    if (raw.length === 1 && (first.kind === "identifier" || first.kind === "word")) {
      if (!this.#pageIsOpen()) {
        this.#outsidePageError(this.#pageSeen, line.span);
      } else {
        this.#error(
          "KDM2002",
          `element ${JSON.stringify(first.text)} is missing its opening brace`,
          line.span,
          `add { at the end of the line: ${first.text} {`,
        );
      }
      return;
    }

    if (!this.#pageIsOpen()) {
      this.#outsidePageError(this.#pageSeen, line.span);
      return;
    }

    this.#parseStatement(line);
  }

  #parseHeader(
    headerTokens: readonly Token[],
    line: LogicalLine,
    first: Token,
  ): void {
    if (isKeyword(first, "component")) {
      this.#error(
        "KDM2012",
        "a source file contains exactly one page or one component",
        line.span,
        "move the component into its own .kdm file",
      );
      this.#foreignComponentDepth = 1;
      return;
    }

    if (isKeyword(first, "page")) {
      if (this.#pageSeen) {
        this.#error(
          "KDM2008",
          "a source file must contain exactly one page",
          line.span,
          "remove the extra page declaration",
        );
        return;
      }
      this.#openPage(headerTokens, line);
      return;
    }

    if (!this.#pageIsOpen()) {
      this.#outsidePageError(this.#pageSeen, line.span);
      return;
    }

    this.#openElement(headerTokens, line);
  }

  #parseVersion(tokens: readonly Token[], line: LogicalLine): void {
    if (tokens.length !== 2 || tokens[1]!.kind !== "number") {
      this.#error(
        "KDM4004",
        "malformed language version directive",
        line.span,
        `use: kadam ${LANGUAGE_VERSION}`,
      );
      this.#versionSpan = line.span;
      return;
    }
    const version = tokens[1]!.text;
    this.#version = version;
    this.#versionSpan = line.span;
    if (version !== LANGUAGE_VERSION) {
      this.#error(
        "KDM4004",
        `language version ${version} is not supported; this compiler implements ${LANGUAGE_VERSION}`,
        tokens[1]!.span,
        `change the directive to: kadam ${LANGUAGE_VERSION}`,
      );
    }
  }

  #isVersionLine(tokens: readonly Token[]): boolean {
    return (
      !this.#sawTopLevelLine &&
      !this.#pageSeen &&
      isKeyword(tokens[0], "kadam")
    );
  }

  #openPage(tokens: readonly Token[], line: LogicalLine): void {
    this.#pageSeen = true;
    let title = "";
    let titleSpan = line.span;

    if (
      tokens.length !== 2 ||
      tokens[0]!.kind !== "keyword" ||
      tokens[1]!.kind !== "string" ||
      typeof tokens[1]!.value !== "string"
    ) {
      this.#error(
        "KDM2002",
        "malformed page declaration",
        line.span,
        'use: page "Home" {',
      );
    } else {
      title = tokens[1]!.value;
      titleSpan = tokens[1]!.span;
      const length = Array.from(title).length;
      if (length === 0) {
        this.#error(
          "KDM3005",
          "a page title cannot be empty",
          titleSpan,
          "use a human-readable title of at most 80 characters",
        );
      } else if (length > 80) {
        this.#error(
          "KDM3005",
          `page title has ${length} characters; the limit is 80`,
          titleSpan,
          "shorten the page title",
        );
      }
    }

    this.#page = {
      title,
      titleSpan,
      headerSpan: line.span,
      settings: [],
      elements: [],
      endSpan: line.span,
    };
  }

  #openElement(tokens: readonly Token[], line: LogicalLine): void {
    if (tokens.length !== 1) {
      this.#error(
        "KDM2002",
        "malformed element declaration",
        line.span,
        "an element header is a lower-camel name followed by {",
      );
      return;
    }

    const nameToken = tokens[0]!;
    if (nameToken.kind !== "identifier") {
      const reserved = nameToken.kind === "keyword";
      this.#error(
        "KDM2007",
        reserved
          ? `element name ${JSON.stringify(nameToken.text)} is a reserved word`
          : `invalid element name ${JSON.stringify(nameToken.text)}`,
        nameToken.span,
        "use a lower-camel name such as button1 or heroSection",
      );
      return;
    }

    const name = nameToken.text;
    const previous = this.#names.get(name);
    if (previous !== undefined) {
      this.#error(
        "KDM3008",
        `duplicate element name ${JSON.stringify(name)}`,
        nameToken.span,
        "element names must be unique in the file; rename one of the elements",
        previous,
      );
    } else {
      this.#names.set(name, nameToken.span);
    }

    if (this.#elementStack.length >= 64 && !this.#nestingDepthReported) {
      this.#nestingDepthReported = true;
      this.#error(
        "KDM2011",
        "element nesting exceeds the 64-level limit",
        nameToken.span,
        "flatten the structure or wait for reusable components",
      );
    }

    const builder: ElementBuilder = {
      name,
      nameSpan: nameToken.span,
      headerSpan: line.span,
      kind: null,
      statements: [],
      properties: [],
      children: [],
      endSpan: line.span,
    };
    this.#stack().push(builder);
  }

  #stack(): ElementBuilder[] {
    return this.#elementStack;
  }

  readonly #elementStack: ElementBuilder[] = [];
  #nestingDepthReported = false;

  #parseStatement(line: LogicalLine): void {
    const period = line.tokens[line.tokens.length - 1];
    if (period?.kind === "period") {
      // A single optional terminal period is syntactic sugar.
      const body = line.tokens.slice(0, -1);
      if (body.length === 0) {
        this.#error(
          "KDM2010",
          "a period does not form a statement",
          period.span,
          "write the statement before the period",
        );
        return;
      }
      this.#dispatchStatement(body, line);
      return;
    }
    this.#dispatchStatement(line.tokens, line);
  }

  #dispatchStatement(tokens: readonly Token[], line: LogicalLine): void {
    const property = matchPropertyBinding(tokens);
    if (property !== null) {
      for (const diagnostic of property.diagnostics) this.#diagnostics.addSpec(diagnostic);
      if (property.binding === null) return;

      const builder = this.#elementStack[this.#elementStack.length - 1];
      if (builder === undefined) {
        this.#error(
          "KDM3030",
          "property bindings are only allowed inside a component instance",
          property.binding.span,
          "move the binding into a named element or component instance",
        );
        return;
      }
      if (builder.kind?.reference.type !== "component-kind") {
        this.#error(
          "KDM3030",
          "property bindings require a component kind",
          property.binding.span,
          "declare the component kind first, then add with a <property> of \"...\"",
        );
        return;
      }
      builder.properties.push(property.binding);
      return;
    }

    const match = matchLine(tokens, STATEMENT_CONTEXT);
    for (const diagnostic of match.diagnostics) this.#diagnostics.addSpec(diagnostic);

    const node = match.selected?.body.statement ?? null;
    if (node === null) return;

    const builder = this.#elementStack[this.#elementStack.length - 1];

    if (builder === undefined) {
      if (node.type === "page-setting") {
        const page = this.#page!;
        page.settings.push(node);
        return;
      }
      this.#error(
        "KDM3003",
        node.type === "kind"
          ? "elements cannot be declared directly in the page body without a name"
          : "only page settings and named elements are allowed in the page body",
        node.span,
        "wrap element statements in a named element block",
      );
      return;
    }

    if (node.type === "page-setting") {
      this.#error(
        "KDM3003",
        "page settings are only allowed in the page body",
        node.span,
        "move this statement outside the element",
      );
      return;
    }

    if (node.type === "kind") {
      if (builder.kind !== null) {
        this.#error(
          "KDM3002",
          `element ${JSON.stringify(builder.name)} already has a kind sentence`,
          node.span,
          "remove the extra kind sentence",
          builder.kind.span,
        );
        return;
      }
      if (
        builder.statements.length > 0 ||
        builder.properties.length > 0 ||
        builder.children.length > 0
      ) {
        this.#error(
          "KDM2003",
          "the kind sentence must be the first statement in the element",
          node.span,
          "move this sentence to the top of the element body",
        );
      }
      builder.kind = node;
      return;
    }

    builder.statements.push(node);
  }

  #closeBlock(span: Span): void {
    const builder = this.#elementStack.pop();
    if (builder !== undefined) {
      builder.endSpan = span;
      this.#finishElement(builder, span);
      return;
    }
    if (this.#pageIsOpen()) {
      this.#page!.endSpan = span;
      this.#pageClosed = true;
      return;
    }
    this.#error(
      "KDM2010",
      "unexpected closing brace",
      span,
      "there is no open page or element block here",
    );
  }

  #finishElement(builder: ElementBuilder, endSpan: Span): void {
    const element: ElementNode = {
      type: "element",
      name: builder.name,
      nameSpan: builder.nameSpan,
      kind: builder.kind,
      statements: builder.statements,
      properties: builder.properties,
      children: builder.children,
      span: mergeSpans(builder.nameSpan, endSpan),
    };
    const parent = this.#elementStack[this.#elementStack.length - 1];
    if (parent !== undefined) parent.children.push(element);
    else this.#page!.elements.push(element);
  }

  #pageIsOpen(): boolean {
    return this.#page !== null && !this.#pageClosed;
  }

  #outsidePageError(pageSeen: boolean, span: Span): void {
    this.#error(
      pageSeen ? "KDM2008" : "KDM2006",
      pageSeen
        ? "content appears after the page block; a source file must contain exactly one page"
        : "content appears outside the page block",
      span,
      pageSeen
        ? "move this content inside the page block"
        : 'wrap content in page "Title" { ... }',
    );
  }

  #buildPage(builder: PageBuilder): PageNode {
    return {
      type: "page",
      title: builder.title,
      titleSpan: builder.titleSpan,
      settings: builder.settings,
      elements: builder.elements,
      span: mergeSpans(builder.headerSpan, builder.endSpan),
    };
  }

  #finishAtEnd(): void {
    if (!this.#pageSeen) {
      this.#error(
        "KDM2008",
        "a source file must contain exactly one page",
        this.#lastSpan,
        'add page "Title" { ... }',
      );
      return;
    }

    while (this.#elementStack.length > 0) {
      const builder = this.#elementStack.pop()!;
      this.#error(
        "KDM2005",
        `element ${JSON.stringify(builder.name)} is missing its closing brace`,
        builder.headerSpan,
        `add } to close ${builder.name}`,
      );
      builder.endSpan = this.#source.span(this.#source.length, this.#source.length);
      this.#finishElement(builder, builder.endSpan);
    }

    if (this.#page !== null && !this.#pageClosed) {
      // A page still open at EOF is missing its closing brace.
      this.#error(
        "KDM2005",
        `page ${JSON.stringify(this.#page.title)} is missing its closing brace`,
        this.#page.headerSpan,
        "add } to close the page",
      );
      this.#page.endSpan = this.#source.span(this.#source.length, this.#source.length);
      this.#pageClosed = true;
    }
  }

  #error(
    code: import("../diagnostics/diagnostic.js").DiagnosticCode,
    message: string,
    span: Span,
    hint?: string,
    relatedSpan?: Span,
  ): void {
    this.#diagnostics.error(
      code,
      message,
      span,
      hint,
      relatedSpan === undefined
        ? undefined
        : [{ span: relatedSpan, message: "first declared here" }],
    );
  }
}

export function splitLogicalLines(
  tokens: readonly Token[],
  source: SourceFile,
): LogicalLine[] {
  const lines: LogicalLine[] = [];
  let current: Token[] = [];
  let lineNumber = 1;

  const flush = (): void => {
    const body = current.filter((token) => token.kind !== "comment");
    if (body.length > 0) {
      const span = source.lineSpan(lineNumber);
      lines.push({ tokens: body, line: lineNumber, span });
    }
    current = [];
  };

  for (const token of tokens) {
    if (token.kind === "newline") {
      flush();
      lineNumber += 1;
      continue;
    }
    if (token.kind === "eof") {
      flush();
      break;
    }
    current.push(token);
  }
  return lines;
}

function mergeSpans(start: Span, end: Span): Span {
  return {
    file: start.file,
    start: start.start,
    end: end.end,
  };
}

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  if (a.span.file !== b.span.file) return a.span.file < b.span.file ? -1 : 1;
  if (a.span.start.offset !== b.span.start.offset) {
    return a.span.start.offset - b.span.start.offset;
  }
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}
