import type {
  Diagnostic,
  DiagnosticCode,
  Severity,
} from "../core/diagnostics/diagnostic.js";
import { isAbsolute, relative, resolve } from "node:path";

export interface EditorRelatedDiagnostic {
  readonly message: string;
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly file: string;
}

export interface EditorDiagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  readonly message: string;
  readonly hint?: string;
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly source: "kadam";
  readonly related: readonly EditorRelatedDiagnostic[];
}

export interface MapDiagnosticsOptions {
  /** Project-relative source path to retain. */
  readonly path: string;
  /** Required when diagnostic spans use absolute file paths. */
  readonly projectRoot?: string | undefined;
}

/**
 * Convert compiler diagnostics to editor markers for one source document.
 *
 * Core diagnostics remain the single source of truth. This adapter only filters
 * by file, exposes UTF-16 offsets alongside line/column data, and keeps related
 * locations for navigation.
 */
export function toEditorDiagnostics(
  diagnostics: readonly Diagnostic[],
  options: MapDiagnosticsOptions,
): readonly EditorDiagnostic[] {
  return diagnostics
    .filter((diagnostic) => matchesPath(diagnostic.span.file, options))
    .map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.hint === undefined ? {} : { hint: diagnostic.hint }),
      from: diagnostic.span.start.offset,
      to: diagnostic.span.end.offset,
      line: diagnostic.span.start.line,
      column: diagnostic.span.start.column,
      endLine: diagnostic.span.end.line,
      endColumn: diagnostic.span.end.column,
      source: "kadam" as const,
      related: (diagnostic.related ?? []).map((related) => ({
        message: related.message,
        from: related.span.start.offset,
        to: related.span.end.offset,
        line: related.span.start.line,
        column: related.span.start.column,
        endLine: related.span.end.line,
        endColumn: related.span.end.column,
        file: normalizePath(related.span.file),
      })),
    }))
    .sort(
      (a, b) =>
        a.from - b.from ||
        a.to - b.to ||
        compareText(a.code, b.code) ||
        compareText(a.message, b.message),
    );
}

function matchesPath(
  file: string,
  options: MapDiagnosticsOptions,
): boolean {
  const target = normalizePath(options.path);
  const normalized = normalizePath(file);
  if (normalized === target) return true;
  if (options.projectRoot === undefined) return false;

  const root = resolve(options.projectRoot);
  const absolute = isAbsolute(file) ? file : resolve(root, file);
  return normalizePath(relative(root, absolute)) === target;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
