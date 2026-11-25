import type { KindNode, PageSettingNode, StatementNode } from "../ast/nodes.js";
import type { DiagnosticSpec } from "../diagnostics/diagnostic.js";
import type { Token } from "../lexer/token.js";
import type { UiLanguageVersion } from "../../version.js";

export interface TemplateContext {
  readonly allowResponsive: boolean;
  /**
   * Language version of the file being parsed. Templates newer than this
   * still match (so the diagnostic can name the construct) but are rejected
   * with KDM2013. Omitted means the latest version, for tooling.
   */
  readonly languageVersion?: UiLanguageVersion | undefined;
  /** kadam 0.3 custom breakpoints from kadam.json: name to min-width in px. */
  readonly breakpoints?: ReadonlyMap<string, number> | undefined;
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
  /** First language version that accepts this template. Default "0.1". */
  readonly since?: UiLanguageVersion | undefined;
  readonly match: StatementMatcher;
}

export interface StatementMatch {
  readonly template: StatementTemplate;
  readonly statement: StatementNode | null;
  readonly diagnostics: readonly DiagnosticSpec[];
}
