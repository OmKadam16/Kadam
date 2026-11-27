import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// D-50: kadam fix applies the fixes the checker offers; it never guesses.

const cli = (...args) => spawnSync(process.execPath, ["dist/cli/main.js", ...args], { encoding: "utf8" });
function site(text) {
  const root = mkdtempSync(join(tmpdir(), "kadam-fix-"));
  mkdirSync(join(root, "pages"));
  writeFileSync(join(root, "pages", "home.kdm"), text);
  return root;
}

test("kadam check shows numbered fixes worded as sentences", () => {
  const root = site('kadam 0.4\n\nA big haeding says "Hi".\nA big blck button says "Go". It has rounded cornrs. It wobbels.\n');
  const run = cli("check", root);
  assert.equal(run.status, 1);
  assert.match(run.stderr + run.stdout, /I don't know "haeding" in: A big haeding says "Hi"\n[\s\S]*= fix 1: A big heading says "Hi"/);
  assert.match(run.stderr + run.stdout, /= fix 1: A big black button says "Go"\n(?![^\n]*fix 2)/);
  assert.match(run.stderr + run.stdout, /I don't know the sentence: It has rounded cornrs\n[\s\S]*?= fix 1: It has rounded corners/);
  // A sentence with nothing close has no fixes, only the hint.
  assert.match(run.stderr + run.stdout, /I don't know the sentence: It wobbels\n(?:(?!fix 1)[\s\S])*?(?:\n\n|$)/);
});

test("kadam fix --first takes fix 1 everywhere and leaves what it cannot fix", () => {
  const root = site('kadam 0.4\n\nA big haeding says "Hi".\nA big blck button says "Go". It has rounded cornrs. It wobbels.\n');
  const run = cli("fix", root, "--first");
  assert.equal(run.status, 1);
  assert.match(run.stdout, /pages\/home\.kdm:4: It has rounded corners\n {2}pages\/home\.kdm:4: A big black button says "Go"\n {2}pages\/home\.kdm:3: A big heading says "Hi"\nkadam fix: 1 problem has no fix to offer/);
  assert.equal(readFileSync(join(root, "pages", "home.kdm"), "utf8"), 'kadam 0.4\n\nA big heading says "Hi".\nA big black button says "Go". It has rounded corners. It wobbels.\n');
  const clean = site('kadam 0.4\n\nA big heading says "Hi".\n');
  assert.match(cli("fix", clean, "--first").stdout, /nothing to fix/);
});

test("without a terminal or --first, kadam fix only lists the fixes", () => {
  const root = site('kadam 0.4\n\nA big blck button says "Go".\n');
  const run = cli("fix", root);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /fix 1: A big black button says "Go"[\s\S]*use --first/);
  assert.match(readFileSync(join(root, "pages", "home.kdm"), "utf8"), /blck/, "nothing is changed");
});
