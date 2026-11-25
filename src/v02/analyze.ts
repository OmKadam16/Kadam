import {
  DiagnosticBag,
  type Diagnostic,
} from "../core/diagnostics/diagnostic.js";
import type { Span } from "../core/source/source-file.js";
import type {
  BlockNode,
  ExpressionNode,
  ExternalFunctionDeclarationNode,
  FunctionDeclarationNode,
  ModuleNode,
  RecordDeclarationNode,
  StatementNode,
  TypeNode,
} from "./ast.js";
import {
  BOOLEAN_TYPE,
  NOTHING_TYPE,
  NUMBER_TYPE,
  TEXT_TYPE,
  describeType,
  listType,
  sameType,
  type CoreType,
  type IrBlock,
  type IrCall,
  type IrExpression,
  type IrExternal,
  type IrFieldDeclaration,
  type IrFunction,
  type IrLocal,
  type IrModule,
  type IrParameter,
  type IrRecord,
  type IrRecordField,
  type IrStatement,
} from "./ir.js";

export interface AnalyzeResult {
  readonly module: IrModule | null;
  readonly diagnostics: readonly Diagnostic[];
}

interface Signature {
  readonly kind: "function" | "external";
  readonly name: string;
  readonly nameSpan: Span;
  readonly parameters: readonly IrParameter[];
  readonly returnType: CoreType;
  readonly span: Span;
}

interface Binding {
  readonly type: CoreType;
  readonly mutable: boolean;
  readonly span: Span;
}

interface FunctionBuild {
  readonly node: FunctionDeclarationNode;
  readonly signature: Signature;
  readonly body: IrBlock;
  readonly directEffects: ReadonlySet<string>;
  readonly calls: ReadonlySet<string>;
}

const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "length",
  "output",
  "readText",
  "writeText",
]);

export function analyzeModule(module: ModuleNode): AnalyzeResult {
  return new Analyzer(module).analyze();
}

class Analyzer {
  readonly #module: ModuleNode;
  readonly #diagnostics = new DiagnosticBag();
  readonly #recordNodes = new Map<string, RecordDeclarationNode>();
  readonly #records = new Map<string, IrRecord>();
  readonly #signatures = new Map<string, Signature>();
  readonly #externals: IrExternal[] = [];
  readonly #functionBuilds: FunctionBuild[] = [];

  constructor(module: ModuleNode) {
    this.#module = module;
  }

  analyze(): AnalyzeResult {
    if (RESERVED_NAMES.has(this.#module.name)) {
      this.#diagnostics.error(
        "KDM5004",
        `module name ${JSON.stringify(this.#module.name)} is a reserved intrinsic name`,
        this.#module.nameSpan,
      );
    }
    this.#collectRecords();
    this.#resolveRecords();
    this.#checkRecordCycles();
    this.#collectSignatures();
    this.#validateMain();
    this.#checkFunctions();
    const functions = this.#finalizeFunctions();
    const main = functions.find((item) => item.name === "main") ?? null;

    return {
      module: {
        type: "module-ir",
        name: this.#module.name,
        sourceFile: this.#module.span.file,
        records: [...this.#records.values()],
        functions,
        externals: this.#externals,
        main,
        span: this.#module.span,
      },
      diagnostics: this.#diagnostics.sorted(),
    };
  }

  #collectRecords(): void {
    for (const declaration of this.#module.declarations) {
      if (declaration.kind !== "record") continue;
      const previous = this.#recordNodes.get(declaration.name);
      if (previous !== undefined) {
        this.#diagnostics.error(
          "KDM5004",
          `duplicate record ${JSON.stringify(declaration.name)}`,
          declaration.nameSpan,
          "record names must be unique",
          [{ span: previous.nameSpan, message: "first declared here" }],
        );
      } else {
        this.#recordNodes.set(declaration.name, declaration);
      }
    }
  }

  #resolveRecords(): void {
    for (const [name, node] of this.#recordNodes) {
      if (RESERVED_NAMES.has(name)) {
        this.#diagnostics.error(
          "KDM5004",
          `record name ${JSON.stringify(name)} is a reserved intrinsic name`,
          node.nameSpan,
        );
      }
      const fields: IrFieldDeclaration[] = [];
      for (const field of node.fields) {
        if (RESERVED_NAMES.has(field.name)) {
          this.#diagnostics.error(
            "KDM5004",
            `record field ${JSON.stringify(field.name)} is a reserved intrinsic name`,
            field.nameSpan,
          );
        }
        const type = this.#resolveType(field.type, false);
        fields.push({
          name: field.name,
          nameSpan: field.nameSpan,
          type: type ?? TEXT_TYPE,
          span: field.span,
        });
      }
      this.#records.set(name, {
        name,
        nameSpan: node.nameSpan,
        fields,
        span: node.span,
      });
    }
  }

  #checkRecordCycles(): void {
    const state = new Map<string, 0 | 1 | 2>();
    const reported = new Set<string>();

    const visit = (name: string): void => {
      const record = this.#records.get(name);
      if (record === undefined) return;
      state.set(name, 1);
      for (const field of record.fields) {
        const references = new Set<string>();
        collectRecordNames(field.type, references);
        for (const reference of references) {
          if (state.get(reference) === 1) {
            if (!reported.has(name)) {
              reported.add(name);
              this.#diagnostics.error(
                "KDM5003",
                `record ${JSON.stringify(name)} is recursive; record types cannot contain themselves`,
                record.nameSpan,
                "recursive data structures are deferred in v0.2",
              );
            }
          } else if (!state.has(reference)) {
            visit(reference);
          }
        }
      }
      state.set(name, 2);
    };

    for (const name of this.#records.keys()) {
      if (!state.has(name)) visit(name);
    }
  }

  #collectSignatures(): void {
    for (const declaration of this.#module.declarations) {
      if (declaration.kind === "record") continue;
      if (RESERVED_NAMES.has(declaration.name)) {
        this.#diagnostics.error(
          "KDM5004",
          `${JSON.stringify(declaration.name)} is a reserved intrinsic name`,
          declaration.nameSpan,
        );
      }
      const previous = this.#signatures.get(declaration.name);
      if (previous !== undefined) {
        this.#diagnostics.error(
          "KDM5004",
          `duplicate function ${JSON.stringify(declaration.name)}`,
          declaration.nameSpan,
          "function and external names share one module namespace",
          [{ span: previous.nameSpan, message: "first declared here" }],
        );
        continue;
      }

      const parameters: IrParameter[] = [];
      for (const parameter of declaration.parameters) {
        const type = this.#resolveType(parameter.type, false);
        parameters.push({
          name: parameter.name,
          nameSpan: parameter.nameSpan,
          type: type ?? TEXT_TYPE,
          span: parameter.span,
        });
      }
      const returnType = this.#resolveType(declaration.returnType, true) ?? TEXT_TYPE;
      const signature: Signature = {
        kind: declaration.kind,
        name: declaration.name,
        nameSpan: declaration.nameSpan,
        parameters,
        returnType,
        span: declaration.span,
      };
      this.#signatures.set(declaration.name, signature);

      if (declaration.kind === "external") {
        this.#externals.push(this.#buildExternal(declaration, signature));
      }
    }
  }

  #buildExternal(
    declaration: ExternalFunctionDeclarationNode,
    signature: Signature,
  ): IrExternal {
    return {
      kind: "external",
      name: declaration.name,
      nameSpan: declaration.nameSpan,
      parameters: signature.parameters,
      returnType: signature.returnType,
      providers: declaration.providers,
      effects: declaration.effects.map((effect) => effect.name),
      span: declaration.span,
    };
  }

  #validateMain(): void {
    const main = this.#signatures.get("main");
    if (main === undefined) return;
    if (main.kind !== "function") {
      this.#diagnostics.error(
        "KDM5016",
        "main must be declared as a Kadam function, not an external function",
        main.nameSpan,
      );
      return;
    }
    if (main.parameters.length !== 0) {
      this.#diagnostics.error(
        "KDM5016",
        "main must take no parameters",
        main.nameSpan,
      );
    }
    if (!sameType(main.returnType, NUMBER_TYPE)) {
      this.#diagnostics.error(
        "KDM5016",
        "main must return number",
        main.nameSpan,
      );
    }
  }

  #checkFunctions(): void {
    for (const declaration of this.#module.declarations) {
      if (declaration.kind !== "function") continue;
      const signature = this.#signatures.get(declaration.name);
      if (signature === undefined || signature.kind !== "function") continue;
      const checker = new FunctionChecker(
        signature,
        this.#signatures,
        this.#records,
        this.#diagnostics,
        (node, allowNothing) => this.#resolveType(node, allowNothing),
      );
      const checked = checker.check(declaration);
      this.#functionBuilds.push({
        node: declaration,
        signature,
        body: checked.body,
        directEffects: checked.directEffects,
        calls: checked.calls,
      });
    }
  }

  #finalizeFunctions(): IrFunction[] {
    const externalEffects = new Map(
      this.#externals.map((external) => [external.name, new Set(external.effects)]),
    );
    const effects = new Map<string, Set<string>>();
    for (const build of this.#functionBuilds) {
      effects.set(build.node.name, new Set(build.directEffects));
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const build of this.#functionBuilds) {
        const current = effects.get(build.node.name);
        if (current === undefined) continue;
        for (const call of build.calls) {
          const calledEffects =
            externalEffects.get(call) ?? effects.get(call);
          if (calledEffects === undefined) continue;
          for (const effect of calledEffects) {
            if (!current.has(effect)) {
              current.add(effect);
              changed = true;
            }
          }
        }
      }
    }

    return this.#functionBuilds.map((build) => ({
      kind: "function",
      name: build.node.name,
      nameSpan: build.node.nameSpan,
      parameters: build.signature.parameters,
      returnType: build.signature.returnType,
      body: build.body,
      effects: [...(effects.get(build.node.name) ?? new Set<string>())].sort(),
      span: build.node.span,
    }));
  }

  #resolveType(node: TypeNode, allowNothing: boolean): CoreType | null {
    if (node.kind === "primitive") {
      if (node.name === "nothing") {
        if (!allowNothing) {
          this.#diagnostics.error(
            "KDM5003",
            "nothing is a return-only type and cannot be stored or passed",
            node.span,
          );
          return null;
        }
        return NOTHING_TYPE;
      }
      if (node.name === "text") return TEXT_TYPE;
      if (node.name === "number") return NUMBER_TYPE;
      return BOOLEAN_TYPE;
    }
    if (node.kind === "list") {
      const element = this.#resolveType(node.element, false);
      return element === null ? null : listType(element);
    }
    if (!this.#recordNodes.has(node.name)) {
      this.#diagnostics.error(
        "KDM5003",
        `unknown type ${JSON.stringify(node.name)}`,
        node.nameSpan,
        "declare a record with that name or use a primitive type",
      );
      return null;
    }
    return { kind: "record", name: node.name };
  }
}

class FunctionChecker {
  readonly #signature: Signature;
  readonly #signatures: ReadonlyMap<string, Signature>;
  readonly #records: ReadonlyMap<string, IrRecord>;
  readonly #diagnostics: DiagnosticBag;
  readonly #resolveType: (node: TypeNode, allowNothing: boolean) => CoreType | null;
  readonly #scopes: Map<string, Binding>[] = [new Map()];
  readonly #declared = new Set<string>();
  readonly #directEffects = new Set<string>();
  readonly #calls = new Set<string>();

  constructor(
    signature: Signature,
    signatures: ReadonlyMap<string, Signature>,
    records: ReadonlyMap<string, IrRecord>,
    diagnostics: DiagnosticBag,
    resolveType: (node: TypeNode, allowNothing: boolean) => CoreType | null,
  ) {
    this.#signature = signature;
    this.#signatures = signatures;
    this.#records = records;
    this.#diagnostics = diagnostics;
    this.#resolveType = resolveType;

    for (const parameter of signature.parameters) {
      if (
        RESERVED_NAMES.has(parameter.name) ||
        signatures.has(parameter.name) ||
        this.#declared.has(parameter.name)
      ) {
        this.#diagnostics.error(
          "KDM5004",
          `parameter ${JSON.stringify(parameter.name)} shadows a reserved or module-level name`,
          parameter.nameSpan,
        );
      }
      this.#declared.add(parameter.name);
      this.#scopes[0]!.set(parameter.name, {
        type: parameter.type,
        mutable: false,
        span: parameter.nameSpan,
      });
    }
  }

  check(node: FunctionDeclarationNode): {
    readonly body: IrBlock;
    readonly directEffects: ReadonlySet<string>;
    readonly calls: ReadonlySet<string>;
  } {
    const body = this.#checkBlock(node.body);
    if (
      !sameType(this.#signature.returnType, NOTHING_TYPE) &&
      !blockAlwaysReturns(body)
    ) {
      this.#diagnostics.error(
        "KDM5010",
        `function ${JSON.stringify(this.#signature.name)} does not return a value on every reachable path`,
        this.#signature.nameSpan,
      );
    }
    return {
      body,
      directEffects: this.#directEffects,
      calls: this.#calls,
    };
  }

  #checkBlock(block: BlockNode): IrBlock {
    this.#scopes.push(new Map());
    const statements: IrStatement[] = [];
    let terminated = false;
    for (const statement of block.statements) {
      if (terminated) {
        this.#diagnostics.error(
          "KDM5015",
          "statement is unreachable after an unconditional return",
          statement.span,
        );
        break;
      }
      const checked = this.#checkStatement(statement);
      if (checked !== null) statements.push(checked);
      if (statement.kind === "return") terminated = true;
    }
    this.#scopes.pop();
    return { statements, span: block.span };
  }

  #checkStatement(statement: StatementNode): IrStatement | null {
    switch (statement.kind) {
      case "local":
        return this.#checkLocal(statement);
      case "set":
        return this.#checkSet(statement);
      case "if":
        return this.#checkIf(statement);
      case "while":
        return this.#checkWhile(statement);
      case "return":
        return this.#checkReturn(statement);
      case "output":
        return this.#checkOutput(statement);
      case "expression":
        return this.#checkExpressionStatement(statement);
    }
  }

  #checkLocal(statement: Extract<StatementNode, { kind: "local" }>): IrLocal | null {
    const annotation =
      statement.annotation === null
        ? null
        : this.#resolveType(statement.annotation, false);
    const initializer = this.#checkExpression(statement.initializer, annotation ?? undefined);
    if (initializer === null) return null;
    if (sameType(initializer.type, NOTHING_TYPE)) {
      this.#diagnostics.error(
        "KDM5006",
        "a nothing value cannot be stored",
        initializer.span,
      );
      return null;
    }
    if (annotation !== null && !sameType(initializer.type, annotation)) {
      this.#diagnostics.error(
        "KDM5006",
        `cannot initialize ${describeType(annotation)} with ${describeType(initializer.type)}`,
        initializer.span,
      );
      return null;
    }
    const type = annotation ?? initializer.type;
    if (!this.#declare(statement.name, type, statement.mutable, statement.nameSpan)) {
      return null;
    }
    return {
      kind: "local",
      mutable: statement.mutable,
      name: statement.name,
      nameSpan: statement.nameSpan,
      type,
      initializer,
      span: statement.span,
    };
  }

  #checkSet(statement: Extract<StatementNode, { kind: "set" }>): IrStatement | null {
    const binding = this.#lookup(statement.name);
    if (binding === undefined) {
      this.#diagnostics.error(
        "KDM5005",
        `unknown local ${JSON.stringify(statement.name)}`,
        statement.nameSpan,
      );
      return null;
    }
    if (!binding.mutable) {
      this.#diagnostics.error(
        "KDM5007",
        `cannot set immutable binding ${JSON.stringify(statement.name)}`,
        statement.nameSpan,
        "declare the binding with var",
      );
      return null;
    }
    const value = this.#checkExpression(statement.value, binding.type);
    if (value === null) return null;
    return {
      kind: "set",
      name: statement.name,
      nameSpan: statement.nameSpan,
      value,
      span: statement.span,
    };
  }

  #checkIf(statement: Extract<StatementNode, { kind: "if" }>): IrStatement | null {
    const condition = this.#checkCondition(statement.condition);
    if (condition === null) return null;
    return {
      kind: "if",
      condition,
      thenBlock: this.#checkBlock(statement.thenBlock),
      otherwiseBlock:
        statement.otherwiseBlock === null
          ? null
          : this.#checkBlock(statement.otherwiseBlock),
      span: statement.span,
    };
  }

  #checkWhile(statement: Extract<StatementNode, { kind: "while" }>): IrStatement | null {
    const condition = this.#checkCondition(statement.condition);
    if (condition === null) return null;
    return {
      kind: "while",
      condition,
      body: this.#checkBlock(statement.body),
      span: statement.span,
    };
  }

  #checkReturn(statement: Extract<StatementNode, { kind: "return" }>): IrStatement {
    if (statement.value === null) {
      if (!sameType(this.#signature.returnType, NOTHING_TYPE)) {
        this.#diagnostics.error(
          "KDM5010",
          `function ${JSON.stringify(this.#signature.name)} must return a ${describeType(
            this.#signature.returnType,
          )}`,
          statement.span,
        );
      }
      return { kind: "return", value: null, span: statement.span };
    }

    if (sameType(this.#signature.returnType, NOTHING_TYPE)) {
      this.#diagnostics.error(
        "KDM5010",
        `function ${JSON.stringify(this.#signature.name)} returns nothing and cannot return a value`,
        statement.span,
      );
      return { kind: "return", value: null, span: statement.span };
    }

    const value = this.#checkExpression(statement.value, this.#signature.returnType);
    return {
      kind: "return",
      value,
      span: statement.span,
    };
  }

  #checkOutput(statement: Extract<StatementNode, { kind: "output" }>): IrStatement | null {
    const value = this.#checkExpression(statement.value);
    if (value === null) return null;
    if (
      !sameType(value.type, TEXT_TYPE) &&
      !sameType(value.type, NUMBER_TYPE) &&
      !sameType(value.type, BOOLEAN_TYPE)
    ) {
      this.#diagnostics.error(
        "KDM5006",
        `output accepts text, number, or boolean, not ${describeType(value.type)}`,
        value.span,
        "format lists and records explicitly",
      );
      return null;
    }
    this.#directEffects.add("io.output");
    return { kind: "output", value, span: statement.span };
  }

  #checkExpressionStatement(
    statement: Extract<StatementNode, { kind: "expression" }>,
  ): IrStatement | null {
    const expression = this.#checkExpression(statement.expression);
    if (expression === null) return null;
    if (expression.kind !== "call" || !sameType(expression.type, NOTHING_TYPE)) {
      this.#diagnostics.error(
        "KDM5013",
        "only a call returning nothing may stand alone as a statement",
        statement.span,
        "bind the value with let or var",
      );
      return null;
    }
    return {
      kind: "expression",
      expression,
      span: statement.span,
    };
  }

  #checkCondition(expression: ExpressionNode): IrExpression | null {
    const checked = this.#checkExpression(expression);
    if (checked === null) return null;
    if (!sameType(checked.type, BOOLEAN_TYPE)) {
      this.#diagnostics.error(
        "KDM5011",
        `a condition must be boolean, not ${describeType(checked.type)}`,
        checked.span,
      );
      return null;
    }
    return checked;
  }

  #checkExpression(
    expression: ExpressionNode,
    expected?: CoreType,
  ): IrExpression | null {
    switch (expression.kind) {
      case "text":
        return this.#finish(
          { kind: "text", value: expression.value, type: TEXT_TYPE, span: expression.span },
          expected,
        );
      case "number":
        return this.#finish(
          {
            kind: "number",
            value: expression.value,
            type: NUMBER_TYPE,
            span: expression.span,
          },
          expected,
        );
      case "boolean":
        return this.#finish(
          {
            kind: "boolean",
            value: expression.value,
            type: BOOLEAN_TYPE,
            span: expression.span,
          },
          expected,
        );
      case "name": {
        const binding = this.#lookup(expression.name);
        if (binding === undefined) {
          this.#diagnostics.error(
            "KDM5005",
            `unknown local ${JSON.stringify(expression.name)}`,
            expression.nameSpan,
          );
          return null;
        }
        return this.#finish(
          {
            kind: "name",
            name: expression.name,
            nameSpan: expression.nameSpan,
            type: binding.type,
            span: expression.span,
          },
          expected,
        );
      }
      case "list":
        return this.#checkList(expression, expected);
      case "record":
        return this.#checkRecord(expression, expected);
      case "unary":
        return this.#checkUnary(expression, expected);
      case "binary":
        return this.#checkBinary(expression, expected);
      case "field":
        return this.#checkField(expression, expected);
      case "index":
        return this.#checkIndex(expression, expected);
      case "call":
        return this.#checkCall(expression, expected);
    }
  }

  #checkList(
    expression: Extract<ExpressionNode, { kind: "list" }>,
    expected?: CoreType,
  ): IrExpression | null {
    const expectedElement =
      expected?.kind === "list" ? expected.element : undefined;
    if (expression.elements.length === 0) {
      if (expected?.kind !== "list") {
        this.#diagnostics.error(
          "KDM5006",
          "an empty list needs an expected list type",
          expression.span,
          "add a local annotation or return type",
        );
        return null;
      }
      return {
        kind: "list",
        elements: [],
        type: expected,
        span: expression.span,
      };
    }

    if (expected !== undefined && expected.kind !== "list") {
      this.#diagnostics.error(
        "KDM5006",
        `expected ${describeType(expected)} but found a list`,
        expression.span,
      );
      return null;
    }

    const elements: IrExpression[] = [];
    let elementType: CoreType | null = null;
    for (const element of expression.elements) {
      const checked = this.#checkExpression(element, expectedElement);
      if (checked === null) return null;
      if (elementType === null) {
        elementType = checked.type;
      } else if (!sameType(elementType, checked.type)) {
        this.#diagnostics.error(
          "KDM5006",
          `list elements must have one type; expected ${describeType(
            elementType,
          )} but found ${describeType(checked.type)}`,
          checked.span,
        );
        return null;
      }
      elements.push(checked);
    }
    if (elementType === null) return null;
    if (
      expected?.kind === "list" &&
      !sameType(elementType, expected.element)
    ) {
      this.#diagnostics.error(
        "KDM5006",
        `expected ${describeType(expected)} but found list of ${describeType(elementType)}`,
        expression.span,
      );
      return null;
    }
    return {
      kind: "list",
      elements,
      type: expected ?? listType(elementType),
      span: expression.span,
    };
  }

  #checkRecord(
    expression: Extract<ExpressionNode, { kind: "record" }>,
    expected?: CoreType,
  ): IrExpression | null {
    const record = this.#records.get(expression.typeName);
    if (record === undefined) {
      this.#diagnostics.error(
        "KDM5012",
        `unknown record ${JSON.stringify(expression.typeName)}`,
        expression.typeNameSpan,
      );
      return null;
    }
    const fieldsByName = new Map(record.fields.map((field) => [field.name, field]));
    const supplied = new Set<string>();
    const fields: IrRecordField[] = [];
    for (const field of expression.fields) {
      if (supplied.has(field.name)) {
        this.#diagnostics.error(
          "KDM5012",
          `duplicate field ${JSON.stringify(field.name)} in record construction`,
          field.nameSpan,
        );
        continue;
      }
      supplied.add(field.name);
      const declared = fieldsByName.get(field.name);
      if (declared === undefined) {
        this.#diagnostics.error(
          "KDM5012",
          `unknown field ${JSON.stringify(field.name)} on record ${record.name}`,
          field.nameSpan,
        );
        this.#checkExpression(field.value);
        continue;
      }
      const value = this.#checkExpression(field.value, declared.type);
      if (value === null) continue;
      fields.push({
        name: field.name,
        nameSpan: field.nameSpan,
        value,
        span: field.span,
      });
    }
    for (const field of record.fields) {
      if (!supplied.has(field.name)) {
        this.#diagnostics.error(
          "KDM5012",
          `record ${record.name} is missing field ${JSON.stringify(field.name)}`,
          expression.typeNameSpan,
        );
      }
    }
    const type: CoreType = { kind: "record", name: record.name };
    return this.#finish(
      {
        kind: "record",
        typeName: record.name,
        typeNameSpan: expression.typeNameSpan,
        fields,
        type,
        span: expression.span,
      },
      expected,
    );
  }

  #checkUnary(
    expression: Extract<ExpressionNode, { kind: "unary" }>,
    expected?: CoreType,
  ): IrExpression | null {
    const operand = this.#checkExpression(expression.operand);
    if (operand === null) return null;
    const type = expression.operator === "not" ? BOOLEAN_TYPE : NUMBER_TYPE;
    const required = expression.operator === "not" ? BOOLEAN_TYPE : NUMBER_TYPE;
    if (!sameType(operand.type, required)) {
      this.#diagnostics.error(
        "KDM5006",
        `operator ${expression.operator} expects ${describeType(required)} but found ${describeType(
          operand.type,
        )}`,
        operand.span,
      );
      return null;
    }
    return this.#finish(
      {
        kind: "unary",
        operator: expression.operator,
        operand,
        type,
        span: expression.span,
      },
      expected,
    );
  }

  #checkBinary(
    expression: Extract<ExpressionNode, { kind: "binary" }>,
    expected?: CoreType,
  ): IrExpression | null {
    const left = this.#checkExpression(expression.left);
    if (left === null) return null;
    const right = this.#checkExpression(expression.right);
    if (right === null) return null;

    let type: CoreType | null = null;
    if (expression.operator === "and" || expression.operator === "or") {
      if (sameType(left.type, BOOLEAN_TYPE) && sameType(right.type, BOOLEAN_TYPE)) {
        type = BOOLEAN_TYPE;
      }
    } else if (expression.operator === "==" || expression.operator === "!=") {
      if (
        isPrimitive(left.type) &&
        isPrimitive(right.type) &&
        sameType(left.type, right.type)
      ) {
        type = BOOLEAN_TYPE;
      } else {
        this.#diagnostics.error(
          "KDM5013",
          "equality is defined only for two values of the same primitive type",
          expression.span,
          "lists and records cannot be compared with == or != in v0.2",
        );
        return null;
      }
    } else if (
      expression.operator === "<" ||
      expression.operator === "<=" ||
      expression.operator === ">" ||
      expression.operator === ">="
    ) {
      if (sameType(left.type, NUMBER_TYPE) && sameType(right.type, NUMBER_TYPE)) {
        type = BOOLEAN_TYPE;
      }
    } else if (expression.operator === "+") {
      if (sameType(left.type, NUMBER_TYPE) && sameType(right.type, NUMBER_TYPE)) {
        type = NUMBER_TYPE;
      } else if (sameType(left.type, TEXT_TYPE) && sameType(right.type, TEXT_TYPE)) {
        type = TEXT_TYPE;
      }
    } else if (sameType(left.type, NUMBER_TYPE) && sameType(right.type, NUMBER_TYPE)) {
      type = NUMBER_TYPE;
    }

    if (type === null) {
      this.#diagnostics.error(
        "KDM5006",
        `operator ${expression.operator} does not accept ${describeType(
          left.type,
        )} and ${describeType(right.type)}`,
        expression.span,
      );
      return null;
    }

    return this.#finish(
      {
        kind: "binary",
        operator: expression.operator,
        left,
        right,
        type,
        span: expression.span,
      },
      expected,
    );
  }

  #checkField(
    expression: Extract<ExpressionNode, { kind: "field" }>,
    expected?: CoreType,
  ): IrExpression | null {
    const target = this.#checkExpression(expression.target);
    if (target === null) return null;
    if (target.type.kind !== "record") {
      this.#diagnostics.error(
        "KDM5005",
        `field access requires a record, not ${describeType(target.type)}`,
        expression.fieldSpan,
      );
      return null;
    }
    const record = this.#records.get(target.type.name);
    if (record === undefined) {
      this.#diagnostics.error(
        "KDM5003",
        `unknown record ${JSON.stringify(target.type.name)}`,
        expression.fieldSpan,
      );
      return null;
    }
    const field = record.fields.find((item) => item.name === expression.field);
    if (field === undefined) {
      this.#diagnostics.error(
        "KDM5005",
        `record ${record.name} has no field ${JSON.stringify(expression.field)}`,
        expression.fieldSpan,
      );
      return null;
    }
    return this.#finish(
      {
        kind: "field",
        target,
        field: expression.field,
        fieldSpan: expression.fieldSpan,
        type: field.type,
        span: expression.span,
      },
      expected,
    );
  }

  #checkIndex(
    expression: Extract<ExpressionNode, { kind: "index" }>,
    expected?: CoreType,
  ): IrExpression | null {
    const target = this.#checkExpression(expression.target);
    if (target === null) return null;
    if (target.type.kind !== "list") {
      this.#diagnostics.error(
        "KDM5013",
        `indexing requires a list, not ${describeType(target.type)}`,
        expression.span,
      );
      return null;
    }
    const index = this.#checkExpression(expression.index, NUMBER_TYPE);
    if (index === null) return null;
    return this.#finish(
      {
        kind: "index",
        target,
        index,
        type: target.type.element,
        span: expression.span,
      },
      expected,
    );
  }

  #checkCall(
    expression: Extract<ExpressionNode, { kind: "call" }>,
    expected?: CoreType,
  ): IrExpression | null {
    if (expression.callee.kind !== "name") {
      this.#diagnostics.error(
        "KDM5013",
        "only named functions and intrinsics can be called",
        expression.callee.span,
      );
      return null;
    }
    const name = expression.callee.name;
    if (name === "length") {
      if (expression.arguments.length !== 1) {
        this.#diagnostics.error(
          "KDM5013",
          "length takes exactly one argument",
          expression.span,
        );
        return null;
      }
      const argument = this.#checkExpression(expression.arguments[0]!);
      if (argument === null) return null;
      if (argument.type.kind !== "list") {
        this.#diagnostics.error(
          "KDM5013",
          "length requires a list",
          argument.span,
        );
        return null;
      }
      return this.#finish(
        {
          kind: "call",
          callee: name,
          callKind: "intrinsic",
          arguments: [argument],
          type: NUMBER_TYPE,
          span: expression.span,
        },
        expected,
      );
    }
    if (name === "readText" || name === "writeText") {
      const expectedArguments = name === "readText" ? 1 : 2;
      if (expression.arguments.length !== expectedArguments) {
        this.#diagnostics.error(
          "KDM5013",
          `${name} takes ${expectedArguments} argument${expectedArguments === 1 ? "" : "s"}`,
          expression.span,
        );
        return null;
      }
      const args: IrExpression[] = [];
      for (const argument of expression.arguments) {
        const checked = this.#checkExpression(argument, TEXT_TYPE);
        if (checked === null) return null;
        args.push(checked);
      }
      this.#directEffects.add(
        name === "readText" ? "io.file.read" : "io.file.write",
      );
      return this.#finish(
        {
          kind: "call",
          callee: name,
          callKind: "intrinsic",
          arguments: args,
          type: name === "readText" ? TEXT_TYPE : NOTHING_TYPE,
          span: expression.span,
        },
        expected,
      );
    }

    const signature = this.#signatures.get(name);
    if (signature === undefined) {
      this.#diagnostics.error(
        "KDM5005",
        `unknown function ${JSON.stringify(name)}`,
        expression.callee.nameSpan,
      );
      return null;
    }
    if (expression.arguments.length !== signature.parameters.length) {
      this.#diagnostics.error(
        "KDM5013",
        `function ${JSON.stringify(name)} takes ${signature.parameters.length} argument${
          signature.parameters.length === 1 ? "" : "s"
        } but received ${expression.arguments.length}`,
        expression.span,
      );
      return null;
    }
    const args: IrExpression[] = [];
    for (let index = 0; index < expression.arguments.length; index += 1) {
      const parameter = signature.parameters[index]!;
      const checked = this.#checkExpression(
        expression.arguments[index]!,
        parameter.type,
      );
      if (checked === null) return null;
      args.push(checked);
    }
    this.#calls.add(name);
    return this.#finish(
      {
        kind: "call",
        callee: name,
        callKind: signature.kind,
        arguments: args,
        type: signature.returnType,
        span: expression.span,
      },
      expected,
    );
  }

  #finish(expression: IrExpression, expected?: CoreType): IrExpression | null {
    if (expected !== undefined && !sameType(expression.type, expected)) {
      this.#diagnostics.error(
        "KDM5006",
        `expected ${describeType(expected)} but found ${describeType(expression.type)}`,
        expression.span,
      );
      return null;
    }
    return expression;
  }

  #declare(
    name: string,
    type: CoreType,
    mutable: boolean,
    span: Span,
  ): boolean {
    if (
      RESERVED_NAMES.has(name) ||
      this.#signatures.has(name) ||
      this.#declared.has(name)
    ) {
      this.#diagnostics.error(
        "KDM5004",
        `local ${JSON.stringify(name)} shadows a reserved or existing name`,
        span,
      );
      return false;
    }
    this.#declared.add(name);
    this.#scopes[this.#scopes.length - 1]!.set(name, { type, mutable, span });
    return true;
  }

  #lookup(name: string): Binding | undefined {
    for (let index = this.#scopes.length - 1; index >= 0; index -= 1) {
      const binding = this.#scopes[index]!.get(name);
      if (binding !== undefined) return binding;
    }
    return undefined;
  }
}

function isPrimitive(type: CoreType): boolean {
  return type.kind === "text" || type.kind === "number" || type.kind === "boolean";
}

function collectRecordNames(type: CoreType, out: Set<string>): void {
  if (type.kind === "record") {
    out.add(type.name);
    return;
  }
  if (type.kind === "list") collectRecordNames(type.element, out);
}

function blockAlwaysReturns(block: IrBlock): boolean {
  for (const statement of block.statements) {
    if (statement.kind === "return") return true;
    if (
      statement.kind === "if" &&
      statement.otherwiseBlock !== null &&
      blockAlwaysReturns(statement.thenBlock) &&
      blockAlwaysReturns(statement.otherwiseBlock)
    ) {
      return true;
    }
  }
  return false;
}
