import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SourceHistory,
  applySourceEdit,
  createSourceDocument,
} from "../dist/editor/index.js";

function edit(document, originalText, replacementText) {
  const from = document.text.indexOf(originalText);
  assert.notEqual(from, -1, `missing ${originalText}`);
  const result = applySourceEdit(document, {
    path: document.path,
    baseVersion: document.version,
    from,
    to: from + originalText.length,
    originalText,
    replacementText,
    intent: "manual",
  });
  assert.equal(result.ok, true);
  return result.document;
}

function initialDocument() {
  return createSourceDocument("pages/home.kdm", 'page "Home" {\n}\n');
}

test("undo and redo restore text with fresh versions", () => {
  const initial = initialDocument();
  const history = new SourceHistory(initial);
  const first = edit(initial, '"Home"', '"One"');
  history.commit(first);
  const second = edit(first, '"One"', '"Two"');
  history.commit(second);

  assert.equal(history.canUndo, true);
  assert.equal(history.undoDepth, 2);

  const undone = history.undo();
  assert.equal(undone?.text, first.text);
  assert.equal(undone?.version, 4);
  assert.equal(history.canRedo, true);

  const redone = history.redo();
  assert.equal(redone?.text, second.text);
  assert.equal(redone?.version, 5);
  assert.equal(history.redoDepth, 0);
});

test("undo restores the saved baseline and clears dirty state", () => {
  const initial = initialDocument();
  const history = new SourceHistory(initial);
  history.commit(edit(initial, '"Home"', '"Changed"'));
  assert.equal(history.document.dirty, true);

  const restored = history.undo();
  assert.equal(restored?.text, initial.text);
  assert.equal(restored?.dirty, false);
  assert.equal(history.canUndo, false);
});

test("a no-op save updates the saved baseline without adding history", () => {
  const initial = initialDocument();
  const history = new SourceHistory(initial);
  const changed = edit(initial, '"Home"', '"Saved"');
  history.commit(changed);

  const saved = { ...changed, savedText: changed.text, dirty: false };
  history.commit(saved);

  assert.equal(history.undoDepth, 1);
  const restored = history.undo();
  assert.equal(restored?.text, initial.text);
  assert.equal(restored?.savedText, changed.text);
  assert.equal(restored?.dirty, true);
});

test("committing after undo discards redo entries and rejects another path", () => {
  const initial = initialDocument();
  const history = new SourceHistory(initial);
  const first = edit(initial, '"Home"', '"One"');
  const second = edit(first, '"One"', '"Two"');
  history.commit(first);
  history.commit(second);
  history.undo();

  const branch = edit(history.document, '"One"', '"Branch"');
  history.commit(branch);
  assert.equal(history.canRedo, false);
  assert.equal(history.redoDepth, 0);

  assert.throws(
    () => history.commit(createSourceDocument("pages/other.kdm", 'page "Other" {\n}\n')),
    /cannot commit/,
  );
});
