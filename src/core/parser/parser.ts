import type {
  DocumentNode,
  ElementNode,
  ExternalDeclaration,
  PageNode,
  PageSettingNode,
  PropertyBindingNode,
  RepeatClause,
  StatementNode,
} from "../ast/nodes.js";
import { isProseSource, looksLikeParagraphs, PROSE_SENTENCES, translateProse, type ProseComponentInfo, type ProseTranslation } from "../prose/translate.js";
import { DiagnosticBag, type Diagnostic } from "../diagnostics/diagnostic.js";
import { lex } from "../lexer/lexer.js";
import type { Token } from "../lexer/token.js";
import {
  createSourceFile,
  SourceFile,
  type Span,
} from "../source/source-file.js";
import {
  LANGUAGE_VERSION,
  UI_LANGUAGE_VERSIONS,
  isUiLanguageVersion,
  type UiLanguageVersion,
} from "../../version.js";
import { matchLine, STATEMENT_TEMPLATES } from "./registry.js";
import { editDistance } from "./suggest.js";
import { matchRepeatModifier } from "./repeat.js";
import { matchPropertyBinding } from "./property.js";
import type { TemplateContext } from "./statement-types.js";
import { validateDocument } from "./validate.js";
import { isAnyWord, isKeyword } from "./values.js";
import { describeInvalidElementName } from "./names.js";

export interface ParseResult {
  readonly source: SourceFile;
  readonly tokens: readonly Token[];
  readonly comments: readonly Token[];
  readonly document: DocumentNode;
  readonly diagnostics: readonly Diagnostic[];
  /** D-50: present when the source was a kadam 0.4 paragraph page. */
  readonly prose?: ProseTranslation;
}

export interface ParseOptions {
  /** Run structural validation immediately. Defaults to true. */
  readonly validate?: boolean | undefined;
  /** Allow unresolved component kinds for project compilation. */
  readonly allowComponentKinds?: boolean | undefined;
  /**
   * Language version used when the file has no `kadam` directive: the
   * project manifest's version, or "0.1" for a standalone file.
   */
  readonly defaultLanguageVersion?: UiLanguageVersion | undefined;
  /** kadam 0.3 custom breakpoints from kadam.json: name to min-width px. */
  readonly breakpoints?: ReadonlyMap<string, number> | undefined;
  /** kadam 0.3 theme color names from the project theme (D-38). */
  readonly colorTokens?: ReadonlySet<string> | undefined;
  /** D-50: the title of a kadam 0.4 page that does not name itself (its file name). */
  readonly proseTitle?: string | undefined;
  /** D-50: files without a version line are paragraphs (a kadam 0.4 site). */
  readonly paragraphsByDefault?: boolean | undefined;
  /** D-50: components a kadam 0.4 page may use. */
  readonly proseComponents?: ReadonlyMap<string, ProseComponentInfo> | undefined;
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
  readonly repeat?: RepeatClause | undefined;
  readonly externals: ExternalDeclaration[];
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


/** Parse one already-loaded source file. No file-system access. */
export function parseSource(
  source: SourceFile,
  options: ParseOptions = {},
): ParseResult {
  // D-50: a kadam 0.4 page is paragraphs, translated to the block form first.
  if (isProseSource(source.text, options.paragraphsByDefault === true)) return parseProseSource(source, options);
  // A file written as paragraphs, without the line that says so.
  if (!/^\s*(?:\/\/[^\n]*\n\s*)*kadam\s/.test(source.text) && looksLikeParagraphs(source.text)) {
    const start = source.span(0, 0);
    return {
      source,
      tokens: [],
      comments: [],
      document: { type: "document", version: null, versionSpan: null, languageVersion: "0.3", page: null, component: null, span: start } as unknown as DocumentNode,
      diagnostics: [{
        code: "KDM4004",
        severity: "error",
        message: "this file is written as paragraphs; its first line must be kadam 0.4",
        span: source.span(0, Math.min(source.text.indexOf("\n") === -1 ? source.text.length : source.text.indexOf("\n"), source.text.length)),
        hint: "add kadam 0.4 as the first line (in a site whose kadam.json says \"kadam\": \"0.4\", or that has no kadam.json, the line is optional)",
        fixes: [{ label: "kadam 0.4 as the first line", span: start, text: "kadam 0.4\n\n" }],
      }],
    };
  }
  const lexed = lex(source);
  const diagnostics = new DiagnosticBag();
  diagnostics.addAll(lexed.diagnostics);

  const lines = splitLogicalLines(lexed.tokens, source);
  const document = new Parser(
    source,
    lines,
    diagnostics,
    options.defaultLanguageVersion ?? LANGUAGE_VERSION,
    options.breakpoints,
    options.colorTokens,
  ).parse();
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
  #languageVersion: UiLanguageVersion;
  readonly #breakpoints: ReadonlyMap<string, number> | undefined;
  /** Theme color names: the project theme plus those this file declares. */
  readonly #colorTokens: Set<string>;
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
    defaultLanguageVersion: UiLanguageVersion,
    breakpoints: ReadonlyMap<string, number> | undefined = undefined,
    colorTokens: ReadonlySet<string> | undefined = undefined,
  ) {
    this.#breakpoints = breakpoints;
    this.#colorTokens = new Set(colorTokens ?? []);
    this.#languageVersion = defaultLanguageVersion;
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
      languageVersion: this.#languageVersion,
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
    if (isUiLanguageVersion(version)) {
      this.#languageVersion = version;
    } else {
      this.#error(
        "KDM4004",
        `language version ${version} is not supported; this compiler implements ${UI_LANGUAGE_VERSIONS.join(" and ")} (blocks) and 0.4 (paragraphs)`,
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

  #openPage(header: readonly Token[], line: LogicalLine): void {
    let tokens = header;
    this.#pageSeen = true;
    let title = "";
    let titleSpan = line.span;

    // kadam 0.3 (F5 step 3): `page "{the title of post}" for each post in posts {`.
    let repeat: RepeatClause | undefined;
    if (tokens.length === 7 && isAnyWord(tokens[2], "for") && isAnyWord(tokens[3], "each")) {
      const item = tokens[4]!;
      const clause = tokens.slice(2);
      const named = (token: Token | undefined): boolean =>
        token !== undefined && (token.kind === "identifier" || token.kind === "keyword") && /^[a-z][A-Za-z0-9]{0,63}$/.test(token.text);
      if (!named(item) || !isAnyWord(clause[3], "in") || !named(clause[4])) {
        this.#error("KDM2002", "malformed page declaration", line.span, 'use: page "{the title of post}" for each post in posts {');
      } else if (this.#languageVersion !== "0.3") {
        this.#error("KDM2013", "a page made for each record requires kadam 0.3", line.span, "add kadam 0.3 as the first line");
      } else {
        repeat = { item: item.text, itemSpan: item.span, source: clause[4]!.text, sourceSpan: clause[4]!.span, span: mergeSpans(clause[0]!.span, clause[4]!.span) };
      }
      tokens = tokens.slice(0, 2);
    }

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
      ...(repeat === undefined ? {} : { repeat }),
      headerSpan: line.span,
      settings: [],
      elements: [],
      externals: [],
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
      // Open a placeholder block so the body and closing brace stay balanced.
      this.#stack().push({
        name: tokens.map((token) => token.text).join(""),
        nameSpan: tokens[0]?.span ?? line.span,
        headerSpan: line.span,
        kind: null,
        statements: [],
        properties: [],
        children: [],
        endSpan: line.span,
      });
      return;
    }

    const nameToken = tokens[0]!;
    const validName = nameToken.kind === "identifier";
    if (!validName) {
      const report = describeInvalidElementName(nameToken);
      this.#error("KDM2007", report.message, nameToken.span, report.hint);
      // Keep going: open the block anyway so its body and closing brace are
      // attributed to this element rather than to its parent.
    }

    const name = nameToken.text;
    const previous = validName ? this.#names.get(name) : undefined;
    if (!validName) {
      // Not registered; an invalid name never participates in duplicate checks.
    } else if (previous !== undefined) {
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
    const shaping = matchRepeatModifier(tokens);
    if (shaping !== null) {
      for (const diagnostic of shaping.diagnostics) this.#diagnostics.addSpec(diagnostic);
      if (shaping.modifier === null) return;
      const builder = this.#elementStack[this.#elementStack.length - 1];
      const repeat = builder?.kind?.repeat;
      if (builder === undefined || repeat === undefined) {
        this.#error("KDM3041", "this line only works in a data list", line.span, "put it after a kind sentence such as: a ProjectCard for each project in projects");
        return;
      }
      const modifier = shaping.modifier;
      if (modifier.type === "filter") {
        builder.kind = { ...builder.kind!, repeat: { ...repeat, filters: [...(repeat.filters ?? []), modifier.filter] } };
      } else if (modifier.type === "sort") {
        if (repeat.sort !== undefined) {
          this.#error("KDM3040", "a data list has one sorted by line", modifier.sort.span, "keep one sorted by line");
          return;
        }
        builder.kind = { ...builder.kind!, repeat: { ...repeat, sort: modifier.sort } };
      } else if (modifier.type === "paging") {
        if (repeat.paging !== undefined || repeat.limit !== undefined) {
          this.#error("KDM3040", "a data list has one showing line", modifier.paging.span, "keep one showing line");
          return;
        }
        builder.kind = { ...builder.kind!, repeat: { ...repeat, paging: modifier.paging } };
      } else {
        if (repeat.limit !== undefined || repeat.paging !== undefined) {
          this.#error("KDM3040", "a data list has one showing at most line", modifier.span, "keep one showing at most line");
          return;
        }
        builder.kind = { ...builder.kind!, repeat: { ...repeat, limit: { count: modifier.count, span: modifier.span } } };
      }
      return;
    }

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
      if (property.binding.field !== undefined && builder.kind.repeat === undefined) {
        this.#error(
          "KDM3041",
          "a record field can only be read by an instance that repeats for each record",
          property.binding.field.span,
          "add for each <item> in <dataName> to the kind sentence, or bind a quoted value",
        );
        return;
      }
      builder.properties.push(property.binding);
      return;
    }

    const context: TemplateContext = {
      allowResponsive: true,
      languageVersion: this.#languageVersion,
      breakpoints: this.#breakpoints,
      colorTokens: this.#colorTokens,
    };
    const match = matchLine(tokens, context);
    for (const diagnostic of match.diagnostics) this.#diagnostics.addSpec(diagnostic);

    const node = match.selected?.body.statement ?? null;
    if (node === null) return;

    const builder = this.#elementStack[this.#elementStack.length - 1];

    if (builder === undefined) {
      if (node.type === "page-setting") {
        const page = this.#page!;
        if (node.property === "custom font" && this.#languageVersion === "0.1") {
          this.#error("KDM2013", "a named page or heading font requires kadam 0.3", node.span, 'change the first line to "kadam 0.3"');
          return;
        }
        page.settings.push(node);
        // A theme color is usable on the lines after its declaration (D-38).
        if (node.property === "color token") this.#colorTokens.add(node.name);
        return;
      }
      if (node.type === "external") {
        const page = this.#page!;
        const previous = page.externals.find((external) => external.name === node.name);
        if (previous !== undefined) {
          this.#error("KDM3002", `external ${node.name} is declared twice`, node.nameSpan, "remove one declaration", previous.nameSpan);
          return;
        }
        page.externals.push(node);
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

    if (node.type === "external") {
      this.#error("KDM3003", "external declarations are only allowed in the page body", node.span, "move this line out of the element, directly inside page { }");
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
      ...(builder.repeat === undefined ? {} : { repeat: builder.repeat }),
      ...(builder.externals.length === 0 ? {} : { externals: builder.externals }),
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

/** D-50: translate a paragraph page, parse the blocks, and point everything back at the sentences. */
function parseProseSource(source: SourceFile, options: ParseOptions): ParseResult {
  const translation = translateProse(source, {
    title: options.proseTitle ?? titleFromPath(source.path),
    ...(options.colorTokens === undefined ? {} : { colorTokens: options.colorTokens }),
    ...(options.proseComponents === undefined ? {} : { components: options.proseComponents }),
  });
  const blocks = new SourceFile(source.path, translation.text);
  const parsed = parseSource(blocks, { ...options, defaultLanguageVersion: "0.3" });
  const remap = (span: Span): Span => (span.file === source.path ? translation.lineSpans[span.start.line] ?? span : span);
  const diagnostics = [
    ...translation.diagnostics,
    ...parsed.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      span: remap(diagnostic.span),
      // The sentence as the author wrote it, not the block line it became,
      // with close paragraph sentences instead of block ones.
      ...(diagnostic.message.startsWith("unrecognized statement ")
        ? (() => {
            const written = source.text.slice(remap(diagnostic.span).start.offset, remap(diagnostic.span).end.offset);
            const near = closeProseSentences(written);
            return {
              message: `I don't know the sentence: ${written}`,
              hint: near.length > 0 ? `sentences like it: ${near.join(" | ")}` : "see the sentences in the language spec, section 17",
            };
          })()
        : {}),
      ...proseFixes(diagnostic, remap(diagnostic.span)),
      ...(diagnostic.related === undefined ? {} : { related: diagnostic.related.map((related) => ({ ...related, span: remap(related.span) })) }),
    })),
  ];
  return {
    ...parsed,
    source,
    document: remapSpans(parsed.document, remap),
    diagnostics: dedupe(diagnostics).sort(compareDiagnostics),
    prose: translation,
  };
}

/** `pages/my-usage.kdm` is titled "My usage"; `home` and `index` are "Home". */
export function titleFromPath(path: string): string {
  const base = (path.split("/").at(-1) ?? path).replace(/\.kdm$/, "");
  const words = base === "index" ? "home" : base.replace(/[-_]+/g, " ");
  return `${words[0]?.toUpperCase() ?? ""}${words.slice(1)}` || "Home";
}

export function remapSpans<T>(value: T, remap: (span: Span) => Span): T {
  if (Array.isArray(value)) return value.map((item) => remapSpans(item, remap)) as T;
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record.file === "string" && typeof record.start === "object" && typeof record.end === "object") return remap(value as unknown as Span) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) out[key] = remapSpans(item, remap);
  return out as T;
}

/** Two generated lines from one sentence can report the same problem. */
function dedupe(list: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return list.filter((diagnostic) => {
    const key = `${diagnostic.code}|${diagnostic.message}|${diagnostic.span.start.offset}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * D-50: the block grammar's "did you mean" sentences, worded as paragraph
 * sentences, replace the sentence the author wrote.
 */
function proseFixes(diagnostic: Diagnostic, span: Span): { fixes: NonNullable<Diagnostic["fixes"]> } | Record<string, never> {
  const hint = diagnostic.hint ?? "";
  if (!hint.startsWith("did you mean: ")) return {};
  // Only close sentences are fixes; a far one is a guess.
  const written = diagnostic.message.match(/"(.*)"$/)?.[1] ?? "";
  const fixes = hint.slice("did you mean: ".length).replace(/\?$/, "").split(" | ")
    .filter((option) => written !== "" && editDistance(option.replace(/"[^"]*"/g, '"…"'), written.replace(/"[^"]*"/g, '"…"')) <= Math.max(2, Math.floor(written.length * 0.3)))
    .map((option) => {
      const sentence = /^has /.test(option) ? `It ${option}` : `${option[0]!.toUpperCase()}${option.slice(1)}`;
      return { label: sentence, span, text: sentence };
    });
  return fixes.length === 0 ? {} : { fixes };
}

let proseSentencePool: readonly string[] | null = null;

/** Every sentence a paragraph page can say about a thing, in the paragraph form. */
function prosePool(): readonly string[] {
  if (proseSentencePool !== null) return proseSentencePool;
  const pool = new Set<string>(PROSE_SENTENCES.map((sentence) => sentence.text));
  for (const template of STATEMENT_TEMPLATES) {
    for (const example of template.examples ?? []) {
      if (/^(it|its|when|the|has|on|in)\b/.test(example) && !example.startsWith("the page")) {
        const sentence = example.startsWith("has ") ? `It ${example}` : `${example[0]!.toUpperCase()}${example.slice(1)}`;
        pool.add(sentence);
      }
    }
  }
  proseSentencePool = [...pool];
  return proseSentencePool;
}

/** Up to three sentences that share the most meaningful words with `written`. */
function closeProseSentences(written: string): string[] {
  const filler = new Set(["it", "its", "the", "a", "an", "is", "are", "has", "of", "to", "in", "on", "when", "and", "by"]);
  const wordsOf = (text: string): Set<string> => new Set(text.toLowerCase().replace(/"[^"]*"/g, " ").split(/[^a-z0-9%]+/).filter((word) => word !== "" && !filler.has(word)));
  const mine = wordsOf(written);
  if (mine.size === 0) return [];
  const scored = prosePool()
    .map((sentence) => {
      const theirs = wordsOf(sentence);
      let shared = 0;
      for (const word of mine) if (theirs.has(word) || [...theirs].some((other) => other.length > 3 && editDistance(other, word) <= 1)) shared += 1;
      return { sentence, shared };
    })
    .filter((entry) => entry.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.sentence.length - b.sentence.length || (a.sentence < b.sentence ? -1 : 1));
  return scored.slice(0, 3).map((entry) => entry.sentence);
}
