import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applySourceEdit,
  createSourceDocument,
  sourceDocumentToSaveText,
} from "../dist/editor/index.js";

test("a source document normalizes text and restores its newline and BOM", () => {
  const raw = '\uFEFFkadam 0.1\r\n\r\npage "Home" {\r\n}\r\n';
  const document = createSourceDocument("pages/home.kdm", raw);

  assert.equal(document.text, 'kadam 0.1\n\npage "Home" {\n}\n');
  assert.equal(document.newline, "\r\n");
  assert.equal(document.bom, true);
  assert.equal(document.version, 1);
  assert.equal(document.dirty, false);
  assert.equal(sourceDocumentToSaveText(document), raw);
});

test("an exact edit replaces only its range and advances the version", () => {
  const document = createSourceDocument(
    "pages/home.kdm",
    'kadam 0.1\n\npage "Home" {\n    headline1 {\n        a main heading\n        the text says "Old"\n    }\n}\n',
  );
  const from = document.text.indexOf('"Old"');
  const result = applySourceEdit(document, {
    path: "pages/home.kdm",
    baseVersion: 1,
    from,
    to: from + 5,
    originalText: '"Old"',
    replacementText: '"New"',
    intent: "inspector",
  });

  assert.equal(result.ok, true);
  assert.equal(result.document.version, 2);
  assert.equal(result.document.dirty, true);
  assert.equal(result.edit.intent, "inspector");
  assert.match(result.document.text, /the text says "New"/);
  assert.equal(
    result.document.text.replace('"New"', '"Old"'),
    document.text,
  );

  const reverted = applySourceEdit(result.document, {
    path: "pages/home.kdm",
    baseVersion: 2,
    from,
    to: from + 5,
    originalText: '"New"',
    replacementText: '"Old"',
    intent: "manual",
  });
  assert.equal(reverted.ok, true);
  assert.equal(reverted.document.text, document.text);
  assert.equal(reverted.document.dirty, false);
});

test("edits reject stale versions, mismatched ranges, and wrong paths", () => {
  const document = createSourceDocument("pages/home.kdm", "alpha beta");

  const stale = applySourceEdit(document, {
    path: "pages/home.kdm",
    baseVersion: 99,
    from: 0,
    to: 5,
    originalText: "alpha",
    replacementText: "gamma",
    intent: "manual",
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "stale-version");
  assert.equal(stale.document, document);

  const mismatched = applySourceEdit(document, {
    path: "pages/home.kdm",
    baseVersion: 1,
    from: 0,
    to: 5,
    originalText: "wrong",
    replacementText: "gamma",
    intent: "manual",
  });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.error.code, "text-mismatch");

  const wrongPath = applySourceEdit(document, {
    path: "pages/about.kdm",
    baseVersion: 1,
    from: 0,
    to: 5,
    originalText: "alpha",
    replacementText: "gamma",
    intent: "manual",
  });
  assert.equal(wrongPath.ok, false);
  assert.equal(wrongPath.error.code, "path-mismatch");

  const invalid = applySourceEdit(document, {
    path: "pages/home.kdm",
    baseVersion: 1,
    from: 7,
    to: 3,
    originalText: "",
    replacementText: "",
    intent: "manual",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "invalid-range");
});

test("offsets are UTF-16 and replacement newlines are normalized", () => {
  const document = createSourceDocument("pages/home.kdm", 'text "😀"\n');
  const from = document.text.indexOf("😀");
  const result = applySourceEdit(document, {
    path: "pages/home.kdm",
    baseVersion: 1,
    from,
    to: from + "😀".length,
    originalText: "😀",
    replacementText: "two\r\nlines",
    intent: "manual",
  });

  assert.equal(result.ok, true);
  assert.equal(result.document.text, 'text "two\nlines"\n');
  assert.equal(from, 6);
});
