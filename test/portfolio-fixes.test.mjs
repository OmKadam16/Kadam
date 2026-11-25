import { test } from "node:test";
import assert from "node:assert/strict";

import { compileText } from "../dist/compiler/compile.js";

// Problems found by writing a real portfolio page in kadam 0.3.

const codes = (result) => result.diagnostics.map((d) => d.code);
const css = (result) => String(result.files?.find((f) => f.path === "assets/kadam.home.css")?.contents ?? "");
function page(body, version = "0.3") {
  return compileText("home.kdm", [`kadam ${version}`, 'page "Home" {', ...body.map((l) => `    ${l}`), "}", ""].join("\n"));
}

test("it sits at the end follows a parent that turns into a column on phones", () => {
  const result = page([
    "row1 {",
    "    a container",
    "    it arranges its children in a row",
    "    on phones, it arranges its children in a column",
    "    first {",
    "        a link",
    '        the text says "About"',
    "        it sits at the end",
    '        when clicked, go to page "Home"',
    "    }",
    "}",
  ]);
  assert.deepEqual(codes(result), []);
  assert.match(css(result), /\.kdm-home-first \{\n {2}margin-inline-start: auto;\n\}/);
  assert.match(css(result), /@media \(max-width: 599px\) \{[^@]*\.kdm-home-first \{\n {4}margin-inline-start: 0;\n {4}margin-block-start: auto;/);
});

test("it is as wide as its content hugs the content, and is kadam 0.3", () => {
  const result = page(["nav1 {", "    a navigation bar", "    it is as wide as its content", "}"]);
  assert.deepEqual(codes(result), []);
  assert.match(css(result), /\.kdm-home-nav1 \{\n {2}width: fit-content;\n\}/);
  assert.ok(codes(page(["nav1 {", "    a navigation bar", "    it is as wide as its content", "}"], "0.1")).includes("KDM2013"));
  // It is a width, so it conflicts with another width.
  assert.ok(codes(page(["c1 {", "    a container", "    it is full width", "    it is as wide as its content", "}"])).length > 0);
});

test("kadam 0.3 elements can shrink on hover and press; 0.1 keeps 100% to 200%", () => {
  const result = page([
    "b1 {", "    a button", '    the text says "Press"', "    when pressed, it scales to 96%", "    when hovered, it scales to 98%", "}",
  ]);
  assert.deepEqual(codes(result), []);
  assert.match(css(result), /\.kdm-home-b1:active \{\n {2}scale: 0\.96;/);
  assert.match(css(result), /\.kdm-home-b1:hover \{\n {4}scale: 0\.98;/);
  const tooSmall = page(["b1 {", "    a button", '    the text says "x"', "    when pressed, it scales to 40%", "}"]);
  assert.match(tooSmall.diagnostics[0].message, /outside 50%–200%/);
  const old = page(["b1 {", "    a button", '    the text says "x"', "    when hovered, it scales to 98%", "}"], "0.1");
  assert.deepEqual(old.diagnostics.map((d) => d.message), ["scale percentage 98% is outside 100%–200%"]);
});

test("centered text in a column is centered even when the line is short", () => {
  const result = page([
    "foot {", "    a footer",
    "    note {", "        a paragraph", '        the text says "Centered"', "        the text is centered", "    }",
    "}",
  ]);
  assert.deepEqual(codes(result), []);
  assert.match(css(result), /\.kdm-home-note \{\n {2}text-align: center;\n {2}align-self: center;\n\}/);
  // In a row the box stays where the row puts it.
  const row = page([
    "r1 {", "    a container", "    it arranges its children in a row",
    "    note {", "        a paragraph", '        the text says "x"', "        the text is centered", "    }",
    "}",
  ]);
  assert.doesNotMatch(css(row), /align-self: center/);
});
