import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { compileText } from "../dist/compiler/compile.js";
import { compileProject } from "../dist/compiler/project.js";
import { contrastRatio } from "../dist/compiler/contrast.js";
import { parseColorFunction } from "../dist/core/lexer/color-functions.js";

// kadam 0.3 frontend phase F3: styling, theming, states, and motion.

const codes = (result) => result.diagnostics.map((d) => d.code);
const errors = (result) => result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
const messages = (result) => result.diagnostics.map((d) => d.message);
const html = (result) => String(result.files.find((f) => f.path === "index.html")?.contents ?? "");
const css = (result) => String(result.files.find((f) => f.path === "assets/kadam.home.css")?.contents ?? "");

function page(body, { version = "0.3", fonts } = {}) {
  const lines = [`kadam ${version}`, 'page "Home" {', ...body.map((l) => `    ${l}`), "}", ""];
  return compileText("home.kdm", lines.join("\n"), fonts === undefined ? {} : { fonts });
}
const el = (name, kind, ...lines) => [`${name} {`, `    a ${kind}`, ...lines.map((l) => (l.startsWith("  ") ? `  ${l}` : `    ${l}`)), "}"];
const text = (value) => `the text says ${JSON.stringify(value)}`;
const nest = (lines) => lines.map((line) => `  ${line}`);

function rule(result, selector, within = css(result)) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escaped} \\{\\n([^}]*)\\}`).exec(within);
  return match === null ? null : match[1].trim().split("\n").map((line) => line.trim());
}
const own = (result, name) => rule(result, `.kdm-home-${name}`);

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "kadam-f3-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return compileProject({ projectRoot: dir });
}

// ---------------------------------------------------------------------------
// Version gating

test("F3 sentences, rgb() colors, and deg angles are kadam 0.3 syntax", () => {
  for (const sentence of [
    "has a dashed red border",
    "has a 2px red border on the bottom",
    "has a blue and white and red gradient",
    "the opacity is 50%",
    "it spins forever",
    "has a rgb(255, 0, 0) background",
    "it is rotated by 10deg",
    "in dark mode, has a black background",
  ]) {
    const result = page(el("x1", "container", sentence), { version: "0.1" });
    assert.ok(codes(result).includes("KDM2013"), sentence);
  }
  const autoDark = page(["the page is dark when the system is dark", ...el("x1", "container")], { version: "0.1" });
  assert.ok(codes(autoDark).includes("KDM2013"));
});

test("0.1 sentences keep their exact meaning and messages", () => {
  const result = page(el("x1", "container", "has a huge shadow"), { version: "0.1" });
  assert.deepEqual(messages(result), ["shadow expects a preset"]);
  const border = page(el("x1", "container", "has a 2px red border"), { version: "0.1" });
  assert.deepEqual(codes(border), []);
});

// ---------------------------------------------------------------------------
// Colors

test("rgb() and hsl() become hex colors", () => {
  assert.deepEqual(parseColorFunction("rgb", "255, 0, 0"), { ok: true, hex: "#ff0000" });
  assert.deepEqual(parseColorFunction("rgb", "37 99 235 / 50%"), { ok: true, hex: "#2563eb80" });
  assert.deepEqual(parseColorFunction("rgba", "0, 0, 0, 0.2"), { ok: true, hex: "#00000033" });
  assert.deepEqual(parseColorFunction("hsl", "0, 100%, 50%"), { ok: true, hex: "#ff0000" });
  assert.deepEqual(parseColorFunction("hsl", "220, 83%, 53%"), { ok: true, hex: "#2466eb" });
  assert.equal(parseColorFunction("rgb", "300, 0, 0").ok, false);
  assert.equal(parseColorFunction("rgb", "1, 2").ok, false);
  const result = page(el("x1", "container", "has a rgb(37, 99, 235) background"));
  assert.deepEqual(codes(result), []);
  assert.ok(own(result, "x1").includes("background-color: #2563eb;"));
  assert.ok(codes(page(el("x1", "container", "has a rgb(300, 0, 0) background"))).includes("KDM3006"));
});

test("opacity is a property-table row for every kind", () => {
  const result = page(el("x1", "container", "the opacity is 40%"));
  assert.deepEqual(own(result, "x1"), ["opacity: 0.4;"]);
  assert.match(messages(page(el("x1", "container", "the opacity is 0.4")))[0], /percentage/);
  assert.match(messages(page(el("x1", "container", "the opacity is 150%")))[0], /between 0% and 100%/);
});

// ---------------------------------------------------------------------------
// Borders, corners, outline

test("border styles, sides, corners, and outlines", () => {
  const result = page([
    ...el("a1", "container", "has a 2px dashed red border"),
    ...el("b1", "container", "has a 1px #E5E5E5 border on the bottom"),
    ...el("c1", "container", "has a dotted blue border on the left and right"),
    ...el("d1", "container", "has 12px rounded corners on the top"),
    ...el("e1", "container", "has fully rounded corners on the bottom right"),
    ...el("f1", "button", text("Go"), "has a 2px blue outline"),
  ]);
  assert.deepEqual(codes(result), []);
  assert.deepEqual(own(result, "a1"), ["border: 2px solid #ff0000;".replace("#ff0000", "red"), "border-style: dashed;"]);
  assert.deepEqual(own(result, "b1"), ["border-bottom: 1px solid #e5e5e5;"]);
  assert.deepEqual(own(result, "c1"), ["border-left: 1px dotted blue;", "border-right: 1px dotted blue;"]);
  assert.deepEqual(own(result, "d1"), ["border-top-left-radius: 12px;", "border-top-right-radius: 12px;"]);
  assert.deepEqual(own(result, "e1"), ["border-bottom-right-radius: 9999px;"]);
  assert.deepEqual(own(result, "f1"), ["outline: 2px solid blue;", "outline-offset: 2px;"]);
});

test("border mistakes and duplicates", () => {
  assert.match(messages(page(el("x1", "container", "has a red border on the middle")))[0], /side border/);
  assert.match(messages(page(el("x1", "container", "has 12px rounded corners on the middle")))[0], /invalid corner/);
  const dup = page(el("x1", "container", "has a red border on the top", "has a blue border on the top"));
  assert.ok(dup.diagnostics.some((d) => /duplicate/.test(d.message)));
  // A side border may refine a full border.
  assert.deepEqual(errors(page(el("x1", "container", "has a red border", "has a 3px blue border on the bottom"))), []);
});

test("form fields put box styles on the input", () => {
  const result = page(el("f1", "text field", 'the label says "Email"', "has a 2px dashed red border", "it is at most 400px wide"));
  assert.deepEqual(codes(result), []);
  assert.ok(own(result, "f1").includes("max-width: 400px;"));
  assert.ok(rule(result, ".kdm-home-f1 .kdm-field-input").includes("border-style: dashed;"));
});

// ---------------------------------------------------------------------------
// Backgrounds

test("multi-color, radial, and angled gradients", () => {
  const result = page([
    ...el("a1", "container", "has a blue and white and red gradient"),
    ...el("b1", "container", "has a blue and white and red gradient", "the gradient goes from left to right"),
    ...el("c1", "container", "has a navy and teal and gold gradient", "the gradient goes at 135deg"),
    ...el("d1", "container", "has a radial white and blue gradient"),
  ]);
  assert.deepEqual(codes(result), []);
  assert.ok(own(result, "a1").includes("background-image: linear-gradient(to bottom, blue, white, red);"));
  assert.ok(own(result, "b1").includes("background-image: linear-gradient(to right, blue, white, red);"));
  assert.ok(own(result, "c1").includes("background-image: linear-gradient(135deg, navy, teal, gold);"));
  assert.ok(own(result, "d1").includes("background-image: radial-gradient(circle, white, blue);"));
  // A 0.1 two-color gradient accepts the angle too.
  assert.deepEqual(codes(page(el("e1", "container", "has a blue and white gradient", "the gradient goes at 45deg"))), []);
});

test("gradient mistakes", () => {
  assert.match(messages(page(el("x1", "container", "the gradient goes at 45deg")))[0], /requires a gradient/);
  assert.match(messages(page(el("x1", "container", "has a radial white and blue gradient", "the gradient goes at 45deg")))[0], /radial gradient has no direction/);
  assert.equal(codes(page(el("x1", "container", "has a blue and white and nope gradient")))[0], "KDM3005");
});

test("background images are copied, cover by default, and accept fit and focus", () => {
  const result = project({
    "kadam.json": JSON.stringify({ kadam: "0.3", name: "t", pages: [{ source: "home.kdm", route: "/" }] }),
    "home.kdm": 'page "Home" {\n    hero {\n        a section\n        has a "assets/hero.jpg" background image\n        the background image keeps the top in view\n        h1 {\n            a main heading\n            the text says "Hi"\n        }\n    }\n}\n',
    "assets/hero.jpg": "jpg",
  });
  assert.deepEqual(result.diagnostics.map((d) => d.message), []);
  assert.ok(result.files.some((f) => f.path === "assets/hero.jpg"));
  const out = String(result.files.find((f) => f.path === "assets/kadam.home.css").contents);
  assert.match(out, /background-image: url\("\/assets\/hero\.jpg"\);\n  background-size: cover;\n  background-position: center top;\n  background-repeat: no-repeat;/);
  const missing = page(el("x1", "container", "the background image repeats"));
  assert.match(messages(missing)[0], /requires a background image/);
  const both = page(el("x1", "container", 'has a "assets/a.png" background image', "has a red and blue and green gradient"));
  assert.ok(messages(both).some((m) => /both a background image and a gradient/.test(m)));
});

// ---------------------------------------------------------------------------
// Typography

test("decoration, case, line length, and truncation", () => {
  const result = page([
    ...el("a1", "paragraph", text("x"), "the text is underlined"),
    ...el("b1", "link", text("x"), 'when clicked, open "https://example.com" in a new tab', "the text is not underlined"),
    ...el("c1", "paragraph", text("x"), "the text is uppercase"),
    ...el("d1", "paragraph", text("x"), "the text is at most 65 characters wide"),
    ...el("e1", "paragraph", text("x"), "it shows at most 2 lines"),
    ...el("f1", "paragraph", text("x"), "it shows at most 1 line"),
  ]);
  assert.deepEqual(codes(result), []);
  assert.deepEqual(own(result, "a1"), ["text-decoration-line: underline;"]);
  assert.deepEqual(own(result, "b1"), ["text-decoration-line: none;"]);
  assert.deepEqual(own(result, "c1"), ["text-transform: uppercase;"]);
  assert.deepEqual(own(result, "d1"), ["max-width: 65ch;"]);
  assert.deepEqual(own(result, "e1"), ["display: -webkit-box;", "-webkit-box-orient: vertical;", "-webkit-line-clamp: 2;", "line-clamp: 2;", "overflow: hidden;"]);
  assert.deepEqual(own(result, "f1"), ["overflow: hidden;", "text-overflow: ellipsis;", "white-space: nowrap;"]);
  assert.match(messages(page(el("x1", "paragraph", text("x"), "it shows at most 2 line")))[0], /truncation/);
  // `it shows "..."` is still an image source.
  assert.deepEqual(codes(page(el("i1", "image", 'it shows "assets/a.png"', "it is decorative"))), []);
});

test("custom fonts come from kadam.json and emit @font-face", () => {
  const result = project({
    "kadam.json": JSON.stringify({
      kadam: "0.3", name: "t", pages: [{ source: "home.kdm", route: "/" }],
      fonts: { Inter: { source: "assets/fonts/Inter.woff2", weight: "100 900", fallback: "sans serif" } },
    }),
    "home.kdm": 'page "Home" {\n    body1 {\n        a container\n        the font is "Inter"\n        p1 {\n            a paragraph\n            the text says "Hi"\n        }\n    }\n}\n',
    "assets/fonts/Inter.woff2": "woff2",
  });
  assert.deepEqual(result.diagnostics.map((d) => d.message), []);
  assert.ok(result.files.some((f) => f.path === "assets/fonts/Inter.woff2"));
  const out = String(result.files.find((f) => f.path === "assets/kadam.home.css").contents);
  assert.match(out, /@font-face \{\n  font-family: "Inter";\n  src: url\("\/assets\/fonts\/Inter\.woff2"\) format\("woff2"\);\n  font-weight: 100 900;\n  font-style: normal;\n  font-display: swap;\n\}/);
  assert.match(out, /font-family: "Inter", ui-sans-serif/);
  const unknown = page(el("p1", "paragraph", text("x"), 'the font is "Nope"'));
  assert.match(messages(unknown)[0], /unknown font "Nope"/);
  const badManifest = project({
    "kadam.json": JSON.stringify({ kadam: "0.3", name: "t", pages: [{ source: "home.kdm", route: "/" }], fonts: { Inter: { source: "https://fonts.example/inter.woff2x" } } }),
    "home.kdm": 'page "Home" {\n}\n',
  });
  assert.ok(badManifest.diagnostics.some((d) => d.code === "KDM4001"));
});

// ---------------------------------------------------------------------------
// Shadows, filters, transforms

test("colored, inner, and custom shadows", () => {
  const result = page([
    ...el("a1", "card", "has a soft blue shadow"),
    ...el("b1", "card", "has an inner shadow"),
    ...el("c1", "card", "has a #0000001A shadow that is 24px blurred and 8px down"),
  ]);
  assert.deepEqual(codes(result), []);
  assert.deepEqual(own(result, "a1"), ["box-shadow: 0 1px 3px blue;"]);
  assert.deepEqual(own(result, "b1"), ["box-shadow: inset 0 2px 4px #0000001f;"]);
  assert.deepEqual(own(result, "c1"), ["box-shadow: 0 8px 24px #0000001a;"]);
  assert.equal(codes(page(el("x1", "card", "has a soft shadow")))[0], undefined);
  assert.match(messages(page(el("x1", "card", "has a #000 shadow that is 8px down")))[0], /how blurred/);
});

test("blur, backdrop blur, rotation, moves, and scale", () => {
  const result = page([
    ...el("a1", "container", "it is blurred by 4px"),
    ...el("b1", "container", "it blurs the background behind it by 12px"),
    ...el("c1", "container", "it is rotated by 10deg"),
    ...el("d1", "container", "it is moved 4px left and 2px down"),
    ...el("e1", "container", "it is scaled to 110%"),
    ...el("f1", "link", text("x"), 'when clicked, open "https://example.com" in a new tab', "it is rotated by 5deg"),
  ]);
  assert.deepEqual(codes(result), []);
  assert.deepEqual(own(result, "a1"), ["filter: blur(4px);"]);
  assert.deepEqual(own(result, "b1"), ["-webkit-backdrop-filter: blur(12px);", "backdrop-filter: blur(12px);"]);
  assert.deepEqual(own(result, "c1"), ["rotate: 10deg;"]);
  assert.deepEqual(own(result, "d1"), ["translate: -4px 2px;"]);
  assert.deepEqual(own(result, "e1"), ["scale: 1.1;"]);
  assert.deepEqual(own(result, "f1"), ["rotate: 5deg;", "display: inline-block;"]);
  assert.match(messages(page(el("x1", "container", "it is rotated by 10")))[0], /rotation/);
});

// ---------------------------------------------------------------------------
// States and motion

test("interaction states map to the right selectors and share transitions", () => {
  const result = page([
    ...el("b1", "button", text("Go"), "when hovered, the background turns navy", "when pressed, it scales to 102%",
      "when focused, the text turns yellow", "when hovered, it rotates by 3deg"),
    ...el("f1", "text field", 'the label says "Email"', "when focused, the border turns blue", "when invalid, the border turns red"),
    ...el("c1", "checkbox", 'the label says "Yes"', "when checked, the background turns honeydew"),
  ]);
  assert.deepEqual(codes(result), []);
  const out = css(result);
  assert.deepEqual(rule(result, ".kdm-home-b1:active"), ["scale: 1.02;"]);
  assert.deepEqual(rule(result, ".kdm-home-b1:focus-visible"), ["color: yellow;"]);
  assert.deepEqual(rule(result, ".kdm-home-f1 .kdm-field-input:focus-visible"), ["border-color: blue;"]);
  assert.deepEqual(rule(result, ".kdm-home-f1 .kdm-field-input:user-invalid"), ["border-color: red;"]);
  assert.deepEqual(rule(result, ".kdm-home-c1:has(.kdm-checkbox-input:checked)"), ["background-color: honeydew;"]);
  // The hover rotation sits in the hover media block with the 0.1 hover rule.
  assert.match(out, /@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*\.kdm-home-b1:hover \{\n    rotate: 3deg;/);
  // One transition list covers hover and state effects.
  assert.match(out, /transition: background-color 150ms ease-out, scale 150ms ease-out, color 150ms ease-out, rotate 150ms ease-out;/);
  // Reduced motion turns them off.
  assert.match(out, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.kdm-home-b1 \{\n    transition: none;/);
});

test("states are checked against the kind", () => {
  assert.equal(codes(page(el("p1", "paragraph", text("x"), "when pressed, the text turns red")))[0], "KDM3003");
  assert.equal(codes(page(el("b1", "button", text("x"), "when checked, the text turns red")))[0], "KDM3003");
  assert.equal(codes(page(el("b1", "button", text("x"), "when focused, the border turns red")))[0], "KDM3014");
  assert.equal(codes(page(el("b1", "button", text("x"), "when focused the border turns red")))[0], "KDM2010");
});

test("loops, scroll entrances, and staggered children respect reduced motion", () => {
  const result = page([
    ...el("s1", "container", "it spins forever"),
    ...el("p1", "container", "it pulses every 3s"),
    ...el("r1", "container", "it fades in when it scrolls into view"),
    ...el("g1", "container", "its children fade in one after another",
      ...nest(el("x1", "paragraph", text("a"))), ...nest(el("x2", "paragraph", text("b"))), ...nest(el("x3", "paragraph", text("c")))),
  ]);
  assert.deepEqual(codes(result), []);
  const out = css(result);
  assert.deepEqual(own(result, "s1"), ["animation: kdm-loop-spin 1s linear infinite;"]);
  assert.deepEqual(own(result, "p1"), ["animation: kdm-loop-pulse 3s ease-in-out infinite;"]);
  assert.match(out, /@keyframes kdm-loop-spin \{/);
  assert.match(out, /@keyframes kdm-loop-pulse \{/);
  assert.doesNotMatch(out, /kdm-loop-bounce/);
  assert.match(out, /@supports \(animation-timeline: view\(\)\) \{\n  \.kdm-home-r1 \{\n    animation: kdm-fade-in linear both;\n    animation-timeline: view\(\);/);
  assert.deepEqual(rule(result, ".kdm-home-g1 > *"), ["animation: kdm-fade-in 400ms ease-out both;"]);
  assert.deepEqual(rule(result, ".kdm-home-g1 > :nth-child(3)"), ["animation-delay: 200ms;"]);
  const reduced = out.slice(out.indexOf("@media (prefers-reduced-motion: reduce)"));
  for (const selector of [".kdm-home-s1", ".kdm-home-p1", ".kdm-home-r1", ".kdm-home-g1 > *"]) {
    assert.ok(reduced.includes(`${selector} {\n    animation: none;`), selector);
  }
  // An entrance and a loop are both the element's animation.
  assert.ok(page(el("x1", "container", "it spins forever", "it fades in when it scrolls into view"))
    .diagnostics.some((d) => /duplicate/.test(d.message)));
});

test("a badge is a short pill of text", () => {
  const result = page(el("b1", "badge", text("New")));
  assert.deepEqual(codes(result), []);
  assert.match(html(result), /<span class="kdm-home-b1 kdm-kind-badge" data-kdm-id="home-b1">New<\/span>/);
  assert.match(String(result.files.find((f) => f.path === "assets/kadam.css").contents), /\.kdm-kind-badge \{/);
  assert.equal(codes(page(el("b1", "badge")))[0], "KDM3009");
});

// ---------------------------------------------------------------------------
// Theme colors and dark mode (D-38)

test("theme colors are custom properties usable anywhere a color is", () => {
  const result = page([
    "the brand color is #FF0066",
    "in dark mode, the brand color is #FF4D8D",
    ...el("b1", "button", text("Go"), "has a brand background", "when hovered, the background turns brand"),
    ...el("t1", "paragraph", text("x"), "the text is brand"),
  ]);
  assert.deepEqual(errors(result), []);
  const out = css(result);
  assert.match(out, /:root \{\n  --kdm-color-brand: #ff0066;\n\}/);
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{\n  :root \{\n    --kdm-color-brand: #ff4d8d;/);
  assert.ok(own(result, "b1").includes("background-color: var(--kdm-color-brand);"));
  assert.ok(own(result, "t1").includes("color: var(--kdm-color-brand);"));
});

test("theme color names are words, used only after they are declared", () => {
  assert.match(messages(page(["the Brand color is #FF0066"]))[0], /lower-case/);
  const before = page([...el("t1", "paragraph", text("x"), "the text is brand"), "the brand color is #FF0066"]);
  assert.ok(codes(before).includes("KDM3005"));
  assert.ok(page(["the brand color is #FF0066", "the brand color is #000000"]).diagnostics.some((d) => /duplicate brand color/.test(d.message)));
  // An element named like a color word is unaffected.
  assert.deepEqual(errors(page(["the brand color is #FF0066", ...el("brand", "container")])), []);
});

test("a project theme file is shared by every page and component", () => {
  const result = project({
    "kadam.json": JSON.stringify({ kadam: "0.3", name: "t", theme: "theme.kdm", pages: [{ source: "home.kdm", route: "/" }] }),
    "theme.kdm": "kadam 0.3\ntheme {\n    the brand color is #FF0066\n    in dark mode, the brand color is #FF4D8D\n}\n",
    "home.kdm": 'page "Home" {\n    b1 {\n        a button\n        the text says "Go"\n        has a brand background\n    }\n}\n',
  });
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message), []);
  const out = String(result.files.find((f) => f.path === "assets/kadam.home.css").contents);
  assert.match(out, /--kdm-color-brand: #ff0066;/);
  assert.match(out, /--kdm-color-brand: #ff4d8d;/);
  const bad = project({
    "kadam.json": JSON.stringify({ kadam: "0.3", name: "t", theme: "theme.kdm", pages: [{ source: "home.kdm", route: "/" }] }),
    "theme.kdm": "theme {\n    it is hidden\n    in dark mode, the accent color is red\n}\n",
    "home.kdm": 'page "Home" {\n}\n',
  });
  assert.ok(bad.diagnostics.some((d) => /only theme colors/.test(d.message)));
  assert.ok(bad.diagnostics.some((d) => /accent has a dark mode color but no color/.test(d.message)));
});

test("in dark mode scopes element statements and page colors", () => {
  const result = page([
    "in dark mode, the page background is #0B0D10",
    "in dark mode, the page text is #F1F1F1",
    ...el("c1", "card", "in dark mode, has a #222222 background", "in dark mode, has a #444444 border"),
  ]);
  assert.deepEqual(errors(result), []);
  const out = css(result);
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{\n  body \{\n    background-color: #0b0d10;\n  \}\n\n  \.kdm-page \{\n    color: #f1f1f1;/);
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{\n  \.kdm-home-c1 \{\n    background-color: #222222;/);
  assert.match(messages(page(["in dark mode, the page font is serif"]))[0], /only the page background/);
  assert.match(messages(page(el("c1", "card", "on phones, in dark mode, it is hidden")))[0], /cannot be nested/);
});

test("the built-in dark palette follows the system and never overrides authored colors", () => {
  const result = page([
    "the page is dark when the system is dark",
    ...el("c1", "card", ...nest(el("t1", "paragraph", text("Hello")))),
    ...el("c2", "card", "has a white background"),
  ]);
  assert.deepEqual(errors(result), []);
  const out = css(result);
  assert.match(html(result), /<meta name="color-scheme" content="light dark">/);
  assert.match(out, /:root \{\n  color-scheme: light dark;\n\}/);
  const dark = out.indexOf("@media (prefers-color-scheme: dark)");
  const authored = out.indexOf(".kdm-home-c2 {");
  assert.ok(dark !== -1 && dark < authored, "the palette comes before authored rules");
  assert.match(out, /\.kdm-kind-card \{\n    background-color: #1B2028;/);
});

// ---------------------------------------------------------------------------
// Contrast (D-39)

test("contrast ratios follow WCAG", () => {
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]).toFixed(2), "21.00");
  assert.equal(contrastRatio([118, 118, 118], [255, 255, 255]).toFixed(2), "4.54");
});

test("low-contrast text is a warning that never blocks output", () => {
  const result = page(el("p1", "paragraph", text("faint"), "the text is #BBBBBB"));
  assert.deepEqual(codes(result), ["KDM3039"]);
  assert.equal(result.diagnostics[0].severity, "warning");
  assert.match(result.diagnostics[0].message, /text in p1 has a contrast ratio of 1\.\d\d:1; WCAG AA needs 4\.5:1/);
  assert.ok(result.ok);
  // Large text needs only 3:1.
  assert.deepEqual(codes(page(el("h1", "main heading", text("Big"), "the text is #949494"))), []);
  // The background comes from the nearest ancestor with one.
  const nested = page(el("c1", "container", "has a navy background", ...nest(el("p1", "paragraph", text("x"), "the text is #000080".replace("#000080", "blue")))));
  assert.deepEqual(codes(nested), ["KDM3039"]);
});

test("contrast is checked through theme colors and in dark mode", () => {
  const result = page([
    "the ink color is #222222",
    "in dark mode, the ink color is #333333",
    "the page is dark when the system is dark",
    ...el("p1", "paragraph", text("x"), "the text is ink"),
  ]);
  assert.deepEqual(codes(result), ["KDM3039"]);
  assert.match(result.diagnostics[0].message, /in dark mode/);
  // Unknown backgrounds are not guessed at.
  assert.deepEqual(codes(page(el("c1", "container", "has a black and white and black gradient", ...nest(el("p1", "paragraph", text("x"), "the text is #777777"))))), []);
  // 0.1 pages never get the new warning.
  assert.deepEqual(codes(page(el("p1", "paragraph", text("faint"), "the text is #BBBBBB"), { version: "0.1" })), []);
});
