import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { compileProject } from "../dist/compiler/project.js";

// F7: the documentation site is written in Kadam.

test("the site's reference data is generated from the compiler and up to date", () => {
  const before = ["site/data/sentences.json", "site/data/codes.json"].map((path) => readFileSync(path, "utf8"));
  const run = spawnSync(process.execPath, ["scripts/generate-site-data.mjs"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const after = ["site/data/sentences.json", "site/data/codes.json"].map((path) => readFileSync(path, "utf8"));
  assert.deepEqual(after, before, "run npm run build, then node scripts/generate-site-data.mjs");
});

test("the documentation site builds with no errors or warnings", () => {
  const result = compileProject({ projectRoot: "site", write: false });
  assert.deepEqual(result.diagnostics.map((d) => `${d.code} ${d.span.file}:${d.span.start.line} ${d.message}`), []);
  const pages = result.files.filter((f) => f.path.endsWith("index.html")).map((f) => f.path).sort();
  assert.deepEqual(pages, [
    "errors/index.html", "fonts/index.html", "guide/data-and-state/index.html", "guide/getting-started/index.html", "guide/language-tour/index.html",
    "guide/server/index.html", "guide/tooling/index.html", "index.html", "paragraphs/index.html", "sentences/index.html",
  ]);
  const errors = String(result.files.find((f) => f.path === "errors/index.html").contents);
  assert.equal(errors.match(/>KDM\d{4}</g).length, JSON.parse(readFileSync("site/data/codes.json", "utf8")).length);
});
