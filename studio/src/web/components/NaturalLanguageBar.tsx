import { useRef, useState } from "react";
import { NATURAL_LANGUAGE_EXAMPLES } from "../natural-language.js";
import { CommandReference } from "./CommandReference.js";

interface NaturalLanguageBarProps {
  readonly selectedName: string | null;
  readonly busy: boolean;
  readonly onRun: (text: string) => Promise<boolean>;
}

export function NaturalLanguageBar({
  selectedName,
  busy,
  onRun,
}: NaturalLanguageBarProps) {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [focused, setFocused] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const referenceButtonRef = useRef<HTMLButtonElement>(null);

  const closeReference = () => {
    setReferenceOpen(false);
    referenceButtonRef.current?.focus();
  };

  return (
    <section className={`natural-language${focused ? " is-focused" : ""}`}>
      <div className="natural-language-heading">
        <h2>Edit with words</h2>
        <span className="natural-language-local">Local</span>
        <button
          type="button"
          ref={referenceButtonRef}
          className="natural-language-reference"
          title="Browse supported commands"
          aria-haspopup="dialog"
          aria-expanded={referenceOpen}
          onClick={() => setReferenceOpen(true)}
        >
          Commands
        </button>
        <span className="natural-language-selection">
          {selectedName === null ? "No layer selected" : selectedName}
        </span>
      </div>

      <form
        className="natural-language-form"
        onSubmit={(event) => {
          event.preventDefault();
          const command = text.trim();
          if (command.length === 0 || running || busy) return;
          setRunning(true);
          void onRun(command)
            .then((accepted) => {
              if (accepted) setText("");
            })
            .finally(() => setRunning(false));
        }}
      >
        <input
          ref={inputRef}
          aria-label="Natural language edit"
          value={text}
          disabled={busy || running}
          placeholder={
            selectedName === null
              ? "Try: add a heading saying Welcome"
              : `Change ${selectedName} in plain English…`
          }
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <button
          type="submit"
          className="button primary small"
          disabled={busy || running || text.trim().length === 0}
        >
          {running ? "…" : "Apply"}
        </button>
      </form>

      <p className="natural-language-hint">
        {selectedName === null ? "Pick a layer for property edits. " : ""}
        Try “{NATURAL_LANGUAGE_EXAMPLES[0]}”, “{NATURAL_LANGUAGE_EXAMPLES[1]}”,
        or “{NATURAL_LANGUAGE_EXAMPLES[2]}”.
      </p>

      {referenceOpen ? (
        <CommandReference
          onClose={closeReference}
          onUse={(command) => {
            setText(command);
            setReferenceOpen(false);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      ) : null}
    </section>
  );
}
