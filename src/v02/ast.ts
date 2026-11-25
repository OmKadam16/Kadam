import type { Span } from "../core/source/source-file.js";

export interface ModuleNode {
  readonly type: "module";
  readonly name: string;
  readonly nameSpan: Span;
  readonly headerSpan: Span;
  readonly versionSpan: Span;
  readonly declarations: readonly DeclarationNode[];
  readonly span: Span;
}

export type DeclarationNode =
  | RecordDeclarationNode
  | FunctionDeclarationNode
  | ExternalFunctionDeclarationNode;

export interface RecordDeclarationNode {
  readonly kind: "record";
  readonly name: string;
  readonly nameSpan: Span;
  readonly fields: readonly RecordFieldNode[];
  readonly headerSpan: Span;
  readonly span: Span;
}

export interface RecordFieldNode {
  readonly name: string;
  readonly nameSpan: Span;
  readonly type: TypeNode;
  readonly span: Span;
}

export interface FunctionDeclarationNode {
  readonly kind: "function";
  readonly name: string;
  readonly nameSpan: Span;
  readonly parameters: readonly ParameterNode[];
  readonly returnType: TypeNode;
  readonly body: BlockNode;
  readonly headerSpan: Span;
  readonly span: Span;
}

export interface ExternalFunctionDeclarationNode {
  readonly kind: "external";
  readonly name: string;
  readonly nameSpan: Span;
  readonly parameters: readonly ParameterNode[];
  readonly returnType: TypeNode;
  readonly providers: readonly ProviderNode[];
  readonly effects: readonly EffectNode[];
  readonly headerSpan: Span;
  readonly span: Span;
}

export interface ParameterNode {
  readonly name: string;
  readonly nameSpan: Span;
  readonly type: TypeNode;
  readonly span: Span;
}

export interface ProviderNode {
  readonly target: string;
  readonly targetSpan: Span;
  readonly symbol: string;
  readonly symbolSpan: Span;
  readonly span: Span;
}

export interface EffectNode {
  readonly name: string;
  readonly nameSpan: Span;
  readonly span: Span;
}

export type TypeNode = PrimitiveTypeNode | ListTypeNode | NamedTypeNode;

export interface PrimitiveTypeNode {
  readonly kind: "primitive";
  readonly name: "text" | "number" | "boolean" | "nothing";
  readonly span: Span;
}

export interface ListTypeNode {
  readonly kind: "list";
  readonly element: TypeNode;
  readonly span: Span;
}

export interface NamedTypeNode {
  readonly kind: "named";
  readonly name: string;
  readonly nameSpan: Span;
  readonly span: Span;
}

export interface BlockNode {
  readonly statements: readonly StatementNode[];
  readonly span: Span;
}

export type StatementNode =
  | LocalStatementNode
  | SetStatementNode
  | IfStatementNode
  | WhileStatementNode
  | ReturnStatementNode
  | OutputStatementNode
  | ExpressionStatementNode;

export interface LocalStatementNode {
  readonly kind: "local";
  readonly mutable: boolean;
  readonly name: string;
  readonly nameSpan: Span;
  readonly annotation: TypeNode | null;
  readonly initializer: ExpressionNode;
  readonly span: Span;
}

export interface SetStatementNode {
  readonly kind: "set";
  readonly name: string;
  readonly nameSpan: Span;
  readonly value: ExpressionNode;
  readonly span: Span;
}

export interface IfStatementNode {
  readonly kind: "if";
  readonly condition: ExpressionNode;
  readonly thenBlock: BlockNode;
  readonly otherwiseBlock: BlockNode | null;
  readonly span: Span;
}

export interface WhileStatementNode {
  readonly kind: "while";
  readonly condition: ExpressionNode;
  readonly body: BlockNode;
  readonly span: Span;
}

export interface ReturnStatementNode {
  readonly kind: "return";
  readonly value: ExpressionNode | null;
  readonly span: Span;
}

export interface OutputStatementNode {
  readonly kind: "output";
  readonly value: ExpressionNode;
  readonly span: Span;
}

export interface ExpressionStatementNode {
  readonly kind: "expression";
  readonly expression: ExpressionNode;
  readonly span: Span;
}

export type ExpressionNode =
  | TextExpressionNode
  | NumberExpressionNode
  | BooleanExpressionNode
  | NameExpressionNode
  | ListExpressionNode
  | RecordExpressionNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | FieldExpressionNode
  | IndexExpressionNode
  | CallExpressionNode;

export interface TextExpressionNode {
  readonly kind: "text";
  readonly value: string;
  readonly span: Span;
}

export interface NumberExpressionNode {
  readonly kind: "number";
  readonly value: number;
  readonly text: string;
  readonly span: Span;
}

export interface BooleanExpressionNode {
  readonly kind: "boolean";
  readonly value: boolean;
  readonly span: Span;
}

export interface NameExpressionNode {
  readonly kind: "name";
  readonly name: string;
  readonly nameSpan: Span;
  readonly span: Span;
}

export interface ListExpressionNode {
  readonly kind: "list";
  readonly elements: readonly ExpressionNode[];
  readonly span: Span;
}

export interface RecordExpressionNode {
  readonly kind: "record";
  readonly typeName: string;
  readonly typeNameSpan: Span;
  readonly fields: readonly RecordFieldValueNode[];
  readonly span: Span;
}

export interface RecordFieldValueNode {
  readonly name: string;
  readonly nameSpan: Span;
  readonly value: ExpressionNode;
  readonly span: Span;
}

export interface UnaryExpressionNode {
  readonly kind: "unary";
  readonly operator: "not" | "-";
  readonly operand: ExpressionNode;
  readonly span: Span;
}

export type BinaryOperator =
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

export interface BinaryExpressionNode {
  readonly kind: "binary";
  readonly operator: BinaryOperator;
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
  readonly span: Span;
}

export interface FieldExpressionNode {
  readonly kind: "field";
  readonly target: ExpressionNode;
  readonly field: string;
  readonly fieldSpan: Span;
  readonly span: Span;
}

export interface IndexExpressionNode {
  readonly kind: "index";
  readonly target: ExpressionNode;
  readonly index: ExpressionNode;
  readonly span: Span;
}

export interface CallExpressionNode {
  readonly kind: "call";
  readonly callee: ExpressionNode;
  readonly arguments: readonly ExpressionNode[];
  readonly span: Span;
}
