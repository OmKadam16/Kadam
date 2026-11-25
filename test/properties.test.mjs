import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { compileText } from "../dist/compiler/compile.js";
import { compileProject } from "../dist/compiler/project.js";
import { PROPERTIES } from "../dist/core/parser/properties.js";

const codes = (result) => result.diagnostics.map((d) => d.code);
const css = (result) =>
  result.files.find((f) => /kadam\.[a-z0-9-]+\.css$/.test(f.path))?.contents ?? "";

function page(body, version = "0.3") {
  return `kadam ${version}\npage "Home" {\n${body}\n}\n`;
}

test("the regular property sentence emits CSS in source order, with responsive overrides", () => {
  const result = compileText(
    "home.kdm",
    page(`    p1 {
        a paragraph
        the text says "Hello"
        the letter spacing is 0.05rem
        the line height is 1.8
        on phones, the line height is 1.5
    }`),
  );
  assert.deepEqual(codes(result), []);
  const out = css(result);
  assert.match(out, /\.kdm-home-p1 \{\n  letter-spacing: 0\.05rem;\n  line-height: 1\.8;\n\}/);
  assert.match(out, /@media \(max-width: 599px\) \{\n  \.kdm-home-p1 \{\n    line-height: 1\.5;/);
});

test("text field properties apply to the input, like typography", () => {
  const result = compileText(
    "home.kdm",
    page(`    f1 {
        a text field
        the label says "Email"
        the letter spacing is 1px
    }`),
  );
  assert.deepEqual(codes(result), []);
  assert.match(css(result), /\.kdm-home-f1 \.kdm-field-input \{\n  letter-spacing: 1px;/);
});

test("property values, kinds, and duplicates are checked", () => {
  const result = compileText(
    "home.kdm",
    page(`    c1 {
        a container
        the line height is 1.5
    }
    p1 {
        a paragraph
        the text says "x"
        the line height is 9
        the letter spacing is wide
        the letter spacing is 1px
        the letter spacing is 2px
    }`),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ["KDM3003", "KDM3005", "KDM3005", "KDM3004"]);
  assert.match(result.diagnostics[1].message, /between 0\.5 and 4/);
});

test("an unknown property name is not claimed by the property sentence", () => {
  const result = compileText(
    "home.kdm",
    page(`    p1 {
        a paragraph
        the text says "x"
        the word spacing is 2px
    }`),
  );
  assert.deepEqual(codes(result), ["KDM2001"]);
});

test("properties pass through component expansion", () => {
  const dir = mkdtempSync(join(tmpdir(), "kadam-props-"));
  const write = (path, contents) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  };
  write("kadam.json", JSON.stringify({
    kadam: "0.3",
    name: "P",
    components: ["components/Lead.kdm"],
    pages: [{ source: "pages/home.kdm", route: "/" }],
  }));
  write("components/Lead.kdm", 'component Lead takes a body as text {\n    copy1 {\n        a paragraph\n        the text says "{$body}"\n        the line height is 1.7\n    }\n}\n');
  write("pages/home.kdm", 'page "Home" {\n    intro {\n        a Lead\n        with a body of "Hi"\n    }\n}\n');
  const result = compileProject({ projectRoot: dir });
  assert.deepEqual(codes(result), []);
  const out = result.files.find((f) => f.path.endsWith(".css") && f.path !== "assets/kadam.css")?.contents ?? "";
  assert.match(String(out), /line-height: 1\.7;/);
});

const kindFor = (row) => (row.name === "gap" ? "container" : "paragraph");
const elementWith = (row, line) => {
  const text = kindFor(row) === "paragraph" ? '\n        the text says "x"' : "";
  return `    p1 {\n        a ${kindFor(row)}${text}\n        ${line}\n    }`;
};

test("every property row has a unique name and a self-matching example", () => {
  const names = new Set();
  for (const row of PROPERTIES) {
    assert.ok(!names.has(row.name), `duplicate ${row.name}`);
    names.add(row.name);
    assert.ok(row.example.startsWith(`the ${row.name} is `), row.name);
    const result = compileText("home.kdm", page(elementWith(row, row.example)));
    assert.deepEqual(codes(result), [], row.example);
  }
});

test("a shorthand-backed row compiles byte-identically to its shorthand", () => {
  const rows = PROPERTIES.filter((row) => "shorthand" in row);
  assert.ok(rows.length >= 10);
  for (const row of rows) {
    const regular = compileText("home.kdm", page(elementWith(row, row.example)));
    const shorthand = compileText("home.kdm", page(elementWith(row, row.shorthand)));
    assert.deepEqual(codes(shorthand), [], row.shorthand);
    assert.deepEqual(
      regular.files.map((f) => [f.path, f.contents]),
      shorthand.files.map((f) => [f.path, f.contents]),
      `${row.example} vs ${row.shorthand}`,
    );
  }
});

test("a regular sentence and its shorthand are one property for duplicates", () => {
  for (const row of PROPERTIES.filter((r) => "shorthand" in r)) {
    const both = `${row.example}\n        ${row.shorthand}`;
    const result = compileText("home.kdm", page(elementWith(row, both)));
    assert.deepEqual(codes(result), ["KDM3004"], row.name);
  }
});

test("shorthand-backed rows keep their kind rules and accept responsive scopes", () => {
  const onParagraph = compileText(
    "home.kdm",
    page('    p1 {\n        a paragraph\n        the text says "x"\n        the gap is 8px\n    }'),
  );
  assert.deepEqual(codes(onParagraph), ["KDM3003"]);

  const scoped = compileText(
    "home.kdm",
    page('    p1 {\n        a paragraph\n        the text says "x"\n        on phones, the text size is 14px\n    }'),
  );
  assert.deepEqual(codes(scoped), []);
  assert.match(css(scoped), /@media \(max-width: 599px\) \{\n  \.kdm-home-p1 \{\n    font-size: 14px;/);
});

test("choice values are checked against the row", () => {
  const result = compileText(
    "home.kdm",
    page('    p1 {\n        a paragraph\n        the text says "x"\n        the text weight is heavy\n        the font family is sans serif\n    }'),
  );
  assert.deepEqual(codes(result), ["KDM3005"]);
  assert.match(result.diagnostics[0].message, /use light, regular, medium, semibold, bold/);
});

test("shorthand-backed rows are kadam 0.3 syntax", () => {
  const result = compileText(
    "home.kdm",
    page('    p1 {\n        a paragraph\n        the text says "x"\n        the padding is 8px\n    }', "0.1"),
  );
  assert.deepEqual(codes(result), ["KDM2013"]);
  assert.match(result.diagnostics[0].message, /the padding requires kadam 0\.3/);
});

test("component placeholders work in shorthand-backed rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "kadam-props-ref-"));
  const write = (path, contents) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  };
  write("kadam.json", JSON.stringify({
    kadam: "0.3",
    name: "P",
    components: ["components/Tint.kdm"],
    pages: [{ source: "pages/home.kdm", route: "/" }],
  }));
  write("components/Tint.kdm", 'component Tint takes a tone as color, a space as length {\n    box1 {\n        a card\n        the background color is "{$tone}"\n        the padding is "{$space}"\n    }\n}\n');
  write("pages/home.kdm", 'page "Home" {\n    t1 {\n        a Tint\n        with a tone of "#FF0066"\n        with a space of "12px"\n    }\n}\n');
  const result = compileProject({ projectRoot: dir });
  assert.deepEqual(codes(result), []);
  const out = String(result.files.find((f) => f.path.endsWith(".css") && f.path !== "assets/kadam.css")?.contents ?? "");
  assert.match(out, /background-color: #FF0066;/i);
  assert.match(out, /padding-top: 12px;\n  padding-right: 12px;/);
});
