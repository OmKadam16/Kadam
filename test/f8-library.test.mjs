import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { compileProject, libraryComponentNames } from "../dist/compiler/project.js";

// D-46: the standard component library.

const ROOT = "test/fixtures/library-site";
const MANIFEST = JSON.parse(readFileSync(`${ROOT}/kadam.json`, "utf8"));
const cli = (...args) => spawnSync(process.execPath, ["dist/cli/main.js", ...args], { encoding: "utf8" });
const build = (manifest = MANIFEST, overrides = new Map()) => compileProject({ projectRoot: ROOT, manifestText: JSON.stringify(manifest), sourceOverrides: overrides });
const codes = (result) => result.diagnostics.map((d) => d.code);
const file = (result, path) => String(result.files.find((f) => f.path === path)?.contents ?? "");

test("every library component builds, with no warnings, from the package", () => {
  const result = build();
  assert.deepEqual(result.diagnostics.map((d) => `${d.code} ${d.message}`), []);
  assert.deepEqual(libraryComponentNames(), ["Banner", "Card", "Feature", "FeatureGrid", "Hero", "NavBar", "PageFooter", "PricingPlan", "PricingTable", "Question", "Questions", "Testimonial"]);
  for (const name of libraryComponentNames()) assert.ok(MANIFEST.components[0].use.includes(name), `the fixture uses ${name}`);
  const home = file(result, "index.html");
  assert.match(home, /<h1 class="kdm-c-kadam-Hero-centered-title1-[a-z0-9]+ kdm-kind-main-heading"[^>]*>Ship pages you can read<\/h1>/);
  assert.match(home, /<a class="kdm-c-kadam-Hero-centered-action1[^"]*"[^>]*href="\/pricing\/"/);
  // Library sources are not project files, so the dev server does not watch them.
  assert.ok(result.sources.some((source) => source.path === "kadam/Card.kdm"));
});

test("component parameters fill quoted text in every kind of statement", () => {
  const pricing = file(build(), "pricing/index.html");
  assert.match(pricing, /<summary class="kdm-expandable-title">Can I change plans\?<\/summary>/);
  assert.doesNotMatch(pricing, /\{\$/);
});

test("library entries are checked", () => {
  const withUse = (use) => ({ ...MANIFEST, components: [{ library: "kadam", use }] });
  const unknown = build(withUse([...MANIFEST.components[0].use, "Carousel"]));
  assert.ok(codes(unknown).includes("KDM4009"));
  assert.match(unknown.diagnostics.find((d) => d.code === "KDM4009").hint, /library components: Banner, Card/);
  assert.ok(codes(build(withUse(["Card", "Card"]))).includes("KDM4008"));
  assert.ok(codes(build({ ...MANIFEST, components: [{ library: "other", use: ["Card"] }] })).includes("KDM4009"));
  assert.ok(codes(build({ ...MANIFEST, components: [...MANIFEST.components, { source: "components/X.kdm", namespace: "kadam" }] })).includes("KDM4009"));
  // A page that names a library component it did not list is told so.
  assert.ok(build(withUse(MANIFEST.components[0].use.filter((name) => name !== "Banner"))).diagnostics.some((d) => d.severity === "error"));
});

test("kadam explain describes a library component; kadam eject copies it into the project", () => {
  const explained = cli("explain", "PricingPlan");
  assert.equal(explained.status, 0, explained.stderr);
  assert.match(explained.stdout, /^PricingPlan \(the kadam library\)\n {2}One plan in a pricing table\./);
  assert.match(explained.stdout, /period {7}text, defaulting to "per month"/);
  assert.match(explained.stdout, /Variants: featured/);
  assert.match(explained.stdout, /Slots: content \(unnamed\)/);
  assert.match(cli("explain", "--library").stdout, /^ {2}Banner {9}A one-line notice/);
  assert.equal(cli("explain", "Carousel").status, 2);

  const dir = mkdtempSync(join(tmpdir(), "kadam-eject-"));
  cpSync(ROOT, dir, { recursive: true });
  const ejected = cli("eject", "Card", "-p", dir);
  assert.equal(ejected.status, 0, ejected.stderr);
  assert.match(ejected.stdout, /components\/Card\.kdm\n {2}kadam\.json\n {2}pages\/pricing\.kdm/);
  assert.ok(existsSync(join(dir, "components", "Card.kdm")));
  const manifest = JSON.parse(readFileSync(join(dir, "kadam.json"), "utf8"));
  assert.ok(!manifest.components[0].use.includes("Card"));
  assert.ok(manifest.components.includes("components/Card.kdm"));
  assert.match(readFileSync(join(dir, "pages", "pricing.kdm"), "utf8"), /^ {8}a Card\n/m);
  const after = compileProject({ projectRoot: dir });
  assert.deepEqual(after.diagnostics.filter((d) => d.severity === "error"), []);
  assert.equal(cli("eject", "Card", "-p", dir).status, 2, "an existing copy is never overwritten");
});
