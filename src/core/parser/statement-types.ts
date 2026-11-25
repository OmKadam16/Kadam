import type { KindNode, PageSettingNode, StatementNode } from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Token } from "../lexer/token.js";

export interface TemplateContext {
  readonly allowResponsive: boolean;
}

/**
 * A template may produce an element statement or a page setting. The parser
 * decides which body position accepts which node; the template table itself is
 * position-independent so overlap can be tested over every canonical line.
 */
export type MatchedNode = StatementNode | PageSettingNode | KindNode;

export interface StatementMatchBody {
  readonly statement: MatchedNode | null;
  readonly diagnostics: readonly DiagnosticSpec[];
}

export type StatementMatcher = (
  tokens: readonly Token[],
  context: TemplateContext,
) => StatementMatchBody | null;

export interface StatementTemplate {
  readonly id: string;
  readonly description: string;
  readonly examples: readonly string[];
  readonly match: StatementMatcher;
}

export interface StatementMatch {
  readonly template: StatementTemplate;
  readonly statement: StatementNode | null;
  readonly diagnostics: readonly DiagnosticSpec[];
}
