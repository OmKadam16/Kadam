import { test } from "node:test";
import assert from "node:assert/strict";

import { parseText } from "../dist/core/parser/parser.js";
import { parseComponentText } from "../dist/core/parser/component.js";
import { buildComponentCatalog } from "../dist/core/components/catalog.js";
import {
  validateComponentCatalog,
  validatePageComponents,
} from "../dist/core/components/validate.js";
import { expandPage } from "../dist/core/components/expand.js";

const PAGES = [{ title: "Home", route: "/" }];

function component(text, path, namespace = undefined) {
  const parsed = parseComponentText(path, text);
  return {
    source: parsed.source,
    document: parsed.document,
    diagnostics: parsed.diagnostics,
    namespace,
  };
}

function page(text) {
  return parseText("pages/home.kdm", text, {
    validate: false,
    allowComponentKinds: true,
  });
}

function catalogOf(...files) {
  return buildComponentCatalog(files);
}

function codes(diagnostics) {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function textOf(element) {
  return element.statements.find((statement) => statement.type === "text")?.value;
}

const PROJECT_BUTTON = `component Button {
    button1 {
        a button
        the button text says "Project"
    }
}
`;

const LIBRARY_BUTTON = `component Button {
    button1 {
        a button
        the button text says "Library"
    }
}
`;

function projectButton() {
  return component(PROJECT_BUTTON, "components/Button.kdm");
}

function libraryButton() {
  return component(LIBRARY_BUTTON, "libs/ui/Button.kdm", "ui");
}

test("qualified component kinds parse with their namespace", () => {
  const result = page(`page "Home" {
    primary1 {
        a Button from ui in the outline variant
        with a label of "Save"
    }
}
`);
  const kind = result.document.page.elements[0].kind;
  assert.equal(kind.reference.type, "component-kind");
  assert.equal(kind.reference.name, "Button");
  assert.equal(kind.reference.namespace, "ui");
  assert.equal(kind.reference.namespaceSpan.file, "pages/home.kdm");
  assert.equal(kind.variant.name, "outline");
});

test("malformed component namespaces are KDM2002", () => {
  const result = page(`page "Home" {
    primary1 {
        a Button from UI
    }
}
`);
  assert.ok(codes(result.diagnostics).includes("KDM2002"));
});

test("the catalog keys components by namespace", () => {
  const built = catalogOf(projectButton(), libraryButton());
  assert.deepEqual(built.diagnostics, []);
  assert.deepEqual(built.catalog.names, ["Button", "ui/Button"]);
  assert.deepEqual([...built.catalog.namespaces], ["ui"]);
  assert.equal(built.catalog.records.get("ui/Button").namespace, "ui");
  assert.equal(built.catalog.records.get("Button").namespace, null);
});

test("duplicate components in one namespace are KDM3035", () => {
  const built = catalogOf(
    component(LIBRARY_BUTTON, "libs/ui/A.kdm", "ui"),
    component(LIBRARY_BUTTON, "libs/ui/B.kdm", "ui"),
  );
  assert.deepEqual(codes(built.diagnostics), ["KDM3035"]);
});

test("a namespaced tree is validated independently of the project namespace", () => {
  const built = catalogOf(projectButton(), libraryButton());
  assert.deepEqual(validateComponentCatalog(built.catalog, { pages: PAGES }), []);
});

test("qualified references resolve only inside their namespace", () => {
  const card = component(
    `component Card {
    card1 {
        a card
        title1 {
            a section heading
            the heading text says "Card"
        }
    }
}
`,
    "components/Card.kdm",
  );
  const built = catalogOf(projectButton(), libraryButton(), card);

  const qualified = page(`page "Home" {
    primary1 {
        a Button from ui
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(qualified.document.page, built.catalog, { pages: PAGES })),
    [],
  );

  const unqualifiedMiss = page(`page "Home" {
    primary1 {
        a Tag
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(unqualifiedMiss.document.page, built.catalog, { pages: PAGES })),
    ["KDM3022"],
  );

  const unknownNamespace = page(`page "Home" {
    primary1 {
        a Button from ui2
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(unknownNamespace.document.page, built.catalog, { pages: PAGES })),
    ["KDM3036"],
  );

  const unknownMember = page(`page "Home" {
    primary1 {
        a Tag from ui
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(unknownMember.document.page, built.catalog, { pages: PAGES })),
    ["KDM3036"],
  );

  const qualifierOnProject = page(`page "Home" {
    primary1 {
        a Card from ui
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(qualifierOnProject.document.page, built.catalog, { pages: PAGES })),
    ["KDM3037"],
  );
});

test("expansion resolves project and library components independently", () => {
  const built = catalogOf(projectButton(), libraryButton());
  const home = page(`page "Home" {
    first1 {
        a Button
    }
    second1 {
        a Button from ui
    }
}
`);

  assert.deepEqual(
    validatePageComponents(home.document.page, built.catalog, { pages: PAGES }),
    [],
  );

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);

  const project = result.page.elements[0];
  const library = result.page.elements[1];
  assert.equal(textOf(project), "Project");
  assert.equal(textOf(library), "Library");
  assert.equal(project.componentOrigin.namespace, undefined);
  assert.equal(library.componentOrigin.namespace, "ui");
  assert.equal(library.componentOrigin.component, "Button");
});

test("a library component may instantiate another library component", () => {
  const tag = component(
    `component Tag takes a label as text {
    tag1 {
        a paragraph
        the text says "{$label}"
    }
}
`,
    "libs/ui/Tag.kdm",
    "ui",
  );
  const panel = component(
    `component Panel {
    frame1 {
        a container
        tag1 {
            a Tag from ui
            with a label of "Nested"
        }
    }
}
`,
    "libs/ui/Panel.kdm",
    "ui",
  );
  const built = catalogOf(tag, panel);
  assert.deepEqual(validateComponentCatalog(built.catalog, { pages: PAGES }), []);

  const home = page(`page "Home" {
    panel1 {
        a Panel from ui
    }
}
`);
  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);
  const frame = result.page.elements[0];
  assert.equal(frame.componentOrigin.namespace, "ui");
  const tagRoot = frame.children[0];
  assert.equal(textOf(tagRoot), "Nested");
  assert.equal(tagRoot.componentOrigin.component, "Tag");
  assert.deepEqual(
    tagRoot.componentOrigin.instances.map((instance) => instance.namespace),
    ["ui", "ui"],
  );
});
