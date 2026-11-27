import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { PROJECT_TEMPLATES } from "../dist/cli/templates.generated.js";
import { compileProject } from "../dist/compiler/project.js";

// F7: kadam new.

const cli = (...args) => spawnSync(process.execPath, ["dist/cli/main.js", ...args], { encoding: "utf8" });

test("the generated templates match the reference projects", () => {
  const before = readFileSync("src/cli/templates.generated.ts", "utf8");
  const run = spawnSync(process.execPath, ["scripts/generate-templates.mjs"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync("src/cli/templates.generated.ts", "utf8"), before, "run node scripts/generate-templates.mjs");
});

test("every template creates a project that builds without errors", () => {
  const root = mkdtempSync(join(tmpdir(), "kadam-new-"));
  for (const template of PROJECT_TEMPLATES) {
    const dir = join(root, `My ${template.name} Site`);
    const run = cli("new", dir, "--template", template.name);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp(`from the ${template.name} template`));
    assert.match(run.stdout, /kadam dev\n$/);
    // A kadam 0.4 template needs no kadam.json: its pages folder is the site.
    if (template.files["kadam.json"] !== undefined) {
      const manifest = JSON.parse(readFileSync(join(dir, "kadam.json"), "utf8"));
      assert.equal(manifest.name, `my-${template.name}-site`);
    }
    const result = compileProject({ projectRoot: dir, write: false });
    assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message), [], template.name);
  }
});

test("kadam new lists templates, defaults to minimal, and never writes into a non-empty directory", () => {
  const list = cli("new", "--list");
  assert.equal(list.status, 0);
  assert.equal(list.stdout.trim().split("\n").length, PROJECT_TEMPLATES.length);
  const root = mkdtempSync(join(tmpdir(), "kadam-new-"));
  const plain = cli("new", join(root, "plain"));
  assert.equal(plain.status, 0);
  assert.match(plain.stdout, /from the minimal template \(2 files\)/);
  const busy = join(root, "busy");
  mkdirSync(busy);
  writeFileSync(join(busy, "notes.txt"), "keep me");
  const refused = cli("new", busy);
  assert.equal(refused.status, 1);
  assert.equal(readFileSync(join(busy, "notes.txt"), "utf8"), "keep me");
  assert.equal(cli("new", join(root, "x"), "--template", "wordpress").status, 2);
  assert.equal(cli("new").status, 2);
});
