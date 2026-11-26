import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { formatKadam } from "../dist/cli/format.js";
import { compileProject } from "../dist/compiler/project.js";
import { compileText } from "../dist/compiler/compile.js";
import { compileV02Text } from "../dist/v02/compile.js";

// F7: kadam format changes only whitespace.

const fmt = (text) => {
  const result = formatKadam(text);
  assert.equal(result.ok, true, result.message);
  return result.text;
};

test("indentation, spaces, blank lines and line endings become canonical", () => {
  const messy = 'kadam 0.3\r\n\r\n\r\npage "Home"   {\r\n\r\n  hero {\n\t\ta section\n            it has   24px  padding  \n        title {\n  a main heading\n            the text says "Two   spaces  stay"   \n }\n\n\n  }\n}';
  assert.equal(fmt(messy), 'kadam 0.3\n\npage "Home" {\n    hero {\n        a section\n        it has 24px padding\n        title {\n            a main heading\n            the text says "Two   spaces  stay"\n        }\n    }\n}\n');
});

test("commas, comments, quotes with braces and one-line records keep their meaning", () => {
  assert.equal(fmt('x {\n  it remembers n , a number that starts as 0\n  //   a  comment {  stays\n  the text says "a { b } \\" c"\n}\n'),
    'x {\n    it remembers n, a number that starts as 0\n    //   a  comment {  stays\n    the text says "a { b } \\" c"\n}\n');
  const core = "kadam 0.2\n\nmodule demo {\n  record P {\n    name as text\n  }\n  function f takes nothing and returns P {\n    if 1 < 2 {\n      return P { name: \"a\" }\n    } otherwise {\n      return P { name: \"b\" }\n    }\n  }\n}\n";
  assert.equal(fmt(core), "kadam 0.2\n\nmodule demo {\n    record P {\n        name as text\n    }\n    function f takes nothing and returns P {\n        if 1 < 2 {\n            return P { name: \"a\" }\n        } otherwise {\n            return P { name: \"b\" }\n        }\n    }\n}\n");
});

test("formatting is idempotent and refuses unbalanced files", () => {
  const once = fmt('page "A" {\nb1 {\na button\n}\n}');
  assert.equal(formatKadam(once).changed, false);
  assert.deepEqual(formatKadam('page "A" {\n  b1 {\n}\n'), { ok: false, line: 4, message: "1 { is not closed" });
  assert.equal(formatKadam("}\n").ok, false);
  assert.equal(formatKadam('x {\n  the text says "open\n}\n').ok, false);
});

function kdmFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "dist" || name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) kdmFiles(path, out);
    else if (name.endsWith(".kdm")) out.push(path);
  }
  return out;
}

test("formatting every example project leaves its build output byte for byte the same", () => {
  const projects = [];
  const find = (dir) => {
    if (existsSync(join(dir, "kadam.json"))) projects.push(dir);
    else for (const name of readdirSync(dir)) if (statSync(join(dir, name)).isDirectory() && name !== "dist") find(join(dir, name));
  };
  find("examples");
  find("test/fixtures/server-shop");
  assert.ok(projects.length >= 8, projects.join());
  for (const root of projects) {
    const overrides = new Map();
    for (const file of kdmFiles(root)) {
      const result = formatKadam(readFileSync(file, "utf8"));
      if (result.ok) overrides.set(file.slice(root.length + 1), result.text);
    }
    const before = compileProject({ projectRoot: root, write: false });
    const after = compileProject({ projectRoot: root, write: false, sourceOverrides: overrides });
    assert.deepEqual(after.files.map((f) => [f.path, String(f.contents)]), before.files.map((f) => [f.path, String(f.contents)]), root);
  }
});

test("formatting single pages and kadam 0.2 modules keeps them compiling the same", () => {
  for (const file of kdmFiles("examples").filter((path) => !/\/(pages|components|libs|server)\//.test(path))) {
    const text = readFileSync(file, "utf8");
    const compile = text.startsWith("kadam 0.2")
      ? (source) => compileV02Text(file, source, { target: "typescript" }).files.map((f) => f.contents)
      : (source) => compileText(file, source).files.map((f) => String(f.contents));
    assert.deepEqual(compile(fmt(text)), compile(text), file);
  }
});
