import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileProject } from "../dist/compiler/project.js";

// F5 step 6 (D-41): runtime data.

const CARD = [
  "kadam 0.3", "",
  "component ProductCard takes a name as text, a price as text, a link as url {",
  "    card1 {", "        a card",
  "        name1 {", "            a minor heading", '            the text says "{$name}"', "        }",
  "        price1 {", "            a paragraph", '            the text says "{$price} USD"', "        }",
  "        link1 {", "            a link", '            the text says "View {$name}"', '            when clicked, open "{$link}" in a new tab', "        }",
  "    }", "}", "",
].join("\n");

export const CATALOG = [
  "catalog {",
  "    a container",
  '    it loads products from "/api/products.json"',
  "    each product has a name as text, a price as a number, a link as a url, and an inStock as true or false",
  "    while loading, it shows loadingNote",
  "    when there are none, it shows emptyNote",
  "    when loading fails, it shows errorNote",
  "    loadingNote {", "        a paragraph", '        the text says "Loading products"', "    }",
  "    emptyNote {", "        a paragraph", '        the text says "No products yet"', "    }",
  "    errorNote {", "        a paragraph", '        the text says "Products could not load"', "    }",
  "    tile {",
  "        a ProductCard for each product in products",
  "        only where the inStock of product is true",
  "        sorted by the price of product from highest to lowest",
  "        with a name of the name of product",
  "        with a price of the price of product",
  "        with a link of the link of product",
  "    }",
  "    again {", "        a button", '        the text says "Reload"', "        when clicked, reload products", "    }",
  "}",
];

export function project(body = CATALOG, manifest = {}) {
  const root = mkdtempSync(join(tmpdir(), "kadam-load-"));
  mkdirSync(join(root, "pages"));
  mkdirSync(join(root, "components"));
  writeFileSync(join(root, "components", "ProductCard.kdm"), CARD);
  writeFileSync(join(root, "pages", "home.kdm"), ["kadam 0.3", "", 'page "Shop" {', ...body.map((l) => `    ${l}`), "}", ""].join("\n"));
  writeFileSync(join(root, "kadam.json"), JSON.stringify({ kadam: "0.3", name: "shop", components: ["components/ProductCard.kdm"], pages: [{ source: "pages/home.kdm", route: "/" }], ...manifest }));
  const result = compileProject({ projectRoot: root, write: false });
  result.root = root;
  return result;
}
const codes = (result) => result.diagnostics.map((d) => d.code);
const file = (result, path) => String(result.files.find((f) => f.path === path)?.contents ?? "");

test("a loaded list compiles to a template, states, and a loader table", () => {
  const result = project();
  assert.deepEqual(result.diagnostics.map((d) => d.message), []);
  const html = file(result, "index.html");
  assert.match(html, /<template data-kdm-template="home-tile-card1">/);
  assert.match(html, /data-kdm-id="home-loadingNote" role="status"/);
  assert.match(html, /data-kdm-id="home-emptyNote" data-kdm-hidden/);
  assert.match(html, /data-kdm-id="home-errorNote" data-kdm-hidden/);
  // The placeholders live only inside the inert template.
  const outside = html.replace(/<template[\s\S]*?<\/template>/g, "");
  assert.doesNotMatch(outside, /kadam\.invalid/);
  const js = file(result, "assets/kadam.home.js");
  assert.match(js, /const loaders = \[\["products","\/api\/products.json","home-catalog",\[\["name","text"\],\["price","number"\],\["link","url"\],\["inStock","yes\/no"\]\],"home-loadingNote","home-emptyNote","home-errorNote",\[\["home-tile-card1",\[\["inStock",false,true,null,null\]\],\["price",true\],null,null\]\]\]\];/);
  assert.match(js, /credentials: "omit"/);
  assert.match(js, /case "reload"/);
  assert.doesNotMatch(js, /innerHTML|eval\(|new Function/);
  const noscript = file(result, "assets/kadam.home.noscript.css");
  assert.match(noscript, /\[data-kdm-id="home-loadingNote"\] \{\n  display: none !important;/);
  assert.match(noscript, /\[data-kdm-id="home-errorNote"\]/);
  assert.doesNotMatch(noscript, /home-emptyNote/);
});

test("all three states and a shape are required", () => {
  for (const line of ["    while loading, it shows loadingNote", "    when there are none, it shows emptyNote", "    when loading fails, it shows errorNote"]) {
    const result = project(CATALOG.filter((l) => l !== line));
    assert.deepEqual(codes(result), ["KDM3045"], line);
  }
  const noShape = project(CATALOG.filter((l) => !l.includes("each product has")));
  assert.ok(codes(noShape).includes("KDM3045"));
  const outside = project(CATALOG.map((l) => l.replace("it shows errorNote", "it shows nowhere")));
  assert.deepEqual(codes(outside), ["KDM3012"]);
});

test("fields are checked against the shape and the component's parameter types", () => {
  const typo = project(CATALOG.map((l) => l.replace("with a price of the price of product", "with a price of the prise of product")));
  assert.deepEqual(codes(typo), ["KDM3043"]);
  assert.match(typo.diagnostics[0].hint, /did you mean: price/);
  // price is a number; the link parameter needs a url field.
  const wrong = project(CATALOG.map((l) => l.replace("with a link of the link of product", "with a link of the price of product")));
  assert.deepEqual(codes(wrong), ["KDM3026"]);
  assert.match(wrong.diagnostics[0].message, /price is a number, but link needs a url field/);
  const filter = project(CATALOG.map((l) => l.replace("the inStock of product is true", 'the inStock of product is "yes"')));
  assert.deepEqual(codes(filter), ["KDM3043"]);
});

test("origins must be same-site or declared, and https", () => {
  const remote = (url) => CATALOG.map((l) => l.replace('"/api/products.json"', `"${url}"`));
  assert.deepEqual(codes(project(remote("https://api.example.com/products"))), ["KDM3046"]);
  assert.deepEqual(codes(project(remote("https://api.example.com/products"), { connect: ["https://api.example.com"] })), []);
  assert.deepEqual(codes(project(remote("http://api.example.com/products"), { connect: ["https://api.example.com"] })), ["KDM3046"]);
  assert.deepEqual(codes(project(remote("http://localhost:9000/p"), { connect: ["http://localhost:9000"] })), []);
  assert.deepEqual(codes(project(CATALOG, { connect: ["https://api.example.com/path"] })), ["KDM4001"]);
});

test("reload names loaded data; unused loaders are errors", () => {
  assert.deepEqual(codes(project(CATALOG.map((l) => l.replace("reload products", "reload prodcts")))), ["KDM3012"]);
  const unused = CATALOG.filter((_, i) => i < CATALOG.indexOf("    tile {") || i > CATALOG.indexOf("    tile {") + 7);
  assert.deepEqual(codes(project(unused)), ["KDM3045"]);
});

const WITH_STATE = (filter, paging = "        showing 3 per page using page") => [
  ...CATALOG.slice(0, 2),
  '    it remembers category, a text that starts as "all", kept in the address',
  "    it remembers page, a number that starts as 1, kept in the address",
  ...CATALOG.slice(2).map((l) => (l.includes("each product has") ? l.replace("a name as text,", "a name as text, a category as text,") : l))
    .flatMap((l) => (l.includes("only where the inStock") ? [l, filter, paging].filter((x) => x !== "") : [l])),
];

test("states kept in the address drive filters and pages of loaded data", () => {
  const result = project(WITH_STATE('        only where the category of product is category, unless it is "all"'));
  assert.deepEqual(result.diagnostics.map((d) => d.message), []);
  const js = file(result, "assets/kadam.home.js");
  assert.match(js, /const addressed = \[\["home-catalog\.category","category"\],\["home-catalog\.page","page"\]\];/);
  assert.match(js, /\["category",false,"","home-catalog\.category","all"\]/);
  assert.match(js, /\[3,"home-catalog\.page"\]/);
  assert.match(js, /history\.replaceState/);
  // Pages without address state get none of that code.
  assert.doesNotMatch(file(project(), "assets/kadam.home.js"), /readAddress|replaceState/);
});

test("state filters and paging are type-checked, and only for loaded data", () => {
  const wrongType = project(WITH_STATE("        only where the price of product is category"));
  assert.deepEqual(codes(wrongType), ["KDM3005"]);
  assert.match(wrongType.diagnostics[0].message, /price is number, but category is a text/);
  assert.deepEqual(codes(project(WITH_STATE("", "        showing 3 per page using category"))), ["KDM3005"]);
  assert.deepEqual(codes(project(WITH_STATE("        only where the category of product is categry"))), ["KDM3012"]);
  assert.deepEqual(codes(project(WITH_STATE('        only where the category of product is category, unless it is 3'))), ["KDM3005"]);
  const both = WITH_STATE("").map((l) => l.replace("showing 3 per page using page", "showing 3 per page using page\n        showing at most 2"));
  assert.ok(codes(project(both)).includes("KDM3040"));
});

test("a data file cannot follow a state", () => {
  const root = project();
  const page = ["kadam 0.3", "", 'page "Shop" {', "    box {", "        a container",
    '        it remembers category, a text that starts as "all"',
    "        tile {", "            a ProductCard for each product in items", "            only where the name of product is category",
    "            with a name of the name of product", "            with a price of the name of product", '            with a link of "https://example.com"', "        }", "    }", "}", ""].join("\n");
  writeFileSync(join(root.root, "pages", "home.kdm"), page);
  writeFileSync(join(root.root, "items.json"), '[{"name":"a"}]');
  writeFileSync(join(root.root, "kadam.json"), JSON.stringify({ kadam: "0.3", name: "shop", components: ["components/ProductCard.kdm"], data: { items: "items.json" }, pages: [{ source: "pages/home.kdm", route: "/" }] }));
  const result = compileProject({ projectRoot: root.root, write: false });
  assert.deepEqual(codes(result), ["KDM3043"]);
  assert.match(result.diagnostics[0].message, /cannot be filtered by a state/);
});

test("two address states with one name are an error", () => {
  const body = ["a1 {", "    a container", '    it remembers tab, a text that starts as "x", kept in the address', "}", "a2 {", "    a container", '    it remembers tab, a text that starts as "y", kept in the address', "}"];
  assert.deepEqual(codes(project(body)), ["KDM3044"]);
});
