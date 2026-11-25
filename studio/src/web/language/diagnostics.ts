import { setDiagnostics, type Diagnostic as LintDiagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type { StudioDiagnostic } from "../../shared/protocol.js";

/** Push compiler diagnostics into CodeMirror without inventing a second format. */
export function applyEditorDiagnostics(
  view: EditorView | null,
  diagnostics: readonly StudioDiagnostic[],
  path: string,
): void {
  if (view === null) return;

  const length = view.state.doc.length;
  const markers: LintDiagnostic[] = diagnostics
    .filter((diagnostic) => diagnostic.file === path)
    .map((diagnostic) => {
      const from = clamp(diagnostic.from, 0, length);
      const to = clamp(diagnostic.to, from, length);
      return {
        from,
        to,
        severity:
          diagnostic.severity === "error"
            ? "error"
            : diagnostic.severity === "warning"
              ? "warning"
              : "info",
        message: `${diagnostic.code}: ${diagnostic.message}${
          diagnostic.hint === undefined ? "" : ` — ${diagnostic.hint}`
        }`,
        source: "kadam",
      };
    });

  view.dispatch(setDiagnostics(view.state, markers));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}
