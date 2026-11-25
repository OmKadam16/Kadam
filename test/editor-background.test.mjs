import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createSourceDocument,
  planElementBackgroundEdit,
  setValidatedElementBackground,
} from "../dist/editor/index.js";
import { createProject, manifestFor } from "./helpers/dev-project.mjs";

const HOME = `kadam 0.1

page "Home" {
    card1 {
        a card
        has a white background
    }
}
`;

function project() {
  return createProject(
    { "pages/home.kdm": HOME },
    manifestFor([{ title: "Home", source: "pages/home.kdm", route: "/" }]),
  );
}

function documentFor(projectRoot) {
  return createSourceDocument(
    "pages/home.kdm",
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
  );
}

test("background edits replace only the statement and canonicalize colors", () => {
  const projectRoot = project();
  const document = documentFor(projectRoot);

  const planned = planElementBackgroundEdit({
    document,
    documentKind: "page",
    targetId: "element:card1",
    background: { mode: "solid", color: "  #ABCDEF " },
  });

  assert.equal(planned.ok, true);
  assert.equal(planned.request.originalText, "has a white background");
  assert.equal(planned.request.replacementText, "has a #abcdef background");
});

test("validated background edits update the document when compilation succeeds", () => {
  const projectRoot = project();
  const document = documentFor(projectRoot);
  const diskBefore = readFileSync(join(projectRoot, "pages/home.kdm"), "utf8");

  const result = setValidatedElementBackground({
    projectRoot,
    document,
    documentKind: "page",
    targetId: "element:card1",
    background: { mode: "gradient", from: "red", to: "blue" },
  });

  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.match(result.document.text, /has a red and blue gradient/);
  assert.equal(result.document.dirty, true);
  assert.equal(
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
    diskBefore,
  );
});

test("background edits reject invalid values, missing statements, and dangling directions", () => {
  const projectRoot = project();
  const document = documentFor(projectRoot);

  const invalid = planElementBackgroundEdit({
    document,
    documentKind: "page",
    targetId: "element:card1",
    background: { mode: "solid", color: "not a color" },
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "invalid-value");

  const page = planElementBackgroundEdit({
    document,
    documentKind: "page",
    targetId: "page",
    background: { mode: "none" },
  });
  assert.equal(page.ok, false);
  assert.equal(page.error.code, "target-not-element");

  const withDirection = createSourceDocument(
    "pages/direction.kdm",
    `page "Direction" {
    card1 {
        a card
        has a red and blue gradient
        the gradient goes from left to right
    }
}
`,
  );
  const direction = planElementBackgroundEdit({
    document: withDirection,
    documentKind: "page",
    targetId: "element:card1",
    background: { mode: "none" },
  });
  assert.equal(direction.ok, false);
  assert.equal(direction.error.code, "gradient-direction-present");
});
