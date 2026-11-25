import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createSourceDocument,
  planElementTextEdit,
  quoteTextLiteral,
  setValidatedElementText,
} from "../dist/editor/index.js";
import { standardProject } from "./helpers/dev-project.mjs";

function homeDocument(projectRoot) {
  return createSourceDocument(
    "pages/home.kdm",
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
  );
}

test("text edits replace only the quoted literal and escape special characters", () => {
  const projectRoot = standardProject();
  const document = homeDocument(projectRoot);

  const planned = planElementTextEdit({
    document,
    documentKind: "page",
    targetId: "element:headline1",
    value: 'He said "Hi"\\n\nnext\tline',
  });

  assert.equal(planned.ok, true);
  assert.equal(planned.request.originalText, '"Home page"');
  assert.equal(
    planned.request.replacementText,
    '"He said \\"Hi\\"\\\\n\\nnext\\tline"',
  );
  assert.equal(quoteTextLiteral("\u0001"), '"\\u0001"');
});

test("validated text edits update the document when the project compiles", () => {
  const projectRoot = standardProject();
  const document = homeDocument(projectRoot);

  const result = setValidatedElementText({
    projectRoot,
    document,
    documentKind: "page",
    targetId: "element:headline1",
    value: "Welcome back",
  });

  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.document.version, 2);
  assert.match(result.document.text, /the text says "Welcome back"/);
  assert.equal(result.document.dirty, true);
});

test("validated text edits reject compile failures and non-text targets", () => {
  const projectRoot = standardProject();
  const document = homeDocument(projectRoot);

  const invalid = setValidatedElementText({
    projectRoot,
    document,
    documentKind: "page",
    targetId: "element:headline1",
    value: "",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, null);
  assert.ok(invalid.diagnostics.length > 0);
  assert.equal(invalid.document, document);

  const page = setValidatedElementText({
    projectRoot,
    document,
    documentKind: "page",
    targetId: "page",
    value: "Not an element",
  });
  assert.equal(page.ok, false);
  assert.equal(page.error?.code, "target-not-element");

  const container = createSourceDocument(
    "pages/container.kdm",
    `page "Container" {
    box1 {
        a container
    }
}
`,
  );
  const noText = planElementTextEdit({
    document: container,
    documentKind: "page",
    targetId: "element:box1",
    value: "Renamed",
  });
  assert.equal(noText.ok, false);
  assert.equal(noText.error?.code, "text-not-found");
});
