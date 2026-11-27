import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { compileProject } from "../dist/compiler/project.js";
import { compileText } from "../dist/compiler/compile.js";

// D-50: a first page full of ordinary mistakes (test/fixtures/beginner/home.kdm).

const cli = (...args) => spawnSync(process.execPath, ["dist/cli/main.js", ...args], { encoding: "utf8" });
function site(files) {
  const root = mkdtempSync(join(tmpdir(), "kadam-beginner-"));
  mkdirSync(join(root, "pages"));
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  return root;
}

test("every mistake has a message that says what to do, and a fix", () => {
  const root = site({ "pages/home.kdm": readFileSync("test/fixtures/beginner/home.kdm", "utf8") });
  const errors = compileProject({ projectRoot: root }).diagnostics.filter((d) => d.severity === "error");
  const said = errors.map((d) => [d.message, d.fixes?.[0]?.label]);
  assert.deepEqual(said, [
    ['a new sentence seems to start at "Text"; sentences end with a full stop', 'A big heading says "Welcome". Text says "Hello there"'],
    ['the lines under "Hero section" are indented, but it does not end with a colon', "Hero section:"],
    ['the lines under "A card." are indented, but it does not end with a colon', "A card:"],
    ["the words after says go in quotes", 'A heading says "Welcome"'],
    ["a quote is opened on this line but never closed", 'A button says "Unclosed".'],
    ['I don\'t know "buton" in: A buton says "Go"', 'A button says "Go"'],
    ['I don\'t know "buttn" in: A big blue buttn says "Go"', 'A big blue button says "Go"'],
  ]);
});

test("kadam fix --first repairs the page so it builds", () => {
  const root = site({ "pages/home.kdm": readFileSync("test/fixtures/beginner/home.kdm", "utf8") });
  const run = cli("fix", root, "--first");
  assert.match(run.stdout, /kadam fix: everything is fixed\./);
  assert.deepEqual(compileProject({ projectRoot: root }).diagnostics.filter((d) => d.severity === "error"), []);
  const fixed = readFileSync(join(root, "pages", "home.kdm"), "utf8");
  assert.match(fixed, /^Hero section:\n {4}A button says "Go"\.$/m);
  assert.match(fixed, /^ {2}A card:$/m);
});

test("the kadam 0.4 line is optional in a paragraph site, and asked for in a single file", () => {
  const root = site({ "pages/home.kdm": 'A big heading says "Welcome".\nText says "Hello".\n' });
  assert.deepEqual(compileProject({ projectRoot: root }).diagnostics.filter((d) => d.severity === "error"), []);
  const zeroFour = site({ "kadam.json": '{ "kadam": "0.4", "name": "x" }', "pages/home.kdm": 'A big heading says "Welcome".\n' });
  assert.deepEqual(compileProject({ projectRoot: zeroFour }).diagnostics.filter((d) => d.severity === "error"), []);
  const single = compileText("home.kdm", 'A big heading says "Welcome"\nText says "Hello"\n');
  assert.equal(single.diagnostics.length, 1);
  assert.equal(single.diagnostics[0].code, "KDM4004");
  assert.equal(single.diagnostics[0].fixes[0].text, "kadam 0.4\n\n");
  // A block file without a version line is still a 0.1 page.
  assert.deepEqual(compileText("a.kdm", 'page "A" {\n    h1 {\n        a main heading\n        the text says "Hi"\n    }\n}\n').diagnostics.filter((d) => d.severity === "error"), []);
});

test("a section with no heading to name it is a plain box", () => {
  const out = compileText("home.kdm", 'kadam 0.4\n\nA big heading says "Hi".\nHero section:\n    A button says "Go".\n');
  assert.deepEqual(out.diagnostics.filter((d) => d.severity === "error"), []);
  assert.match(String(out.files.find((f) => f.path === "index.html").contents), /<div class="kdm-home-hero1 kdm-kind-container"/);
});
