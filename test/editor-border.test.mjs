import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createSourceDocument,
  planElementBorderEdit,
  planElementCornersEdit,
  setValidatedElementBorder,
  setValidatedElementCorners,
} from "../dist/editor/index.js";
import { createProject, manifestFor } from "./helpers/dev-project.mjs";

const HOME = `kadam 0.1

page "Home" {
    card1 {
        a card
        has a white border
        has rounded corners
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

test("border and corner edits replace only their statement spans", () => {
  const projectRoot = project();
  const document = documentFor(projectRoot);

  const border = planElementBorderEdit({
    document,
    documentKind: "page",
    targetId: "element:card1",
    border: { mode: "solid", color: "  #ABCDEF ", width: "2PX" },
  });
  assert.equal(border.ok, true);
  assert.equal(border.request.originalText, "has a white border");
  assert.equal(border.request.replacementText, "has a 2px #abcdef border");

  const corners = planElementCornersEdit({
    document,
    documentKind: "page",
    targetId: "element:card1",
    corners: { mode: "custom", radius: "12px" },
  });
  assert.equal(corners.ok, true);
  assert.equal(corners.request.originalText, "has rounded corners");
  assert.equal(corners.request.replacementText, "has 12px rounded corners");
});

test("validated border and corner edits update the document without writing", () => {
  const projectRoot = project();
  const document = documentFor(projectRoot);
  const diskBefore = readFileSync(join(projectRoot, "pages/home.kdm"), "utf8");

  const border = setValidatedElementBorder({
    projectRoot,
    document,
    documentKind: "page",
    targetId: "element:card1",
    border: { mode: "solid", color: "blue" },
  });
  assert.equal(border.ok, true, JSON.stringify(border.diagnostics));

  const corners = setValidatedElementCorners({
    projectRoot,
    document: border.document,
    documentKind: "page",
    targetId: "element:card1",
    corners: { mode: "full" },
  });
  assert.equal(corners.ok, true, JSON.stringify(corners.diagnostics));
  assert.match(corners.document.text, /has a blue border/);
  assert.match(corners.document.text, /has fully rounded corners/);
  assert.equal(
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
    diskBefore,
  );
});

test("border and corner edits reject invalid values, targets, and missing statements", () => {
  const projectRoot = project();
  const document = documentFor(projectRoot);

  const badBorder = planElementBorderEdit({
    document,
    documentKind: "page",
    targetId: "element:card1",
    border: { mode: "solid", color: "not a color" },
  });
  assert.equal(badBorder.ok, false);
  assert.equal(badBorder.error.code, "invalid-value");

  const badCorners = planElementCornersEdit({
    document,
    documentKind: "page",
    targetId: "element:card1",
    corners: { mode: "custom", radius: "wide" },
  });
  assert.equal(badCorners.ok, false);
  assert.equal(badCorners.error.code, "invalid-value");

  const page = planElementBorderEdit({
    document,
    documentKind: "page",
    targetId: "page",
    border: { mode: "none" },
  });
  assert.equal(page.ok, false);
  assert.equal(page.error.code, "target-not-element");

});

test("missing border and corners are inserted before the first child", () => {
  const source = `page "Home" {
    card1 {
        a card
        title1 {
            a paragraph
            the text says "Title"
        }
    }
}
`;
  const projectRoot = createProject(
    { "pages/home.kdm": source },
    manifestFor([{ title: "Home", source: "pages/home.kdm", route: "/" }]),
  );
  const document = createSourceDocument("pages/home.kdm", source);

  const border = setValidatedElementBorder({
    projectRoot,
    document,
    documentKind: "page",
    targetId: "element:card1",
    border: { mode: "solid", color: "blue" },
  });
  assert.equal(border.ok, true, JSON.stringify(border.diagnostics));

  const corners = setValidatedElementCorners({
    projectRoot,
    document: border.document,
    documentKind: "page",
    targetId: "element:card1",
    corners: { mode: "full" },
  });
  assert.equal(corners.ok, true, JSON.stringify(corners.diagnostics));
  assert.ok(
    corners.document.text.includes(
      `        a card\n        has a blue border\n        has fully rounded corners\n        title1 {`,
    ),
  );
});
