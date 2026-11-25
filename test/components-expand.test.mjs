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

const PAGES = [
  { title: "Home", route: "/" },
  { title: "About", route: "/about" },
];

function component(text, path) {
  return parseComponentText(path, text);
}

function page(text, options) {
  return parseText("pages/home.kdm", text, options);
}

// Project compilation parses pages before expansion, so component kinds and
// slot groups are validated by the component layer, not the parser.
function deferredPage(text) {
  return parseText("pages/home.kdm", text, {
    validate: false,
    allowComponentKinds: true,
  });
}

function catalogOf(...files) {
  return buildComponentCatalog(
    files.map((parsed) => ({
      source: parsed.source,
      document: parsed.document,
      diagnostics: parsed.diagnostics,
    })),
  );
}

function codes(diagnostics) {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function textOf(element) {
  return element.statements.find((statement) => statement.type === "text")?.value;
}

function hasComponentKind(element) {
  if (element.kind?.reference.type === "component-kind") return true;
  return element.children.some(hasComponentKind);
}

test("expansion replaces instances and substitutes text in source order", () => {
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
  assert.deepEqual(validateComponentCatalog(built.catalog, { pages: PAGES }), []);
  assert.deepEqual(
    validatePageComponents(home.document.page, built.catalog, { pages: PAGES }),
    [],
  );

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);
  const root = result.page.elements[0];
  assert.equal(root.name, "card1");
  assert.equal(root.kind.reference.type, "builtin-kind");
  assert.equal(root.kind.reference.name, "card");
  assert.deepEqual(root.properties, []);
  assert.equal(textOf(root.children[0]), "Starter");
  assert.equal(textOf(root.children[1]), "$9");
  assert.equal(hasComponentKind(root), false);

  // Expansion builds new nodes and leaves the page AST untouched.
  assert.equal(home.document.page.elements[0].kind.reference.type, "component-kind");
  assert.notEqual(result.page, home.document.page);
});

test("expansion fills omitted defaults and honors explicit values", () => {
  const badge = component(`component Badge takes a label as text defaulting to "New" {
    badge1 {
        a paragraph
        the paragraph text says "{$label}"
    }
}
`, "components/Badge.kdm");
  const home = page(`page "Home" {
    defaultBadge {
        a Badge
    }
    customBadge {
        a Badge
        with a label of "Updated"
    }
}
`);
  const built = catalogOf(badge);
  assert.deepEqual(validatePageComponents(home.document.page, built.catalog, { pages: PAGES }), []);

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);
  assert.equal(textOf(result.page.elements[0]), "New");
  assert.equal(textOf(result.page.elements[1]), "Updated");
});

test("expansion selects complete named variants", () => {
  const button = component(`component Button takes a label as text {
    button1 {
        a button
        the button text says "Default {$label}"
    }

    variant outline {
        button1 {
            a button
            the button text says "Outline {$label}"
        }
    }
}
`, "components/Button.kdm");
  const home = page(`page "Home" {
    action1 {
        a Button in the outline variant
        with a label of "Save"
    }
}
`);
  const built = catalogOf(button);
  assert.deepEqual(validatePageComponents(home.document.page, built.catalog, { pages: PAGES }), []);

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);
  assert.equal(textOf(result.page.elements[0]), "Outline Save");
});

test("nested components expand recursively and pass page bindings through", () => {
  const link = component(`component NavLink takes a label as text, a target as page {
    link1 {
        a link
        the link text says "{$label}"
        when clicked, go to page "{$target}"
    }
}
`, "components/NavLink.kdm");
  const navigation = component(`component Navigation takes a homeTarget as page, an aboutTarget as page {
    nav1 {
        a navigation bar
        homeLink1 {
            a NavLink
            with a label of "Home"
            with a target of "{$homeTarget}"
        }
        aboutLink1 {
            a NavLink
            with a label of "About"
            with a target of "{$aboutTarget}"
        }
    }
}
`, "components/Navigation.kdm");
  const home = page(`page "Home" {
    navigation1 {
        a Navigation
        with a homeTarget of "Home"
        with an aboutTarget of "About"
    }
}
`);
  const built = catalogOf(link, navigation);
  assert.deepEqual(validateComponentCatalog(built.catalog, { pages: PAGES }), []);
  assert.deepEqual(
    validatePageComponents(home.document.page, built.catalog, { pages: PAGES }),
    [],
  );

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);
  const nav = result.page.elements[0];
  assert.equal(nav.name, "nav1");
  assert.equal(nav.children.length, 2);
  assert.equal(textOf(nav.children[0]), "Home");
  assert.equal(textOf(nav.children[1]), "About");
  const firstTarget = nav.children[0].statements.find(
    (statement) => statement.type === "click",
  ).action.pageTitle;
  assert.equal(firstTarget, "Home");
  assert.equal(hasComponentKind(nav), false);
});

test("url parameters substitute into external link targets", () => {
  const link = component(`component ExternalLink takes a label as text, a url as url {
    link1 {
        a link
        the link text says "{$label}"
        when clicked, open "{$url}" in a new tab
    }
}
`, "components/ExternalLink.kdm");
  const card = component(`component DocsCard takes a target as url {
    card1 {
        a container
        link1 {
            a ExternalLink
            with a label of "Docs"
            with a url of "{$target}"
        }
    }
}
`, "components/DocsCard.kdm");
  const home = page(`page "Home" {
    docs1 {
        a DocsCard
        with a target of "https://example.com/docs"
    }
}
`);
  const built = catalogOf(link, card);
  assert.deepEqual(validateComponentCatalog(built.catalog, { pages: PAGES }), []);
  assert.deepEqual(
    validatePageComponents(home.document.page, built.catalog, { pages: PAGES }),
    [],
  );

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);
  const root = result.page.elements[0];
  const anchor = root.children[0];
  assert.equal(textOf(anchor), "Docs");
  const click = anchor.statements.find((statement) => statement.type === "click");
  assert.ok(click);
  assert.equal(click.action.type, "external");
  assert.equal(click.action.url, "https://example.com/docs");
  assert.equal(click.action.urlSpan.file, "pages/home.kdm");
});

test("image parameters substitute into image sources", () => {
  const photo = component(`component Photo takes a caption as text, a picture as image {
    photo1 {
        an image
        it shows "{$picture}"
        the description says "{$caption}"
    }
}
`, "components/Photo.kdm");
  const album = component(`component Album takes a cover as image {
    album1 {
        a container
        photo1 {
            a Photo
            with a caption of "Cover"
            with a picture of "{$cover}"
        }
    }
}
`, "components/Album.kdm");
  const home = page(`page "Home" {
    album1 {
        a Album
        with a cover of "assets/cover.svg"
    }
}
`);
  const built = catalogOf(photo, album);
  assert.deepEqual(validateComponentCatalog(built.catalog, { pages: PAGES }), []);
  assert.deepEqual(
    validatePageComponents(home.document.page, built.catalog, { pages: PAGES }),
    [],
  );

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);
  const image = result.page.elements[0].children[0];
  const source = image.statements.find((statement) => statement.type === "image-source");
  assert.ok(source);
  assert.equal(source.value, "assets/cover.svg");
  assert.equal(source.valueSpan.file, "pages/home.kdm");
});

test("length parameters substitute into spacing, size, and type", () => {
  const card = component(`component Card takes a gap as length, a width as length, a textSize as length {
    card1 {
        a card
        it has "{$gap}" gap between children
        title1 {
            a paragraph
            the text is "{$textSize}"
        }
        box1 {
            a container
            it is "{$width}" wide
        }
    }
}
`, "components/Card.kdm");
  const home = page(`page "Home" {
    card1 {
        a Card
        with a gap of "12px"
        with a width of "240px"
        with a textSize of "18px"
    }
}
`);
  const built = catalogOf(card);
  assert.deepEqual(validateComponentCatalog(built.catalog, { pages: PAGES }), []);
  assert.deepEqual(
    validatePageComponents(home.document.page, built.catalog, { pages: PAGES }),
    [],
  );

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);
  const root = result.page.elements[0];
  const gap = root.statements.find(
    (statement) => statement.type === "layout" && statement.property === "gap",
  );
  assert.ok(gap);
  assert.equal(gap.value.value, 12);
  assert.equal(gap.value.unit, "px");
  assert.equal(gap.value.reference, undefined);
  const title = root.children[0];
  const typography = title.statements.find(
    (statement) =>
      statement.type === "typography" && statement.property === "size",
  );
  assert.ok(typography);
  assert.equal(typography.value.value, 18);
  const box = root.children[1];
  const size = box.statements.find((statement) => statement.type === "size");
  assert.ok(size);
  assert.equal(size.width.value, 240);
});

test("color parameters substitute into background, border, and text", () => {
  const banner = component(`component Banner takes a fill as color, a line as color {
    banner1 {
        a card
        has a "{$fill}" background
        has a "{$line}" border
        title1 {
            a paragraph
            the text is "{$fill}"
        }
    }
}
`, "components/Banner.kdm");
  const home = page(`page "Home" {
    banner1 {
        a Banner
        with a fill of "#FF0000"
        with a line of "green"
    }
}
`);
  const built = catalogOf(banner);
  assert.deepEqual(validateComponentCatalog(built.catalog, { pages: PAGES }), []);
  assert.deepEqual(
    validatePageComponents(home.document.page, built.catalog, { pages: PAGES }),
    [],
  );

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);
  const root = result.page.elements[0];
  const background = root.statements.find((statement) => statement.type === "background");
  assert.ok(background);
  assert.equal(background.mode, "solid");
  assert.equal(background.color.kind, "hex");
  assert.equal(background.color.value, "#ff0000");
  const border = root.statements.find((statement) => statement.type === "border");
  assert.ok(border);
  assert.equal(border.mode, "solid");
  assert.equal(border.color.value, "green");
  const title = root.children[0];
  const typography = title.statements.find(
    (statement) => statement.type === "typography" && statement.property === "color",
  );
  assert.ok(typography);
  assert.equal(typography.value.value, "#ff0000");
});

test("page-owned braces are literal and substitution is one pass", () => {
  const echo = component(`component Echo takes a value as text {
    echo1 {
        a paragraph
        the paragraph text says "{$value}"
    }
}
`, "components/Echo.kdm");
  const wrapper = component(`component Wrapper takes a value as text {
    wrap1 {
        a container
        inner1 {
            a Echo
            with a value of "{$value}"
        }
    }
}
`, "components/Wrapper.kdm");
  const home = page(`page "Home" {
    wrapper1 {
        a Wrapper
        with a value of "{$literal}"
    }
}
`);
  const built = catalogOf(echo, wrapper);
  assert.deepEqual(validatePageComponents(home.document.page, built.catalog, { pages: PAGES }), []);

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);
  assert.equal(textOf(result.page.elements[0].children[0]), "{$literal}");
});

test("cycles are rejected before expansion and expansion is all-or-nothing", () => {
  const alpha = component(`component Alpha {
    alpha1 {
        a container
        beta1 {
            a Beta
        }
    }
}
`, "components/Alpha.kdm");
  const beta = component(`component Beta {
    beta1 {
        a container
        alpha1 {
            a Alpha
        }
    }
}
`, "components/Beta.kdm");
  const home = page(`page "Home" {
    alpha1 {
        a Alpha
    }
}
`);
  const built = catalogOf(alpha, beta);
  const result = expandPage(home.document.page, built.catalog);
  assert.equal(result.page, null);
  assert.deepEqual(codes(result.diagnostics), ["KDM3028"]);
});

test("expansion depth and element limits are deterministic", () => {
  const leaf = component(`component Leaf {
    leaf1 {
        a paragraph
        the text says "Leaf"
    }
}
`, "components/Leaf.kdm");
  const branch = component(`component Branch {
    branch1 {
        a container
        leaf1 {
            a Leaf
        }
    }
}
`, "components/Branch.kdm");
  const home = page(`page "Home" {
    branch1 {
        a Branch
    }
}
`);
  const built = catalogOf(leaf, branch);

  const depth = expandPage(home.document.page, built.catalog, { maxDepth: 1 });
  assert.equal(depth.page, null);
  assert.deepEqual(codes(depth.diagnostics), ["KDM3032"]);

  const elements = expandPage(home.document.page, built.catalog, { maxElements: 1 });
  assert.equal(elements.page, null);
  assert.deepEqual(codes(elements.diagnostics), ["KDM3032"]);
});

test("expansion reports unresolved instances instead of leaking component kinds", () => {
  const home = page(`page "Home" {
    missing1 {
        a Missing
    }
}
`);
  const built = catalogOf();
  const result = expandPage(home.document.page, built.catalog);
  assert.equal(result.page, null);
  assert.deepEqual(codes(result.diagnostics), ["KDM3022"]);
});

test("page-owned text containing braces stays literal", () => {
  const home = page(`page "Home" {
    copy1 {
        a paragraph
        the paragraph text says "{$literal}"
    }
}
`);
  const built = catalogOf();
  assert.deepEqual(validatePageComponents(home.document.page, built.catalog, { pages: PAGES }), []);

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);
  assert.equal(textOf(result.page.elements[0]), "{$literal}");
});

test("expansion annotates component origins and leaves page elements alone", () => {
  const link = component(`component NavLink takes a label as text {
    link1 {
        a link
        the link text says "{$label}"
        when clicked, go to page "Home"
    }
}
`, "components/NavLink.kdm");
  const navigation = component(`component Navigation {
    nav1 {
        a navigation bar
        homeLink1 {
            a NavLink
            with a label of "Home"
        }
    }
}
`, "components/Navigation.kdm");
  const home = page(`page "Home" {
    headline1 {
        a main heading
        the text says "Hello"
    }
    navigation1 {
        a Navigation
    }
}
`);
  const built = catalogOf(link, navigation);

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);

  const headline = result.page.elements[0];
  assert.equal(headline.componentOrigin, undefined);

  const nav = result.page.elements[1];
  assert.equal(nav.componentOrigin.component, "Navigation");
  assert.equal(nav.componentOrigin.variant, null);
  assert.deepEqual(nav.componentOrigin.instancePath, ["navigation1"]);
  assert.deepEqual(
    nav.componentOrigin.instances.map((instance) => instance.instanceName),
    ["navigation1"],
  );

  const linkRoot = nav.children[0];
  assert.deepEqual(linkRoot.componentOrigin.instancePath, [
    "navigation1",
    "homeLink1",
  ]);
  assert.equal(linkRoot.componentOrigin.component, "NavLink");
  assert.deepEqual(
    linkRoot.componentOrigin.instances.map((instance) => instance.component),
    ["Navigation", "NavLink"],
  );
  assert.deepEqual(
    linkRoot.componentOrigin.instances.map((instance) => instance.instanceName),
    ["navigation1", "homeLink1"],
  );
  assert.equal(linkRoot.componentOrigin.instances[0].componentSpan.file, "components/Navigation.kdm");
  assert.equal(linkRoot.componentOrigin.instances[1].componentSpan.file, "components/NavLink.kdm");

  // Page ASTs stay untouched by annotation.
  assert.equal(home.document.page.elements[0].componentOrigin, undefined);
  assert.equal(home.document.page.elements[1].componentOrigin, undefined);
  assert.equal(home.document.page.elements[1].kind.reference.type, "component-kind");
});

test("instance children fill a content slot in source order", () => {
  const panel = component(`component Panel takes a title as text {
    frame1 {
        a container
        heading1 {
            a minor heading
            the heading text says "{$title}"
        }
        content1 {
            a slot
        }
    }
}
`, "components/Panel.kdm");
  const home = page(`page "Home" {
    panel1 {
        a Panel
        with a title of "Notes"
        note1 {
            a paragraph
            the text says "First"
        }
        note2 {
            a paragraph
            the text says "Second"
        }
    }
}
`);
  const built = catalogOf(panel);
  assert.deepEqual(validateComponentCatalog(built.catalog, { pages: PAGES }), []);
  assert.deepEqual(
    validatePageComponents(home.document.page, built.catalog, { pages: PAGES }),
    [],
  );

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);

  const frame = result.page.elements[0];
  assert.equal(frame.name, "frame1");
  assert.equal(frame.componentOrigin.component, "Panel");
  assert.equal(frame.children.length, 3);
  assert.equal(textOf(frame.children[0]), "Notes");
  assert.equal(frame.children[1].name, "note1");
  assert.equal(textOf(frame.children[1]), "First");
  assert.equal(frame.children[2].name, "note2");
  assert.equal(textOf(frame.children[2]), "Second");

  // Supplied content is page-owned: no component origin, real built-in kinds.
  assert.equal(frame.children[1].componentOrigin, undefined);
  assert.equal(frame.children[1].kind.reference.type, "builtin-kind");
});

test("an empty content slot expands to nothing", () => {
  const panel = component(`component Panel {
    frame1 {
        a container
        heading1 {
            a minor heading
            the heading text says "Notes"
        }
        content1 {
            a slot
        }
    }
}
`, "components/Panel.kdm");
  const home = page(`page "Home" {
    panel1 {
        a Panel
    }
}
`);
  const built = catalogOf(panel);
  assert.deepEqual(
    validatePageComponents(home.document.page, built.catalog, { pages: PAGES }),
    [],
  );

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);
  const frame = result.page.elements[0];
  assert.equal(frame.children.length, 1);
  assert.equal(frame.children[0].name, "heading1");
});

test("slot fallback content is used only when the instance supplies none", () => {
  const panel = component(`component Panel {
    frame1 {
        a container
        content1 {
            a slot
            empty1 {
                a paragraph
                the text says "Nothing yet"
            }
        }
    }
}
`, "components/Panel.kdm");
  const home = page(`page "Home" {
    panel1 {
        a Panel
    }
    panel2 {
        a Panel
        note1 {
            a paragraph
            the text says "Supplied"
        }
    }
}
`);
  const built = catalogOf(panel);
  assert.deepEqual(validateComponentCatalog(built.catalog, { pages: PAGES }), []);

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);

  const fallbackHost = result.page.elements[0];
  assert.equal(fallbackHost.children.length, 1);
  const fallback = fallbackHost.children[0];
  assert.equal(fallback.name, "empty1");
  assert.equal(textOf(fallback), "Nothing yet");
  assert.equal(fallback.componentOrigin.component, "Panel");
  assert.deepEqual(fallback.componentOrigin.instancePath, ["panel1"]);

  const suppliedHost = result.page.elements[1];
  assert.equal(suppliedHost.children.length, 1);
  assert.equal(suppliedHost.children[0].name, "note1");
  assert.equal(textOf(suppliedHost.children[0]), "Supplied");
  assert.equal(suppliedHost.children[0].componentOrigin, undefined);
});

test("children are rejected when the component has no content slot", () => {
  const card = component(`component PriceCard takes a title as text {
    card1 {
        a card
        title1 {
            a section heading
            the heading text says "{$title}"
        }
    }
}
`, "components/PriceCard.kdm");
  const home = page(`page "Home" {
    pricing1 {
        a PriceCard
        with a title of "Starter"
        note1 {
            a paragraph
            the text says "Extra"
        }
    }
}
`);
  const built = catalogOf(card);
  assert.ok(
    codes(
      validatePageComponents(home.document.page, built.catalog, { pages: PAGES }),
    ).includes("KDM3030"),
  );

  const result = expandPage(home.document.page, built.catalog);
  assert.equal(result.page, null);
  assert.ok(codes(result.diagnostics).includes("KDM3030"));
});

test("nested callers keep their own scope for slot content", () => {
  const wrapper = component(`component Wrapper {
    frame1 {
        a container
        content1 {
            a slot
        }
    }
}
`, "components/Wrapper.kdm");
  const outer = component(`component Outer {
    outer1 {
        a container
        wrap1 {
            a Wrapper
            inner1 {
                a paragraph
                the text says "Inside"
            }
        }
    }
}
`, "components/Outer.kdm");
  const home = page(`page "Home" {
    outer1 {
        a Outer
    }
}
`);
  const built = catalogOf(wrapper, outer);
  assert.deepEqual(validateComponentCatalog(built.catalog, { pages: PAGES }), []);

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);

  const outerRoot = result.page.elements[0];
  assert.equal(outerRoot.name, "outer1");
  const frame = outerRoot.children[0];
  assert.equal(frame.name, "frame1");
  assert.equal(frame.componentOrigin.component, "Wrapper");

  // The paragraph was authored in Outer, not by the page.
  const inner = frame.children[0];
  assert.equal(inner.name, "inner1");
  assert.equal(inner.componentOrigin.component, "Outer");
  assert.deepEqual(inner.componentOrigin.instancePath, ["outer1"]);
  assert.deepEqual(
    inner.componentOrigin.instances.map((instance) => instance.component),
    ["Outer"],
  );
});

test("content slot misuse is diagnosed", () => {
  const pageSlot = page(`page "Home" {
    content1 {
        a slot
    }
}
`);
  assert.ok(codes(pageSlot.diagnostics).includes("KDM3033"));

  const duplicate = component(`component Panel {
    frame1 {
        a container
        content1 {
            a slot
        }
        content2 {
            a slot
        }
    }
}
`, "components/Panel.kdm");
  assert.deepEqual(
    codes(validateComponentCatalog(catalogOf(duplicate).catalog, { pages: PAGES })),
    ["KDM3033"],
  );

  const rootSlot = component(`component Panel {
    content1 {
        a slot
    }
}
`, "components/Panel.kdm");
  assert.deepEqual(
    codes(validateComponentCatalog(catalogOf(rootSlot).catalog, { pages: PAGES })),
    ["KDM3033"],
  );

  const styledSlot = component(`component Panel {
    frame1 {
        a container
        content1 {
            a slot
            it has 8px padding
        }
    }
}
`, "components/Panel.kdm");
  assert.deepEqual(
    codes(validateComponentCatalog(catalogOf(styledSlot).catalog, { pages: PAGES })),
    ["KDM3033"],
  );

  const nestedSlot = component(`component Panel {
    frame1 {
        a container
        content1 {
            a slot
            inner1 {
                a slot
            }
        }
    }
}
`, "components/Panel.kdm");
  assert.deepEqual(
    codes(validateComponentCatalog(catalogOf(nestedSlot).catalog, { pages: PAGES })),
    ["KDM3033"],
  );
});

test("named slot kinds parse with their name", () => {
  const panel = component(`component Panel {
    frame1 {
        a container
        head1 {
            a header slot
        }
    }
}
`, "components/Panel.kdm");
  const slot = panel.document.component.elements[0].children[0];
  assert.equal(slot.kind.reference.type, "slot-kind");
  assert.equal(slot.kind.reference.name, "header");
  assert.equal(slot.kind.reference.nameSpan.file, "components/Panel.kdm");
});

test("named slots receive their own child groups in source order", () => {
  const panel = component(`component Panel {
    frame1 {
        a container
        head1 {
            a header slot
            fallback1 {
                a minor heading
                the heading text says "Default header"
            }
        }
        body1 {
            a content slot
        }
    }
}
`, "components/Panel.kdm");
  const home = deferredPage(`page "Home" {
    panel1 {
        a Panel
        head1 {
            a header slot
            title1 {
                a minor heading
                the heading text says "Custom header"
            }
        }
        body1 {
            a content slot
            note1 {
                a paragraph
                the text says "Body"
            }
        }
    }
}
`);
  const built = catalogOf(panel);
  assert.deepEqual(validateComponentCatalog(built.catalog, { pages: PAGES }), []);
  assert.deepEqual(
    validatePageComponents(home.document.page, built.catalog, { pages: PAGES }),
    [],
  );

  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);

  const frame = result.page.elements[0];
  assert.equal(frame.name, "frame1");
  // Both slot placeholders are replaced in place; only their content remains.
  assert.equal(frame.children.length, 2);
  assert.equal(frame.children[0].name, "title1");
  assert.equal(textOf(frame.children[0]), "Custom header");
  assert.equal(frame.children[0].componentOrigin, undefined);
  assert.equal(frame.children[1].name, "note1");
  assert.equal(textOf(frame.children[1]), "Body");
});

test("a named slot without supplied content uses its fallback", () => {
  const panel = component(`component Panel {
    frame1 {
        a container
        head1 {
            a header slot
            fallback1 {
                a minor heading
                the heading text says "Default header"
            }
        }
        body1 {
            a content slot
        }
    }
}
`, "components/Panel.kdm");
  const home = deferredPage(`page "Home" {
    panel1 {
        a Panel
    }
}
`);
  const built = catalogOf(panel);
  const result = expandPage(home.document.page, built.catalog);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.page);

  const frame = result.page.elements[0];
  assert.equal(frame.children.length, 1);
  const fallback = frame.children[0];
  assert.equal(fallback.name, "fallback1");
  assert.equal(fallback.componentOrigin.component, "Panel");
  assert.deepEqual(fallback.componentOrigin.instancePath, ["panel1"]);
});

test("named slot declarations and fill groups are validated", () => {
  const duplicateNames = component(`component Panel {
    frame1 {
        a container
        head1 {
            a header slot
        }
        head2 {
            a header slot
        }
    }
}
`, "components/Panel.kdm");
  assert.deepEqual(
    codes(validateComponentCatalog(catalogOf(duplicateNames).catalog, { pages: PAGES })),
    ["KDM3033"],
  );

  const panel = component(`component Panel {
    frame1 {
        a container
        head1 {
            a header slot
        }
    }
}
`, "components/Panel.kdm");
  const built = catalogOf(panel);

  const unknown = deferredPage(`page "Home" {
    panel1 {
        a Panel
        body1 {
            a body slot
            note1 {
                a paragraph
                the text says "x"
            }
        }
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(unknown.document.page, built.catalog, { pages: PAGES })),
    ["KDM3034"],
  );
  assert.equal(expandPage(unknown.document.page, built.catalog).page, null);

  const duplicateFill = deferredPage(`page "Home" {
    panel1 {
        a Panel
        head1 {
            a header slot
            note1 {
                a paragraph
                the text says "One"
            }
        }
        head2 {
            a header slot
            note2 {
                a paragraph
                the text says "Two"
            }
        }
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(duplicateFill.document.page, built.catalog, { pages: PAGES })),
    ["KDM3034"],
  );

  const plain = deferredPage(`page "Home" {
    panel1 {
        a Panel
        note1 {
            a paragraph
            the text says "x"
        }
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(plain.document.page, built.catalog, { pages: PAGES })),
    ["KDM3030"],
  );

  const styledFill = deferredPage(`page "Home" {
    panel1 {
        a Panel
        head1 {
            a header slot
            it has 8px padding
        }
    }
}
`);
  assert.deepEqual(
    codes(validatePageComponents(styledFill.document.page, built.catalog, { pages: PAGES })),
    ["KDM3034"],
  );
});