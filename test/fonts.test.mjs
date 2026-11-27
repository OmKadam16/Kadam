import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileProject } from "../dist/compiler/project.js";
import { compileText } from "../dist/compiler/compile.js";
import { builtInFonts, catalogFont, closestFontNames, fontCatalog, FONTS_ROOT, parseFontFileName } from "../dist/fonts/catalog.js";

// D-51: fonts. 150 built in, the catalog of every free family, the project's fonts/ folder.

function project(files, binary = {}) {
  const root = mkdtempSync(join(tmpdir(), "kadam-fonts-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  for (const [path, from] of Object.entries(binary)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    copyFileSync(from, join(root, path));
  }
  return compileProject({ projectRoot: root });
}
const errors = (result) => result.diagnostics.filter((d) => d.severity === "error");
const warnings = (result) => result.diagnostics.filter((d) => d.severity === "warning");
const css = (result) => String(result.files.find((f) => f.path === "assets/kadam.home.css")?.contents ?? "");
const page = (body) => ({ "pages/home.kdm": `kadam 0.4\n\n${body}\n` });

test("the catalog lists every free family and 150 ship built in", () => {
  assert.ok(fontCatalog().length > 2000, "the whole Fontsource catalog");
  assert.equal(builtInFonts().size, 150);
  for (const name of ["Inter", "Roboto", "Lora", "Playfair Display", "JetBrains Mono", "Noto Sans Devanagari", "Noto Sans Arabic"]) {
    assert.ok(builtInFonts().has(name.toLowerCase().replace(/[^a-z0-9]/g, "")), `${name} is built in`);
  }
  assert.equal(catalogFont("playfair-display")?.family, "Playfair Display");
  assert.equal(catalogFont("noto sans jp")?.category, "sans-serif");
  assert.deepEqual(closestFontNames("Robotto", []).slice(0, 1), ["Roboto"]);
});

test("The page font is Lora: no setup, the files are copied, the fallback follows the style", () => {
  const result = project(page('The page font is Lora.\nA big heading says "Hi".'));
  assert.deepEqual(errors(result), []);
  assert.match(css(result), /\.kdm-page \{\n  color: #171717;\n  font-family: "Lora", ui-serif, Georgia/);
  assert.match(css(result), /@font-face \{\n  font-family: "Lora";\n  src: url\("\/fonts\/lora\/latin-wght-normal\.woff2"\) format\("woff2"\);\n  font-weight: 400 700;\n  font-style: normal;\n  font-display: swap;\n  unicode-range: U\+0000-00FF/);
  const fonts = result.files.filter((f) => f.path.startsWith("fonts/")).map((f) => f.path);
  assert.ok(fonts.includes("fonts/lora/latin-wght-normal.woff2"));
  assert.ok(fonts.every((path) => path.startsWith("fonts/lora/")), "only the font the page uses");
});

test("heading, element and handwriting fonts", () => {
  const result = project(page('The heading font is Playfair Display.\nA big heading says "Hi".\nText says "Note". The font is Caveat.\nText says "Code". Its font is JetBrains Mono.'));
  assert.deepEqual(errors(result), []);
  assert.match(css(result), /:where\(\.kdm-page, \.kdm-page-landmark\) :is\(\.kdm-kind-main-heading, \.kdm-kind-section-heading, \.kdm-kind-minor-heading\) \{\n  font-family: "Playfair Display", ui-serif/);
  assert.match(css(result), /font-family: "Caveat", "Segoe Print", "Bradley Hand", cursive/);
  assert.match(css(result), /font-family: "JetBrains Mono", ui-monospace/);
});

test("fixes, never guesses: a misspelling, a catalog font not installed, a missing weight", () => {
  const misspelled = project(page('Text says "x". The font is "Robotto".'));
  assert.equal(errors(misspelled)[0]?.message, 'unknown font "Robotto"');
  assert.match(errors(misspelled)[0]?.hint ?? "", /did you mean "Roboto"/);

  const notInstalled = project(page('Text says "x". The font is Noto Sans JP.'));
  assert.equal(errors(notInstalled)[0]?.message, 'the font "Noto Sans JP" is not installed');
  assert.equal(errors(notInstalled)[0]?.hint, 'run: kadam fonts add "Noto Sans JP"');

  const weight = project(page('Text says "x". The font is Lora. The text weight is 200.'));
  assert.deepEqual(errors(weight), []);
  assert.equal(warnings(weight)[0]?.message, 'the font "Lora" has no weight 200');
  assert.equal(warnings(weight)[0]?.hint, "its weights are 400, 500, 600, 700");
});

test("in a block file the fix replaces just the name", () => {
  const result = compileText("home.kdm", 'kadam 0.3\npage "Home" {\n    text1 {\n        a paragraph\n        the text says "x"\n        the font is "Robotto"\n    }\n}\n');
  const fix = result.diagnostics.find((d) => d.code === "KDM3005")?.fixes?.[0];
  assert.equal(fix?.text, '"Roboto"');
  assert.equal(fix?.span.end.offset - fix?.span.start.offset, '"Robotto"'.length);
});

test("fonts/ folder: a dropped-in file is a family by its file name", () => {
  assert.deepEqual(parseFontFileName("Acme Sans-BoldItalic"), { family: "Acme Sans", weight: "700", style: "italic" });
  assert.deepEqual(parseFontFileName("Acme_Sans-Regular"), { family: "Acme Sans", weight: "400", style: "normal" });
  assert.deepEqual(parseFontFileName("AcmeSans[wght]"), { family: "AcmeSans", weight: "100 900", style: "normal" });
  const result = project(page('Text says "x". The font is Acme Script.'), {
    "fonts/Acme Script-Regular.woff2": join(FONTS_ROOT, "lobster", "latin-400-normal.woff2"),
  });
  assert.deepEqual(errors(result), []);
  assert.match(css(result), /src: url\("\/fonts\/Acme%20Script-Regular\.woff2"\) format\("woff2"\);\n  font-weight: 400;/);
  assert.ok(result.files.some((f) => f.path === "fonts/Acme Script-Regular.woff2"));
});

test("a single file can use the built-in fonts; kadam 0.1 cannot name one", () => {
  const single = compileText("home.kdm", 'kadam 0.3\npage "Home" {\n    the page font is "Inter"\n    heading1 {\n        a main heading\n        the text says "Hi"\n    }\n}\n');
  assert.equal(single.ok, true);
  assert.ok(single.files.some((f) => f.path === "fonts/inter/latin-wght-normal.woff2"));
  const old = compileText("home.kdm", 'kadam 0.1\npage "Home" {\n    the page font is "Inter"\n}\n');
  assert.equal(old.diagnostics[0]?.code, "KDM2013");
});

test("kadam.json fonts keep working and win over a built-in of the same name", () => {
  const result = project({
    "kadam.json": JSON.stringify({ name: "Fonts", kadam: "0.4", fonts: { Lora: { source: "assets/Mine.woff2", fallback: "serif" } } }),
    ...page('Text says "x". The font is "Lora".'),
  }, { "assets/Mine.woff2": join(FONTS_ROOT, "lora", "latin-wght-normal.woff2") });
  assert.deepEqual(errors(result), []);
  assert.match(css(result), /src: url\("\/assets\/Mine\.woff2"\)/);
  assert.ok(!result.files.some((f) => f.path.startsWith("fonts/")));
});
