import type { Span } from "../core/source/source-file.js";

export type CoreType =
  | { readonly kind: "text" }
  | { readonly kind: "number" }
  | { readonly kind: "boolean" }
  | { readonly kind: "nothing" }
  | { readonly kind: "list"; readonly element: CoreType }
  | { readonly kind: "record"; readonly name: string };

export const TEXT_TYPE: CoreType = { kind: "text" };
export const NUMBER_TYPE: CoreType = { kind: "number" };
export const BOOLEAN_TYPE: CoreType = { kind: "boolean" };
export const NOTHING_TYPE: CoreType = { kind: "nothing" };

export function listType(element: CoreType): CoreType {
  return { kind: "list", element };
}

export function sameType(left: CoreType, right: CoreType): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "list") {
    return right.kind === "list" && sameType(left.element, right.element);
  }
  if (left.kind === "record") {
    return right.kind === "record" && left.name === right.name;
  }
  return true;
}

export function describeType(type: CoreType): string {
  switch (type.kind) {
    case "list":
      return `list of ${describeType(type.element)}`;
    case "record":
      return type.name;
    default:
      return type.kind;
  }
}

export interface IrModule {
  readonly type: "module-ir";
  readonly name: string;
  readonly sourceFile: string;
  readonly records: readonly IrRecord[];
  readonly functions: readonly IrFunction[];
  readonly externals: readonly IrExternal[];
  readonly main: IrFunction | null;
  readonly span: Span;
}

export interface IrRecord {
  readonly name: string;
  readonly nameSpan: Span;
  readonly fields: readonly IrFieldDeclaration[];
  readonly span: Span;
}

export interface IrFieldDeclaration {
  readonly name: string;
  readonly nameSpan: Span;
  readonly type: CoreType;
  readonly span: Span;
}

export interface IrParameter {
  readonly name: string;
  readonly nameSpan: Span;
  readonly type: CoreType;
  readonly span: Span;
}

export interface IrFunction {
  readonly kind: "function";
  readonly name: string;
  readonly nameSpan: Span;
  readonly parameters: readonly IrParameter[];
  readonly returnType: CoreType;
  readonly body: IrBlock;
  readonly effects: readonly string[];
  readonly span: Span;
}

export interface IrExternal {
  readonly kind: "external";
  readonly name: string;
  readonly nameSpan: Span;
  readonly parameters: readonly IrParameter[];
  readonly returnType: CoreType;
  readonly providers: readonly IrProvider[];
  readonly effects: readonly string[];
  readonly span: Span;
}

export interface IrProvider {
  readonly target: string;
  readonly targetSpan: Span;
  readonly symbol: string;
  readonly symbolSpan: Span;
  readonly span: Span;
}

export interface IrBlock {
  readonly statements: readonly IrStatement[];
  readonly span: Span;
}

export type IrStatement =
  | IrLocal
  | IrSet
  | IrIf
  | IrWhile
  | IrReturn
  | IrOutput
  | IrExpressionStatement;

export interface IrLocal {
  readonly kind: "local";
  readonly mutable: boolean;
  readonly name: string;
  readonly nameSpan: Span;
  readonly type: CoreType;
  readonly initializer: IrExpression;
  readonly span: Span;
}

export interface IrSet {
  readonly kind: "set";
  readonly name: string;
  readonly nameSpan: Span;
  readonly value: IrExpression;
  readonly span: Span;
}

export interface IrIf {
  readonly kind: "if";
  readonly condition: IrExpression;
  readonly thenBlock: IrBlock;
  readonly otherwiseBlock: IrBlock | null;
  readonly span: Span;
}

export interface IrWhile {
  readonly kind: "while";
  readonly condition: IrExpression;
  readonly body: IrBlock;
  readonly span: Span;
}

export interface IrReturn {
  readonly kind: "return";
  readonly value: IrExpression | null;
  readonly span: Span;
}

export interface IrOutput {
  readonly kind: "output";
  readonly value: IrExpression;
  readonly span: Span;
}

export interface IrExpressionStatement {
  readonly kind: "expression";
  readonly expression: IrCall;
  readonly span: Span;
}

export type IrExpression =
  | IrText
  | IrNumber
  | IrBoolean
  | IrName
  | IrList
  | IrRecordLiteral
  | IrUnary
  | IrBinary
  | IrField
  | IrIndex
  | IrCall;

export interface IrText {
  readonly kind: "text";
  readonly value: string;
  readonly type: CoreType;
  readonly span: Span;
}

export interface IrNumber {
  readonly kind: "number";
  readonly value: number;
  readonly type: CoreType;
  readonly span: Span;
}

export interface IrBoolean {
  readonly kind: "boolean";
  readonly value: boolean;
  readonly type: CoreType;
  readonly span: Span;
}

export interface IrName {
  readonly kind: "name";
  readonly name: string;
  readonly nameSpan: Span;
  readonly type: CoreType;
  readonly span: Span;
}

export interface IrList {
  readonly kind: "list";
  readonly elements: readonly IrExpression[];
  readonly type: CoreType;
  readonly span: Span;
}

export interface IrRecordLiteral {
  readonly kind: "record";
  readonly typeName: string;
  readonly typeNameSpan: Span;
  readonly fields: readonly IrRecordField[];
  readonly type: CoreType;
  readonly span: Span;
}

export interface IrRecordField {
  readonly name: string;
  readonly nameSpan: Span;
  readonly value: IrExpression;
  readonly span: Span;
}

export interface IrUnary {
  readonly kind: "unary";
  readonly operator: "not" | "-";
  readonly operand: IrExpression;
  readonly type: CoreType;
  readonly span: Span;
}

export interface IrBinary {
  readonly kind: "binary";
  readonly operator:
    | "or"
    | "and"
    | "=="
    | "!="
    | "<"
    | "<="
    | ">"
    | ">="
    | "+"
    | "-"
    | "*"
    | "/";
  readonly left: IrExpression;
  readonly right: IrExpression;
  readonly type: CoreType;
  readonly span: Span;
}

export interface IrField {
  readonly kind: "field";
  readonly target: IrExpression;
  readonly field: string;
  readonly fieldSpan: Span;
  readonly type: CoreType;
  readonly span: Span;
}

export interface IrIndex {
  readonly kind: "index";
  readonly target: IrExpression;
  readonly index: IrExpression;
  readonly type: CoreType;
  readonly span: Span;
}

export interface IrCall {
  readonly kind: "call";
  readonly callee: string;
  readonly callKind: "function" | "external" | "intrinsic";
  readonly arguments: readonly IrExpression[];
  readonly type: CoreType;
  readonly span: Span;
}
