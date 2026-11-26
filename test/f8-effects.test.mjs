import { test } from "node:test";
import assert from "node:assert/strict";

import { compileText } from "../dist/compiler/compile.js";

// F8 step 1: image and box effects.

const codes = (result) => result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
const css = (result) => String(result.files?.find((f) => f.path === "assets/kadam.home.css")?.contents ?? "");
const page = (lines, version = "0.3") => compileText("a.kdm", [`kadam ${version}`, 'page "A" {', ...lines.map((l) => `    ${l}`), "}", ""].join("\n"));
const image = (...lines) => ["photo {", "    an image", '    it shows "assets/a.jpg"', '    the description says "A desk"', ...lines.map((l) => `    ${l}`), "}"];
const html = (result) => String(result.files?.find((f) => f.path === "index.html")?.contents ?? "");
const box = (...lines) => ["box1 {", "    a container", ...lines.map((l) => `    ${l}`), "}"];

test("filters combine into one filter declaration, in the order written", () => {
  const result = page(image("it is grayscale", "it is blurred by 2px", "the brightness is 90%", "the contrast is 110%", "the saturation is 0%", "it is sepia"));
  assert.deepEqual(codes(result), []);
  assert.match(css(result), /\.kdm-home-photo \{\n {2}filter: grayscale\(100%\) blur\(2px\) brightness\(90%\) contrast\(110%\) saturate\(0%\) sepia\(100%\);\n\}/);
  // Blur alone is written exactly as before.
  assert.match(css(page(image("it is blurred by 4px"))), /\.kdm-home-photo \{\n {2}filter: blur\(4px\);\n\}/);
  assert.equal(codes(page(image("the brightness is 400%")))[0], "KDM3005");
  assert.ok(codes(page(image("it is grayscale", "it is grayscale"))).includes("KDM3004"));
});

test("when hovered, it is in color removes the filters, with a transition", () => {
  const result = page(image("it is grayscale", "when hovered, it is in color"));
  assert.deepEqual(codes(result), []);
  assert.match(css(result), /\.kdm-home-photo:hover \{\n {4}filter: none;\n {2}\}/);
  assert.match(css(result), /transition: filter 150ms ease-out;/);
});

test("overlays are the top background layer of a box", () => {
  const dark = page(box("it has a dark overlay at 40%"));
  assert.deepEqual(codes(dark), []);
  assert.match(css(dark), /background-image: linear-gradient\(color-mix\(in srgb, #000000 40%, transparent\), color-mix\(in srgb, #000000 40%, transparent\)\);/);
  const over = page(["hero1 {", "    a section", '    has a "assets/b.jpg" background image', "    it has a #0F766E overlay at 30%", "    t1 {", "        a section heading", '        the text says "Hero"', "    }", "}"]);
  assert.match(css(over), /background-image: linear-gradient\(color-mix\(in srgb, #0f766e 30%, transparent\), color-mix\(in srgb, #0f766e 30%, transparent\)\), url\("\/assets\/b\.jpg"\);/);
  assert.match(css(page(box("it has a light overlay at 20%"))), /#FFFFFF 20%/);
  assert.ok(codes(page(image("it has a dark overlay at 40%"))).length > 0);
  for (const bad of ["it has a dark overlay at 140%", "it has a purple overlay", "it has a dark overlay at 0%"]) assert.equal(codes(page(box(bad)))[0], "KDM3005", bad);
});

test("shapes clip a box, and soft shapes are rounded corners", () => {
  const shapes = { circle: "clip-path: circle\\(50%\\)", hexagon: "clip-path: polygon\\(25% 0, 75% 0", diamond: "clip-path: polygon\\(50% 0, 100% 50%", triangle: "clip-path: polygon\\(50% 0, 100% 100%", ellipse: "clip-path: ellipse\\(50% 50%\\)", blob: "border-radius: 42% 58% 70% 30%", arch: "border-radius: 9999px 9999px 0 0" };
  for (const [shape, expected] of Object.entries(shapes)) {
    const article = /^[aeiou]/.test(shape) ? "an" : "a";
    assert.match(css(page(image(`it is shaped like ${article} ${shape}`))), new RegExp(expected), shape);
  }
  assert.equal(codes(page(image("it is shaped like a star")))[0], "KDM3005");
  assert.ok(codes(page(["c1 {", "    a card", "    has 12px rounded corners", "    it is shaped like a blob", "}"])).includes("KDM3004"));
});

test("it zooms slowly forever is a slow pan and zoom, off for reduced motion", () => {
  const result = page(image("it zooms slowly forever"));
  assert.deepEqual(codes(result), []);
  const text = css(result);
  assert.match(text, /animation: kdm-loop-zoom 24s ease-in-out infinite;/);
  assert.match(text, /@keyframes kdm-loop-zoom \{/);
  assert.match(text, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.kdm-home-photo \{\n {4}animation: none;/);
  assert.match(css(page(image("it zooms forever every 30s"))), /kdm-loop-zoom 30s/);
});

test("the effects work in scopes and are kadam 0.3", () => {
  const result = page(image("on phones, it is grayscale", "in dark mode, the brightness is 80%"));
  assert.deepEqual(codes(result), []);
  assert.match(css(result), /@media \(max-width: 599px\) \{\n {2}\.kdm-home-photo \{\n {4}filter: grayscale\(100%\);/);
  for (const line of ["it is grayscale", "the brightness is 90%", "it is shaped like a circle"]) {
    assert.ok(codes(page(image(line), "0.1")).includes("KDM2013"), line);
  }
});

// F8 step 2: background video.
const video = (...lines) => ["hero1 {", "    a section", "    backdrop {", "        a video", '        it plays "assets/loop.mp4"', ...lines.map((l) => `        ${l}`), "    }", "    t1 {", "        a main heading", '        the text says "Hello"', "    }", "}"];

test("a background video is muted, looping, decorative, and has a hidden pause button", () => {
  const result = page(video('the poster is "assets/poster.png"', "it plays in the background", "it is placed over its parent"));
  assert.deepEqual(codes(result), []);
  const markup = html(result);
  assert.match(markup, /<video class="kdm-home-backdrop kdm-kind-video kdm-background-video" data-kdm-id="home-backdrop" src="\/assets\/loop\.mp4" muted loop playsinline disablepictureinpicture preload="metadata" aria-hidden="true" poster="\/assets\/poster\.png"><\/video>/);
  assert.doesNotMatch(markup, /autoplay|controls/);
  assert.match(markup, /<button class="kdm-video-toggle" type="button" data-kdm-video-toggle="home-backdrop" aria-label="Pause the background video" hidden>Pause<\/button>/);
  const js = String(result.files.find((f) => f.path === "assets/kadam.home.js").contents);
  assert.match(js, /const backgroundVideos = \["home-backdrop"\];/);
  assert.match(js, /if \(reduceMotion\.matches\) show\(false\);/);
});

test("a background video needs a poster, has no captions, and only a video plays in the background", () => {
  assert.ok(codes(page(video("it plays in the background"))).includes("KDM3009"));
  assert.ok(codes(page(video('the poster is "assets/poster.png"', "it plays in the background", 'the captions are "assets/a.vtt"'))).includes("KDM3005"));
  assert.ok(codes(page(["b1 {", "    a container", "    it plays in the background", "}"])).length > 0);
  // A normal video still needs captions or it has no speech.
  assert.ok(codes(page(video('the poster is "assets/poster.png"'))).includes("KDM3009"));
});

// F8 steps 3 to 5: scroll motion, tilt, masonry, snapping and the lightbox.

test("parallax and scroll progress are scroll-driven CSS behind @supports", () => {
  const result = page([...box("it scrolls slower than the page"), "bar1 {", "    a container", "    it is 3px tall", "    it shows how far the page has scrolled", "}"]);
  assert.deepEqual(codes(result), []);
  const text = css(result);
  assert.match(text, /@supports \(animation-timeline: view\(\)\) \{\n {2}\.kdm-home-box1 \{\n {4}animation: kdm-parallax linear both;\n {4}animation-timeline: view\(\);/);
  assert.match(text, /@supports \(animation-timeline: scroll\(\)\) \{\n {2}\.kdm-home-bar1 \{\n {4}animation: kdm-scroll-progress linear both;\n {4}animation-timeline: scroll\(root\);/);
  assert.match(text, /\.kdm-home-bar1 \{[^}]*transform-origin: left center;\n {2}scale: 0 1;/);
  assert.match(text, /@keyframes kdm-parallax \{/);
  // Reduced motion turns parallax off and leaves the progress bar on.
  const reduced = text.slice(text.indexOf("prefers-reduced-motion"));
  assert.match(reduced, /kdm-home-box1/);
  assert.doesNotMatch(reduced, /kdm-home-bar1/);
  assert.ok(codes(page(box("it scrolls slower than the page", "it shows how far the page has scrolled"))).includes("KDM3004"));
  // The older sentences are unchanged.
  assert.deepEqual(codes(page(box("it scrolls vertically"))), []);
});

test("tilt, masonry and snapping", () => {
  const tilt = page(box("when hovered, it tilts by 8deg"));
  assert.deepEqual(codes(tilt), []);
  assert.match(css(tilt), /:hover \{\n {4}transform: perspective\(800px\) rotateX\(4deg\) rotateY\(-8deg\);/);
  assert.equal(codes(page(box("when hovered, it tilts by 60deg")))[0], "KDM3005");
  const masonry = page(box("it arranges its children in 3 masonry columns", "it has 12px gap between children"));
  assert.deepEqual(codes(masonry), []);
  assert.match(css(masonry), /\.kdm-home-box1 \{[^}]*display: block;\n {2}column-count: 3;/);
  assert.match(css(masonry), /\.kdm-home-box1 > \* \{\n {2}break-inside: avoid;\n {2}margin-bottom: 12px;/);
  assert.ok(codes(page(box("it arranges its children in 3 masonry columns", "it arranges its children in 2 columns"))).includes("KDM3004"));
  assert.equal(codes(page(box("it arranges its children in 9 masonry columns")))[0], "KDM3005");
  // Ordinary grids still work.
  assert.deepEqual(codes(page(box("it arranges its children in 3 columns"))), []);
  const snap = page(box("it arranges its children in a row", "it scrolls horizontally", "its children snap into place"));
  assert.match(css(snap), /scroll-snap-type: x mandatory;/);
  assert.match(css(snap), /\.kdm-home-box1 > \* \{\n {2}scroll-snap-align: start;/);
});

test("an image can open larger in a dialog; it needs a description", () => {
  const result = page(image("it opens larger when clicked"));
  assert.deepEqual(codes(result), []);
  assert.match(html(result), /<img [^>]*tabindex="0" role="button" aria-haspopup="dialog" aria-label="Open larger: A desk" data-kdm-lightbox-open="home-photo">\n\s*<dialog class="kdm-lightbox" data-kdm-lightbox="home-photo" aria-label="A desk">/);
  assert.match(String(result.files.find((f) => f.path === "assets/kadam.home.js").contents), /const lightboxes = \["home-photo"\];/);
  assert.ok(codes(page(["p1 {", "    an image", '    it shows "assets/a.jpg"', "    it is decorative", "    it opens larger when clicked", "}"])).includes("KDM3005"));
  assert.ok(codes(page(box("it opens larger when clicked"))).length > 0);
});

// F8: right-to-left pages, built-in icons, and embeds that load when clicked.

const baseCss = (result) => String(result.files?.find((f) => f.path === "assets/kadam.css")?.contents ?? "");

test("a right-to-left page sets dir and aligns Kadam's defaults to the start", () => {
  const heading = ["t1 {", "    a main heading", '    the text says "مرحبا"', "}"];
  const result = page(['the page language is "ar"', "the page direction is right to left", ...heading]);
  assert.deepEqual(codes(result), []);
  assert.match(html(result), /<html lang="ar" dir="rtl">/);
  assert.match(baseCss(result), /text-align: start;/);
  assert.doesNotMatch(baseCss(result), /text-align: left;/);
  // Left to right is said, so dir is written, and nothing else changes.
  const ltr = page(["the page direction is left to right", ...heading]);
  assert.match(html(ltr), /<html lang="en" dir="ltr">/);
  assert.match(baseCss(ltr), /text-align: left;/);
  assert.doesNotMatch(html(page(heading)), /dir=/);
  assert.equal(codes(page(["the page direction is upside down", ...heading]))[0], "KDM3005");
  assert.ok(codes(page(["the page direction is right to left", "the page direction is left to right", ...heading])).includes("KDM3004"));
});

test("a built-in icon is inline SVG in the text colour, labelled or hidden", () => {
  const icon = (...lines) => ["i1 {", "    an icon", ...lines.map((l) => `    ${l}`), "}"];
  const decorative = page(icon('it shows the icon "Arrow  Right"', "it is decorative", "the text color is red"));
  assert.deepEqual(codes(decorative), []);
  assert.match(html(decorative), /<svg class="kdm-home-i1 kdm-kind-icon" data-kdm-id="home-i1" viewBox="0 0 24 24" fill="none" stroke="currentColor" [^>]*aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"\/><\/svg>/);
  assert.match(css(decorative), /\.kdm-home-i1 \{\n {2}color: red;\n\}/);
  const labelled = page(icon('it shows the icon "mail"', 'the description says "Email us"'));
  assert.match(html(labelled), /role="img" aria-label="Email us"><rect /);
  // Only the icons a page uses are in it.
  assert.doesNotMatch(html(labelled), /M5 12h14/);
  const unknown = page(icon('it shows the icon "arow"', "it is decorative")).diagnostics.find((d) => d.message.includes("no built-in icon"));
  assert.ok(unknown !== undefined);
  assert.ok(codes(page(icon('it shows the icon "check"', "it is decorative"))).length === 0);
  assert.ok(codes(page(icon('it shows the icon "check"'))).includes("KDM3009"), "needs a description or decorative");
  assert.ok(codes(page(icon('it shows the icon "check"', 'it shows "assets/check.svg"', "it is decorative"))).includes("KDM3004"));
  assert.ok(codes(page(icon('it shows "assets/check.svg"', "it is decorative", "the text color is red"))).includes("KDM3003"), "a file icon keeps its colours");
  assert.ok(codes(page(image('it shows the icon "check"'))).includes("KDM3003"));
  // An icon from a file is unchanged.
  assert.match(html(page(icon('it shows "assets/check.svg"', "it is decorative"))), /<img class="kdm-home-i1 kdm-kind-icon" [^>]*src="\/assets\/check\.svg" alt="">/);
});

test("an embed is a link until clicked, then the runtime puts the frame in", () => {
  const result = page(box('it embeds "https://www.youtube-nocookie.com/embed/abc" titled "Product tour"'));
  assert.deepEqual(codes(result), []);
  assert.match(html(result), /<a class="kdm-embed-load" href="https:\/\/www\.youtube-nocookie\.com\/embed\/abc" target="_blank" rel="noopener noreferrer" data-kdm-embed="home-box1">Load Product tour from www\.youtube-nocookie\.com<\/a>/);
  assert.doesNotMatch(html(result), /<iframe/);
  assert.match(css(result), /\.kdm-home-box1 \{\n {2}aspect-ratio: 16 \/ 9;/);
  assert.match(String(result.files.find((f) => f.path === "assets/kadam.home.js").contents), /const embeds = \[\["home-box1","https:\/\/www\.youtube-nocookie\.com\/embed\/abc","Product tour"\]\];/);
  assert.doesNotMatch(css(page(box('it embeds "https://maps.example.com/m" titled "Map"', "it keeps a square shape"))), /16 \/ 9/);
  assert.equal(codes(page(box('it embeds "http://example.com" titled "X"')))[0], "KDM3005");
  assert.equal(codes(page(box('it embeds "https://example.com" titled ""')))[0], "KDM3005");
  assert.ok(codes(page(["b1 {", "    a button", '    the text says "Go"', '    it embeds "https://example.com" titled "X"', "}"])).includes("KDM3003"));
  assert.ok(codes(page(["c1 {", "    a container", '    it embeds "https://example.com" titled "X"', "    p1 {", "        a paragraph", '        the text says "hi"', "    }", "}"])).includes("KDM3005"));
});

test("mesh and aurora backgrounds, patterns and grain are layered CSS backgrounds", () => {
  const mesh = page(box("it has a mesh background of #0F172A, #7C3AED and #0EA5E9"));
  assert.deepEqual(codes(mesh), []);
  assert.match(css(mesh), /background-color: #0f172a;\n {2}background-image: radial-gradient\(at 15% 20%, #7c3aed 0px, transparent 55%\), radial-gradient\(at 85% 25%, #0ea5e9 0px, transparent 55%\);\n\}/);
  const aurora = page(box("it has an aurora background of teal and violet", "it has a grain texture"));
  assert.deepEqual(codes(aurora), []);
  assert.match(css(aurora), /background-image: url\("data:image\/svg\+xml,[^"]+"\), radial-gradient\(at 15% 20%, violet 0px, transparent 50%\);\n {2}background-size: 160px 160px, 200% 200%;/);
  assert.match(css(aurora), /animation: kdm-aurora 20s ease-in-out infinite alternate;/);
  assert.match(css(aurora), /@keyframes kdm-aurora \{/);
  assert.match(css(aurora).slice(css(aurora).indexOf("prefers-reduced-motion")), /kdm-home-box1 \{\n {4}animation: none;/);
  // An overlay sits on top and gets its own size entry.
  const lined = page(box("it has a lined pattern", "it has a dark overlay at 10%"));
  assert.match(css(lined), /background-size: auto, 100% 24px;/);
  assert.match(css(page(box("it has a grid pattern in #CBD5E1"))), /linear-gradient\(#CBD5E1 1px, transparent 1px\), linear-gradient\(90deg, #CBD5E1 1px, transparent 1px\);\n {2}background-size: 24px 24px, 24px 24px;/i);
  assert.match(css(page(box("it has a dotted pattern"))), /radial-gradient\(color-mix\(in srgb, currentColor 24%, transparent\) 1px, transparent 1.5px\)/);
  for (const bad of ["it has a mesh background of teal", "it has a mesh background of a, b, c, d, e", "it has a mesh background of teal,", "it has a wavy pattern", "it has a dotted pattern in"]) {
    assert.equal(codes(page(box(bad)))[0], "KDM3005", bad);
  }
  assert.ok(codes(page(box("it has a mesh background of teal and violet", "has a red background"))).includes("KDM3004"));
  assert.ok(codes(page(box("it has a dotted pattern", 'has a "assets/b.jpg" background image'))).includes("KDM3005"));
  assert.ok(codes(page(image("it has a grain texture"))).includes("KDM3003"));
});
