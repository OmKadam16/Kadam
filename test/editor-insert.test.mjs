import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildOutline,
  createSourceDocument,
  findOutlineNode,
  insertSourceStatement,
} from "../dist/editor/index.js";

test("insertion appends a child block with inferred indentation", () => {
  const document = createSourceDocument(
    "pages/home.kdm",
    `page "Home" {
    hero1 {
        a card
    }
}
`,
  );

  const result = insertSourceStatement({
    document,
    documentKind: "page",
    targetId: "element:hero1",
    statement: `headline1 {
    a main heading
    the text says "Welcome"
}`,
  });

  assert.equal(result.ok, true);
  assert.equal(result.targetId, "element:hero1");
  assert.equal(result.request.originalText, "");
  assert.equal(result.request.replacementText.includes("    headline1 {"), true);
  assert.equal(
    result.document.text,
    `page "Home" {
    hero1 {
        a card
        headline1 {
            a main heading
            the text says "Welcome"
        }
    }
}
`,
  );
});

test("insertion preserves a two-space body style", () => {
  const document = createSourceDocument(
    "pages/home.kdm",
    `page "Home" {
  hero1 {
    a card
  }
}
`,
  );

  const result = insertSourceStatement({
    document,
    documentKind: "page",
    targetId: "element:hero1",
    statement: "the text says \"Hello\"",
  });

  assert.equal(result.ok, true);
  assert.match(result.document.text, /\n    the text says "Hello"\n  \}/);
});

test("insertion rejects missing targets and empty statements", () => {
  const document = createSourceDocument(
    "pages/home.kdm",
    `page "Home" {
    hero1 {
        a card
    }
}
`,
  );

  const missing = insertSourceStatement({
    document,
    documentKind: "page",
    targetId: "element:missing",
    statement: "the text says \"Hi\"",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "target-not-found");

  const empty = insertSourceStatement({
    document,
    documentKind: "page",
    targetId: "page",
    statement: "  \n",
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "empty-statement");
});

test("before-children insertion places statements ahead of child elements", () => {
  const document = createSourceDocument(
    "pages/home.kdm",
    `page "Home" {
    hero1 {
        a card
        headline1 {
            a main heading
            the text says "Hello"
        }
    }
}
`,
  );

  const result = insertSourceStatement({
    document,
    documentKind: "page",
    targetId: "element:hero1",
    statement: "has a white border",
    placement: "before-children",
  });

  assert.equal(result.ok, true);
  assert.ok(
    result.document.text.includes(
      `        a card\n        has a white border\n        headline1 {`,
    ),
  );
});

test("findOutlineNode resolves nested stable IDs", () => {
  const document = createSourceDocument(
    "pages/home.kdm",
    `page "Home" {
    hero1 {
        a card
        headline1 {
            a main heading
        }
    }
}
`,
  );
  const outline = buildOutline(document.path, document.text, "page").outline;
  assert.ok(outline);
  assert.equal(
    findOutlineNode(outline, "element:hero1/headline1")?.name,
    "headline1",
  );
  assert.equal(findOutlineNode(outline, "element:missing"), null);
});
