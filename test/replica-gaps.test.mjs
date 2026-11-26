import { test } from "node:test";
import assert from "node:assert/strict";

import { compileText } from "../dist/compiler/compile.js";

// Gaps found by replicating a real landing page in Kadam (kadam 0.3).

const codes = (result) => result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
const messages = (result) => result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
const file = (result, path) => String(result.files?.find((f) => f.path === path)?.contents ?? "");
function page(lines, version = "0.3") {
  return compileText("a.kdm", [`kadam ${version}`, 'page "A" {', "    the brand color is #0F766E", ...lines.map((l) => `    ${l}`), "}", ""].join("\n"));
}
const text = (...lines) => ["t1 {", "    a main heading", '    the text says "Hello +25 −4 brand Amount terms"', ...lines.map((l) => `    ${l}`), "}"];

test("letter spacing can be negative; nothing else can", () => {
  const result = page(text("the letter spacing is -1.3px"));
  assert.deepEqual(codes(result), []);
  assert.match(file(result, "assets/kadam.home.css"), /letter-spacing: -1\.3px;/);
  for (const line of ["it has -4px padding", "the text is -12px", "it is -3px wide", "the letter spacing is -2", "it moves by -4px to the left"]) {
    const bad = page(text(line));
    assert.deepEqual(codes(bad), ["KDM3005"], line);
    assert.match(messages(bad)[0], /is negative; only the letter spacing can be negative/);
  }
  // A hyphen inside a word is not a minus sign.
  assert.deepEqual(codes(page(["kebab1 {", "    a paragraph", '    the text says "well-known 3-4 minutes"', "}"])), []);
});

test("the text weight can be a number from 100 to 900", () => {
  const result = page(text("the text weight is 420"));
  assert.deepEqual(codes(result), []);
  assert.match(file(result, "assets/kadam.home.css"), /font-weight: 420;/);
  assert.match(messages(page(text("the text weight is 950")))[0], /whole number from 100 to 900/);
  assert.match(messages(page(text("the text weight is 420.5")))[0], /whole number from 100 to 900/);
  // The named weights still work.
  assert.match(file(page(text("the text weight is semibold")), "assets/kadam.home.css"), /font-weight: 600;/);
});

test("words can be colored, code, or underlined", () => {
  const result = page(text(
    'the words "+25" are #1E7F45', 'the words "−4" are red', 'the words "brand" are brand',
    'the words "Amount" are code', 'the words "terms" are underlined',
  ));
  assert.deepEqual(codes(result), []);
  assert.match(file(result, "index.html"),
    /Hello <span class="kdm-words-1e7f45">\+25<\/span> <span class="kdm-words-red">−4<\/span> <span class="kdm-words-brand">brand<\/span> <code class="kdm-inline-code">Amount<\/code> <span class="kdm-inline-underline">terms<\/span>/);
  const css = file(result, "assets/kadam.home.css");
  assert.match(css, /\.kdm-words-1e7f45 \{\n {2}color: #1e7f45;\n\}/);
  assert.match(css, /\.kdm-words-brand \{\n {2}color: var\(--kdm-color-brand\);\n\}/);
  assert.match(file(result, "assets/kadam.css"), /\.kdm-inline-underline \{\n {2}text-decoration: underline;\n\}/);
  // No inline styles: the strict CSP still holds.
  assert.doesNotMatch(file(result, "index.html"), / style=/);
  assert.ok(codes(page(text('the words "Amount" are sparkly'))).includes("KDM3005"));
});

test("it stretches its children fills the cross axis", () => {
  const result = page(["col1 {", "    a container", "    it stretches its children", "    a1 {", "        a paragraph", '        the text says "x"', "    }", "}"]);
  assert.deepEqual(codes(result), []);
  assert.match(file(result, "assets/kadam.home.css"), /\.kdm-home-col1 \{\n {2}align-items: stretch;\n\}/);
  assert.ok(codes(page(["col1 {", "    a container", "    it stretches its children", "    it stretches its children", "}"])).length > 0);
});

const TABS = [
  "tabs1 {", "    a container", '    it remembers suite, a text that starts as "terminal"',
  "    tabA {", "        a button", '        the text says "Terminal"', "        has a #111110 background",
  '        when suite is "terminal", has a 2px #F26522 border', '        when clicked, set suite to "terminal"', "    }",
  "    tabB {", "        a button", '        the text says "Deep"', "        has a #111110 background",
  '        when suite is "deep", has a 2px #F26522 border', '        when clicked, set suite to "deep"', "    }",
  "}",
];

test("a style can follow a state: the attribute starts right and the runtime keeps it right", () => {
  const result = page(TABS);
  assert.deepEqual(codes(result), []);
  const html = file(result, "index.html");
  assert.match(html, /data-kdm-id="home-tabA" data-kdm-when-suite-terminal type="button"/);
  assert.match(html, /data-kdm-id="home-tabB" type="button"/);
  const css = file(result, "assets/kadam.home.css");
  assert.match(css, /\.kdm-home-tabA\[data-kdm-when-suite-terminal\] \{\n {2}border: 2px solid #f26522;\n\}/);
  assert.match(css, /\.kdm-home-tabB\[data-kdm-when-suite-deep\] \{/);
  const js = file(result, "assets/kadam.home.js");
  assert.match(js, /const styled = \[\["home-tabA","home-tabs1\.suite","terminal","data-kdm-when-suite-terminal"\],/);
  assert.match(js, /toggleAttribute\(attribute, state\.get\(key\) === value\)/);
});

test("a style that follows state names a real state with a value of its type", () => {
  assert.deepEqual(messages(page(TABS.map((l) => l.replace('when suite is "deep"', 'when suit is "deep"')))), ["no element on this page remembers suit"]);
  assert.deepEqual(messages(page(TABS.map((l) => l.replace('when suite is "deep"', "when suite is 3")))), ["suite is a text, not a number"]);
  assert.ok(codes(page(TABS, "0.1")).includes("KDM2013"));
  // Other sentences that start with when are unchanged.
  assert.deepEqual(codes(page(["b1 {", "    a button", '    the text says "x"', "    when hovered, the background turns #333333", "}"])), []);
});

// Found by writing the documentation site in Kadam.
test("the font is monospace reaches the CSS of a text element", () => {
  const result = page(["p1 {", "    a paragraph", '    the text says "x"', "    the font is monospace", "}", "p2 {", "    a minor heading", '    the text says "y"', "    the font is serif", "}"]);
  assert.deepEqual(codes(result), []);
  const css = file(result, "assets/kadam.home.css");
  assert.match(css, /\.kdm-home-p1 \{\n {2}font-family: ui-monospace[^;]*;\n\}/);
  assert.match(css, /\.kdm-home-p2 \{\n {2}font-family: ui-serif[^;]*;\n\}/);
});

test("are code and are underlined win over a theme color with the same name", () => {
  const result = compileText("a.kdm", ["kadam 0.3", 'page "A" {', "    the code color is #F2F3F6", "    the underlined color is #F2F3F6",
    "    t1 {", "        a paragraph", '        the text says "Run kadam check now"', '        the words "kadam check" are code', '        the words "now" are underlined', "    }", "}", ""].join("\n"));
  assert.deepEqual(codes(result), []);
  assert.match(file(result, "index.html"), /Run <code class="kdm-inline-code">kadam check<\/code> <span class="kdm-inline-underline">now<\/span>/);
});
