import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileProject } from "../dist/compiler/project.js";
import { DevSession } from "../dist/server/dev-session.js";

// F5 step 1 (D-40): build-time data lists.

const CARD = [
  "kadam 0.3",
  "",
  "component ProjectCard takes a title as text, a year as text defaulting to \"Now\", a link as url defaulting to \"https://example.com\" {",
  "    card1 {",
  "        a card",
  "        name1 {",
  "            a section heading",
  '            the text says "{$title}"',
  "        }",
  "        year1 {",
  "            a paragraph",
  '            the text says "{$year}"',
  "        }",
  "    }",
  "}",
  "",
].join("\n");

function project(body, { data = '[{"title":"Kadam","year":2026},{"title":"Lens"}]', manifest = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kadam-data-"));
  mkdirSync(join(root, "pages"));
  mkdirSync(join(root, "components"));
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "components", "ProjectCard.kdm"), CARD);
  writeFileSync(join(root, "data", "projects.json"), data);
  writeFileSync(
    join(root, "pages", "home.kdm"),
    ["kadam 0.3", "", 'page "Home" {', ...body.map((line) => `    ${line}`), "}", ""].join("\n"),
  );
  writeFileSync(
    join(root, "kadam.json"),
    JSON.stringify({
      kadam: "0.3",
      name: "data-test",
      components: ["components/ProjectCard.kdm"],
      pages: [{ source: "pages/home.kdm", route: "/" }],
      data: { projects: "data/projects.json" },
      ...manifest,
    }),
  );
  const result = compileProject({ projectRoot: root, write: false });
  result.root = root;
  return result;
}

const codes = (result) => result.diagnostics.map((d) => d.code);
const html = (result) => String(result.files.find((f) => f.path === "index.html")?.contents ?? "");

const LIST = [
  "work {",
  "    a container",
  "    tile {",
  "        a ProjectCard for each project in projects",
  "        with a title of the title of project",
  "        with a year of the year of project",
  "    }",
  "}",
];

test("a component repeats once per record, in order, as static HTML", () => {
  const result = project(LIST);
  assert.deepEqual(codes(result), []);
  const out = html(result);
  assert.ok(out.indexOf("Kadam") < out.indexOf("Lens"));
  assert.match(out, /2026/);
  // A missing field leaves the parameter to its default.
  assert.match(out, /Now/);
  assert.ok(!result.files.some((f) => String(f.path).endsWith(".js")), "no runtime for build-time data");
});

test("an unknown field or record name points at the binding", () => {
  const bad = LIST.map((line) => line.replace("the year of project", "the yaer of project"));
  const result = project(bad);
  assert.deepEqual(codes(result), ["KDM3043"]);
  assert.match(result.diagnostics[0].hint, /did you mean: year/);
  const wrongItem = project(LIST.map((line) => line.replace("the title of project", "the title of item")));
  assert.deepEqual(codes(wrongItem), ["KDM3043"]);
});

test("unknown data names are suggested", () => {
  const result = project(LIST.map((line) => line.replace("in projects", "in projcts")));
  assert.deepEqual(codes(result), ["KDM3042"]);
  assert.match(result.diagnostics[0].hint, /projects/);
});

test("a bad data file is one clear error", () => {
  assert.deepEqual(codes(project(LIST, { data: "[{]" })), ["KDM4010"]);
  assert.deepEqual(codes(project(LIST, { data: '{"title":"x"}' })), ["KDM4010"]);
  const mixed = project(LIST, { data: '[{"title":"a","year":1},{"title":"b","year":"two"}]' });
  assert.deepEqual(codes(mixed), ["KDM4010"]);
  assert.match(mixed.diagnostics[0].message, /record 2 field "year" is text, but earlier records have number/);
});

test("a repeated instance is checked like a hand-written one", () => {
  // The title parameter is required; a record without it is a component error.
  const result = project(LIST, { data: '[{"year":2026}]' });
  assert.ok(codes(result).length > 0);
  assert.ok(!codes(result).includes("KDM9001"));
});

test("data lists need kadam 0.3, a component, and no generated-name clash", () => {
  const old = project(LIST, { manifest: { kadam: "0.1" } });
  assert.ok(codes(old).includes("KDM4001"));
  const builtin = project(["tile {", "    a paragraph for each project in projects", "}"]);
  assert.ok(codes(builtin).includes("KDM3040"));
  const clash = project([...LIST, "tile1 {", "    a paragraph", '    the text says "x"', "}"]);
  assert.ok(codes(clash).includes("KDM3044"));
  const loose = project(["c {", "    a ProjectCard", "    with a title of the title of project", "}"]);
  assert.deepEqual(codes(loose), ["KDM3041"]);
});

test("kadam dev rebuilds when a data file changes", () => {
  const { root } = project(LIST);
  const session = new DevSession({ projectRoot: root });
  assert.equal(session.build().ok, true);
  assert.ok(session.watchPaths.includes("data/projects.json"));
});

test("a component whose root is a list item is checked where it is used", () => {
  const item = (root) => writeFileSync(join(root, "components", "Item.kdm"), 'kadam 0.3\n\ncomponent Item takes a text as text {\n    item1 {\n        a list item\n        the text says "{$text}"\n    }\n}\n');
  const build = (body) => {
    const { root } = project(["x {", "    a paragraph", '    the text says "x"', "}"]);
    item(root);
    writeFileSync(join(root, "pages", "home.kdm"), ["kadam 0.3", "", 'page "Home" {', ...body.map((l) => `    ${l}`), "}", ""].join("\n"));
    const manifest = JSON.parse(readFileSync(join(root, "kadam.json"), "utf8"));
    manifest.components.push("components/Item.kdm");
    writeFileSync(join(root, "kadam.json"), JSON.stringify(manifest));
    return compileProject({ projectRoot: root, write: false });
  };
  const inList = build(["list1 {", "    a list", "    entry {", "        an Item for each project in projects", "        with a text of the title of project", "    }", "}"]);
  assert.deepEqual(codes(inList), []);
  assert.equal((html(inList).match(/<li[ >]/g) ?? []).length, 2);
  const loose = build(["entry {", "    an Item", '    with a text of "x"', "}"]);
  assert.deepEqual(codes(loose), ["KDM3010"]);
});

const ROWS = JSON.stringify([
  { title: "A", year: 2023, featured: true },
  { title: "B", year: 2026, featured: false },
  { title: "C", year: 2025, featured: true },
  { title: "D", featured: true },
  { title: "E", year: 2024, featured: true },
]);
const shaped = (...lines) => [
  "work {",
  "    a container",
  "    tile {",
  "        a ProjectCard for each project in projects",
  ...lines.map((line) => `        ${line}`),
  "        with a title of the title of project",
  "    }",
  "}",
];
const titles = (result) => [...html(result).matchAll(/<h2[^>]*>([A-E])<\/h2>/g)].map((m) => m[1]);

test("only where, sorted by, and showing at most shape a data list", () => {
  const result = project(
    shaped("only where the featured of project is true", "sorted by the year of project from highest to lowest", "showing at most 3"),
    { data: ROWS },
  );
  assert.deepEqual(codes(result), []);
  assert.deepEqual(titles(result), ["C", "E", "A"]);
  // Records without the sort field go last; the sort is stable.
  assert.deepEqual(titles(project(shaped("sorted by the year of project"), { data: ROWS })), ["A", "E", "C", "B", "D"]);
  assert.deepEqual(titles(project(shaped('only where the title of project is not "B"', "showing at most 2"), { data: ROWS })), ["A", "C"]);
});

test("shaping lines are checked", () => {
  assert.deepEqual(codes(project(shaped('only where the year of project is "2026"'), { data: ROWS })), ["KDM3043"]);
  assert.deepEqual(codes(project(shaped("sorted by the yeer of project"), { data: ROWS })), ["KDM3043"]);
  assert.deepEqual(codes(project(shaped("showing at most 0"), { data: ROWS })), ["KDM2002"]);
  assert.deepEqual(codes(project(shaped("sorted by the year of project", "sorted by the title of project"), { data: ROWS })), ["KDM3040"]);
  assert.deepEqual(codes(project(["x {", "    a paragraph", '    the text says "x"', "    showing at most 3", "}"])), ["KDM3041"]);
});
