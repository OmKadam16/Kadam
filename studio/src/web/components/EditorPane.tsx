import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { lintGutter } from "@codemirror/lint";
import {
  Annotation,
  EditorState,
  StateEffect,
  StateField,
  type Range,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import { basicSetup } from "codemirror";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { StudioDiagnostic } from "../../shared/protocol.js";
import { applyEditorDiagnostics } from "../language/diagnostics.js";
import { kadamHighlighting } from "../language/kadam.js";

const remoteUpdate = Annotation.define<boolean>();

export interface SourceHighlight {
  readonly from: number;
  readonly to: number;
}

const setSourceHighlight = StateEffect.define<SourceHighlight | null>();

const sourceHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(highlights, transaction) {
    let next = highlights.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setSourceHighlight)) continue;
      next = sourceHighlightDecorations(transaction.state.doc, effect.value);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function sourceHighlightDecorations(
  doc: Text,
  range: SourceHighlight | null,
): DecorationSet {
  if (
    range === null ||
    !Number.isFinite(range.from) ||
    !Number.isFinite(range.to)
  ) {
    return Decoration.none;
  }
  const from = Math.max(0, Math.min(range.from, doc.length));
  const to = Math.max(from, Math.min(range.to, doc.length));
  if (from === to) return Decoration.none;

  const ranges: Range<Decoration>[] = [];
  const firstLine = doc.lineAt(from).number;
  const lastLine = doc.lineAt(to - 1).number;
  for (let line = firstLine; line <= lastLine; line += 1) {
    ranges.push(
      Decoration.line({ class: "cm-kadam-source-highlight" }).range(
        doc.line(line).from,
      ),
    );
  }
  return Decoration.set(ranges, true);
}

export interface EditorHandle {
  getText(): string;
  replaceText(text: string): void;
  selectRange(from: number, to: number): void;
  focus(): void;
}

interface EditorPaneProps {
  readonly path: string;
  readonly initialText: string;
  readonly diagnostics: readonly StudioDiagnostic[];
  readonly highlight: SourceHighlight | null;
  readonly onChange: () => void;
  readonly onSave: () => void;
}

export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(
  function EditorPane(props, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const changeRef = useRef(props.onChange);
    const saveRef = useRef(props.onSave);
    const initialTextRef = useRef(props.initialText);
    changeRef.current = props.onChange;
    saveRef.current = props.onSave;
    initialTextRef.current = props.initialText;

    useEffect(() => {
      const host = hostRef.current;
      if (host === null) return;

      const view = new EditorView({
        state: EditorState.create({
          doc: initialTextRef.current,
          extensions: [
            basicSetup,
            lintGutter(),
            kadamHighlighting,
            sourceHighlightField,
            EditorView.lineWrapping,
            keymap.of([
              {
                key: "Mod-s",
                preventDefault: true,
                run: () => {
                  saveRef.current();
                  return true;
                },
              },
              ...defaultKeymap,
              ...historyKeymap,
              indentWithTab,
            ]),
            EditorView.updateListener.of((update) => {
              if (
                update.docChanged &&
                !update.transactions.some((transaction) =>
                  transaction.annotation(remoteUpdate),
                )
              ) {
                changeRef.current();
              }
            }),
          ],
        }),
        parent: host,
      });

      viewRef.current = view;
      view.focus();
      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, [props.path]);

    useEffect(() => {
      applyEditorDiagnostics(viewRef.current, props.diagnostics, props.path);
    }, [props.diagnostics, props.path]);

    useEffect(() => {
      viewRef.current?.dispatch({
        effects: setSourceHighlight.of(props.highlight),
      });
    }, [props.highlight]);

    useImperativeHandle(
      ref,
      () => ({
        getText(): string {
          return viewRef.current?.state.doc.toString() ?? "";
        },
        replaceText(text: string): void {
          const view = viewRef.current;
          if (view === null) return;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            annotations: remoteUpdate.of(true),
          });
        },
        selectRange(from: number, to: number): void {
          const view = viewRef.current;
          if (view === null) return;
          const length = view.state.doc.length;
          const start = Math.max(0, Math.min(from, length));
          const end = Math.max(start, Math.min(to, length));
          view.dispatch({
            selection: { anchor: start, head: end },
            scrollIntoView: true,
          });
          view.focus();
        },
        focus(): void {
          viewRef.current?.focus();
        },
      }),
      [],
    );

    return <div className="editor-host" ref={hostRef} />;
  },
);
