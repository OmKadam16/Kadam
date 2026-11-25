import { test } from "node:test";
import assert from "node:assert/strict";

import { parseText } from "../dist/core/parser/parser.js";
import { parseComponentText } from "../dist/core/parser/component.js";
import { buildComponentCatalog } from "../dist/core/components/catalog.js";
import {
  validateComponentCatalog,
  validatePageComponents,
} from "../dist/core/components/validate.js";

const PAGES = [{ title: "Home", route: "/" }];

function codes(diagnostics) {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function component(text, path = "components/Test.kdm") {
  return parseComponentText(path, text);
}

function catalogOf(...parsedFiles) {
  return buildComponentCatalog(
    parsedFiles.map((parsed) => ({
      source: parsed.source,
      document: parsed.document,
      diagnostics: parsed.diagnostics,
    })),
  );
}

function page(text, path = "pages/home.kdm") {
  return parseText(path, text);
}

test("component declarations parse parameters, defaults, and one root", () => {
  const parsed = component(`kadam 0.1

component PriceCard takes a title as text, a price as text, a badge as text defaulting to "New" {
    card1 {
        a card
        title1 {
            a section heading
            the heading text says "{$title}"
        }
        price1 {
            a paragraph
            the paragraph text says "{$price}"
        }
        badge1 {
            a paragraph
            the paragraph text says "{$badge}"
        }
    }
}
`);

  assert.deepEqual(parsed.diagnostics, []);
  const declaration = parsed.document.component;
  assert.ok(declaration);
  assert.equal(declaration.name, "PriceCard");
  assert.deepEqual(
    declaration.parameters.map((parameter) => [
      parameter.name,
      parameter.valueType,
      parameter.defaultValue,
    ]),
    [
      ["title", "text", null],
      ["price", "text", null],
      ["badge", "text", "New"],
    ],
  );
  assert.equal(declaration.elements.length, 1);
  assert.equal(declaration.elements[0].name, "card1");
});

test("url parameters parse, default, and validate absolute targets", () => {
  const parsed = component(`component ExternalLink takes a label as text, a url as url defaulting to "https://example.com" {
    link1 {
        a link
        the link text says "{$label}"
        when clicked, open "{$url}" in a new tab
    }
}
`);

  assert.deepEqual(parsed.diagnostics, []);
  const declaration = parsed.document.component;
  assert.ok(declaration);
  assert.deepEqual(
    declaration.parameters.map((parameter) => [
      parameter.name,
      parameter.valueType,
      parameter.defaultValue,
    ]),
    [
      ["label", "text", null],
      ["url", "url", "https://example.com"],
    ],
  );

  const built = catalogOf(parsed);
  assert.deepEqual(validateComponentCatalog(built.catalog), []);

  const home = page(`page "Home" {
    link1 {
        a ExternalLink
        with a label of "Docs"
        with a url of "ftp://example.com"
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(home.document.page, built.catalog)),
    ["KDM3026"],
  );
});

test("url properties accept only url parameters, not text", () => {
  const link = component(`component ExternalLink takes a label as text, a url as url {
    link1 {
        a link
        the link text says "{$label}"
        when clicked, open "{$url}" in a new tab
    }
}
`, "components/ExternalLink.kdm");
  const wrapper = component(`component Wrapper takes a caption as text {
    wrap1 {
        a container
        link1 {
            a ExternalLink
            with a label of "{$caption}"
            with a url of "{$caption}"
        }
    }
}
`, "components/Wrapper.kdm");
  const built = catalogOf(link, wrapper);
  assert.deepEqual(codes(validateComponentCatalog(built.catalog)), ["KDM3026"]);
});

test("image parameters parse and require project-relative image paths", () => {
  const parsed = component(`component Photo takes a caption as text, a picture as image defaulting to "assets/photo.png" {
    photo1 {
        an image
        it shows "{$picture}"
        the description says "{$caption}"
    }
}
`);

  assert.deepEqual(parsed.diagnostics, []);
  const declaration = parsed.document.component;
  assert.ok(declaration);
  assert.deepEqual(
    declaration.parameters.map((parameter) => [
      parameter.name,
      parameter.valueType,
      parameter.defaultValue,
    ]),
    [
      ["caption", "text", null],
      ["picture", "image", "assets/photo.png"],
    ],
  );

  const built = catalogOf(parsed);
  assert.deepEqual(validateComponentCatalog(built.catalog), []);

  const home = page(`page "Home" {
    bad1 {
        a Photo
        with a caption of "Bad"
        with a picture of "https://example.com/photo.png"
    }
    good1 {
        a Photo
        with a caption of "Good"
        with a picture of "assets/good.png"
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(home.document.page, built.catalog)),
    ["KDM3026"],
  );
});

test("image properties accept only image parameters, not text", () => {
  const photo = component(`component Photo takes a caption as text, a picture as image {
    photo1 {
        an image
        it shows "{$picture}"
        the description says "{$caption}"
    }
}
`, "components/Photo.kdm");
  const wrapper = component(`component Wrapper takes a caption as text {
    wrap1 {
        a container
        photo1 {
            a Photo
            with a caption of "{$caption}"
            with a picture of "{$caption}"
        }
    }
}
`, "components/Wrapper.kdm");
  const built = catalogOf(photo, wrapper);
  assert.deepEqual(codes(validateComponentCatalog(built.catalog)), ["KDM3026"]);
});

test("length parameters parse quoted placeholders and reject invalid values", () => {
  const parsed = component(`component Card takes a gap as length, a textSize as length defaulting to "16px" {
    card1 {
        a card
        it has "{$gap}" gap between children
        title1 {
            a paragraph
            the text is "{$textSize}"
        }
    }
}
`);

  assert.deepEqual(parsed.diagnostics, []);
  const declaration = parsed.document.component;
  assert.ok(declaration);
  assert.deepEqual(
    declaration.parameters.map((parameter) => [
      parameter.name,
      parameter.valueType,
      parameter.defaultValue,
    ]),
    [
      ["gap", "length", null],
      ["textSize", "length", "16px"],
    ],
  );

  const built = catalogOf(parsed);
  assert.deepEqual(validateComponentCatalog(built.catalog), []);

  const home = page(`page "Home" {
    card1 {
        a Card
        with a gap of "8"
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(home.document.page, built.catalog)),
    ["KDM3026"],
  );
});

test("length properties accept only length parameters, not text", () => {
  const card = component(`component Card takes a gap as length {
    card1 {
        a card
        it has "{$gap}" gap between children
    }
}
`, "components/Card.kdm");
  const wrapper = component(`component Wrapper takes a caption as text {
    wrap1 {
        a container
        card1 {
            a Card
            with a gap of "{$caption}"
        }
    }
}
`, "components/Wrapper.kdm");
  const built = catalogOf(card, wrapper);
  assert.deepEqual(codes(validateComponentCatalog(built.catalog)), ["KDM3026"]);
});

test("color parameters parse and reject non-colors", () => {
  const parsed = component(`component Badge takes a label as text, an accent as color defaulting to "blue" {
    badge1 {
        a paragraph
        the text says "{$label}"
        the text is "{$accent}"
    }
}
`);

  assert.deepEqual(parsed.diagnostics, []);
  const declaration = parsed.document.component;
  assert.ok(declaration);
  assert.deepEqual(
    declaration.parameters.map((parameter) => [
      parameter.name,
      parameter.valueType,
      parameter.defaultValue,
    ]),
    [
      ["label", "text", null],
      ["accent", "color", "blue"],
    ],
  );

  const built = catalogOf(parsed);
  assert.deepEqual(validateComponentCatalog(built.catalog), []);

  const home = page(`page "Home" {
    badge1 {
        a Badge
        with a label of "New"
        with an accent of "not-a-color"
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(home.document.page, built.catalog)),
    ["KDM3026"],
  );
});

test("color properties accept only color parameters, not text", () => {
  const badge = component(`component Badge takes an accent as color {
    badge1 {
        a paragraph
        the text is "{$accent}"
    }
}
`, "components/Badge.kdm");
  const wrapper = component(`component Wrapper takes a caption as text {
    wrap1 {
        a container
        badge1 {
            a Badge
            with an accent of "{$caption}"
        }
    }
}
`, "components/Wrapper.kdm");
  const built = catalogOf(badge, wrapper);
  assert.deepEqual(codes(validateComponentCatalog(built.catalog)), ["KDM3026"]);
});

test("components parse default bodies and named variants with local name scopes", () => {
  const parsed = component(`component Button takes a label as text {
    button1 {
        a button
        the button text says "{$label}"
    }

    variant outline {
        button1 {
            a button
            the button text says "{$label}"
            has no background
            the text is blue
        }
    }
}
`);

  assert.deepEqual(parsed.diagnostics, []);
  const declaration = parsed.document.component;
  assert.ok(declaration);
  assert.equal(declaration.variants.length, 1);
  assert.equal(declaration.variants[0].name, "outline");
  assert.equal(declaration.variants[0].elements[0].name, "button1");
});

test("page instances parse component kind, static variant, and named properties", () => {
  const parsed = page(`page "Home" {
    pricing1 {
        a PriceCard in the featured variant
        with a title of "Starter"
        with a price of "$9"
    }
}
`);

  assert.deepEqual(codes(parsed.diagnostics), ["KDM3001"]);
  const element = parsed.document.page.elements[0];
  assert.equal(element.kind.reference.type, "component-kind");
  assert.equal(element.kind.reference.name, "PriceCard");
  assert.equal(element.kind.variant.name, "featured");
  assert.deepEqual(
    element.properties.map((property) => [property.name, property.value]),
    [
      ["title", "Starter"],
      ["price", "$9"],
    ],
  );
});

test("PascalCase components remain distinct from lowercase built-in kinds", () => {
  const parsed = page(`page "Home" {
    primaryAction {
        a Button in the outline variant
        with a label of "Save"
    }
}
`);
  assert.deepEqual(codes(parsed.diagnostics), ["KDM3001"]);
  const element = parsed.document.page.elements[0];
  assert.equal(element.kind.reference.type, "component-kind");
  assert.equal(element.kind.reference.name, "Button");
  assert.equal(element.kind.variant.name, "outline");

  const builtin = page(`page "Home" {
    secondaryAction {
        a button
        the button text says "Save"
    }
}
`);
  assert.deepEqual(builtin.diagnostics, []);
  assert.equal(builtin.document.page.elements[0].kind.reference.type, "builtin-kind");
});

test("component catalog resolves project-global names and validates a page instance", () => {
  const card = component(`component PriceCard takes a title as text, a price as text {
    card1 {
        a card
        title1 {
            a section heading
            the heading text says "{$title}"
        }
        price1 {
            a paragraph
            the paragraph text says "{$price}"
        }
    }
}
`, "components/PriceCard.kdm");
  const home = page(`page "Home" {
    pricing1 {
        a PriceCard
        with a title of "Starter"
        with a price of "$9"
    }
}
`);

  const built = catalogOf(card);
  assert.deepEqual(built.diagnostics, []);
  assert.deepEqual(built.catalog.names, ["PriceCard"]);
  assert.deepEqual(
    validateComponentCatalog(built.catalog, { pages: PAGES }),
    [],
  );
  assert.deepEqual(
    validatePageComponents(home.document.page, built.catalog, { pages: PAGES }),
    [],
  );
});

test("missing, unknown, duplicate, and mistyped properties are diagnosed", () => {
  const card = component(`component PriceCard takes a title as text, a target as page {
    card1 {
        a card
        title1 {
            a section heading
            the heading text says "{$title}"
        }
    }
}
`);
  const built = catalogOf(card);
  const home = page(`page "Home" {
    one {
        a PriceCard
        with a title of "One"
        with a title of "Two"
        with a nope of "x"
    }
}
`);

  const diagnostics = validatePageComponents(
    home.document.page,
    built.catalog,
    { pages: PAGES },
  );
  assert.deepEqual(codes(diagnostics).sort(), ["KDM3023", "KDM3024", "KDM3025"]);
});

test("page properties require a known page and reject text interpolation", () => {
  const link = component(`component LinkCard takes a target as page {
    link1 {
        a link
        the link text says "Go"
        when clicked, go to page "{$target}"
    }
}
`, "components/LinkCard.kdm");
  const wrapper = component(`component Wrapper takes a caption as text {
    wrap1 {
        a container
        link1 {
            a LinkCard
            with a target of "{$caption}"
        }
    }
}
`, "components/Wrapper.kdm");
  const built = catalogOf(link, wrapper);
  assert.deepEqual(codes(validateComponentCatalog(built.catalog, { pages: PAGES })), [
    "KDM3026",
  ]);

  const home = page(`page "Home" {
    link1 {
        a LinkCard
        with a target of "Missing"
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(home.document.page, built.catalog, { pages: PAGES })),
    ["KDM3026"],
  );
});

test("invalid interpolation and unknown components are diagnosed", () => {
  const card = component(`component PriceCard takes a title as text {
    card1 {
        a card
        title1 {
            a section heading
            the heading text says "{$missing}"
        }
    }
}
`);
  const built = catalogOf(card);
  assert.deepEqual(codes(validateComponentCatalog(built.catalog, { pages: PAGES })), [
    "KDM3027",
  ]);

  const home = page(`page "Home" {
    one {
        a Missing
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(home.document.page, built.catalog, { pages: PAGES })),
    ["KDM3022"],
  );
});

test("component cycles and root cardinality fail statically", () => {
  const cycle = component(`component Alpha {
    a1 {
        a container
        b1 {
            a Beta
        }
    }
}
`, "components/Alpha.kdm");
  const b = component(`component Beta {
    b1 {
        a container
        a1 {
            a Alpha
        }
    }
}
`, "components/Beta.kdm");
  const built = catalogOf(cycle, b);
  assert.deepEqual(codes(validateComponentCatalog(built.catalog, { pages: PAGES })), [
    "KDM3028",
  ]);

  const roots = component(`component TwoRoots {
    one {
        a paragraph
        the text says "One"
    }
    two {
        a paragraph
        the text says "Two"
    }
}
`);
  const rootCatalog = catalogOf(roots);
  assert.deepEqual(codes(validateComponentCatalog(rootCatalog.catalog, { pages: PAGES })), [
    "KDM3021",
  ]);
});

test("page settings, child slots, and instance styling are rejected", () => {
  const settings = component(`component Bad {
    the page background is #FFFFFF
    one {
        a paragraph
        the text says "One"
    }
}
`);
  assert.deepEqual(codes(settings.diagnostics), ["KDM3021"]);

  const card = component(`component PriceCard takes a title as text {
    card1 {
        a card
        title1 {
            a section heading
            the heading text says "{$title}"
        }
    }
}
`);
  const built = catalogOf(card);
  const home = page(`page "Home" {
    one {
        a PriceCard
        with a title of "One"
        has a soft shadow
        child1 {
            a paragraph
            the text says "Child"
        }
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(home.document.page, built.catalog, { pages: PAGES })),
    ["KDM3030", "KDM3030"],
  );
});

test("page files reject component declarations with KDM2012", () => {
  const parsed = page(`page "Home" {
}

component PriceCard {
    card1 {
        a card
    }
}
`);
  assert.deepEqual(codes(parsed.diagnostics), ["KDM2012"]);
});

test("variant selection is component-only", () => {
  const parsed = page(`page "Home" {
    one {
        a card in the outline variant
    }
}
`);
  assert.deepEqual(codes(parsed.diagnostics), ["KDM2002"]);
});

test("duplicate component names are reported by the catalog", () => {
  const one = component(`component Same {
    one {
        a paragraph
        the text says "One"
    }
}
`, "components/One.kdm");
  const two = component(`component Same {
    two {
        a paragraph
        the text says "Two"
    }
}
`, "components/Two.kdm");
  const built = catalogOf(one, two);
  assert.deepEqual(codes(built.diagnostics), ["KDM3020"]);
});

test("parse options allow component kinds only when explicitly requested", () => {
  const source = `page "Home" {
    action1 {
        a Button
    }
}
`;

  assert.deepEqual(codes(parseText("pages/home.kdm", source).diagnostics), [
    "KDM3001",
  ]);

  const allowed = parseText("pages/home.kdm", source, {
    allowComponentKinds: true,
  });
  assert.deepEqual(allowed.diagnostics, []);
  assert.equal(
    allowed.document.page.elements[0].kind.reference.type,
    "component-kind",
  );
});

test("parse options can defer structural validation for project expansion", () => {
  const source = `page "Home" {
    button1 {
        a button
        child1 {
            a card
        }
    }
}
`;

  assert.deepEqual(codes(parseText("pages/home.kdm", source).diagnostics), [
    "KDM3010",
  ]);

  const deferred = parseText("pages/home.kdm", source, {
    validate: false,
    allowComponentKinds: true,
  });
  assert.deepEqual(deferred.diagnostics, []);
});