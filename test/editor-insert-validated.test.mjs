import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createSourceDocument,
  insertValidatedSourceStatement,
} from "../dist/editor/index.js";
import { standardProject } from "./helpers/dev-project.mjs";

function homeDocument(projectRoot) {
  return createSourceDocument(
    "pages/home.kdm",
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
  );
}

test("a valid insertion is accepted only when the project compiles", () => {
  const projectRoot = standardProject();
  const document = homeDocument(projectRoot);
  const diskBefore = readFileSync(join(projectRoot, "pages/home.kdm"), "utf8");

  const result = insertValidatedSourceStatement({
    projectRoot,
    document,
    documentKind: "page",
    targetId: "page",
    statement: `headline2 {
    a main heading
    the text says "Second heading"
}`,
  });

  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.targetId, "page");
  assert.equal(result.document.version, 2);
  assert.equal(result.document.dirty, true);
  assert.match(result.document.text, /headline2/);
  assert.equal(
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
    diskBefore,
  );
});

test("an insertion that breaks compilation is rejected", () => {
  const projectRoot = standardProject();
  const document = homeDocument(projectRoot);

  const result = insertValidatedSourceStatement({
    projectRoot,
    document,
    documentKind: "page",
    targetId: "page",
    statement: `headline2 {
    a main heading
    the text is 40furlongs
}`,
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

test("an invalid insertion target is rejected before compilation", () => {
  const projectRoot = standardProject();
  const document = homeDocument(projectRoot);

  const result = insertValidatedSourceStatement({
    projectRoot,
    document,
    documentKind: "page",
    targetId: "element:missing",
    statement: 'the text says "Unused"',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "target-not-found");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.document, document);
});
