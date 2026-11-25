import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyValidatedSourceEdit,
  createSourceDocument,
} from "../dist/editor/index.js";
import { standardProject } from "./helpers/dev-project.mjs";

function homeDocument(projectRoot) {
  return createSourceDocument(
    "pages/home.kdm",
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
  );
}

function editRequest(document, originalText, replacementText) {
  const from = document.text.indexOf(originalText);
  assert.notEqual(from, -1, `missing ${originalText}`);
  return {
    path: document.path,
    baseVersion: document.version,
    from,
    to: from + originalText.length,
    originalText,
    replacementText,
    intent: "inspector",
  };
}

test("a validated edit updates the candidate only when the project compiles", () => {
  const projectRoot = standardProject();
  const document = homeDocument(projectRoot);
  const diskBefore = readFileSync(join(projectRoot, "pages/home.kdm"), "utf8");

  const result = applyValidatedSourceEdit({
    projectRoot,
    document,
    request: editRequest(document, '"Home page"', '"Preview page"'),
  });

  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.document.version, 2);
  assert.match(result.document.text, /Preview page/);
  assert.equal(result.document.dirty, true);
  assert.equal(result.edit.intent, "inspector");
  assert.equal(
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
    diskBefore,
  );
});

test("an edit that breaks the project is rejected with compiler diagnostics", () => {
  const projectRoot = standardProject();
  const document = homeDocument(projectRoot);

  const result = applyValidatedSourceEdit({
    projectRoot,
    document,
    request: editRequest(document, "the text is 40px", "the text is 40furlongs"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, null);
  assert.equal(result.document, document);
  assert.equal(result.document.version, 1);
  assert.ok(result.diagnostics.length > 0);
  assert.ok(
    result.diagnostics.some((diagnostic) =>
      diagnostic.span.file.endsWith("pages/home.kdm"),
    ),
    JSON.stringify(result.diagnostics),
  );
});

test("a stale edit is rejected before the project is compiled", () => {
  const projectRoot = standardProject();
  const document = homeDocument(projectRoot);

  const result = applyValidatedSourceEdit({
    projectRoot,
    document,
    request: {
      ...editRequest(document, '"Home page"', '"Preview page"'),
      baseVersion: 99,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "stale-version");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.document, document);
});
