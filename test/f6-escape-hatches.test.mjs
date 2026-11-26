import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileText } from "../dist/compiler/compile.js";
import { compileProject } from "../dist/compiler/project.js";

// F6 (D-42): escape hatches.

const codes = (result) => result.diagnostics.map((d) => d.code);
const fileText = (result, path) => String(result.files?.find((f) => f.path === path)?.contents ?? "");
function page(body, version = "0.3") {
  return compileText("home.kdm", [`kadam ${version}`, 'page "Home" {', ...body.map((l) => `    ${l}`), "}", ""].join("\n"));
}
function box(...lines) {
  return ["box {", "    a container", ...lines.map((l) => `    ${l}`), "}"];
}

function project(body, { css = ".legacy-hero { color: red }\n", manifest = {}, files = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kadam-f6-"));
  mkdirSync(join(root, "pages"));
  mkdirSync(join(root, "styles"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "styles", "legacy.css"), css);
  for (const [path, contents] of Object.entries(files)) writeFileSync(join(root, path), contents);
  writeFileSync(join(root, "pages", "home.kdm"), ["kadam 0.3", "", 'page "Home" {', ...body.map((l) => `    ${l}`), "}", ""].join("\n"));
  writeFileSync(join(root, "kadam.json"), JSON.stringify({
    kadam: "0.3", name: "f6", pages: [{ source: "pages/home.kdm", route: "/" }],
    stylesheets: ["styles/legacy.css"], ...manifest,
  }));
  return compileProject({ projectRoot: root, write: false });
}

test("the css sets one declaration on the element, in any scope", () => {
  const result = page(box(
    'the css "clip-path" is "circle(40%)"',
    'on phones, the css "clip-path" is "none"',
    'in dark mode, the css "mix-blend-mode" is "screen"',
  ));
  assert.deepEqual(codes(result), []);
  const css = fileText(result, "assets/kadam.home.css");
  assert.match(css, /\.kdm-home-box \{\n {2}clip-path: circle\(40%\);\n\}/);
  assert.match(css, /@media \(max-width: 599px\) \{\n {2}\.kdm-home-box \{\n {4}clip-path: none;/);
  assert.match(css, /mix-blend-mode: screen;/);
});

test("the css is kadam 0.3 and rejects what Kadam already has a sentence for", () => {
  assert.ok(codes(page(box('the css "clip-path" is "circle(40%)"'), "0.1")).includes("KDM2013"));
  const color = page(box('the css "color" is "red"'));
  assert.deepEqual(codes(color), ["KDM3051"]);
  assert.equal(color.diagnostics[0].hint, "write: the text is #1F2937");
  assert.deepEqual(codes(page(box('the css "padding-top" is "4px"'))), ["KDM3051"]);
  assert.deepEqual(codes(page(box('the css "border-left-color" is "red"'))), ["KDM3051"]);
  // Two values for one property conflict like any other statement.
  assert.ok(codes(page(box('the css "clip-path" is "none"', 'the css "clip-path" is "circle(4%)"'))).length > 0);
});

test("the css value cannot break out of its declaration or load other sites", () => {
  for (const value of [
    "red; color: blue", "x } body { color: red", "url(https://evil.example/x.svg)", "url(//evil.example/x)",
    "url(../secret.svg)", "url(/abs.svg)", "expression(alert(1))", "url(javascript:alert(1))", "none !important", "@import x",
    "url(assets/a.svg",
  ]) {
    assert.deepEqual(codes(page(box(`the css "mask-image" is "${value}"`))), ["KDM3050"], value);
  }
  assert.deepEqual(codes(page(box('the css "--brand" is "red"'))), ["KDM3050"]);
  assert.deepEqual(codes(page(box('the css "Mask-Image" is "none"'))), ["KDM3050"]);
});

test("a url() in the css is copied and rewritten to the asset address", () => {
  const result = project(box('the css "mask-image" is "url(assets/fade.svg)"'), { files: { "assets/fade.svg": "<svg/>" } });
  assert.deepEqual(codes(result), []);
  assert.match(fileText(result, "assets/kadam.home.css"), /mask-image: url\("\/assets\/fade\.svg"\);/);
  assert.ok(result.files.some((f) => f.path === "assets/fade.svg"));
  const missing = project(box('the css "mask-image" is "url(assets/gone.svg)"'));
  assert.deepEqual(codes(missing), ["KDM4003"]);
});

test("an existing stylesheet class is checked, linked first and copied", () => {
  const result = project(box('it also uses the class "legacy-hero" from "styles/legacy.css"'));
  assert.deepEqual(codes(result), []);
  const html = fileText(result, "index.html");
  assert.match(html, /class="kdm-home-box kdm-kind-container legacy-hero"/);
  assert.ok(html.indexOf('href="/styles/legacy.css"') < html.indexOf('href="/assets/kadam.css"'));
  assert.ok(html.indexOf('href="/styles/legacy.css"') > 0);
  assert.equal(fileText(result, "styles/legacy.css"), ".legacy-hero { color: red }\n");
});

test("a class must exist in a listed stylesheet", () => {
  const typo = project(box('it also uses the class "legacy-hro" from "styles/legacy.css"'));
  assert.deepEqual(codes(typo), ["KDM3052"]);
  assert.match(typo.diagnostics[0].message, /not in styles\/legacy\.css/);
  // A longer class name or a commented-out rule does not count.
  assert.deepEqual(codes(project(box('it also uses the class "hero" from "styles/legacy.css"'), { css: ".hero-x {}\n/* .hero {} */\n" })), ["KDM3052"]);
  const unlisted = project(box('it also uses the class "legacy-hero" from "styles/other.css"'));
  assert.deepEqual(codes(unlisted), ["KDM3052"]);
  assert.deepEqual(codes(page(box('it also uses the class "legacy-hero" from "styles/legacy.css"'))), ["KDM3052"]);
  assert.deepEqual(codes(page(box('it also uses the class "kdm-home-box" from "styles/legacy.css"'))), ["KDM3052"]);
  // An unused stylesheet is not copied or linked.
  const unused = project(box('the css "clip-path" is "none"'));
  assert.ok(!unused.files.some((f) => f.path === "styles/legacy.css"));
  assert.doesNotMatch(fileText(unused, "index.html"), /legacy\.css/);
});

test("stylesheets in kadam.json need kadam 0.3 and .css paths", () => {
  assert.ok(codes(project(box(), { manifest: { stylesheets: ["styles/legacy.txt"] } })).includes("KDM4001"));
  assert.ok(codes(project(box(), { manifest: { stylesheets: ["../x.css"] } })).includes("KDM4001"));
});

const EXTERNAL = 'external track from "analytics.js" takes text and a number and returns nothing';
function button(...effects) {
  return ["b1 {", "    a button", '    the text says "Go"', "    it remembers clicks, a number that starts as 0", "    it remembers label, a text that starts as \"x\"",
    ...effects.map((e) => `    when clicked, ${e}`), "}"];
}

test("an external call is type-checked against its declaration", () => {
  assert.deepEqual(codes(page([EXTERNAL, ...button('call track with "hero", clicks')])), []);
  assert.deepEqual(codes(page([EXTERNAL, ...button("call track with label, 3")])), []);
  const few = page([EXTERNAL, ...button('call track with "hero"')]);
  assert.deepEqual(codes(few), ["KDM3005"]);
  assert.equal(few.diagnostics[0].message, "track takes 2 values, but this call passes 1 value");
  assert.equal(few.diagnostics[0].hint, "pass text and a number");
  assert.match(page([EXTERNAL, ...button("call track with 3, 4")]).diagnostics[0].message, /value 1 of track must be text/);
  assert.match(page([EXTERNAL, ...button('call track with "a", label')]).diagnostics[0].message, /needs a number state, but label is a text/);
  assert.deepEqual(codes(page(button("call track"))), ["KDM3012"]);
  assert.deepEqual(codes(page([EXTERNAL, ...button('call track with "a", nothing1')])), ["KDM3012"]);
});

test("external declarations go in the page body, once, from a local .js file", () => {
  assert.deepEqual(codes(page([EXTERNAL, EXTERNAL, ...button('call track with "a", 1')])), ["KDM3002"]);
  assert.deepEqual(codes(page(["box {", "    a container", `    ${EXTERNAL}`, "}"])), ["KDM3003"]);
  for (const file of ["https://cdn.example/a.js", "../a.js", "/a.js", "a.ts"]) {
    assert.deepEqual(codes(page([`external track from "${file}" takes text and returns nothing`])), ["KDM3005"], file);
  }
  assert.deepEqual(codes(page(['external track from "a.js" takes colors and returns nothing'])), ["KDM3005"]);
  assert.deepEqual(codes(page(['external track from "a.js" takes text'])), ["KDM3005"]);
  assert.ok(codes(page([EXTERNAL], "0.1")).includes("KDM2013"));
});

test("a phone link still uses call with a quoted number", () => {
  const result = page(["b1 {", "    a link", '    the text says "Phone"', '    when clicked, call "+1 555 0100"', "}"]);
  assert.deepEqual(codes(result), []);
  assert.match(fileText(result, "index.html"), /href="tel:\+15550100"/);
});

test("an external call runs from the page runtime, and its module is copied", () => {
  const result = project([EXTERNAL, ...button('add 1 to clicks and call track with "hero", clicks')], { files: { "analytics.js": "export function track() {}\n" } });
  assert.deepEqual(codes(result), []);
  const js = fileText(result, "assets/kadam.home.js");
  assert.match(js, /const externals = \["\/analytics\.js"\];/);
  assert.match(js, /\["call",0,"track",\[\[0,"hero"\],\[1,"home-b1\.clicks"\]\]\]/);
  assert.match(js, /import\(externals\[effect\[1\]\]\)/);
  assert.doesNotMatch(js, /eval|innerHTML|new Function/);
  assert.equal(fileText(result, "analytics.js"), "export function track() {}\n");
  assert.deepEqual(codes(project([EXTERNAL])), ["KDM4003"]);
});

test("escape hatches are listed, and strict mode bans them", () => {
  const body = [EXTERNAL, ...button('call track with "a", 1'), ...box('the css "clip-path" is "none"', 'it also uses the class "legacy-hero" from "styles/legacy.css"')];
  const files = { "analytics.js": "export function track() {}\n" };
  const result = project(body, { files });
  assert.deepEqual(codes(result), []);
  assert.deepEqual(result.escapeHatches.map((h) => `${h.kind} ${h.detail} ${h.span.start.line}`), [
    "external track 4", "css clip-path 14", "class legacy-hero 15",
  ]);
  assert.deepEqual(codes(project(body, { files, manifest: { strict: true } })), ["KDM3053", "KDM3053", "KDM3053"]);
  assert.ok(codes(project(body, { files, manifest: { strict: "yes" } })).includes("KDM4001"));
  assert.deepEqual(codes(page(box('the css "clip-path" is "none"'))), []);
  assert.equal(page(box('the css "clip-path" is "none"')).escapeHatches.length, 1);
});
