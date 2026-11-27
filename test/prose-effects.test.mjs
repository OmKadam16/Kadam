import { test } from "node:test";
import assert from "node:assert/strict";

import { compileText } from "../dist/compiler/compile.js";

// D-50: effects, one sentence each, in paragraph pages and in blocks.

const build = (text) => compileText("home.kdm", `kadam 0.4\n\n${text}\n`);
const errors = (result) => result.diagnostics.filter((d) => d.severity === "error");
const file = (result, path) => String(result.files.find((f) => f.path === path)?.contents ?? "");
const css = (result) => file(result, "assets/kadam.home.css");
const js = (result) => file(result, "assets/kadam.home.js");
const reduced = (text) => text.slice(text.indexOf("@media (prefers-reduced-motion: reduce)"));

test("cursor effects: pixels, grain, glow and spotlight", () => {
  const result = build([
    'A big heading says "Hi".',
    "Hero section:",
    "    When the cursor moves over it, white pixels pop out around the cursor.",
    '    A heading says "One".',
    "Grain section:",
    "    When the cursor moves over it, grain surrounds the cursor within 10px.",
    '    A heading says "Two".',
    "Glow section:",
    "    A #A78BFA glow follows the cursor.",
    '    A heading says "Three".',
  ].join("\n"));
  assert.deepEqual(errors(result), []);
  assert.match(css(result), /\.kdm-home-hero1 \{[^}]*position: relative;\n {2}isolation: isolate;\n {2}--kdm-pixel-color: #FFFFFF;/);
  assert.match(css(result), /\.kdm-home-grain1::after \{[^}]*mask-image: radial-gradient\(circle 10px at var\(--kdm-cx, 50%\) var\(--kdm-cy, 50%\), #000 0%, transparent 100%\);/);
  assert.match(css(result), /\.kdm-home-glow1::after \{[^}]*color-mix\(in srgb, #A78BFA 45%, transparent\)/i);
  assert.match(css(result), /\.kdm-home-glow1\[data-kdm-cursor\]::after \{\n {2}opacity: 1;/);
  assert.match(js(result), /const effects = \[\["home-hero1","pixels"\],\["home-grain1","grain"\],\["home-glow1","glow"\]\];/);
  assert.match(js(result), /prefers-reduced-motion: reduce\)"\)\.matches;\nconst pointer = matchMedia\("\(hover: hover\) and \(pointer: fine\)"\)/);
  assert.equal(errors(build('A big heading says "Hi". When the cursor moves over it, purple confetti falls.'))[0].code, "KDM3005");
  assert.ok(errors(build('A big heading says "Hi". When the cursor moves over it, a glow follows the cursor.')).some((d) => d.code === "KDM3003"), "not on a heading");
});

test("button effects: fill, shine, drawn border, magnetic pull and ripple", () => {
  const result = build([
    'A big heading says "Hi".',
    'A black button says "Go". When hovered, a white fill slides in from the left. It ripples when pressed.',
    'A button says "Shine". When hovered, a shine sweeps across it. It pulls toward the cursor.',
    'A link says "Line". When hovered, its border draws itself. When clicked, go to page "Home".',
  ].join("\n"));
  assert.deepEqual(errors(result), []);
  assert.match(css(result), /\.kdm-home-button1::before \{[^}]*background-color: #FFFFFF;\n {2}transform: scaleX\(0\);\n {2}transform-origin: left center;/);
  assert.match(css(result), /\.kdm-home-button1:hover::before,\n\.kdm-home-button1:focus-visible::before \{\n {2}transform: none;/);
  assert.match(css(result), /@media \(prefers-reduced-motion: reduce\) \{\n {2}\.kdm-home-button1::before \{\n {4}transition: none;/);
  assert.match(css(result), /\.kdm-home-button2::before \{[^}]*translateX\(-100%\)/);
  assert.match(css(result), /\.kdm-home-link1:hover::before,[^{]*\{\n {2}background-size: 100% 2px, 2px 100%, 100% 2px, 2px 100%;/);
  assert.match(js(result), /\["home-button1","ripple"\],\["home-button2","magnetic"\]/);
  assert.ok(errors(build('A big heading says "Hi".\nA button says "x". When hovered, a white fill slides in from the left. When hovered, a shine sweeps across it.')).some((d) => d.code === "KDM3004"), "one hover layer");
});

test("scroll, page and text effects; all of them stop with reduced motion", () => {
  const result = build([
    "The page fades in when it opens.",
    "Pages fade into each other when you move between them.",
    'A big heading says "Meet Lumen." It appears word by word.',
    'Text says "Typing now." It types itself.',
    'Text says "Mixed up." It scrambles into place.',
    'Text says "Pretty." Its text is a blue to purple gradient.',
    'Text says "the least spent". A highlight sweeps under "least spent".',
    'Text says "Tilting." It tilts as you scroll.',
    'Text says "Showing." It appears as you scroll.',
  ].join("\n"));
  assert.deepEqual(errors(result), []);
  const html = file(result, "index.html");
  assert.match(html, /<h1[^>]*><span class="kdm-word">Meet<\/span> <span class="kdm-word">Lumen\.<\/span><\/h1>/);
  assert.match(html, /the <mark class="kdm-highlight kdm-highlight-fde68a">least spent<\/mark>/);
  const text = css(result);
  assert.match(text, /\.kdm-home-heading1 \.kdm-word:nth-child\(2\) \{\n {2}animation-delay: 70ms;/);
  assert.match(text, /\.kdm-home-text1 \{\n {2}animation: kdm-type 600ms steps\(11\) both;/);
  assert.match(text, /background-image: linear-gradient\(90deg, blue, purple\);\n {2}-webkit-background-clip: text;\n {2}background-clip: text;\n {2}color: transparent;/);
  assert.match(text, /@supports \(animation-timeline: view\(\)\) \{\n {2}\.kdm-home-text5 \{\n {4}animation: kdm-scroll-tilt linear both;/);
  assert.match(text, /body \{\n {2}animation: kdm-page-fade 500ms ease-out both;/);
  assert.match(text, /@view-transition \{\n {2}navigation: auto;\n\}/);
  for (const keyframe of ["kdm-page-fade", "kdm-type", "kdm-word-in", "kdm-scroll-tilt", "kdm-highlight-sweep"]) assert.match(text, new RegExp(`@keyframes ${keyframe} \\{`), keyframe);
  const still = reduced(text);
  for (const selector of ["body", ".kdm-highlight", ".kdm-home-text1", ".kdm-home-heading1 .kdm-word", ".kdm-home-text5", "::view-transition-group(*)"]) {
    assert.ok(still.includes(selector), `${selector} stops with reduced motion`);
  }
  assert.match(js(result), /\["home-text2","scramble"\]/);
  assert.ok(errors(build('A big heading says "Hi". It types itself. It appears word by word.')).some((d) => d.code === "KDM3004"));
  assert.ok(errors(build('A big heading says "Hi". Its text is a blue to purple gradient. The text is red.')).some((d) => d.code === "KDM3004"));
});

test("the effects are block sentences too", () => {
  const result = compileText("a.kdm", 'kadam 0.3\npage "A" {\n    h1 {\n        a main heading\n        the text says "Hi"\n        it types itself\n    }\n    b1 {\n        a button\n        the text says "Go"\n        when hovered, a white fill slides in from the left\n        when hovered, the text turns black\n    }\n}\n');
  assert.deepEqual(errors(result), []);
  // Ordinary hover sentences are unchanged.
  assert.match(file(result, "assets/kadam.home.css"), /\.kdm-home-b1:hover \{\n {4}color: black;/);
});
