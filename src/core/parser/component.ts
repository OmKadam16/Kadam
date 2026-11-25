import type {
  ComponentNode,
  ComponentParameterNode,
  ComponentParameterType,
  ComponentVariantNode,
  DocumentNode,
  ElementNode,
  KindNode,
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
import {
  LANGUAGE_VERSION,
  UI_LANGUAGE_VERSIONS,
  isUiLanguageVersion,
  type UiLanguageVersion,
} from "../../version.js";
import { matchLine } from "./registry.js";
import { matchPropertyBinding } from "./property.js";
import { describeInvalidElementName } from "./names.js";
import {
  splitLogicalLines,
  type LogicalLine,
  type ParseResult,
} from "./parser.js";
import {
  isAnyWord,
  isKeyword,
  isString,
  spanFromTokens,
} from "./values.js";

interface ComponentBuilder {
  readonly name: string;
  readonly nameSpan: Span;
  readonly headerSpan: Span;
  readonly parameters: ComponentParameterNode[];
  readonly elements: ElementNode[];
  readonly variants: ComponentVariantNode[];
  endSpan: Span;
}

interface VariantBuilder {
  readonly name: string;
  readonly nameSpan: Span;
  readonly headerSpan: Span;
  readonly elements: ElementNode[];
  readonly names: Map<string, Span>;
  endSpan: Span;
}

interface ElementBuilder {
  readonly name: string;
  readonly nameSpan: Span;
  readonly headerSpan: Span;
  kind: KindNode | null;
  readonly statements: StatementNode[];
  readonly properties: PropertyBindingNode[];
  readonly children: ElementNode[];
  endSpan: Span;
}

/** Parse one component source file. No file-system access. */
export interface ComponentParseOptions {
  /** Version used when the file has no directive (the manifest's, or 0.1). */
  readonly defaultLanguageVersion?: UiLanguageVersion | undefined;
  /** kadam 0.3 custom breakpoints from kadam.json. */
  readonly breakpoints?: ReadonlyMap<string, number> | undefined;
  /** kadam 0.3 theme color names from the project theme (D-38). */
  readonly colorTokens?: ReadonlySet<string> | undefined;
}

export function parseComponentSource(
  source: SourceFile,
  options: ComponentParseOptions = {},
): ParseResult {
  const lexed = lex(source);
  const diagnostics = new DiagnosticBag();
  diagnostics.addAll(lexed.diagnostics);

  const lines = splitLogicalLines(lexed.tokens, source);
  const document = new ComponentParser(
    source,
    lines,
    diagnostics,
    options.defaultLanguageVersion ?? LANGUAGE_VERSION,
    options.breakpoints,
    options.colorTokens,
  ).parse();

  return {
    source,
    tokens: lexed.tokens,
    comments: lexed.comments,
    document,
    diagnostics: diagnostics.sorted(),
  };
}

/** Convenience entry point for component buffers and tests. */
export function parseComponentText(path: string, text: string): ParseResult {
  const created = createSourceFile(path, text);
  const parsed = parseComponentSource(created.source);
  if (created.diagnostics.length === 0) return parsed;
  return {
    ...parsed,
    diagnostics: [...created.diagnostics, ...parsed.diagnostics].sort(compareDiagnostics),
  };
}

class ComponentParser {
  readonly #source: SourceFile;
  readonly #lines: readonly LogicalLine[];
  readonly #diagnostics: DiagnosticBag;
  readonly #defaultNames = new Map<string, Span>();

  #version: string | null = null;
  #versionSpan: Span | null = null;
  #languageVersion: UiLanguageVersion;
  readonly #breakpoints: ReadonlyMap<string, number> | undefined;
  /** Theme color names: the project theme plus those this file declares. */
  readonly #colorTokens: Set<string>;
  #sawTopLevelLine = false;
  #componentSeen = false;
  #component: ComponentBuilder | null = null;
  #componentClosed = false;
  #variant: VariantBuilder | null = null;
  #elementStack: ElementBuilder[] = [];
  #nestingDepthReported = false;
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

    const component = this.#component;
    const startSpan =
      this.#versionSpan ?? component?.headerSpan ?? this.#lastSpan;
    const endSpan = component?.endSpan ?? startSpan;
    return {
      type: "document",
      version: this.#version,
      versionSpan: this.#versionSpan,
      languageVersion: this.#languageVersion,
      page: null,
      component: component === null ? null : this.#buildComponent(component),
      span: mergeSpans(startSpan, endSpan),
    };
  }

  #parseLine(line: LogicalLine): void {
    const raw = line.tokens;
    const first = raw[0]!;

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
          "write { at the end of the component, variant, or element header",
        );
      }
      this.#parseHeader(raw.slice(0, braceIndex), line, first);
      return;
    }

    if (this.#isVersionLine(raw)) {
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

    if (isKeyword(first, "page")) {
      this.#error(
        "KDM4008",
        "a component file cannot contain a page declaration",
        line.span,
        "put the page in a page file and the component in its own .kdm file",
      );
      return;
    }

    if (isKeyword(first, "component")) {
      this.#error(
        "KDM2002",
        "component declaration is missing its opening brace",
        line.span,
        'add { at the end of the line: component PriceCard {',
      );
      return;
    }

    if (raw.length === 1 && (first.kind === "identifier" || first.kind === "word")) {
      if (!this.#componentIsOpen()) {
        this.#outsideComponentError(line.span);
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

    if (!this.#componentIsOpen()) {
      this.#outsideComponentError(line.span);
      return;
    }

    this.#parseStatement(line);
  }

  #parseHeader(
    headerTokens: readonly Token[],
    line: LogicalLine,
    first: Token,
  ): void {
    if (isKeyword(first, "page")) {
      this.#error(
        "KDM4008",
        "a component file cannot contain a page declaration",
        line.span,
        "put the page in a page file and the component in its own .kdm file",
      );
      return;
    }

    if (isKeyword(first, "component")) {
      if (this.#componentSeen) {
        this.#error(
          "KDM3021",
          "a component file must contain exactly one component",
          line.span,
          "move the extra component into its own .kdm file",
        );
        return;
      }
      this.#openComponent(headerTokens, line);
      return;
    }

    if (!this.#componentIsOpen()) {
      this.#outsideComponentError(line.span);
      return;
    }

    if (
      headerTokens.length > 1 &&
      isAnyWord(first, "variant") &&
      this.#elementStack.length === 0
    ) {
      this.#openVariant(headerTokens, line);
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
        `language version ${version} is not supported; this compiler implements ${UI_LANGUAGE_VERSIONS.join(" and ")}`,
        tokens[1]!.span,
        `change the directive to: kadam ${LANGUAGE_VERSION}`,
      );
    }
  }

  #isVersionLine(tokens: readonly Token[]): boolean {
    return (
      !this.#sawTopLevelLine &&
      !this.#componentSeen &&
      isKeyword(tokens[0], "kadam")
    );
  }

  #openComponent(tokens: readonly Token[], line: LogicalLine): void {
    this.#componentSeen = true;
    const nameToken = tokens[1];
    let name = "";
    let nameSpan = line.span;

    if (
      tokens.length < 2 ||
      (nameToken?.kind !== "word" && nameToken?.kind !== "keyword") ||
      !/^[A-Z][A-Za-z0-9]{0,63}$/.test(nameToken.text)
    ) {
      this.#error(
        "KDM2002",
        "malformed component declaration",
        line.span,
        'use: component PriceCard { or component PriceCard takes a title as text {',
      );
    } else {
      name = nameToken.text;
      nameSpan = nameToken.span;
    }

    const parameters = this.#parseParameters(tokens, 2);
    this.#component = {
      name,
      nameSpan,
      headerSpan: line.span,
      parameters,
      elements: [],
      variants: [],
      endSpan: line.span,
    };
  }

  #parseParameters(
    tokens: readonly Token[],
    start: number,
  ): ComponentParameterNode[] {
    if (start >= tokens.length) return [];
    if (!isKeyword(tokens[start], "takes")) {
      this.#error(
        "KDM2002",
        "unexpected text after the component name",
        spanFromTokens(tokens.slice(start)),
        "use takes <parameter>, <parameter>, ... or end the header after the name",
      );
      return [];
    }

    const parameters: ComponentParameterNode[] = [];
    const names = new Map<string, Span>();
    let index = start + 1;
    if (index >= tokens.length) {
      this.#error(
        "KDM2002",
        "takes must be followed by at least one parameter",
        tokens[start]!.span,
        'use: takes a title as text',
      );
      return parameters;
    }

    while (index < tokens.length) {
      const startIndex = index;
      const article = tokens[index];
      if (!isKeyword(article, "a") && !isKeyword(article, "an")) {
        this.#error(
          "KDM2002",
          "a component parameter must start with a or an",
          article?.span ?? tokens[start]!.span,
          'use: takes a title as text',
        );
        break;
      }
      index += 1;

      const nameToken = tokens[index];
      if (
        (nameToken?.kind !== "identifier" && nameToken?.kind !== "keyword") ||
        !/^[a-z][A-Za-z0-9]{0,63}$/.test(nameToken.text)
      ) {
        this.#error(
          "KDM2002",
          "a component parameter needs a lower-camel name",
          nameToken?.span ?? article?.span ?? tokens[start]!.span,
          "use a name such as title or price",
        );
        break;
      }
      index += 1;

      if (!isAnyWord(tokens[index], "as")) {
        this.#error(
          "KDM2002",
          `parameter ${JSON.stringify(nameToken.text)} is missing as <type>`,
          tokens[index]?.span ?? nameToken.span,
          "use as text, as page, as url, as image, as length, or as color",
        );
      } else {
        index += 1;
      }

      const typeToken = tokens[index];
      let valueType: ComponentParameterType = "text";
      if (isKeyword(typeToken, "text")) {
        valueType = "text";
        index += 1;
      } else if (isKeyword(typeToken, "page")) {
        valueType = "page";
        index += 1;
      } else if (isAnyWord(typeToken, "url")) {
        valueType = "url";
        index += 1;
      } else if (isAnyWord(typeToken, "image")) {
        valueType = "image";
        index += 1;
      } else if (isAnyWord(typeToken, "length")) {
        valueType = "length";
        index += 1;
      } else if (isAnyWord(typeToken, "color")) {
        valueType = "color";
        index += 1;
      } else {
        this.#error(
          "KDM2002",
          "expected a parameter type",
          typeToken?.span ?? nameToken.span,
          "available parameter types are text, page, url, image, length, and color",
        );
        break;
      }

      let defaultValue: string | null = null;
      let defaultValueSpan: Span | null = null;
      if (isAnyWord(tokens[index], "defaulting")) {
        const defaultingSpan = tokens[index]!.span;
        index += 1;
        if (!isKeyword(tokens[index], "to")) {
          this.#error(
            "KDM2002",
            "defaulting must be followed by to and a quoted string",
            tokens[index]?.span ?? defaultingSpan,
            'use: defaulting to "value"',
          );
        } else {
          index += 1;
        }
        const defaultToken = tokens[index];
        if (!isString(defaultToken)) {
          this.#error(
            "KDM2002",
            "a parameter default must be a quoted string",
            defaultToken?.span ?? defaultingSpan,
            'use: defaulting to "value"',
          );
        } else {
          defaultValue = defaultToken.value;
          defaultValueSpan = defaultToken.span;
          index += 1;
        }
      }

      const previous = names.get(nameToken.text);
      if (previous !== undefined) {
        this.#error(
          "KDM3031",
          `duplicate component parameter ${JSON.stringify(nameToken.text)}`,
          nameToken.span,
          "parameter names must be unique within a component",
          [{ span: previous, message: "first declared here" }],
        );
      } else {
        names.set(nameToken.text, nameToken.span);
        parameters.push({
          type: "component-parameter",
          name: nameToken.text,
          nameSpan: nameToken.span,
          valueType,
          typeSpan: typeToken!.span,
          defaultValue,
          defaultValueSpan,
          span: spanFromTokens(tokens.slice(startIndex, index)),
        });
      }

      if (index >= tokens.length) break;
      if (tokens[index]!.kind !== "comma") {
        this.#error(
          "KDM2002",
          "component parameters must be separated by commas",
          tokens[index]!.span,
          "use a comma between parameter declarations",
        );
        break;
      }
      index += 1;
      if (index >= tokens.length) {
        this.#error(
          "KDM2002",
          "a trailing comma does not declare another parameter",
          tokens[index - 1]!.span,
          "remove the trailing comma or add another parameter",
        );
      }
    }

    return parameters;
  }

  #openVariant(tokens: readonly Token[], line: LogicalLine): void {
    if (this.#variant !== null) {
      this.#error(
        "KDM3029",
        "a variant cannot be declared inside another variant",
        line.span,
        "close the current variant before starting another",
      );
      return;
    }

    const nameToken = tokens[1];
    if (
      tokens.length !== 2 ||
      (nameToken?.kind !== "identifier" && nameToken?.kind !== "keyword") ||
      !/^[a-z][A-Za-z0-9]{0,63}$/.test(nameToken.text)
    ) {
      this.#error(
        "KDM3029",
        "malformed component variant",
        line.span,
        "use: variant outline {",
      );
      return;
    }
    if (nameToken.text === "default") {
      this.#error(
        "KDM3029",
        "default is reserved for the implicit component body",
        nameToken.span,
        "choose another variant name",
      );
      return;
    }

    const component = this.#component;
    if (component === null) return;
    const duplicate = component.variants.find(
      (variant) => variant.name === nameToken.text,
    );
    if (duplicate !== undefined) {
      this.#error(
        "KDM3029",
        `duplicate component variant ${JSON.stringify(nameToken.text)}`,
        nameToken.span,
        "variant names must be unique within a component",
        [{ span: duplicate.nameSpan, message: "first declared here" }],
      );
      return;
    }

    this.#variant = {
      name: nameToken.text,
      nameSpan: nameToken.span,
      headerSpan: line.span,
      elements: [],
      names: new Map(),
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
      this.#elementStack.push({
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
      // Open the block anyway so its body stays attributed to this element.
    }

    const names = this.#currentNames();
    const previous = validName ? names.get(nameToken.text) : undefined;
    if (!validName) {
      // Invalid names never participate in duplicate checks.
    } else if (previous !== undefined) {
      this.#error(
        "KDM3008",
        `duplicate element name ${JSON.stringify(nameToken.text)}`,
        nameToken.span,
        "element names must be unique in the component body or variant",
        [{ span: previous, message: "first declared here" }],
      );
    } else {
      names.set(nameToken.text, nameToken.span);
    }

    if (this.#elementStack.length >= 64 && !this.#nestingDepthReported) {
      this.#nestingDepthReported = true;
      this.#error(
        "KDM2011",
        "element nesting exceeds the 64-level limit",
        nameToken.span,
        "flatten the structure or split it into components",
      );
    }

    this.#elementStack.push({
      name: nameToken.text,
      nameSpan: nameToken.span,
      headerSpan: line.span,
      kind: null,
      statements: [],
      properties: [],
      children: [],
      endSpan: line.span,
    });
  }

  #currentNames(): Map<string, Span> {
    return this.#variant?.names ?? this.#defaultNames;
  }

  #parseStatement(line: LogicalLine): void {
    const period = line.tokens[line.tokens.length - 1];
    const tokens =
      period?.kind === "period" ? line.tokens.slice(0, -1) : line.tokens;
    if (tokens.length === 0) {
      this.#error(
        "KDM2010",
        "a period does not form a statement",
        period?.span ?? line.span,
        "write the statement before the period",
      );
      return;
    }
    this.#dispatchStatement(tokens, line);
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
          'declare the component kind first, then add with a <property> of "..."',
        );
        return;
      }
      builder.properties.push(property.binding);
      return;
    }

    const match = matchLine(tokens, {
      allowResponsive: true,
      languageVersion: this.#languageVersion,
      breakpoints: this.#breakpoints,
      colorTokens: this.#colorTokens,
    });
    for (const diagnostic of match.diagnostics) this.#diagnostics.addSpec(diagnostic);
    const node = match.selected?.body.statement ?? null;
    if (node === null) return;

    const builder = this.#elementStack[this.#elementStack.length - 1];
    if (builder === undefined) {
      this.#error(
        "KDM3021",
        node.type === "page-setting"
          ? "components cannot contain page settings"
          : "component bodies contain named elements and variants, not loose statements",
        node.span,
        "move the statement inside a named element",
      );
      return;
    }

    if (node.type === "page-setting") {
      this.#error(
        "KDM3021",
        "components cannot contain page settings",
        node.span,
        "move the page setting to the page that instantiates the component",
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
          [{ span: builder.kind.span, message: "first declared here" }],
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

    if (this.#variant !== null) {
      this.#variant.endSpan = span;
      this.#finishVariant(this.#variant);
      this.#variant = null;
      return;
    }

    if (this.#componentIsOpen()) {
      this.#component!.endSpan = span;
      this.#componentClosed = true;
      return;
    }

    this.#error(
      "KDM2010",
      "unexpected closing brace",
      span,
      "there is no open component, variant, or element block here",
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
    if (parent !== undefined) {
      parent.children.push(element);
    } else if (this.#variant !== null) {
      this.#variant.elements.push(element);
    } else if (this.#component !== null) {
      this.#component.elements.push(element);
    }
  }

  #finishVariant(builder: VariantBuilder): void {
    this.#component?.variants.push({
      type: "component-variant",
      name: builder.name,
      nameSpan: builder.nameSpan,
      elements: builder.elements,
      span: mergeSpans(builder.headerSpan, builder.endSpan),
    });
  }

  #buildComponent(builder: ComponentBuilder): ComponentNode {
    return {
      type: "component",
      name: builder.name,
      nameSpan: builder.nameSpan,
      parameters: builder.parameters,
      elements: builder.elements,
      variants: builder.variants,
      span: mergeSpans(builder.headerSpan, builder.endSpan),
    };
  }

  #componentIsOpen(): boolean {
    return this.#component !== null && !this.#componentClosed;
  }

  #outsideComponentError(span: Span): void {
    this.#error(
      "KDM4008",
      this.#componentSeen
        ? "content appears after the component block; a component file contains exactly one component"
        : "content appears outside a component block",
      span,
      'wrap content in component PriceCard { ... }',
    );
  }

  #finishAtEnd(): void {
    if (!this.#componentSeen) {
      this.#error(
        "KDM4008",
        "a component file must contain exactly one component",
        this.#lastSpan,
        'add component PriceCard { ... }',
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

    if (this.#variant !== null) {
      const variant = this.#variant;
      this.#error(
        "KDM2005",
        `variant ${JSON.stringify(variant.name)} is missing its closing brace`,
        variant.headerSpan,
        `add } to close the ${variant.name} variant`,
      );
      variant.endSpan = this.#source.span(this.#source.length, this.#source.length);
      this.#finishVariant(variant);
      this.#variant = null;
    }

    if (this.#component !== null && !this.#componentClosed) {
      this.#error(
        "KDM2005",
        `component ${JSON.stringify(this.#component.name)} is missing its closing brace`,
        this.#component.headerSpan,
        "add } to close the component",
      );
      this.#component.endSpan = this.#source.span(
        this.#source.length,
        this.#source.length,
      );
      this.#componentClosed = true;
    }
  }

  #error(
    code: import("../diagnostics/diagnostic.js").DiagnosticCode,
    message: string,
    span: Span,
    hint?: string,
    related?: readonly { readonly span: Span; readonly message: string }[],
  ): void {
    this.#diagnostics.error(code, message, span, hint, related);
  }
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