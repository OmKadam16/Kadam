import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseText } from "../dist/core/parser/parser.js";
import { compileText } from "../dist/compiler/compile.js";
import { compileProject } from "../dist/compiler/project.js";
import { lex } from "../dist/core/lexer/lexer.js";
import { createSourceFile } from "../dist/core/source/source-file.js";
import { matchLine, STATEMENT_TEMPLATES } from "../dist/core/parser/registry.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const codes = (result) => result.diagnostics.map((d) => d.code);

function tokensFor(line) {
  return lex(createSourceFile("inline.kdm", line).source).tokens.filter(
    (t) => t.kind !== "newline" && t.kind !== "eof" && t.kind !== "comment",
  );
}

/** A fake 0.3-only template: `it glows`. Injected; never part of the real table. */
const GLOW = {
  id: "test-glow",
  description: "Glow effect",
  examples: ["it glows"],
  since: "0.3",
  match: (tokens) =>
    tokens.length === 2 && tokens[0].text === "it" && tokens[1].text === "glows"
      ? { statement: { type: "test-glow", span: tokens[0].span }, diagnostics: [] }
      : null,
};
const TABLE = [...STATEMENT_TEMPLATES, GLOW];

test("kadam 0.3 is an accepted directive; unknown versions are rejected", () => {
  const ok = parseText("a.kdm", 'kadam 0.3\npage "P" {\n}\n');
  assert.deepEqual(codes(ok), []);
  const bad = parseText("b.kdm", 'kadam 0.4\npage "P" {\n}\n');
  assert.deepEqual(codes(bad), ["KDM4004"]);
  assert.match(bad.diagnostics[0].message, /0\.1 and 0\.3/);
});

test("a template newer than the file version is claimed and rejected with KDM2013", () => {
  const old = matchLine(tokensFor("it glows"), { allowResponsive: true, languageVersion: "0.1" }, TABLE);
  // The statement is kept (no misleading follow-on errors); the error blocks output.
  assert.equal(old.selected?.body.statement?.type, "test-glow");
  assert.deepEqual(old.diagnostics.map((d) => d.code), ["KDM2013"]);
  assert.match(old.diagnostics[0].message, /glow effect requires kadam 0\.3; this file is kadam 0\.1/);

  const current = matchLine(tokensFor("it glows"), { allowResponsive: true, languageVersion: "0.3" }, TABLE);
  assert.equal(current.selected?.body.statement?.type, "test-glow");
  assert.deepEqual(current.diagnostics, []);

  // Tooling default (no version) sees the newest vocabulary.
  assert.equal(matchLine(tokensFor("it glows"), { allowResponsive: true }, TABLE).selected?.template.id, "test-glow");
});

test("version gating also applies inside a responsive scope", () => {
  const scoped = matchLine(
    tokensFor("on phones, it glows"),
    { allowResponsive: true, languageVersion: "0.1" },
    TABLE,
  );
  assert.ok(scoped.diagnostics.map((d) => d.code).includes("KDM2013"));
});

test("every 0.1 template stays 0.1; only frontend-track templates are 0.3", () => {
  const newer = STATEMENT_TEMPLATES.filter((t) => (t.since ?? "0.1") !== "0.1").map((t) => t.id);
  assert.deepEqual(newer.sort(), [
    "caption", "captions", "f1-field-type", "f1-state", "form-action", "media-source",
    "no-speech", "options", "page-metadata", "poster", "property", "submit", "text-span",
  ]);
});

test("a kadam 0.1 page compiles byte-identically when declared kadam 0.3", () => {
  const text = readFileSync(join(root, "examples/hello.kdm"), "utf8");
  const body = text.replace(/^kadam 0\.1\s*\n/m, "");
  const v01 = compileText("hello.kdm", `kadam 0.1\n${body}`);
  const v03 = compileText("hello.kdm", `kadam 0.3\n${body}`);
  assert.ok(v01.ok && v03.ok);
  assert.deepEqual(
    v03.files.map((f) => [f.path, f.contents]),
    v01.files.map((f) => [f.path, f.contents]),
  );
});

test("kadam.json accepts 0.3 and rejects the core version 0.2", () => {
  const make = (version) => {
    const dir = mkdtempSync(join(tmpdir(), "kadam-version-"));
    const write = (path, contents) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), contents);
    };
    write("kadam.json", JSON.stringify({ kadam: version, name: "V", pages: [{ source: "home.kdm", route: "/" }] }));
    write("home.kdm", 'page "Home" {\n    t1 {\n        a paragraph\n        the text says "hi"\n    }\n}\n');
    return compileProject({ projectRoot: dir });
  };
  assert.equal(make("0.3").ok, true);
  const core = make("0.2");
  assert.equal(core.ok, false);
  assert.ok(core.diagnostics.some((d) => d.code === "KDM4004"));
});

test("in a project, a file directive must match the manifest version", () => {
  const dir = mkdtempSync(join(tmpdir(), "kadam-mismatch-"));
  writeFileSync(join(dir, "kadam.json"), JSON.stringify({ kadam: "0.1", name: "M", pages: [{ source: "home.kdm", route: "/" }] }));
  writeFileSync(join(dir, "home.kdm"), 'kadam 0.3\npage "Home" {\n}\n');
  const result = compileProject({ projectRoot: dir });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === "KDM4004" && /declares kadam 0\.3 but kadam\.json declares 0\.1/.test(d.message)));
});

test("a version-gated kind does not also report a missing kind sentence", () => {
  const result = parseText("t.kdm", 'kadam 0.1\npage "P" {\n    t1 {\n        a header\n    }\n}\n');
  assert.deepEqual(codes(result), ["KDM2013"]);
});
