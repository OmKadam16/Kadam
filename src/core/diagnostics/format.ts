import type { SourceFile } from "../source/source-file.js";
import type { Diagnostic } from "./diagnostic.js";

/** Format one diagnostic with a source excerpt and caret underline. */
export function formatDiagnostic(
  diagnostic: Diagnostic,
  source: SourceFile,
): string {
  const line = diagnostic.span.start.line;
  const column = diagnostic.span.start.column;
  const text = source.lineText(line);
  const gutter = String(line).length;
  const pad = " ".repeat(gutter);
  const caretStart = Math.max(0, column - 1);
  const endColumn =
    diagnostic.span.end.line === line
      ? diagnostic.span.end.column
      : column + 1;
  const caretLength = Math.max(1, endColumn - column);

  const lines = [
    `${diagnostic.severity}[${diagnostic.code}]: ${diagnostic.message}`,
    `${pad}--> ${source.path}:${line}:${column}`,
    `${pad} |`,
    `${line} | ${text}`,
    `${pad} | ${" ".repeat(caretStart)}${"^".repeat(caretLength)}`,
  ];
  if (diagnostic.hint !== undefined) {
    lines.push(`${pad} = hint: ${diagnostic.hint}`);
  }
  (diagnostic.fixes ?? []).forEach((fix, index) => {
    lines.push(`${pad} = fix ${index + 1}: ${fix.label}`);
  });
  return lines.join("\n");
}

export function formatDiagnostics(
  diagnostics: readonly Diagnostic[],
  sources: readonly SourceFile[],
): string {
  const byPath = new Map(sources.map((source) => [source.path, source]));
  return diagnostics
    .map((diagnostic) => {
      const source = byPath.get(diagnostic.span.file);
      return source === undefined
        ? `${diagnostic.severity}[${diagnostic.code}]: ${diagnostic.message} (${diagnostic.span.file}:${diagnostic.span.start.line}:${diagnostic.span.start.column})`
        : formatDiagnostic(diagnostic, source);
    })
    .join("\n\n");
}
