import {
  DiagnosticBag,
  type Diagnostic,
  type DiagnosticCode,
} from "../core/diagnostics/diagnostic.js";
import {
  createSourceFile,
  type SourceFile,
  type Span,
} from "../core/source/source-file.js";
import { CORE_LANGUAGE_VERSION } from "../version.js";
import type {
  BlockNode,
  BinaryOperator,
  CallExpressionNode,
  DeclarationNode,
  EffectNode,
  ExpressionNode,
  ExternalFunctionDeclarationNode,
  FunctionDeclarationNode,
  IfStatementNode,
  ListExpressionNode,
  LocalStatementNode,
  ModuleNode,
  ParameterNode,
  ProviderNode,
  RecordDeclarationNode,
  RecordExpressionNode,
  RecordFieldNode,
  RecordFieldValueNode,
  ReturnStatementNode,
  SetStatementNode,
  StatementNode,
  TypeNode,
  WhileStatementNode,
} from "./ast.js";
import {
  isKeyword,
  isOperator,
  lexV02,
  type V02Token,
} from "./lexer.js";

export interface V02ParseResult {
  readonly source: SourceFile;
  readonly module: ModuleNode | null;
  readonly diagnostics: readonly Diagnostic[];
}

interface SourceLine {
  readonly tokens: readonly V02Token[];
  readonly line: number;
  readonly span: Span;
}

class ParseFailure extends Error {
  readonly span: Span;
  readonly code: DiagnosticCode;
  readonly hint: string | undefined;

  constructor(
    code: DiagnosticCode,
    message: string,
    span: Span,
    hint?: string,
  ) {
    super(message);
    this.code = code;
    this.span = span;
    this.hint = hint;
  }
}

class TokenCursor {
  readonly #tokens: readonly V02Token[];
  readonly #end: number;
  #position: number;

  constructor(tokens: readonly V02Token[], start = 0, end = tokens.length) {
    this.#tokens = tokens;
    this.#position = start;
    this.#end = end;
  }

  get position(): number {
    return this.#position;
  }

  get end(): number {
    return this.#end;
  }

  atEnd(): boolean {
    return this.#position >= this.#end;
  }

  peek(offset = 0): V02Token | undefined {
    return this.#tokens[this.#position + offset];
  }

  take(message: string): V02Token {
    const token = this.peek();
    if (token === undefined || this.#position >= this.#end) {
      throw new ParseFailure(
        "KDM5002",
        message,
        this.#tokens[this.#end - 1]?.span ?? this.#tokens[0]!.span,
      );
    }
    this.#position += 1;
    return token;
  }

  expectKeyword(keyword: string, message: string): V02Token {
    const token = this.take(message);
    if (!isKeyword(token, keyword)) {
      throw new ParseFailure("KDM5002", message, token.span);
    }
    return token;
  }

  expectIdentifier(
    pattern: RegExp,
    message: string,
  ): V02Token {
    const token = this.take(message);
    if (token.kind !== "identifier" || !pattern.test(token.text)) {
      throw new ParseFailure("KDM5002", message, token.span);
    }
    return token;
  }

  expectString(message: string): V02Token {
    const token = this.take(message);
    if (token.kind !== "string" || typeof token.value !== "string") {
      throw new ParseFailure("KDM5002", message, token.span);
    }
    return token;
  }

  expectOperator(operator: string, message: string): V02Token {
    const token = this.take(message);
    if (!isOperator(token, operator)) {
      throw new ParseFailure("KDM5002", message, token.span);
    }
    return token;
  }

  fail(message: string, hint?: string): never {
    throw new ParseFailure(
      "KDM5002",
      message,
      this.peek()?.span ?? this.#tokens[this.#end - 1]!.span,
      hint,
    );
  }
}

const LOWER_CAMEL = /^[a-z][A-Za-z0-9]{0,63}$/;
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]{0,63}$/;
const EFFECT_SEGMENT = /^[a-z][a-z0-9]*$/;

export function parseModuleSource(source: SourceFile): V02ParseResult {
  const lexed = lexV02(source);
  const diagnostics = new DiagnosticBag();
  diagnostics.addAll(lexed.diagnostics);

  try {
    const lines = splitLines(lexed.tokens, source);
    const module = new ModuleParser(source, lines, diagnostics).parse();
    return {
      source,
      module,
      diagnostics: diagnostics.sorted(),
    };
  } catch (error) {
    if (error instanceof ParseFailure) {
      diagnostics.error(error.code, error.message, error.span, error.hint);
    } else {
      diagnostics.error(
        "KDM5002",
        "internal parser failure",
        source.span(0, 0),
      );
    }
    return {
      source,
      module: null,
      diagnostics: diagnostics.sorted(),
    };
  }
}

export function parseModuleText(path: string, text: string): V02ParseResult {
  const created = createSourceFile(path, text);
  const parsed = parseModuleSource(created.source);
  if (created.diagnostics.length === 0) return parsed;
  const diagnostics = new DiagnosticBag();
  diagnostics.addAll(created.diagnostics);
  diagnostics.addAll(parsed.diagnostics);
  return {
    source: parsed.source,
    module: parsed.module,
    diagnostics: diagnostics.sorted(),
  };
}

export function isV02Source(text: string): boolean {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const first = normalized
    .split(/\r?\n/)
    .find((line) => line.trim() !== "" && !line.trim().startsWith("//"));
  return (
    first !== undefined &&
    new RegExp(
      `^kadam\\s+${CORE_LANGUAGE_VERSION.replace(".", "\\.")}(?:\\s|$|//)`,
      "i",
    ).test(first.trim())
  );
}

class ModuleParser {
  readonly #source: SourceFile;
  readonly #lines: readonly SourceLine[];
  readonly #diagnostics: DiagnosticBag;
  #index = 0;

  constructor(
    source: SourceFile,
    lines: readonly SourceLine[],
    diagnostics: DiagnosticBag,
  ) {
    this.#source = source;
    this.#lines = lines;
    this.#diagnostics = diagnostics;
  }

  parse(): ModuleNode {
    const versionLine = this.#takeLine(
      "a v0.2 module must start with the line kadam 0.2",
    );
    if (
      versionLine.tokens.length !== 2 ||
      !isKeyword(versionLine.tokens[0], "kadam") ||
      versionLine.tokens[1]!.kind !== "number" ||
      versionLine.tokens[1]!.text !== CORE_LANGUAGE_VERSION
    ) {
      throw new ParseFailure(
        "KDM5001",
        `the first non-comment line must be exactly kadam ${CORE_LANGUAGE_VERSION}`,
        versionLine.span,
      );
    }

    const moduleLine = this.#takeLine(
      "a v0.2 file must contain exactly one module declaration",
    );
    const moduleHeader = requireHeader(moduleLine, "module");
    if (moduleHeader.length !== 1 || moduleHeader[0]!.kind !== "identifier") {
      throw new ParseFailure(
        "KDM5001",
        "malformed module declaration",
        moduleLine.span,
        'use: module greeting {',
      );
    }
    const nameToken = moduleHeader[0]!;
    if (!LOWER_CAMEL.test(nameToken.text)) {
      throw new ParseFailure(
        "KDM5001",
        "a module name must use lowerCamelCase",
        nameToken.span,
      );
    }

    const declarations: DeclarationNode[] = [];
    while (true) {
      const line = this.#peekLine(
        "module declaration is missing its closing brace",
      );
      if (line.tokens[0]?.kind === "rbrace") {
        this.#expectClosingLine(line, "module declaration");
        break;
      }
      declarations.push(this.#parseDeclaration(line));
    }

    if (this.#index < this.#lines.length) {
      throw new ParseFailure(
        "KDM5001",
        "content appears after the module block",
        this.#lines[this.#index]!.span,
        "a v0.2 source file contains exactly one module",
      );
    }

    const closing = this.#lines[this.#index - 1]!;
    const module: ModuleNode = {
      type: "module",
      name: nameToken.text,
      nameSpan: nameToken.span,
      headerSpan: moduleLine.span,
      versionSpan: versionLine.span,
      declarations,
      span: mergeSpans(versionLine.span, closing.span),
    };

    const stem = fileStem(this.#source.path);
    if (stem !== module.name) {
      this.#diagnostics.error(
        "KDM5001",
        `module ${JSON.stringify(module.name)} must match the file stem ${JSON.stringify(stem)}`,
        nameToken.span,
        `rename the module to ${stem} or rename the file to ${module.name}.kdm`,
      );
    }
    return module;
  }

  #parseDeclaration(line: SourceLine): DeclarationNode {
    this.#takeLine("declaration line is missing");
    const first = line.tokens[0];
    if (isKeyword(first, "record")) return this.#parseRecord(line);
    if (isKeyword(first, "function")) return this.#parseFunction(line);
    if (isKeyword(first, "external")) return this.#parseExternal(line);
    if (isKeyword(first, "page") || isKeyword(first, "component")) {
      throw new ParseFailure(
        "KDM5001",
        "a v0.2 module file cannot contain page or component declarations",
        line.span,
      );
    }
    throw new ParseFailure(
      "KDM5001",
      "module blocks contain only record, function, and external function declarations",
      line.span,
    );
  }

  #parseRecord(line: SourceLine): RecordDeclarationNode {
    const header = requireHeader(line, "record");
    if (header.length !== 1 || header[0]!.kind !== "identifier") {
      throw new ParseFailure(
        "KDM5002",
        "malformed record declaration",
        line.span,
        "use: record Person {",
      );
    }
    const nameToken = header[0]!;
    if (!PASCAL_CASE.test(nameToken.text)) {
      throw new ParseFailure(
        "KDM5002",
        "a record name must use PascalCase",
        nameToken.span,
      );
    }

    const fields: RecordFieldNode[] = [];
    const names = new Map<string, Span>();
    while (true) {
      const fieldLine = this.#peekLine("record declaration is missing its closing brace");
      if (fieldLine.tokens[0]?.kind === "rbrace") {
        this.#expectClosingLine(fieldLine, "record declaration");
        break;
      }
      this.#takeLine("record field line is missing");
      const cursor = new TokenCursor(fieldLine.tokens);
      const fieldToken = cursor.expectIdentifier(
        LOWER_CAMEL,
        "a record field must use a lowerCamelCase name",
      );
      cursor.expectKeyword("as", `field ${JSON.stringify(fieldToken.text)} needs as <type>`);
      const type = parseTypeNode(cursor);
      if (!cursor.atEnd()) {
        throw new ParseFailure(
          "KDM5002",
          "a record field must contain exactly one declaration per line",
          cursor.peek()!.span,
        );
      }
      const previous = names.get(fieldToken.text);
      if (previous !== undefined) {
        this.#diagnostics.error(
          "KDM5012",
          `duplicate record field ${JSON.stringify(fieldToken.text)}`,
          fieldToken.span,
          "record field names must be unique",
          [{ span: previous, message: "first declared here" }],
        );
      } else {
        names.set(fieldToken.text, fieldToken.span);
        fields.push({
          name: fieldToken.text,
          nameSpan: fieldToken.span,
          type,
          span: fieldLine.span,
        });
      }
    }

    return {
      kind: "record",
      name: nameToken.text,
      nameSpan: nameToken.span,
      fields,
      headerSpan: line.span,
      span: mergeSpans(line.span, this.#lines[this.#index - 1]!.span),
    };
  }

  #parseFunction(line: SourceLine): FunctionDeclarationNode {
    const header = requireHeader(line, "function");
    if (header.length < 2 || header[0]!.kind !== "identifier") {
      throw new ParseFailure(
        "KDM5002",
        "malformed function declaration",
        line.span,
        "use: function greet takes person as Person and returns text {",
      );
    }
    const nameToken = header[0]!;
    if (!LOWER_CAMEL.test(nameToken.text)) {
      throw new ParseFailure(
        "KDM5002",
        "a function name must use lowerCamelCase",
        nameToken.span,
      );
    }
    const signature = parseSignature(header, 1);
    const body = this.#parseBlock(line.span);
    if (
      body.closing.tokens.length !== 1 ||
      body.closing.tokens[0]!.kind !== "rbrace"
    ) {
      throw new ParseFailure(
        "KDM5002",
        "a function body must end with a closing brace on its own line",
        body.closing.span,
      );
    }
    return {
      kind: "function",
      name: nameToken.text,
      nameSpan: nameToken.span,
      parameters: signature.parameters,
      returnType: signature.returnType,
      body: body.block,
      headerSpan: line.span,
      span: mergeSpans(line.span, body.closing.span),
    };
  }

  #parseExternal(line: SourceLine): ExternalFunctionDeclarationNode {
    const header = requireHeader(line, "external");
    if (header.length < 2 || !isKeyword(header[0], "function")) {
      throw new ParseFailure(
        "KDM5002",
        "malformed external function declaration",
        line.span,
        "use: external function getEnv takes name as text and returns text {",
      );
    }
    const nameToken = header[1]!;
    if (nameToken.kind !== "identifier" || !LOWER_CAMEL.test(nameToken.text)) {
      throw new ParseFailure(
        "KDM5002",
        "an external function name must use lowerCamelCase",
        nameToken.span,
      );
    }
    const signature = parseSignature(header, 2);
    const providers: ProviderNode[] = [];
    const effects: EffectNode[] = [];
    const targetNames = new Map<string, Span>();
    const effectNames = new Map<string, Span>();

    while (true) {
      const metadataLine = this.#peekLine(
        "external function declaration is missing its closing brace",
      );
      if (metadataLine.tokens[0]?.kind === "rbrace") {
        this.#expectClosingLine(metadataLine, "external function declaration");
        break;
      }
      this.#takeLine("external metadata line is missing");
      const cursor = new TokenCursor(metadataLine.tokens);
      if (isKeyword(cursor.peek(), "provided")) {
        cursor.take("expected provided by");
        cursor.expectKeyword("by", "provided must be followed by by");
        const target = cursor.expectString("provided by requires a target string");
        cursor.expectKeyword("as", "provided by requires as and a native symbol");
        const symbol = cursor.expectString("provided by requires a native symbol string");
        if (!cursor.atEnd()) {
          throw new ParseFailure(
            "KDM5014",
            "a provided by line contains unexpected tokens",
            cursor.peek()!.span,
          );
        }
        const targetValue = String(target.value);
        const symbolValue = String(symbol.value);
        if (targetValue === "" || symbolValue === "") {
          throw new ParseFailure(
            "KDM5014",
            "target identifiers and native symbols must be non-empty strings",
            metadataLine.span,
          );
        }
        const previous = targetNames.get(targetValue);
        if (previous !== undefined) {
          this.#diagnostics.error(
            "KDM5014",
            `duplicate provider for target ${JSON.stringify(targetValue)}`,
            target.span,
            "a target may appear only once in one external declaration",
            [{ span: previous, message: "first declared here" }],
          );
        } else {
          targetNames.set(targetValue, target.span);
          providers.push({
            target: targetValue,
            targetSpan: target.span,
            symbol: symbolValue,
            symbolSpan: symbol.span,
            span: metadataLine.span,
          });
        }
        continue;
      }
      if (isKeyword(cursor.peek(), "affects")) {
        cursor.take("expected affects");
        const effect = parseEffectName(cursor);
        if (!cursor.atEnd()) {
          throw new ParseFailure(
            "KDM5014",
            "an affects line contains unexpected tokens",
            cursor.peek()!.span,
          );
        }
        const previous = effectNames.get(effect.name);
        if (previous !== undefined) {
          this.#diagnostics.error(
            "KDM5014",
            `duplicate effect ${JSON.stringify(effect.name)}`,
            effect.nameSpan,
            "effect names must be unique within one external declaration",
            [{ span: previous, message: "first declared here" }],
          );
        } else {
          effectNames.set(effect.name, effect.nameSpan);
          effects.push(effect);
        }
        continue;
      }
      throw new ParseFailure(
        "KDM5014",
        "external function bodies contain only provided by and affects lines",
        metadataLine.span,
      );
    }

    if (providers.length === 0) {
      this.#diagnostics.error(
        "KDM5014",
        `external function ${JSON.stringify(nameToken.text)} has no target provider`,
        nameToken.span,
        "add at least one provided by line",
      );
    }

    return {
      kind: "external",
      name: nameToken.text,
      nameSpan: nameToken.span,
      parameters: signature.parameters,
      returnType: signature.returnType,
      providers,
      effects,
      headerSpan: line.span,
      span: mergeSpans(line.span, this.#lines[this.#index - 1]!.span),
    };
  }

  #parseBlock(headerSpan: Span): { readonly block: BlockNode; readonly closing: SourceLine } {
    const statements: StatementNode[] = [];
    while (true) {
      const line = this.#peekLine("block is missing its closing brace");
      if (line.tokens[0]?.kind === "rbrace") {
        this.#takeLine("block is missing its closing brace");
        return {
          block: {
            statements,
            span: mergeSpans(headerSpan, line.span),
          },
          closing: line,
        };
      }
      this.#takeLine("statement line is missing");
      statements.push(this.#parseStatement(line));
    }
  }

  #parseStatement(line: SourceLine): StatementNode {
    const first = line.tokens[0];
    if (isKeyword(first, "let") || isKeyword(first, "var")) {
      return this.#parseLocal(line);
    }
    if (isKeyword(first, "set")) return this.#parseSet(line);
    if (isKeyword(first, "if")) return this.#parseIf(line);
    if (isKeyword(first, "while")) return this.#parseWhile(line);
    if (isKeyword(first, "return")) return this.#parseReturn(line);
    if (isKeyword(first, "output")) return this.#parseOutput(line);
    if (
      isKeyword(first, "record") ||
      isKeyword(first, "function") ||
      isKeyword(first, "external") ||
      isKeyword(first, "module")
    ) {
      throw new ParseFailure(
        "KDM5002",
        "declarations are not allowed inside a function body",
        line.span,
      );
    }
    return {
      kind: "expression",
      expression: parseExpression(line.tokens, 0, line.tokens.length),
      span: line.span,
    };
  }

  #parseLocal(line: SourceLine): LocalStatementNode {
    const cursor = new TokenCursor(line.tokens, 1);
    const nameToken = cursor.expectIdentifier(
      LOWER_CAMEL,
      "a local binding needs a lowerCamelCase name",
    );
    let annotation: TypeNode | null = null;
    if (isKeyword(cursor.peek(), "as")) {
      cursor.take("expected as");
      annotation = parseTypeNode(cursor);
    }
    cursor.expectKeyword("be", `binding ${JSON.stringify(nameToken.text)} needs be and an initializer`);
    if (cursor.atEnd()) {
      throw new ParseFailure(
        "KDM5002",
        "a local binding requires an initializer",
        nameToken.span,
      );
    }
    const initializer = parseExpression(
      line.tokens,
      cursor.position,
      line.tokens.length,
    );
    return {
      kind: "local",
      mutable: isKeyword(line.tokens[0], "var"),
      name: nameToken.text,
      nameSpan: nameToken.span,
      annotation,
      initializer,
      span: line.span,
    };
  }

  #parseSet(line: SourceLine): SetStatementNode {
    const cursor = new TokenCursor(line.tokens, 1);
    const nameToken = cursor.expectIdentifier(
      LOWER_CAMEL,
      "set needs a lowerCamelCase local name",
    );
    cursor.expectKeyword("to", "set needs to and a value");
    const value = parseExpression(line.tokens, cursor.position, line.tokens.length);
    return {
      kind: "set",
      name: nameToken.text,
      nameSpan: nameToken.span,
      value,
      span: line.span,
    };
  }

  #parseIf(line: SourceLine): IfStatementNode {
    const header = requireHeader(line, "if");
    if (header.length === 0) {
      throw new ParseFailure(
        "KDM5002",
        "if requires a condition",
        line.span,
      );
    }
    const condition = parseExpression(header, 0, header.length);
    const thenResult = this.#parseBlock(line.span);
    let otherwiseBlock: BlockNode | null = null;
    let endSpan = thenResult.closing.span;

    if (thenResult.closing.tokens.length === 1) {
      if (thenResult.closing.tokens[0]!.kind !== "rbrace") {
        throw new ParseFailure("KDM5002", "malformed if closing brace", thenResult.closing.span);
      }
    } else if (
      thenResult.closing.tokens.length === 3 &&
      thenResult.closing.tokens[0]!.kind === "rbrace" &&
      isKeyword(thenResult.closing.tokens[1], "otherwise") &&
      thenResult.closing.tokens[2]!.kind === "lbrace"
    ) {
      const otherwiseResult = this.#parseBlock(thenResult.closing.span);
      if (
        otherwiseResult.closing.tokens.length !== 1 ||
        otherwiseResult.closing.tokens[0]!.kind !== "rbrace"
      ) {
        throw new ParseFailure(
          "KDM5002",
          "an otherwise block must end with a closing brace on its own line",
          otherwiseResult.closing.span,
        );
      }
      otherwiseBlock = otherwiseResult.block;
      endSpan = otherwiseResult.closing.span;
    } else {
      throw new ParseFailure(
        "KDM5002",
        "a closing brace must be alone or followed by otherwise {",
        thenResult.closing.span,
      );
    }

    return {
      kind: "if",
      condition,
      thenBlock: thenResult.block,
      otherwiseBlock,
      span: mergeSpans(line.span, endSpan),
    };
  }

  #parseWhile(line: SourceLine): WhileStatementNode {
    const header = requireHeader(line, "while");
    if (header.length === 0) {
      throw new ParseFailure("KDM5002", "while requires a condition", line.span);
    }
    const condition = parseExpression(header, 0, header.length);
    const result = this.#parseBlock(line.span);
    if (result.closing.tokens.length !== 1 || result.closing.tokens[0]!.kind !== "rbrace") {
      throw new ParseFailure(
        "KDM5002",
        "a while block must end with a closing brace on its own line",
        result.closing.span,
      );
    }
    return {
      kind: "while",
      condition,
      body: result.block,
      span: mergeSpans(line.span, result.closing.span),
    };
  }

  #parseReturn(line: SourceLine): ReturnStatementNode {
    if (line.tokens.length === 1) {
      return { kind: "return", value: null, span: line.span };
    }
    return {
      kind: "return",
      value: parseExpression(line.tokens, 1, line.tokens.length),
      span: line.span,
    };
  }

  #parseOutput(line: SourceLine): StatementNode {
    if (line.tokens.length === 1) {
      throw new ParseFailure("KDM5002", "output requires a value", line.span);
    }
    return {
      kind: "output",
      value: parseExpression(line.tokens, 1, line.tokens.length),
      span: line.span,
    };
  }

  #peekLine(message: string): SourceLine {
    const line = this.#lines[this.#index];
    if (line === undefined) {
      const last = this.#source.span(this.#source.length, this.#source.length);
      throw new ParseFailure("KDM5002", message, last);
    }
    return line;
  }

  #takeLine(message: string): SourceLine {
    const line = this.#peekLine(message);
    this.#index += 1;
    return line;
  }

  #expectClosingLine(line: SourceLine, context: string): void {
    if (line.tokens.length !== 1 || line.tokens[0]!.kind !== "rbrace") {
      throw new ParseFailure(
        "KDM5002",
        `${context} must end with a closing brace on its own line`,
        line.span,
      );
    }
    this.#takeLine("closing brace is missing");
  }
}

function requireHeader(line: SourceLine, keyword: string): readonly V02Token[] {
  if (line.tokens.length < 2 || !isKeyword(line.tokens[0], keyword)) {
    throw new ParseFailure(
      "KDM5002",
      `malformed ${keyword} declaration`,
      line.span,
    );
  }
  const last = line.tokens[line.tokens.length - 1]!;
  if (last.kind !== "lbrace") {
    throw new ParseFailure(
      "KDM5002",
      `${keyword} declaration is missing its opening brace`,
      line.span,
    );
  }
  return line.tokens.slice(1, -1);
}

function parseSignature(
  header: readonly V02Token[],
  start: number,
): {
  readonly parameters: readonly ParameterNode[];
  readonly returnType: TypeNode;
} {
  const cursor = new TokenCursor(header, start);
  cursor.expectKeyword("takes", "function declaration needs takes");
  const parameters: ParameterNode[] = [];
  const names = new Map<string, Span>();
  if (isKeyword(cursor.peek(), "nothing")) {
    cursor.take("expected nothing");
    cursor.expectKeyword("and", "takes nothing must be followed by and returns");
  } else {
    while (true) {
      const nameToken = cursor.expectIdentifier(
        LOWER_CAMEL,
        "a parameter must use a lowerCamelCase name",
      );
      cursor.expectKeyword("as", `parameter ${JSON.stringify(nameToken.text)} needs as <type>`);
      const type = parseTypeNode(cursor);
      const previous = names.get(nameToken.text);
      if (previous !== undefined) {
        throw new ParseFailure(
          "KDM5004",
          `duplicate parameter ${JSON.stringify(nameToken.text)}`,
          nameToken.span,
        );
      }
      names.set(nameToken.text, nameToken.span);
      parameters.push({
        name: nameToken.text,
        nameSpan: nameToken.span,
        type,
        span: mergeSpans(nameToken.span, type.span),
      });
      cursor.expectKeyword("and", "parameters must be separated by and");
      if (isKeyword(cursor.peek(), "returns")) break;
    }
  }
  cursor.expectKeyword("returns", "function declaration needs and returns <type>");
  const returnType = parseTypeNode(cursor);
  if (!cursor.atEnd()) {
    throw new ParseFailure(
      "KDM5002",
      "unexpected tokens after the return type",
      cursor.peek()!.span,
    );
  }
  return { parameters, returnType };
}

function parseTypeNode(cursor: TokenCursor): TypeNode {
  const token = cursor.peek();
  if (isKeyword(token, "list")) {
    const start = cursor.take("expected list");
    cursor.expectKeyword("of", "list must be followed by of and an element type");
    const element = parseTypeNode(cursor);
    return { kind: "list", element, span: mergeSpans(start.span, element.span) };
  }
  if (isKeyword(token, "text")) {
    const value = cursor.take("expected a type");
    return { kind: "primitive", name: "text", span: value.span };
  }
  if (isKeyword(token, "number")) {
    const value = cursor.take("expected a type");
    return { kind: "primitive", name: "number", span: value.span };
  }
  if (isKeyword(token, "boolean")) {
    const value = cursor.take("expected a type");
    return { kind: "primitive", name: "boolean", span: value.span };
  }
  if (isKeyword(token, "nothing")) {
    const value = cursor.take("expected a type");
    return { kind: "primitive", name: "nothing", span: value.span };
  }
  if (token?.kind === "identifier") {
    const value = cursor.take("expected a type");
    return {
      kind: "named",
      name: value.text,
      nameSpan: value.span,
      span: value.span,
    };
  }
  throw new ParseFailure(
    "KDM5003",
    "expected a type",
    token?.span ?? cursor.peek()?.span ?? cursor.fail("expected a type"),
    "use text, number, boolean, list of <type>, nothing, or a record name",
  );
}

function parseEffectName(cursor: TokenCursor): EffectNode {
  const first = cursor.take("affects requires an effect name");
  if (
    (first.kind !== "identifier" && first.kind !== "keyword") ||
    !EFFECT_SEGMENT.test(first.text)
  ) {
    throw new ParseFailure(
      "KDM5014",
      "an effect name must use lower-case dotted identifiers",
      first.span,
    );
  }
  let name = first.text;
  let last = first;
  while (true) {
    const period = cursor.peek();
    if (period?.kind !== "period") break;
    cursor.take("expected effect segment");
    const segment = cursor.take("expected effect segment after .");
    if (
      (segment.kind !== "identifier" && segment.kind !== "keyword") ||
      !EFFECT_SEGMENT.test(segment.text)
    ) {
      throw new ParseFailure(
        "KDM5014",
        "an effect name must use lower-case dotted identifiers",
        segment.span,
      );
    }
    name += `.${segment.text}`;
    last = segment;
  }
  if (!name.includes(".")) {
    throw new ParseFailure(
      "KDM5014",
      "effect names must be dotted",
      mergeSpans(first.span, last.span),
      "use a name such as io.output or env.read",
    );
  }
  return {
    name,
    nameSpan: mergeSpans(first.span, last.span),
    span: mergeSpans(first.span, last.span),
  };
}

class ExpressionParser {
  readonly #tokens: readonly V02Token[];
  readonly #end: number;
  #position: number;

  constructor(tokens: readonly V02Token[], start: number, end: number) {
    this.#tokens = tokens;
    this.#position = start;
    this.#end = end;
  }

  parse(): ExpressionNode {
    const expression = this.#parseOr();
    if (this.#position !== this.#end) {
      throw new ParseFailure(
        "KDM5002",
        "unexpected token after expression",
        this.#tokens[this.#position]!.span,
      );
    }
    return expression;
  }

  #parseOr(): ExpressionNode {
    let left = this.#parseAnd();
    while (isKeyword(this.#peek(), "or")) {
      this.#take("expected or");
      const right = this.#parseAnd();
      left = binary("or", left, right);
    }
    return left;
  }

  #parseAnd(): ExpressionNode {
    let left = this.#parseEquality();
    while (isKeyword(this.#peek(), "and")) {
      this.#take("expected and");
      const right = this.#parseEquality();
      left = binary("and", left, right);
    }
    return left;
  }

  #parseEquality(): ExpressionNode {
    let left = this.#parseComparison();
    while (isOperator(this.#peek(), "==") || isOperator(this.#peek(), "!=")) {
      const operator = this.#take("expected equality operator").text as "==" | "!=";
      const right = this.#parseComparison();
      left = binary(operator, left, right);
    }
    return left;
  }

  #parseComparison(): ExpressionNode {
    let left = this.#parseAdditive();
    while (
      isOperator(this.#peek(), "<") ||
      isOperator(this.#peek(), "<=") ||
      isOperator(this.#peek(), ">") ||
      isOperator(this.#peek(), ">=")
    ) {
      const operator = this.#take("expected comparison operator").text as
        | "<"
        | "<="
        | ">"
        | ">=";
      const right = this.#parseAdditive();
      left = binary(operator, left, right);
    }
    return left;
  }

  #parseAdditive(): ExpressionNode {
    let left = this.#parseMultiplicative();
    while (isOperator(this.#peek(), "+") || isOperator(this.#peek(), "-")) {
      const operator = this.#take("expected additive operator").text as "+" | "-";
      const right = this.#parseMultiplicative();
      left = binary(operator, left, right);
    }
    return left;
  }

  #parseMultiplicative(): ExpressionNode {
    let left = this.#parseUnary();
    while (isOperator(this.#peek(), "*") || isOperator(this.#peek(), "/")) {
      const operator = this.#take("expected multiplicative operator").text as "*" | "/";
      const right = this.#parseUnary();
      left = binary(operator, left, right);
    }
    return left;
  }

  #parseUnary(): ExpressionNode {
    if (isKeyword(this.#peek(), "not") || isOperator(this.#peek(), "-")) {
      const token = this.#take("expected unary operator");
      const operand = this.#parseUnary();
      const operator = isKeyword(token, "not") ? "not" : "-";
      return {
        kind: "unary",
        operator,
        operand,
        span: mergeSpans(token.span, operand.span),
      };
    }
    return this.#parsePostfix();
  }

  #parsePostfix(): ExpressionNode {
    let expression = this.#parsePrimary();
    while (true) {
      const token = this.#peek();
      if (token?.kind === "period") {
        this.#take("expected field name");
        const field = this.#take("expected field name");
        if (field.kind !== "identifier" || !LOWER_CAMEL.test(field.text)) {
          throw new ParseFailure("KDM5002", "field names use lowerCamelCase", field.span);
        }
        expression = {
          kind: "field",
          target: expression,
          field: field.text,
          fieldSpan: field.span,
          span: mergeSpans(expression.span, field.span),
        };
        continue;
      }
      if (token?.kind === "lbracket") {
        this.#take("expected [");
        const index = this.#parseOr();
        const close = this.#take("index expression needs ]");
        if (close.kind !== "rbracket") {
          throw new ParseFailure("KDM5002", "index expression needs ]", close.span);
        }
        expression = {
          kind: "index",
          target: expression,
          index,
          span: mergeSpans(expression.span, close.span),
        };
        continue;
      }
      if (token?.kind === "lparen") {
        this.#take("expected (");
        const args: ExpressionNode[] = [];
        if (this.#peek()?.kind !== "rparen") {
          while (true) {
            args.push(this.#parseOr());
            if (this.#peek()?.kind !== "comma") break;
            this.#take("expected comma");
            if (this.#peek()?.kind === "rparen") {
              throw new ParseFailure(
                "KDM5002",
                "a trailing comma is not valid in a call",
                this.#peek()!.span,
              );
            }
          }
        }
        const close = this.#take("call needs )");
        if (close.kind !== "rparen") {
          throw new ParseFailure("KDM5002", "call needs )", close.span);
        }
        expression = {
          kind: "call",
          callee: expression,
          arguments: args,
          span: mergeSpans(expression.span, close.span),
        };
        continue;
      }
      break;
    }
    return expression;
  }

  #parsePrimary(): ExpressionNode {
    const token = this.#peek();
    if (token === undefined) {
      throw new ParseFailure(
        "KDM5002",
        "expected an expression",
        this.#tokens[this.#end - 1]!.span,
      );
    }
    if (token.kind === "string" && typeof token.value === "string") {
      this.#take("expected string");
      return { kind: "text", value: token.value, span: token.span };
    }
    if (token.kind === "number" && typeof token.value === "number") {
      this.#take("expected number");
      if (!Number.isFinite(token.value)) {
        throw new ParseFailure("KDM5002", "number literal is not finite", token.span);
      }
      return {
        kind: "number",
        value: token.value,
        text: token.text,
        span: token.span,
      };
    }
    if (isKeyword(token, "true") || isKeyword(token, "false")) {
      this.#take("expected boolean");
      return {
        kind: "boolean",
        value: isKeyword(token, "true"),
        span: token.span,
      };
    }
    if (token.kind === "identifier") {
      this.#take("expected name");
      if (this.#peek()?.kind === "lbrace") {
        return this.#parseRecordLiteral(token);
      }
      return {
        kind: "name",
        name: token.text,
        nameSpan: token.span,
        span: token.span,
      };
    }
    if (token.kind === "lbracket") {
      return this.#parseListLiteral();
    }
    if (token.kind === "lparen") {
      this.#take("expected (");
      const expression = this.#parseOr();
      const close = this.#take("parenthesized expression needs )");
      if (close.kind !== "rparen") {
        throw new ParseFailure("KDM5002", "parenthesized expression needs )", close.span);
      }
      return expression;
    }
    throw new ParseFailure("KDM5002", "expected an expression", token.span);
  }

  #parseListLiteral(): ListExpressionNode {
    const start = this.#take("expected [");
    const elements: ExpressionNode[] = [];
    if (this.#peek()?.kind !== "rbracket") {
      while (true) {
        elements.push(this.#parseOr());
        if (this.#peek()?.kind !== "comma") break;
        this.#take("expected comma");
        if (this.#peek()?.kind === "rbracket") {
          throw new ParseFailure(
            "KDM5002",
            "a trailing comma is not valid in a list",
            this.#peek()!.span,
          );
        }
      }
    }
    const close = this.#take("list needs ]");
    if (close.kind !== "rbracket") {
      throw new ParseFailure("KDM5002", "list needs ]", close.span);
    }
    return {
      kind: "list",
      elements,
      span: mergeSpans(start.span, close.span),
    };
  }

  #parseRecordLiteral(typeToken: V02Token): RecordExpressionNode {
    const open = this.#take("expected {");
    if (open.kind !== "lbrace") {
      throw new ParseFailure("KDM5002", "record construction needs {", open.span);
    }
    const fields: RecordFieldValueNode[] = [];
    if (this.#peek()?.kind !== "rbrace") {
      while (true) {
        const nameToken = this.#take("expected record field name");
        if (nameToken.kind !== "identifier" || !LOWER_CAMEL.test(nameToken.text)) {
          throw new ParseFailure(
            "KDM5012",
            "record field names use lowerCamelCase",
            nameToken.span,
          );
        }
        const colon = this.#take("record field needs :");
        if (colon.kind !== "colon") {
          throw new ParseFailure("KDM5012", "record field needs :", colon.span);
        }
        const value = this.#parseOr();
        fields.push({
          name: nameToken.text,
          nameSpan: nameToken.span,
          value,
          span: mergeSpans(nameToken.span, value.span),
        });
        if (this.#peek()?.kind !== "comma") break;
        this.#take("expected comma");
        if (this.#peek()?.kind === "rbrace") {
          throw new ParseFailure(
            "KDM5012",
            "a trailing comma is not valid in record construction",
            this.#peek()!.span,
          );
        }
      }
    }
    const close = this.#take("record construction needs }");
    if (close.kind !== "rbrace") {
      throw new ParseFailure("KDM5012", "record construction needs }", close.span);
    }
    return {
      kind: "record",
      typeName: typeToken.text,
      typeNameSpan: typeToken.span,
      fields,
      span: mergeSpans(typeToken.span, close.span),
    };
  }

  #peek(): V02Token | undefined {
    return this.#tokens[this.#position];
  }

  #take(message: string): V02Token {
    const token = this.#peek();
    if (token === undefined || this.#position >= this.#end) {
      throw new ParseFailure(
        "KDM5002",
        message,
        this.#tokens[this.#end - 1]!.span,
      );
    }
    this.#position += 1;
    return token;
  }
}

function parseExpression(
  tokens: readonly V02Token[],
  start: number,
  end: number,
): ExpressionNode {
  if (start >= end) {
    throw new ParseFailure(
      "KDM5002",
      "expected an expression",
      tokens[tokens.length - 1]!.span,
    );
  }
  return new ExpressionParser(tokens, start, end).parse();
}

function binary(
  operator: BinaryOperator,
  left: ExpressionNode,
  right: ExpressionNode,
): ExpressionNode {
  return {
    kind: "binary",
    operator,
    left,
    right,
    span: mergeSpans(left.span, right.span),
  };
}

function splitLines(
  tokens: readonly V02Token[],
  source: SourceFile,
): SourceLine[] {
  const lines: SourceLine[] = [];
  let current: V02Token[] = [];
  let lineNumber = 1;

  const flush = (): void => {
    if (current.length > 0) {
      lines.push({
        tokens: current,
        line: lineNumber,
        span: source.lineSpan(lineNumber),
      });
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

function fileStem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.endsWith(".kdm") ? name.slice(0, -4) : name;
}
