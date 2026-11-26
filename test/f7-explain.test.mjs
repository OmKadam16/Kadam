import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { CODE_EXPLANATIONS, explainCode } from "../dist/core/diagnostics/explanations.js";

// F7: kadam explain.

const cli = (...args) => spawnSync(process.execPath, ["dist/cli/main.js", ...args], { encoding: "utf8" });

test("every diagnostic code the compiler can report has an explanation", () => {
  const source = readFileSync("src/core/diagnostics/diagnostic.ts", "utf8");
  const declared = [...new Set([...source.matchAll(/"(KDM\d{4})"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(CODE_EXPLANATIONS.map((entry) => entry.code), declared);
  for (const entry of CODE_EXPLANATIONS) {
    assert.ok(entry.meaning.length > 5 && !entry.meaning.includes("`"), entry.code);
    assert.ok(entry.reference.length > 0, entry.code);
  }
});

test("explainCode accepts KDM3005, kdm3005 and 3005", () => {
  for (const spelling of ["KDM3005", "kdm3005", " 3005 "]) assert.equal(explainCode(spelling)?.code, "KDM3005");
  assert.equal(explainCode("KDM0000"), undefined);
});

test("kadam explain prints one or more codes, lists them all, and rejects unknown ones", () => {
  const one = cli("explain", "KDM3051");
  assert.equal(one.status, 0);
  assert.equal(one.stdout, "KDM3051 (meaning)\n  Raw css sets a property Kadam has a sentence for (kadam 0.3, D-42)\n  Rules: language spec sections 5 to 12\n");
  const all = cli("explain");
  assert.equal(all.status, 0);
  assert.match(all.stdout, /\nSource text\n {2}KDM1001 {2}Unexpected character\n/);
  assert.equal(all.stdout.match(/^ {2}KDM\d{4}/gm).length, CODE_EXPLANATIONS.length);
  const json = JSON.parse(cli("explain", "KDM5008", "--json").stdout);
  assert.deepEqual(json.map((entry) => entry.code), ["KDM5008"]);
  const bad = cli("explain", "KDM3005", "nope");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown code or library component "nope"/);
});
