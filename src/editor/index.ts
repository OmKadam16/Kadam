export {
  planElementBorderEdit,
  planElementCornersEdit,
  setValidatedElementBorder,
  setValidatedElementCorners,
  type BorderEditError,
  type BorderEditErrorCode,
  type BorderInput,
  type CornersEditError,
  type CornersEditErrorCode,
  type CornersInput,
  type PlanElementBorderOptions,
  type PlanElementBorderResult,
  type PlanElementCornersOptions,
  type PlanElementCornersResult,
  type SetElementBorderOptions,
  type SetElementBorderResult,
  type SetElementCornersOptions,
  type SetElementCornersResult,
} from "./border.js";

export { findElementByOffset, parseEditorDocument } from "./ast.js";

export { SourceHistory } from "./history.js";

export {
  planElementBackgroundEdit,
  setValidatedElementBackground,
  type BackgroundEditError,
  type BackgroundEditErrorCode,
  type BackgroundInput,
  type PlanElementBackgroundOptions,
  type PlanElementBackgroundResult,
  type SetElementBackgroundOptions,
  type SetElementBackgroundResult,
} from "./background.js";

export {
  planElementTextEdit,
  quoteTextLiteral,
  setValidatedElementText,
  type PlanElementTextOptions,
  type PlanElementTextResult,
  type SetElementTextOptions,
  type SetElementTextResult,
  type TextEditError,
  type TextEditErrorCode,
} from "./text.js";

export {
  toEditorDiagnostics,
  type EditorDiagnostic,
  type EditorRelatedDiagnostic,
  type MapDiagnosticsOptions,
} from "./diagnostics.js";

export {
  insertValidatedSourceStatement,
  type InsertValidatedSourceStatementOptions,
  type ValidatedSourceInsertionResult,
} from "./insert-validated.js";

export {
  insertSourceStatement,
  type InsertSourceStatementOptions,
  type InsertSourceStatementResult,
  type SourceInsertionPlacement,
  type SourceInsertionError,
  type SourceInsertionErrorCode,
} from "./insert.js";

export {
  saveSourceDocument,
  type SaveSourceDocumentOptions,
  type SaveSourceDocumentResult,
  type SaveSourceError,
  type SaveSourceErrorCode,
} from "./save.js";

export {
  buildOutline,
  findOutlineNode,
  outlineNodeAt,
  outlinePathAt,
  type OutlineKind,
  type OutlineNode,
  type OutlineNodeType,
  type OutlineResult,
} from "./outline.js";

export {
  applyValidatedSourceEdit,
  type ApplyValidatedSourceEditOptions,
  type ValidatedSourceEditResult,
} from "./validate.js";

export {
  applySourceEdit,
  createSourceDocument,
  sourceDocumentToSaveText,
  type AppliedSourceEdit,
  type CreateSourceDocumentOptions,
  type SourceDocument,
  type SourceEditError,
  type SourceEditErrorCode,
  type SourceEditIntent,
  type SourceEditRequest,
  type SourceEditResult,
  type SourceNewline,
} from "./source-document.js";
