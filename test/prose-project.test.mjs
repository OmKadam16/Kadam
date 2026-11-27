import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileProject } from "../dist/compiler/project.js";

// D-50: file routes, components.kdm with blanks, but and without.

function project(files) {
  const root = mkdtempSync(join(tmpdir(), "kadam-prose-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return compileProject({ projectRoot: root });
}
const errors = (result) => result.diagnostics.filter((d) => d.severity === "error");
const file = (result, path) => String(result.files.find((f) => f.path === path)?.contents ?? "");
const COMPONENTS = [
  "kadam 0.4",
  "",
  "A PrimaryButton is a big black button with white text that says ___.",
  "It has fully rounded corners.",
  "",
  "A FeatureCard is a card without a shadow, with a ___ title and a ___ description.",
  "It has 24px padding.",
  "",
].join("\n");

test("the pages folder is the site: file names are routes and titles", () => {
  const result = project({
    "pages/home.kdm": 'kadam 0.4\n\nA big heading says "Home".\nA link says "Usage". When clicked, go to page "Usage".\n',
    "pages/usage.kdm": 'kadam 0.4\n\nA big heading says "Usage".\n',
    "pages/docs/intro.kdm": 'kadam 0.4\n\nThe page is called "Introduction".\nA big heading says "Intro".\n',
  });
  assert.deepEqual(errors(result), []);
  assert.deepEqual(result.files.filter((f) => f.path.endsWith(".html")).map((f) => f.path).sort(), ["docs/intro/index.html", "index.html", "usage/index.html"]);
  assert.match(file(result, "index.html"), /<title>Home<\/title>[\s\S]*href="\/usage\/"/);
  assert.match(file(result, "docs/intro/index.html"), /<title>Introduction<\/title>/);
});

test("components.kdm defines fill-in-the-blank components that pages use", () => {
  const result = project({
    "components.kdm": COMPONENTS,
    "pages/home.kdm": [
      "kadam 0.4",
      "",
      'A big heading says "Hi".',
      "After that, a 40px gap.",
      'A PrimaryButton called download says "Download".',
      'A FeatureCard with the title "Fast" and the description "Static HTML.".',
      'A FeatureCard, but rounded, without a border, with the title "Cheap" and the description "Small models.".',
    ].join("\n"),
  });
  assert.deepEqual(errors(result), []);
  const html = file(result, "index.html");
  assert.match(html, /<div class="[^"]*downloadSpace1[^"]*"[^>]*>\s*<button class="kdm-c-PrimaryButton-default-primaryButton1[^"]*"[^>]*>Download<\/button>/);
  assert.match(html, /<h3[^>]*>Fast<\/h3>\s*<p[^>]*>Static HTML\.<\/p>/);
  assert.match(html, /<h3[^>]*>Cheap<\/h3>\s*<p[^>]*>Small models\.<\/p>/);
  const css = file(result, "assets/kadam.home.css");
  assert.match(css, /\.kdm-c-PrimaryButton-default-primaryButton1[^{]* \{[^}]*background-color: black;/);
  // The changed card is the component's body with the change: rounded, and no border.
  assert.match(css, /\.kdm-home-featureCard2 \{[^}]*box-shadow: none;[^}]*\}/);
  assert.match(css, /\.kdm-home-featureCard2 \{[^}]*border-radius: 8px;/);
});

test("components.kdm errors name the blank or the change that is wrong", () => {
  const base = { "components.kdm": COMPONENTS };
  const blank = project({ ...base, "pages/home.kdm": 'kadam 0.4\n\nA big heading says "Hi".\nA FeatureCard with the titel "x" and the description "y".\n' });
  assert.match(errors(blank).map((d) => d.message).join("\n"), /FeatureCard has no blank called titel/);
  assert.equal(errors(blank).find((d) => d.fixes)?.fixes[0].text, "title");
  const missing = project({ ...base, "pages/home.kdm": 'kadam 0.4\n\nA big heading says "Hi".\nA FeatureCard, but rounded, with the title "x".\n' });
  assert.match(errors(missing).map((d) => d.message).join("\n"), /FeatureCard needs its description/);
  // A blank may have any name; a new name is plain text.
  const any = project({ ...base, "components.kdm": "kadam 0.4\n\nA Thing is a card with a ___ wobble.\n", "pages/home.kdm": 'kadam 0.4\n\nA big heading says "Hi".\nA Thing with the wobble "Hello".\n' });
  assert.deepEqual(errors(any), []);
  assert.match(file(any, "index.html"), /<p[^>]*>Hello<\/p>/);
});

test("a block can sit inside a paragraph page", () => {
  const result = project({
    "pages/home.kdm": [
      "kadam 0.4",
      "",
      'A big heading says "Hi".',
      "After that, a 30px gap.",
      "exact1 {",
      "    a paragraph",
      '    the text says "Written as a block."',
      "    the text is 13px",
      "}",
      'Text says "After the block.".',
    ].join("\n"),
  });
  assert.deepEqual(errors(result), []);
  assert.match(file(result, "index.html"), /Written as a block\.<\/p>\s*<p[^>]*>After the block\.<\/p>/);
  assert.match(file(result, "assets/kadam.home.css"), /\.kdm-home-exact1 \{\n {2}margin-top: 30px;/);
});
