import { test } from "node:test";
import assert from "node:assert/strict";

import { compileProject } from "../dist/compiler/project.js";
import { shapingLine } from "../dist/core/prose/translate.js";

// D-50: data lists in paragraph pages (test/fixtures/shop-prose-site).

const result = compileProject({ projectRoot: "test/fixtures/shop-prose-site" });
const html = String(result.files.find((f) => f.path === "index.html")?.contents ?? "");
const names = (from, to) => [...html.slice(html.indexOf(from), to === undefined ? undefined : html.indexOf(to)).matchAll(/<h2[^>]*kdm-c-[^>]*>([^<]+)<\/h2>|<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1] ?? m[2]);

test("data/*.json are found without kadam.json, and For each groups repeat their lines", () => {
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
  assert.deepEqual(result.manifest.data, { products: "data/products.json" });
  // Sorted by the year of the product, newest first.
  assert.deepEqual(names("All products", "Featured"), ["Mug", "Notebook", "Desk lamp", "Pen set"]);
  assert.match(html, /<p class="kdm-c-ShopEachProduct-default-text1 kdm-kind-paragraph" data-kdm-id="home-product11-text1">\$12<\/p>/);
});

test("a component repeats for each record, filtered and limited", () => {
  // Only where the featured of the product is true. Showing at most 2.
  assert.deepEqual(names("Featured"), ["Desk lamp", "Pen set"]);
});

test("shaping lines in everyday words", () => {
  assert.equal(shapingLine("Sorted by the year of the product, newest first."), "sorted by the year of product from highest to lowest");
  assert.equal(shapingLine("Ordered by the name of the product."), "sorted by the name of product");
  assert.equal(shapingLine("Only if the featured of the product is true."), "only where the featured of product is true");
  assert.equal(shapingLine("Show at most 3."), "showing at most 3");
  assert.equal(shapingLine("Showing at most 2."), "showing at most 2");
  assert.equal(shapingLine("A card says \"x\"."), null);
});
