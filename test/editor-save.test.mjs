import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  applySourceEdit,
  createSourceDocument,
  saveSourceDocument,
} from "../dist/editor/index.js";

function project(t) {
  const root = mkdtempSync(join(tmpdir(), "kadam-save-"));
  mkdirSync(join(root, "pages"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function documentFromDisk(root, path) {
  return createSourceDocument(path, readFileSync(join(root, path), "utf8"));
}

function replace(document, originalText, replacementText) {
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

test("saving replaces the file atomically and preserves CRLF and BOM", (t) => {
  const root = project(t);
  const path = "pages/home.kdm";
  const raw = '\uFEFFpage "Home" {\r\n    headline1 {\r\n        a main heading\r\n        the text says "Hello"\r\n    }\r\n}\r\n';
  writeFileSync(join(root, path), raw);

  const document = replace(
    documentFromDisk(root, path),
    '"Hello"',
    '"Hello world"',
  );
  const result = saveSourceDocument({ projectRoot: root, document });

  assert.equal(result.ok, true);
  assert.equal(result.status, "saved");
  assert.equal(result.document.dirty, false);
  assert.equal(result.document.savedText, document.text);

  const saved = readFileSync(join(root, path), "utf8");
  assert.equal(
    saved,
    '\uFEFFpage "Home" {\r\n    headline1 {\r\n        a main heading\r\n        the text says "Hello world"\r\n    }\r\n}\r\n',
  );
  assert.deepEqual(
    readdirSync(join(root, "pages")).filter((name) => name.endsWith(".tmp")),
    [],
  );

  const again = saveSourceDocument({
    projectRoot: root,
    document: result.document,
  });
  assert.equal(again.ok, true);
  assert.equal(again.status, "unchanged");
});

test("saving refuses to overwrite an external edit", (t) => {
  const root = project(t);
  const path = "pages/home.kdm";
  writeFileSync(join(root, path), 'page "Home" {\n}\n');

  const document = replace(
    documentFromDisk(root, path),
    '"Home"',
    '"Preview"',
  );
  writeFileSync(join(root, path), 'page "External" {\n}\n');

  const result = saveSourceDocument({ projectRoot: root, document });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict");
  assert.equal(result.error.diskText, 'page "External" {\n}\n');
  assert.equal(readFileSync(join(root, path), "utf8"), 'page "External" {\n}\n');
});

test("saving rejects paths outside the project and non-kdm files", (t) => {
  const root = project(t);
  const source = 'page "Home" {\n}\n';
  writeFileSync(join(root, "notes.txt"), source);

  for (const path of ["../escape.kdm", "notes.txt"]) {
    const document = createSourceDocument(path, source);
    const edited = replace(document, '"Home"', '"Preview"');
    const result = saveSourceDocument({ projectRoot: root, document: edited });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalid-path");
  }

  assert.equal(readFileSync(join(root, "notes.txt"), "utf8"), source);
});
