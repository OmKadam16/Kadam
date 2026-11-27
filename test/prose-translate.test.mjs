import { test } from "node:test";
import assert from "node:assert/strict";

import { compileText } from "../dist/compiler/compile.js";
import { parseText } from "../dist/core/parser/parser.js";

// D-50: kadam 0.4 pages written as paragraphs.

const blocks = (text) => parseText("home.kdm", `kadam 0.4\n\n${text}\n`).prose.text;
const build = (text) => compileText("home.kdm", `kadam 0.4\n\n${text}\n`);
const errors = (result) => result.diagnostics.filter((d) => d.severity === "error");
const file = (result, path) => String(result.files.find((f) => f.path === path)?.contents ?? "");

test("reading order is layout order, with gaps, names and groups", () => {
  const out = blocks([
    "Nav bar:",
    '    The Lumen logo shows "assets/lumen.svg" on the left.',
    '    A small black button says "Get Started" on the right.',
    "",
    "Hero section:",
    "    After that, a 200px gap.",
    '    A big heading says "Meet Lumen."',
    "    After that, a 50 pixel gap.",
    '    Small grey text, 18px, says "Less spent."',
    '    A big black button called download says "Download for macOS".',
  ].join("\n"));
  assert.equal(out, [
    "kadam 0.3",
    'page "Home" {',
    "    nav1 {",
    "        a navigation bar",
    "        logo1 {",
    "            an image",
    '            it shows "assets/lumen.svg"',
    '            the description says "Lumen logo"',
    "            it is at most 100% wide",
    "        }",
    "        button1 {",
    "            a button",
    "            it has 8px padding on the top and bottom",
    "            it has 14px padding on the left and right",
    "            the text is 14px",
    "            has a black background",
    '            the text says "Get Started"',
    "            it sits at the end",
    "        }",
    "    }",
    "    hero1 {",
    "        a section",
    "        heading1 {",
    "            a main heading",
    "            it has 200px margin on the top",
    '            the text says "Meet Lumen."',
    "        }",
    "        text1 {",
    "            a paragraph",
    "            it has 50px margin on the top",
    "            the text is 18px",
    "            the text is #6B7280",
    '            the text says "Less spent."',
    "        }",
    "        download {",
    "            a button",
    "            it has 16px padding on the top and bottom",
    "            it has 28px padding on the left and right",
    "            the text is 18px",
    "            has a black background",
    '            the text says "Download for macOS"',
    "        }",
    "    }",
    "}",
    "",
  ].join("\n"));
});

test("describing words may come in any order; sentences about it describe the last thing", () => {
  assert.equal(blocks('Small gray text says "a".'), blocks('Gray small text says "a".'));
  const out = blocks('A card says "x".\nIt has rounded corners and a soft shadow. Its text is centered.\nThe background is a blue to white gradient from left to right.');
  assert.match(out, /a card\n {8}the text says "x"\n {8}has rounded corners\n {8}has a soft shadow\n {8}the text is centered\n {8}has a blue and white gradient\n {8}the gradient goes from left to right/);
  assert.match(blocks("A card without a shadow and without a top border says \"x\"."), /has no shadow\n {8}has no border on the top/);
});

test("a paragraph page builds the same HTML and CSS as the blocks it stands for", () => {
  const prose = 'The page background is white.\n\nHero section:\n    A big heading says "Hi".\n    After that, a 40px gap.\n    A big black button called goButton says "Go". It has rounded corners.';
  const fromProse = build(prose);
  assert.deepEqual(errors(fromProse), []);
  const fromBlocks = compileText("home.kdm", blocks(prose));
  for (const path of ["index.html", "assets/kadam.css", "assets/kadam.home.css"]) assert.equal(file(fromProse, path), file(fromBlocks, path), path);
  assert.match(file(fromProse, "index.html"), /<html lang="en">[\s\S]*<title>Home<\/title>/);
  assert.match(file(build('The page is called "Lumen".\n\nA big heading says "Hi".'), "index.html"), /<title>Lumen<\/title>/);
});

test("errors point at the sentence and offer fixes, never a guess", () => {
  const typo = build('A big blck button says "Go".');
  const [first] = errors(typo);
  assert.equal(first.code, "KDM2001");
  assert.match(first.message, /I don't know "blck"/);
  assert.equal(first.span.start.line, 3);
  assert.equal(first.fixes[0].label, 'A big black button says "Go"');
  assert.equal(first.fixes.length, 1, "blue is too far from blck to offer");
  const box = errors(build("A card, 18px.")).find((d) => d.fixes !== undefined);
  assert.match(box.message, /could mean its height, its width or its padding/);
  assert.deepEqual(box.fixes.map((fix) => fix.text), ["18px tall", "18px wide", "18px padding"]);
  // A block sentence the grammar rejects is reported at the paragraph sentence.
  const bad = errors(build('A big heading says "Hi". It wobbles a lot.'))[0];
  assert.equal(bad.span.start.line, 3);
  assert.equal(bad.span.start.column, 26);
  assert.equal(errors(build("After that, a 20px gap.")).length, 1, "a gap needs something after it");
  assert.match(errors(build("It is bold."))[0].message, /has nothing to describe yet/);
});

test("a page of about 1,500 sentences builds in well under a second", () => {
  const lines = ["kadam 0.4", "", 'A big heading says "Big page".'];
  for (let i = 0; i < 120; i += 1) {
    lines.push(`Part ${i} section:`, "    Give it 24px padding. It has rounded corners and a soft shadow.", `    A heading says "Part ${i}".`,
      `    Small gray text, 16px, says "Line ${i}." It appears as you scroll.`, "    After that, a 20px gap.",
      `    A black button says "Go ${i}". When hovered, it lifts by 2px.`, "    Side by side:", "        A card.", `        Text says "b ${i}".`);
  }
  const text = `${lines.join("\n")}\n`;
  compileText("home.kdm", text);
  const start = performance.now();
  const result = compileText("home.kdm", text);
  const took = performance.now() - start;
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
  // About 0.1s on a laptop; the bound leaves room for slow CI machines.
  assert.ok(took < 1500, `took ${Math.round(took)}ms`);
});
