import { useEffect, useMemo, useState } from "react";
import {
  COMMAND_REFERENCE,
  groupCommandReference,
} from "../command-reference.js";

interface CommandReferenceProps {
  readonly onClose: () => void;
  readonly onUse: (command: string) => void;
}

export function CommandReference({ onClose, onUse }: CommandReferenceProps) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupCommandReference(query), [query]);
  const resultCount = groups.reduce(
    (total, group) => total + group.entries.length,
    0,
  );
  const searching = query.trim().length > 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="command-reference-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="command-reference"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-reference-title"
      >
        <header className="command-reference-header">
          <div>
            <h2 id="command-reference-title">Command reference</h2>
            <p>
              Search the local command grammar. Pick an example to put it in
              the command bar.
            </p>
          </div>
          <button
            type="button"
            className="icon-button command-reference-close"
            aria-label="Close command reference"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="command-reference-search">
          <input
            type="search"
            value={query}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            aria-label="Search commands"
            placeholder="Search commands, properties, or examples…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="command-reference-esc" aria-hidden="true">
            Esc
          </span>
        </div>

        <p className="command-reference-count" aria-live="polite">
          {searching
            ? `${resultCount} matching command${resultCount === 1 ? "" : "s"}`
            : `${COMMAND_REFERENCE.length} command types`}
        </p>

        <div className="command-reference-list">
          {groups.length === 0 ? (
            <div className="command-reference-empty">
              <strong>No matching commands</strong>
              <p>
                Try “shadow”, “padding”, “hover”, “text color”, or
                “gradient”.
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <section
                className="command-reference-group"
                key={group.category}
              >
                <h3>
                  {group.category}
                  <span>{group.entries.length}</span>
                </h3>
                {group.entries.map((entry) => (
                  <article
                    className="command-reference-entry"
                    key={`${entry.category}-${entry.title}`}
                  >
                    <h4>{entry.title}</h4>
                    <p>{entry.description}</p>
                    <div className="command-reference-examples">
                      {entry.examples.map((example) => (
                        <button
                          type="button"
                          className="command-reference-example"
                          key={example}
                          title={`Use “${example}”`}
                          onClick={() => onUse(example)}
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </section>
            ))
          )}
        </div>

        <footer className="command-reference-footer">
          <span>Examples are clickable; they fill the command bar.</span>
          <span>Style edits apply to the selected layer.</span>
        </footer>
      </div>
    </div>
  );
}
