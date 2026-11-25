import type { StudioDiagnostic } from "../../shared/protocol.js";

interface DiagnosticsPanelProps {
  readonly diagnostics: readonly StudioDiagnostic[];
  readonly activePath: string | null;
  readonly onSelect: (diagnostic: StudioDiagnostic) => void;
}

export function DiagnosticsPanel({
  diagnostics,
  activePath,
  onSelect,
}: DiagnosticsPanelProps) {
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warnings = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  ).length;

  return (
    <section className="diagnostics-panel">
      <header className="diagnostics-header">
        <h2>Problems</h2>
        <span className={errors > 0 ? "problem-count has-errors" : "problem-count"}>
          {errors} error{errors === 1 ? "" : "s"} · {warnings} warning
          {warnings === 1 ? "" : "s"}
        </span>
      </header>
      <div className="diagnostics-list">
        {diagnostics.length === 0 ? (
          <p className="empty diagnostics-empty">The project compiles cleanly.</p>
        ) : (
          diagnostics.map((diagnostic, index) => (
            <button
              type="button"
              key={`${diagnostic.file}:${diagnostic.from}:${diagnostic.code}:${index}`}
              className={`diagnostic-row severity-${diagnostic.severity}${
                diagnostic.file === activePath ? " is-active-file" : ""
              }`}
              onClick={() => onSelect(diagnostic)}
            >
              <span className="diagnostic-code">{diagnostic.code}</span>
              <span className="diagnostic-message">{diagnostic.message}</span>
              <span className="diagnostic-location">
                {diagnostic.file}:{diagnostic.line}:{diagnostic.column}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
