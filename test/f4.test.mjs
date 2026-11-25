import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { compileText } from "../dist/compiler/compile.js";
import { compileProject } from "../dist/compiler/project.js";

// kadam 0.3 frontend phase F4 step 1: interactions plain HTML does natively.
// Every page here must still ship zero JavaScript.

const codes = (result) => result.diagnostics.map((d) => d.code);
const messages = (result) => result.diagnostics.map((d) => d.message);
const html = (result) => String(result.files.find((f) => f.path === "index.html")?.contents ?? "");
const baseCss = (result) => String(result.files.find((f) => f.path === "assets/kadam.css")?.contents ?? "");

function page(body, { version = "0.3" } = {}) {
  const lines = [`kadam ${version}`, 'page "Home" {', ...body.map((l) => `    ${l}`), "}", ""];
  return compileText("home.kdm", lines.join("\n"));
}
const el = (name, kind, ...lines) => [`${name} {`, `    a ${kind}`, ...lines.map((l) => (l.startsWith("  ") ? `  ${l}` : `    ${l}`)), "}"];
const text = (value) => `the text says ${JSON.stringify(value)}`;
const nest = (lines) => lines.map((line) => `  ${line}`);

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "kadam-f4-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return compileProject({ projectRoot: dir });
}

test("F4 step 1 sentences are kadam 0.3 syntax", () => {
  for (const lines of [
    el("b1", "button", text("x"), 'when clicked, go to "b1"'),
    el("b1", "link", text("x"), 'when clicked, send an email to "a@b.com"'),
    el("c1", "card", 'when clicked, go to page "Home"'),
    el("f1", "text field", 'the label says "Email"', 'the error says "Required"'),
    el("q1", "expandable section", 'the title says "Q"'),
  ]) {
    assert.ok(codes(page(lines, { version: "0.1" })).includes("KDM2013") || codes(page(lines, { version: "0.1" })).includes("KDM3003"),
      lines.join(" / "));
  }
});

test("in-page links point at the named element's id", () => {
  const result = page([
    ...el("topLink", "link", text("Features"), 'when clicked, go to "features"'),
    ...el("features", "section", ...nest(el("h", "section heading", text("Features")))),
  ]);
  assert.deepEqual(codes(result), []);
  assert.match(html(result), /<a class="kdm-home-topLink kdm-kind-link" data-kdm-id="home-topLink" href="#home-features">Features<\/a>/);
  assert.match(html(result), /<section class="kdm-home-features kdm-kind-section" data-kdm-id="home-features" id="home-features" aria-labelledby="home-h">/);
  // Any kind can be a target, and an id is never written twice.
  const containerTarget = page([...el("l1", "link", text("x"), 'when clicked, go to "box"'), ...el("box", "container")]);
  assert.match(html(containerTarget), /<div class="kdm-home-box kdm-kind-container" data-kdm-id="home-box" id="home-box"><\/div>/);
  const headingTarget = page([...el("l1", "link", text("x"), 'when clicked, go to "h2x"'), ...el("h2x", "section heading", text("Top"))]);
  assert.equal(html(headingTarget).match(/ id="home-h2x"/g).length, 1);
  const missing = page(el("l1", "link", text("x"), 'when clicked, go to "nowhere"'));
  assert.deepEqual(codes(missing), ["KDM3012"]);
  assert.match(messages(missing)[0], /no element named "nowhere"/);
});

test("email, phone, and download links", () => {
  const result = page([
    ...el("mail", "link", text("Email us"), 'when clicked, send an email to "hello@acme.com"'),
    ...el("phone", "button", text("Call"), 'when clicked, call "+1 (555) 010-0100"'),
  ]);
  assert.deepEqual(codes(result), []);
  assert.match(html(result), /href="mailto:hello@acme\.com">Email us</);
  assert.match(html(result), /href="tel:\+15550100100">Call</);
  assert.ok(messages(page(el("m", "link", text("x"), 'when clicked, send an email to "not an email"'))).some((m) => /email address/.test(m)));
  assert.ok(messages(page(el("m", "link", text("x"), 'when clicked, call "call me"'))).some((m) => /phone link/.test(m)));

  const files = project({
    "kadam.json": JSON.stringify({ kadam: "0.3", name: "t", pages: [{ source: "home.kdm", route: "/" }] }),
    "home.kdm": 'page "Home" {\n    guide {\n        a button\n        the text says "Get the guide"\n        when clicked, download "assets/guide.pdf"\n    }\n}\n',
    "assets/guide.pdf": "%PDF",
  });
  assert.deepEqual(files.diagnostics.map((d) => d.message), []);
  assert.ok(files.files.some((f) => f.path === "assets/guide.pdf"));
  assert.match(String(files.files.find((f) => f.path === "index.html").contents), /href="\/assets\/guide\.pdf" download>Get the guide</);
  const wrongType = project({
    "kadam.json": JSON.stringify({ kadam: "0.3", name: "t", pages: [{ source: "home.kdm", route: "/" }] }),
    "home.kdm": 'page "Home" {\n    guide {\n        a button\n        the text says "x"\n        when clicked, download "assets/run.exe"\n    }\n}\n',
    "assets/run.exe": "MZ",
  });
  assert.ok(wrongType.diagnostics.some((d) => d.severity === "error"));
});

test("a clickable card is one link and cannot hold other interactive elements", () => {
  const result = page(el("plan", "card", 'when clicked, go to page "Home"', ...nest(el("t", "paragraph", text("Pro plan")))));
  assert.deepEqual(codes(result), []);
  assert.match(html(result), /<a class="kdm-home-plan kdm-kind-card" data-kdm-id="home-plan" href="\/">\n {6}<p [^>]*>Pro plan<\/p>\n {4}<\/a>/);
  assert.match(baseCss(result), /a\.kdm-kind-card,\na\.kdm-kind-container \{\n  color: inherit;\n  text-decoration: none;/);
  const nested = page(el("plan", "card", 'when clicked, go to page "Home"', ...nest(el("b", "button", text("Buy")))));
  assert.deepEqual(codes(nested), ["KDM3010"]);
  assert.match(messages(nested)[0], /cannot contain b, which is interactive/);
  // Other containers still cannot be clicked.
  assert.equal(codes(page(el("sec1", "section", 'when clicked, go to page "Home"', ...nest(el("h", "section heading", text("x"))))))[0], "KDM3003");
});

test("an expandable section is details and summary, closed unless it starts open", () => {
  const result = page([
    ...el("q1", "expandable section", 'the title says "What is Kadam?"', ...nest(el("a1", "paragraph", text("A language.")))),
    ...el("q2", "expandable section", 'the title says "Is it free?"', "it starts open", ...nest(el("a2", "paragraph", text("Yes.")))),
  ]);
  assert.deepEqual(codes(result), []);
  assert.match(html(result), /<details class="kdm-home-q1 kdm-kind-expandable-section" data-kdm-id="home-q1">\n {6}<summary class="kdm-expandable-title">What is Kadam\?<\/summary>\n {6}<div class="kdm-expandable-body">\n {8}<p /);
  assert.match(html(result), /<details [^>]*data-kdm-id="home-q2" open>/);
  assert.match(baseCss(result), /\.kdm-expandable-title \{\n  cursor: pointer;/);
  assert.deepEqual(codes(page(el("q", "expandable section"))), ["KDM3009"]);
  assert.equal(codes(page(el("q", "container", 'the title says "x"')))[0], "KDM3003");
});

test("field errors are described and shown only once the field is invalid", () => {
  const result = page(el("emailField", "text field", 'the label says "Email"', "it accepts email addresses", "it is required",
    'the error says "Enter a valid email address"'));
  assert.deepEqual(codes(result), []);
  assert.match(html(result), /<input [^>]*aria-describedby="home-emailField-input-error">\n {6}<p class="kdm-field-error" id="home-emailField-input-error">Enter a valid email address<\/p>/);
  assert.match(baseCss(result), /\.kdm-field-error \{\n  display: none;/);
  assert.match(baseCss(result), /\.kdm-field-input:user-invalid ~ \.kdm-field-error \{\n  display: block;/);
  assert.equal(codes(page(el("c", "checkbox", 'the label says "x"', 'the error says "y"')))[0], "KDM3003");
});

test("F4 step 1 pages ship no JavaScript", () => {
  const result = page([
    ...el("q1", "expandable section", 'the title says "Q"', ...nest(el("a1", "paragraph", text("A")))),
    ...el("l1", "link", text("Top"), 'when clicked, go to "q1"'),
  ]);
  assert.ok(result.files.every((file) => !file.path.endsWith(".js")));
  assert.doesNotMatch(html(result), /<script/);
});
