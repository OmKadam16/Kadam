import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { compileText } from "../dist/compiler/compile.js";
import { compileProject } from "../dist/compiler/project.js";

// kadam 0.3 frontend phase F1: elements, structure, text, media, forms, metadata.

const codes = (result) => result.diagnostics.map((d) => d.code);
const errors = (result) => result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
const html = (result) => String(result.files.find((f) => f.path === "index.html")?.contents ?? "");
const baseCss = (result) => String(result.files.find((f) => f.path === "assets/kadam.css")?.contents ?? "");

/** Build a page from element blocks given as arrays of lines. */
function page(body, { version = "0.3", settings = [] } = {}) {
  const lines = [`kadam ${version}`, 'page "Home" {', ...settings.map((s) => `    ${s}`), ...body.map((l) => `    ${l}`), "}", ""];
  return compileText("home.kdm", lines.join("\n"));
}
const el = (name, kind, ...lines) => [`${name} {`, `    a ${kind}`, ...lines.map((l) => (l.startsWith("  ") ? `  ${l}` : `    ${l}`)), "}"];
const text = (value) => `the text says ${JSON.stringify(value)}`;

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "kadam-f1-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return compileProject({ projectRoot: dir });
}

test("every F1 kind is kadam 0.3 syntax", () => {
  for (const kind of ["header", "section", "list", "table", "video", "icon", "code block", "form", "checkbox", "small heading"]) {
    const result = page(el("x1", kind), { version: "0.1" });
    assert.ok(codes(result).includes("KDM2013"), kind);
    assert.match(result.diagnostics.find((d) => d.code === "KDM2013").message, /requires kadam 0\.3/);
  }
});

test("new vocabulary is not reserved, so existing 0.1 element names stay valid", () => {
  const result = page(el("list", "paragraph", text("x")).concat(el("table", "container")), { version: "0.1" });
  assert.deepEqual(codes(result), []);
});

test("a page-level header and footer are emitted outside main", () => {
  const result = page([
    ...el("topBar", "header", ...el("t", "paragraph", text("Top"))),
    ...el("body1", "paragraph", text("Body")),
    ...el("endBar", "footer", ...el("e", "paragraph", text("End"))),
  ]);
  assert.deepEqual(codes(result), []);
  assert.match(html(result), /<body>\n  <header [^>]*>[\s\S]*<\/header>\n  <main class="kdm-page">\n    <p [^>]*>Body<\/p>\n  <\/main>\n  <footer [^>]*>[\s\S]*<\/footer>\n<\/body>/);
});

test("a section is labelled by its first heading and requires one", () => {
  const labelled = page(el("s1", "section", ...el("h", "section heading", text("Plans"))));
  assert.match(html(labelled), /<section [^>]*aria-labelledby="home-h">/);
  assert.match(html(labelled), /<h2 [^>]*id="home-h">Plans<\/h2>/);
  assert.deepEqual(errors(page(el("s1", "section", ...el("p", "paragraph", text("x"))))), ["KDM3009"]);
});

test("landmark kinds map to their HTML elements", () => {
  const result = page([
    ...el("a1", "article", ...el("h", "section heading", text("A"))),
    ...el("side1", "sidebar"),
  ]);
  assert.match(html(result), /<article class="kdm-home-a1 kdm-kind-article"/);
  assert.match(html(result), /<aside class="kdm-home-side1 kdm-kind-sidebar"/);
});

test("lists and tables enforce their structure", () => {
  const list = page(el("l1", "numbered list", ...el("i1", "list item", text("One"))));
  assert.match(html(list), /<ol [^>]*>\n      <li [^>]*>One<\/li>\n    <\/ol>/);

  assert.deepEqual(errors(page(el("l1", "list", ...el("p1", "paragraph", text("x"))))), ["KDM3010"]);
  assert.deepEqual(errors(page(el("i1", "list item", text("x")))), ["KDM3010"]);

  const table = page(el(
    "t1", "table", 'the caption says "Plans"',
    ...el("hr1", "header row", ...el("hc", "cell", text("Plan"))),
    ...el("r1", "row", ...el("c", "cell", text("Free"))),
  ));
  assert.deepEqual(codes(table), []);
  assert.match(html(table), /<caption>Plans<\/caption>\n      <thead>\n        <tr [^>]*>\n          <th [^>]*scope="col">Plan<\/th>/);
  assert.match(html(table), /<tbody>\n        <tr [^>]*>\n          <td [^>]*>Free<\/td>/);

  const noCaption = page(el("t1", "table", ...el("r1", "row", ...el("c", "cell", text("x")))));
  assert.deepEqual(errors(noCaption), ["KDM3009"]);
  const lateHeader = page(el(
    "t1", "table", 'the caption says "x"',
    ...el("r1", "row", ...el("c", "cell", text("x"))),
    ...el("hr1", "header row", ...el("hc", "cell", text("x"))),
  ));
  assert.deepEqual(errors(lateHeader), ["KDM3010"]);
});

test("line breaks and inline spans render only in kadam 0.3", () => {
  const body = el(
    "p1", "paragraph", text("Read the guide, fast.\nDone."),
    'the words "guide" go to page "Home"',
    'the word "fast" is bold',
  );
  const result = page(body);
  assert.deepEqual(codes(result), []);
  assert.match(html(result), />Read the <a class="kdm-inline-link" href="\/">guide<\/a>, <strong>fast<\/strong>\.<br>Done\.<\/p>/);
  assert.match(baseCss(result), /\.kdm-inline-link \{/);

  // A 0.1 page keeps its exact output for a \n escape.
  const old = page(el("p1", "paragraph", text("a\nb")), { version: "0.1" });
  assert.match(html(old), />a\nb<\/p>/);
});

test("inline spans are checked against the text", () => {
  const missing = page(el("p1", "paragraph", text("Hello"), 'the words "bye" are bold'));
  assert.deepEqual(errors(missing), ["KDM3005"]);
  const twice = page(el("p1", "paragraph", text("go go"), 'the words "go" are bold'));
  assert.match(twice.diagnostics[0].message, /appear 2 times/);
  const overlap = page(el("p1", "paragraph", text("big red dog"), 'the words "big red" are bold', 'the words "red dog" are italic'));
  assert.deepEqual(errors(overlap), ["KDM3005"]);
  const unknownPage = page(el("p1", "paragraph", text("docs"), 'the words "docs" go to page "Nowhere"'));
  assert.deepEqual(errors(unknownPage), ["KDM3007"]);
  const external = page(el("p1", "paragraph", text("see source"), 'the words "source" open "https://example.com" in a new tab'));
  assert.match(html(external), /href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">source<\/a>/);
});

test("a code block preserves whitespace and escapes markup", () => {
  const result = page(el("c1", "code block", text("<b>\n  x</b>")));
  assert.match(html(result), /<pre [^>]*><code>&lt;b&gt;\n  x&lt;\/b&gt;<\/code><\/pre>/);
  // It scrolls sideways, so keyboard users can focus it.
  assert.match(html(result), /<pre [^>]*tabindex="0"><code>/);
});

test("video needs a source and captions or an explicit no-speech marker", () => {
  const ok = page(el("v1", "video", 'it plays "assets/intro.mp4"', 'the captions are "assets/intro.vtt"', 'the poster is "assets/p.jpg"'));
  assert.deepEqual(codes(ok), []);
  assert.match(html(ok), /<video [^>]*src="\/assets\/intro\.mp4" controls preload="metadata" poster="\/assets\/p\.jpg">\n      <track kind="captions" src="\/assets\/intro\.vtt" srclang="en" label="Captions" default>/);

  const silent = page(el("v1", "video", 'it plays "assets/loop.webm"', "it has no speech"));
  assert.match(html(silent), /<video [^>]*><\/video>/);

  assert.deepEqual(errors(page(el("v1", "video", 'it plays "assets/intro.mp4"'))), ["KDM3009"]);
  assert.deepEqual(errors(page(el("v1", "video", 'it plays "assets/intro.mov"', "it has no speech"))), ["KDM3005"]);
  const audio = page(el("a1", "audio clip", 'it plays "assets/ep.mp3"'));
  assert.match(html(audio), /<audio [^>]*src="\/assets\/ep\.mp3" controls preload="metadata"><\/audio>/);
});

test("icons are images with an accessible name or a decorative marker", () => {
  const icon = page(el("i1", "icon", 'it shows "assets/check.svg"', 'the description says "Done"'));
  assert.match(html(icon), /<img class="kdm-home-i1 kdm-kind-icon" [^>]*src="\/assets\/check\.svg" alt="Done">/);
  assert.deepEqual(errors(page(el("i1", "icon", 'it shows "assets/check.svg"'))), ["KDM3009"]);
  assert.deepEqual(errors(page(el("i1", "icon", 'it shows "assets/photo.jpg"', "it is decorative"))), ["KDM3005"]);
});

test("form controls render native, labelled, named HTML", () => {
  const result = page(el(
    "f1", "form", 'it sends to "https://example.com/join"',
    ...el("email1", "text field", 'the label says "Email"', "it accepts email addresses", "it is at least 3 characters", "it is at most 80 characters"),
    ...el("note1", "text area", 'the label says "Note"', "it is disabled"),
    ...el("agree1", "checkbox", 'the label says "I agree"', "it is checked", "it is required"),
    ...el("size1", "dropdown", 'the label says "Size"', 'the placeholder says "Pick"', 'the options are "S", "M"'),
    ...el("tone1", "radio group", 'the label says "Tone"', 'the options are "Calm", "Loud"', "it is required"),
    ...el("go1", "button", text("Join"), "it submits the form"),
  ));
  assert.deepEqual(codes(result), []);
  const out = html(result);
  assert.match(out, /<form [^>]*action="https:\/\/example\.com\/join" method="post">/);
  assert.match(out, /<input class="kdm-field-input" id="home-email1-input" type="email" name="email1" minlength="3" maxlength="80">/);
  assert.match(out, /<textarea class="kdm-field-input" id="home-note1-input" rows="4" name="note1" disabled><\/textarea>/);
  assert.match(out, /<input class="kdm-checkbox-input" id="home-agree1-input" type="checkbox" checked required name="agree1">\n\s+<label class="kdm-field-label" for="home-agree1-input">I agree<\/label>/);
  assert.match(out, /<select class="kdm-field-input" id="home-size1-input" name="size1">\n\s+<option value="" disabled selected>Pick<\/option>\n\s+<option value="S">S<\/option>/);
  assert.match(out, /<fieldset [^>]*>\n\s+<legend class="kdm-field-label">Tone<\/legend>/);
  assert.match(out, /type="radio" name="tone1" value="Calm" required>/);
  assert.match(out, /<button [^>]*type="submit">Join<\/button>/);
});

test("form rules: destination, options, submit placement, nesting", () => {
  assert.deepEqual(errors(page(el("f1", "form"))), ["KDM3009"]);
  assert.deepEqual(errors(page(el("d1", "dropdown", 'the label says "x"'))), ["KDM3009"]);
  // A malformed options line is reported, and the dropdown then has no options.
  assert.deepEqual(errors(page(el("d1", "dropdown", 'the label says "x"', 'the options are "Only"'))), ["KDM3009", "KDM3005"]);
  assert.deepEqual(errors(page(el("b1", "button", text("x"), "it submits the form"))), ["KDM3005"]);
  assert.deepEqual(errors(page(el("f1", "form", 'it sends to "ftp://x.y"'))), ["KDM3009", "KDM3005"]);
  const nested = page(el("f1", "form", 'it sends to "https://a.b"', ...el("f2", "form", 'it sends to "https://a.b"')));
  assert.deepEqual(errors(nested), ["KDM3010"]);
  assert.deepEqual(errors(page(el("c1", "checkbox"))), ["KDM3009"]);
  assert.match(page(el("c1", "checkbox")).diagnostics[0].message, /^checkbox "c1" requires a label/);
});

test("heading outline: one main heading is an error, skipped levels are a warning", () => {
  const two = page([...el("h1a", "main heading", text("A")), ...el("h1b", "main heading", text("B"))]);
  assert.deepEqual(errors(two), ["KDM3009"]);
  const skip = page([...el("h1a", "main heading", text("A")), ...el("h4a", "small heading", text("B"))]);
  assert.equal(skip.ok, true, "a warning does not block output");
  assert.deepEqual(skip.diagnostics.map((d) => d.severity), ["warning"]);
  assert.match(html(skip), /<h4 [^>]*>B<\/h4>/);
  // 0.1 pages keep their old behaviour.
  assert.deepEqual(codes(page([...el("h1a", "main heading", text("A")), ...el("h1b", "main heading", text("B"))], { version: "0.1" })), []);
});

test("page metadata renders in head", () => {
  const result = page(el("p1", "paragraph", text("x")), {
    settings: ['the page description says "All about <Kadam>"', 'the page language is "pt-BR"'],
  });
  assert.deepEqual(codes(result), []);
  assert.match(html(result), /<html lang="pt-BR">/);
  assert.match(html(result), /<meta name="description" content="All about &lt;Kadam&gt;">/);
  assert.deepEqual(errors(page([], { settings: ['the page language is "English"'] })), ["KDM3005"]);
  assert.deepEqual(errors(page([], { settings: ['the page share image is "assets/s.png"'] })), ["KDM3005"]);
});

test("siteUrl adds canonical URLs, share images, and a sitemap; assets are copied", () => {
  const result = project({
    "kadam.json": JSON.stringify({
      kadam: "0.3", name: "Site", siteUrl: "https://example.com",
      pages: [{ source: "home.kdm", route: "/" }, { source: "about.kdm", route: "/about" }],
    }),
    "home.kdm": 'page "Home" {\n    the page icon is "assets/icon.svg"\n    the page share image is "assets/share.png"\n    v1 {\n        a video\n        it plays "assets/a.mp4"\n        the captions are "assets/a.vtt"\n    }\n}\n',
    "about.kdm": 'page "About" {\n}\n',
    "assets/icon.svg": "<svg/>",
    "assets/share.png": "png",
    "assets/a.mp4": "mp4",
    "assets/a.vtt": "WEBVTT",
  });
  assert.deepEqual(codes(result), []);
  const paths = result.files.map((f) => f.path);
  for (const path of ["assets/a.mp4", "assets/a.vtt", "assets/icon.svg", "assets/share.png", "sitemap.xml"]) {
    assert.ok(paths.includes(path), path);
  }
  const home = String(result.files.find((f) => f.path === "index.html").contents);
  assert.match(home, /<link rel="canonical" href="https:\/\/example\.com\/">/);
  assert.match(home, /<link rel="icon" href="\/assets\/icon\.svg">/);
  assert.match(home, /<meta property="og:image" content="https:\/\/example\.com\/assets\/share\.png">/);
  const sitemap = String(result.files.find((f) => f.path === "sitemap.xml").contents);
  assert.match(sitemap, /<url><loc>https:\/\/example\.com\/<\/loc><\/url>\n  <url><loc>https:\/\/example\.com\/about\/<\/loc><\/url>/);
});

test("siteUrl is validated and requires kadam 0.3", () => {
  const base = { name: "S", pages: [{ source: "home.kdm", route: "/" }] };
  const home = { "home.kdm": 'page "Home" {\n}\n' };
  assert.equal(project({ ...home, "kadam.json": JSON.stringify({ ...base, kadam: "0.1", siteUrl: "https://a.b" }) }).ok, false);
  assert.equal(project({ ...home, "kadam.json": JSON.stringify({ ...base, kadam: "0.3", siteUrl: "https://a.b/sub" }) }).ok, false);
  assert.equal(project({ ...home, "kadam.json": JSON.stringify({ ...base, kadam: "0.3", siteUrl: "https://a.b/" }) }).ok, true);
});

test("kadam.css gains base rules only for the F1 kinds a project uses", () => {
  const plain = page(el("p1", "paragraph", text("x")));
  assert.doesNotMatch(baseCss(plain), /kdm-kind-table|kdm-kind-list|kdm-inline-link/);
  const table = page(el("t1", "table", 'the caption says "x"', ...el("r1", "row", ...el("c", "cell", text("x")))));
  assert.match(baseCss(table), /\.kdm-kind-table \{/);
  assert.match(baseCss(table), /\.kdm-kind-cell \{/);
  assert.doesNotMatch(baseCss(table), /kdm-kind-list/);
});

test("F1 output is deterministic", () => {
  const body = el("f1", "form", 'it sends to "https://a.b"', ...el("t1", "text field", 'the label says "x"'));
  const a = page(body);
  const b = page(body);
  assert.deepEqual(a.files.map((f) => [f.path, f.contents]), b.files.map((f) => [f.path, f.contents]));
});

const pageCss = (result) => String(result.files.find((f) => /assets\/kadam\.home\.css$/.test(f.path))?.contents ?? "");

test("a header or footer outside main keeps the page font and text color", () => {
  const result = page([
    ...el("topBar", "header", ...el("t", "paragraph", text("Top"))),
    ...el("endBar", "footer", ...el("e", "paragraph", text("End"))),
  ], { settings: ["the page font is serif"] });
  assert.match(html(result), /<header class="kdm-home-topBar kdm-kind-header kdm-page-landmark"/);
  assert.match(html(result), /<footer class="kdm-home-endBar kdm-kind-footer kdm-page-landmark"/);
  assert.match(pageCss(result), /\.kdm-page,\n\.kdm-page-landmark \{\n  color: #171717;\n  font-family: ui-serif/);
  // Without moved landmarks the rule keeps its 0.1 selector.
  assert.match(pageCss(page(el("p1", "paragraph", text("x")))), /\n\.kdm-page \{\n/);
});

test("a code block scrolls inside its box instead of widening the page", () => {
  const css = baseCss(page(el("c1", "code block", text("x"))));
  assert.match(css, /\.kdm-kind-code-block \{\n  width: 100%;\n  contain: inline-size;/);
});

test("a radio group legend has no default indent", () => {
  const css = baseCss(page(el("r1", "radio group", 'the label says "x"', 'the options are "A", "B"')));
  assert.match(css, /\.kdm-kind-radio-group legend \{\n  padding: 0;\n  margin-bottom: 8px;\n\}/);
});
