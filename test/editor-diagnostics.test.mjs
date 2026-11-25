import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyValidatedSourceEdit,
  createSourceDocument,
  toEditorDiagnostics,
} from "../dist/editor/index.js";
import { createSourceFile } from "../dist/core/source/source-file.js";
import { standardProject } from "./helpers/dev-project.mjs";

function homeDocument(projectRoot) {
  return createSourceDocument(
    "pages/home.kdm",
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
  );
}

test("compiler diagnostics map to the matching editor document", () => {
  const projectRoot = standardProject();
  const document = homeDocument(projectRoot);
  const from = document.text.indexOf("the text is 40px");
  assert.notEqual(from, -1);

  const invalid = applyValidatedSourceEdit({
    projectRoot,
    document,
    request: {
      path: document.path,
      baseVersion: document.version,
      from,
      to: from + "the text is 40px".length,
      originalText: "the text is 40px",
      replacementText: "the text is 40furlongs",
      intent: "inspector",
    },
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.diagnostics.length > 0);

  const mapped = toEditorDiagnostics(invalid.diagnostics, {
    path: "pages/home.kdm",
    projectRoot,
  });
  const other = toEditorDiagnostics(invalid.diagnostics, {
    path: "pages/about.kdm",
    projectRoot,
  });

  assert.ok(mapped.length > 0);
  assert.deepEqual(other, []);
  assert.ok(mapped.every((diagnostic) => diagnostic.source === "kadam"));
  assert.ok(
    mapped.every(
      (diagnostic) =>
        diagnostic.from >= 0 &&
        diagnostic.to >= diagnostic.from &&
        diagnostic.line >= 1,
    ),
  );
});

test("diagnostic mapping preserves related spans and sorts by offset", () => {
  const { source } = createSourceFile(
    "pages/home.kdm",
    'page "Home" {\n    hero1 {\n        a card\n    }\n}\n',
  );
  const later = source.span(30, 32);
  const earlier = source.span(0, 4);
  const relatedSpan = source.span(10, 12);

  const mapped = toEditorDiagnostics(
    [
      {
        code: "KDM3001",
        severity: "error",
        message: "later",
        span: later,
      },
      {
        code: "KDM3002",
        severity: "warning",
        message: "earlier",
        span: earlier,
        related: [{ message: "see this", span: relatedSpan }],
      },
    ],
    { path: "pages/home.kdm" },
  );

  assert.equal(mapped[0].code, "KDM3002");
  assert.equal(mapped[1].code, "KDM3001");
  assert.equal(mapped[0].related.length, 1);
  assert.equal(mapped[0].related[0].message, "see this");
  assert.equal(mapped[0].related[0].from, relatedSpan.start.offset);
  assert.equal(mapped[0].related[0].to, relatedSpan.end.offset);
});

test("absolute diagnostic paths match through the project root", () => {
  const projectRoot = standardProject();
  const sourcePath = join(projectRoot, "pages/home.kdm");
  const { source } = createSourceFile(
    sourcePath,
    'page "Home" {\n}\n',
  );
  const diagnostic = {
    code: "KDM3001",
    severity: "error",
    message: "absolute path",
    span: source.span(0, 4),
  };

  const mapped = toEditorDiagnostics([diagnostic], {
    path: "pages/home.kdm",
    projectRoot,
  });
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].from, 0);
  assert.equal(mapped[0].to, 4);
});
