import { RangeSetBuilder, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet,
} from "@codemirror/view";
import { createSourceFile, lex } from "kadam/dist/browser.js";

const TOKEN_CLASSES: Readonly<Record<string, string>> = {
  keyword: "kdm-token-keyword",
  string: "kdm-token-string",
  number: "kdm-token-number",
  length: "kdm-token-number",
  duration: "kdm-token-number",
  percentage: "kdm-token-number",
  color: "kdm-token-color",
  "hex-color": "kdm-token-color",
  identifier: "kdm-token-identifier",
  word: "kdm-token-word",
  comment: "kdm-token-comment",
  lbrace: "kdm-token-punctuation",
  rbrace: "kdm-token-punctuation",
  comma: "kdm-token-punctuation",
  period: "kdm-token-punctuation",
  invalid: "kdm-token-invalid",
};

function buildDecorations(text: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  try {
    const created = createSourceFile("buffer.kdm", text);
    const result = lex(created.source);
    for (const token of result.tokens) {
      const className = TOKEN_CLASSES[token.kind];
      if (className === undefined) continue;
      const from = token.span.start.offset;
      const to = token.span.end.offset;
      if (to <= from) continue;
      builder.add(from, to, Decoration.mark({ class: className }));
    }
  } catch {
    return Decoration.none;
  }
  return builder.finish();
}

/**
 * Highlighting is derived from `src/core/lexer`, the same lexer the compiler
 * uses. The adapter only maps token kinds to CSS classes.
 */
export const kadamHighlighting = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state.doc.toString());
  },
  update(value, transaction) {
    return transaction.docChanged
      ? buildDecorations(transaction.state.doc.toString())
      : value;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});
