import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { compileText } from "../dist/compiler/compile.js";
import { compileProject } from "../dist/compiler/project.js";
import { fluidFontSize } from "../dist/compiler/lower-f2.js";

// kadam 0.3 frontend phase F2: layout and sizing.

const codes = (result) => result.diagnostics.map((d) => d.code);
const messages = (result) => result.diagnostics.map((d) => d.message);
const html = (result) => String(result.files.find((f) => f.path === "index.html")?.contents ?? "");
const css = (result) => String(result.files.find((f) => f.path === "assets/kadam.home.css")?.contents ?? "");

function page(body, { version = "0.3", breakpoints } = {}) {
  const lines = [`kadam ${version}`, 'page "Home" {', ...body.map((l) => `    ${l}`), "}", ""];
  return compileText("home.kdm", lines.join("\n"), breakpoints === undefined ? {} : { breakpoints });
}
const el = (name, kind, ...lines) => [`${name} {`, `    a ${kind}`, ...lines.map((l) => (l.startsWith("  ") ? `  ${l}` : `    ${l}`)), "}"];
const text = (value) => `the text says ${JSON.stringify(value)}`;
const nest = (lines) => lines.map((line) => `  ${line}`);

/** The declarations of one rule, e.g. rule(result, "x1"). */
function rule(result, name, within = css(result)) {
  const match = new RegExp(`\\.kdm-home-${name} \\{\\n([^}]*)\\}`).exec(within);
  return match === null ? null : match[1].trim().split("\n").map((line) => line.trim());
}

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "kadam-f2-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return compileProject({ projectRoot: dir });
}

// ---------------------------------------------------------------------------
// Version gating

test("every F2 sentence is kadam 0.3 syntax", () => {
  const sentences = [
    "it is 50% wide",
    "it is at most 1200px wide",
    "it keeps a 16 by 9 shape",
    "it wraps its children",
    "it arranges its children in 3 columns",
    "it sticks to the top",
    "it is pinned to the bottom right",
    "it scrolls vertically",
    "the layer is 10",
  ];
  for (const sentence of sentences) {
    const result = page(el("x1", "container", sentence), { version: "0.1" });
    assert.ok(codes(result).includes("KDM2013"), sentence);
  }
});

test("the new units are kadam 0.3; 0.1 files get one version error per unit", () => {
  const result = page(el("x1", "container", "it is 80vh tall", "it has 2em padding"), { version: "0.1" });
  assert.deepEqual(codes(result), ["KDM2013", "KDM2013"]);
  assert.match(messages(result)[0], /the unit vh requires kadam 0\.3/);
  const ok = page(el("x1", "container", "it is 80vh tall", "it has 2em padding", "it is 50vw wide"));
  assert.deepEqual(codes(ok), []);
  const dynamic = page(el("x1", "container", "it is 100dvh tall"));
  assert.deepEqual(codes(dynamic), []);
  assert.match(css(dynamic), /height: 100dvh;/);
});

test("a unit with a space before it is still not a unit", () => {
  // Only px, rem, ms and s may be spaced; `2 em` stays a bare number.
  const result = page(el("x1", "container", "it has 2 em padding"));
  assert.ok(codes(result).length > 0);
});

test("new F2 words are not reserved, so 0.1 element names stay valid", () => {
  const result = page(
    el("grid", "container").concat(el("sticky", "container"), el("layer", "container")),
    { version: "0.1" },
  );
  assert.deepEqual(codes(result), []);
});

// ---------------------------------------------------------------------------
// Units and sizes

test("units and percentages reach the CSS unchanged", () => {
  const result = page(el("x1", "container", "it is 50% wide", "it is 80vh tall", "it has 2em padding"));
  assert.deepEqual(codes(result), []);
  const declarations = rule(result, "x1");
  assert.ok(declarations.includes("width: 50%;"));
  assert.ok(declarations.includes("height: 80vh;"));
  assert.ok(declarations.includes("padding-top: 2em;"));
});

test("size limits and shapes", () => {
  const result = page(el("x1", "container",
    "it is at most 1200px wide", "it is at least 50vh tall", "it is at least 10% wide", "it keeps a 16 by 9 shape"));
  assert.deepEqual(codes(result), []);
  assert.deepEqual(rule(result, "x1"), [
    "max-width: 1200px;", "min-height: 50vh;", "min-width: 10%;", "aspect-ratio: 16 / 9;",
  ]);
  const square = page(el("x1", "container", "it keeps a square shape"));
  assert.deepEqual(rule(square, "x1"), ["aspect-ratio: 1 / 1;"]);
});

test("size and shape mistakes are reported", () => {
  assert.match(messages(page(el("x1", "container", "it keeps a 16:9 shape")))[0], /./);
  assert.match(messages(page(el("x1", "container", "it keeps a 0 by 9 shape")))[0], /whole numbers from 1 to 100/);
  assert.match(messages(page(el("x1", "container", "it is at most 1200px")))[0], /invalid size limit/);
  assert.ok(page(el("x1", "container", "it is 50% wide", "the width is 300px")).diagnostics.some((d) => /duplicate/.test(d.message)));
  // A size limit does not clash with a size: both can be written.
  assert.deepEqual(codes(page(el("x1", "container", "it is 50% wide", "it is at most 600px wide"))), []);
  // Character limits stay text-field sentences (F1).
  assert.deepEqual(codes(page(el("x1", "text field", 'the label says "Name"', "it is at most 20 characters"))), []);
});

test("the same size twice is a duplicate", () => {
  const result = page(el("x1", "container", "it is at most 600px wide", "it is at most 700px wide"));
  assert.ok(result.diagnostics.some((d) => /duplicate/.test(d.message)));
});

test("fluid text becomes clamp() between 360px and 1280px viewports", () => {
  assert.equal(
    fluidFontSize({ type: "length", value: 1, unit: "rem", raw: "1rem" }, { type: "length", value: 2, unit: "rem", raw: "2rem" }),
    "clamp(1rem, 0.6087rem + 1.7391vw, 2rem)",
  );
  const result = page(el("t", "main heading", text("Hi"), "the text is between 2rem and 3.5rem"));
  assert.deepEqual(codes(result), []);
  assert.deepEqual(rule(result, "t"), ["font-size: clamp(2rem, 1.413rem + 2.6087vw, 3.5rem);"]);
  // The regular property form says the same thing.
  const regular = page(el("t", "paragraph", text("Hi"), "the text size is between 16px and 20px"));
  assert.deepEqual(codes(regular), []);
  assert.match(css(regular), /font-size: clamp\(16px, /);
});

test("fluid text is checked", () => {
  assert.match(messages(page(el("t", "paragraph", text("Hi"), "the text is between 2rem and 1rem")))[0], /smaller than the second/);
  assert.match(messages(page(el("t", "paragraph", text("Hi"), "the text is between 2vw and 4vw")))[0], /px or rem/);
  assert.match(messages(page(el("t", "paragraph", text("Hi"), "the text is between 1rem")))[0], /two sizes/);
  // It is one text size: it clashes with a fixed size.
  const clash = page(el("t", "paragraph", text("Hi"), "the text is 18px", "the text is between 1rem and 2rem"));
  assert.ok(clash.diagnostics.some((d) => /duplicate/.test(d.message)));
});

// ---------------------------------------------------------------------------
// Flex and grid

test("wrapping, spreading, and spacing children", () => {
  const result = page(el("x1", "container", "it arranges its children in a row", "it wraps its children", "it spreads its children apart"));
  assert.deepEqual(codes(result), []);
  const declarations = rule(result, "x1");
  assert.ok(declarations.includes("flex-wrap: wrap;"));
  assert.equal(declarations.at(-1), "justify-content: space-between;");
  const even = page(el("x1", "container", "it spaces its children evenly"));
  assert.deepEqual(rule(even, "x1"), ["justify-content: space-evenly;"]);
  // Spreading and spacing are the same property.
  assert.ok(page(el("x1", "container", "it spreads its children apart", "it spaces its children evenly"))
    .diagnostics.some((d) => /duplicate/.test(d.message)));
});

test("child rules follow the parent's direction", () => {
  const row = page(el("bar1", "container", "it arranges its children in a row",
    ...nest(el("a1", "paragraph", text("A"), "it grows to fill the space")),
    ...nest(el("b1", "button", text("B"), "it does not shrink", "it sits at the end"))));
  assert.deepEqual(codes(row), []);
  assert.deepEqual(rule(row, "a1"), ["flex-grow: 1;"]);
  assert.deepEqual(rule(row, "b1"), ["flex-shrink: 0;", "margin-inline-start: auto;"]);
  const column = page(el("bar1", "container", ...nest(el("b1", "button", text("B"), "it sits at the end"))));
  assert.deepEqual(rule(column, "b1"), ["margin-block-start: auto;"]);
});

test("child rules need a parent that arranges its children", () => {
  const top = page(el("a1", "paragraph", text("A"), "it grows to fill the space"));
  assert.match(messages(top)[0], /needs a parent element/);
  const inRow = page(el("t1", "table", 'the caption says "Plans"',
    ...nest(el("r1", "row", ...nest(el("c1", "cell", text("A"), "it sits at the end"))))));
  assert.match(messages(inRow).join("\n"), /needs a parent that arranges its children/);
});

test("grid columns, minimum widths, and spans", () => {
  const result = page(el("g", "container", "it arranges its children in 3 columns",
    ...nest(el("wideCard", "card", "it spans 2 columns")),
    ...nest(el("fullCard", "card", "it spans all columns"))));
  assert.deepEqual(codes(result), []);
  assert.deepEqual(rule(result, "g"), ["display: grid;", "grid-template-columns: repeat(3, minmax(0, 1fr));"]);
  assert.deepEqual(rule(result, "wideCard"), ["grid-column: span 2;"]);
  assert.deepEqual(rule(result, "fullCard"), ["grid-column: 1 / -1;"]);

  const auto = page(el("g", "container", "it arranges its children in columns at least 240px wide"));
  assert.deepEqual(rule(auto, "g"), ["display: grid;", "grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));"]);
  const one = page(el("g", "container", "it arranges its children in 1 column"));
  assert.deepEqual(codes(one), []);
});

test("a grid inside a column stretches to the full width", () => {
  const result = page(el("outer", "container", ...nest(el("g", "container", "it arranges its children in 2 columns"))));
  assert.ok(rule(result, "g").includes("align-self: stretch;"));
});

test("grid mistakes", () => {
  assert.match(messages(page(el("g", "container", "it arranges its children in 13 columns")))[0], /1 column or 2 to 12/);
  assert.match(messages(page(el("g", "container", "it arranges its children in 1 columns")))[0], /1 column or 2 to 12/);
  assert.match(messages(page(el("g", "container", "it arranges its children in columns at least 240px")))[0], /at least <width> wide/);
  // A grid replaces the row/column direction.
  assert.ok(page(el("g", "container", "it arranges its children in a row", "it arranges its children in 3 columns"))
    .diagnostics.some((d) => /duplicate/.test(d.message)));
  // A span needs a grid parent.
  const noGrid = page(el("p", "container", ...nest(el("c", "card", "it spans 2 columns"))));
  assert.match(messages(noGrid)[0], /arranges its children in columns/);
  // Grids are for containers.
  assert.equal(codes(page(el("t", "paragraph", text("x"), "it arranges its children in 3 columns")))[0], "KDM3003");
});

test("responsive grids switch column counts and back to flex", () => {
  const result = page(el("g", "container", "it arranges its children in 3 columns",
    "on phones, it arranges its children in 1 column",
    "on tablets, it arranges its children in a column"));
  assert.deepEqual(codes(result), []);
  assert.match(css(result), /@media \(max-width: 599px\) \{\n  \.kdm-home-g \{\n    display: grid;\n    grid-template-columns: repeat\(1, minmax\(0, 1fr\)\);/);
  // A row or column in a scope turns the grid back into flex.
  assert.match(css(result), /@media \(min-width: 600px\) and \(max-width: 1023px\) \{\n  \.kdm-home-g \{\n    flex-direction: column;\n    align-items: flex-start;\n    justify-content: flex-start;\n    display: flex;\n  \}/);
});

// ---------------------------------------------------------------------------
// Positioning, layers, overflow

test("sticky, pinned, and placed positions", () => {
  const result = page([
    ...el("bar1", "container", "it sticks to the top"),
    ...el("bar2x", "container", "it sticks 16px from the bottom"),
    ...el("help", "button", text("Help"), "it is pinned 24px from the bottom right"),
    ...el("rail", "container", "it is pinned to the left"),
    ...el("hero", "container",
      ...nest(el("shade", "container", "it is placed over its parent")),
      ...nest(el("badge", "paragraph", text("New"), "it is placed 8px from the top right of its parent"))),
  ]);
  assert.deepEqual(codes(result), []);
  assert.deepEqual(rule(result, "bar1"), ["position: sticky;", "top: 0;"]);
  assert.deepEqual(rule(result, "bar2x"), ["position: sticky;", "bottom: 16px;"]);
  assert.deepEqual(rule(result, "help"), ["position: fixed;", "bottom: 24px;", "right: 24px;"]);
  assert.deepEqual(rule(result, "rail"), ["position: fixed;", "left: 0;", "top: 0;", "bottom: 0;"]);
  assert.deepEqual(rule(result, "shade"), ["position: absolute;", "inset: 0;"]);
  assert.deepEqual(rule(result, "badge"), ["position: absolute;", "top: 8px;", "right: 8px;"]);
  // The parent of a placed element becomes the positioning box automatically.
  assert.deepEqual(rule(result, "hero"), ["position: relative;"]);
});

test("position mistakes", () => {
  assert.match(messages(page(el("x", "container", "it is placed over its parent")))[0], /needs a parent element/);
  assert.match(messages(page(el("x", "container", "it is pinned to the middle")))[0], /invalid position/);
  assert.match(messages(page(el("x", "container", "it sticks to the left")))[0], /top or the bottom/);
  assert.match(messages(page(el("p", "container", ...nest(el("x", "container", "it is placed at the top")))))[0], /names a spot/);
  // Sticky and pinned are one position.
  assert.ok(page(el("x", "container", "it sticks to the top", "it is pinned to the top"))
    .diagnostics.some((d) => /duplicate/.test(d.message)));
});

test("two elements pinned to the same spot get a warning", () => {
  const result = page([
    ...el("a1", "button", text("A"), "it is pinned to the bottom right"),
    ...el("b1", "button", text("B"), "it is pinned to the bottom right"),
  ]);
  assert.deepEqual(codes(result), ["KDM3038"]);
  assert.equal(result.diagnostics[0].severity, "warning");
  assert.ok(result.ok, "a warning never blocks output");
});

test("the layer sets z-index and positions the element when needed", () => {
  const plain = page(el("x", "container", "the layer is 5"));
  assert.deepEqual(rule(plain, "x"), ["z-index: 5;", "position: relative;"]);
  const sticky = page(el("x", "container", "it sticks to the top", "the layer is 10"));
  assert.deepEqual(rule(sticky, "x"), ["position: sticky;", "top: 0;", "z-index: 10;"]);
  assert.match(messages(page(el("x", "container", "the layer is 2.5")))[0], /whole number/);
  assert.match(messages(page(el("x", "container", "the layer is 5000")))[0], /between 0 and 1000/);
});

test("scroll containers are focusable", () => {
  const result = page(el("log", "container", "it is at most 240px tall", "it scrolls vertically"));
  assert.deepEqual(codes(result), []);
  assert.deepEqual(rule(result, "log"), ["max-height: 240px;", "overflow-y: auto;"]);
  assert.match(html(result), /data-kdm-id="home-log" tabindex="0"/);
  const hidden = page(el("box", "container", "it hides its overflow"));
  assert.deepEqual(rule(hidden, "box"), ["overflow: hidden;"]);
  assert.doesNotMatch(html(hidden), /tabindex/);
  const sideways = page(el("strip", "container", "it scrolls horizontally"));
  assert.deepEqual(rule(sideways, "strip"), ["overflow-x: auto;"]);
});

// ---------------------------------------------------------------------------
// Images

const image = (name, ...lines) => el(name, "image", 'it shows "assets/a.png"', 'the description says "A"', ...lines);

test("image fit and focus", () => {
  const result = page(image("photo", "it keeps a 4 by 3 shape", "it fills its box", "it keeps the top right in view"));
  assert.deepEqual(codes(result), []);
  assert.deepEqual(rule(result, "photo"), ["aspect-ratio: 4 / 3;", "object-fit: cover;", "object-position: right top;"]);
  const contain = page(image("photo", "it fits inside its box", "it keeps the center in view"));
  assert.deepEqual(rule(contain, "photo"), ["object-fit: contain;", "object-position: center;"]);
  const top = page(image("photo", "it keeps the top in view"));
  assert.deepEqual(rule(top, "photo"), ["object-position: center top;"]);
  assert.equal(codes(page(el("x", "container", "it fills its box")))[0], "KDM3003");
});

test("images after the first load lazily on 0.3 pages", () => {
  const result = page([...image("first"), ...image("second"), ...image("third", "it loads right away"), ...image("fourth", "it loads lazily")]);
  assert.deepEqual(codes(result), []);
  const tags = html(result).split("\n").filter((line) => line.includes("<img"));
  assert.doesNotMatch(tags[0], /loading=/);
  assert.match(tags[1], /loading="lazy"/);
  assert.doesNotMatch(tags[2], /loading=/);
  assert.match(tags[3], /loading="lazy"/);
  const explicit = page([...image("first", "it loads lazily")]);
  assert.match(html(explicit), /loading="lazy"/);
  assert.equal(codes(page(el("x", "container", "it loads lazily")))[0], "KDM3003");
});

test("0.1 images never get a loading attribute", () => {
  const result = page([...image("first"), ...image("second")].filter((line) => !line.includes("description")), { version: "0.1" });
  assert.doesNotMatch(html(result), /loading=/);
});

// ---------------------------------------------------------------------------
// Custom breakpoints and container queries

test("custom breakpoints come from kadam.json and emit min-width queries in order", () => {
  const result = page(el("g", "container", "it arranges its children in 2 columns",
    "on huge screens, it arranges its children in 6 columns",
    "on wide screens, it arranges its children in 4 columns"), { breakpoints: new Map([["wide", 1440], ["huge", 1920]]) });
  assert.deepEqual(codes(result), []);
  const out = css(result);
  assert.ok(out.indexOf("@media (min-width: 1440px)") < out.indexOf("@media (min-width: 1920px)"));
  assert.match(out, /@media \(min-width: 1440px\) \{\n  \.kdm-home-g \{\n    display: grid;\n    grid-template-columns: repeat\(4, /);
});

test("an unknown breakpoint names kadam.json", () => {
  const result = page(el("g", "container", "on wide screens, it is hidden"));
  assert.match(messages(result)[0], /unknown breakpoint "wide"/);
  assert.match(result.diagnostics[0].hint, /kadam\.json/);
  assert.equal(codes(page(el("g", "container", "on wide screens it is hidden"), { breakpoints: new Map([["wide", 1440]]) }))[0], "KDM2010");
});

test("container conditions make the parent a query container", () => {
  const result = page(el("card1", "card",
    ...nest(el("row1", "container", "it arranges its children in a row",
      "when its parent is narrower than 400px, it arranges its children in a column",
      "when its parent is wider than 50rem, it has 32px gap between children"))));
  assert.deepEqual(codes(result), []);
  const out = css(result);
  // Top-level: the page is a plain block, so no stretch is needed.
  assert.deepEqual(rule(result, "card1"), ["container-type: inline-size;"]);
  assert.match(out, /@container \(width < 400px\) \{\n  \.kdm-home-row1 \{\n    flex-direction: column;/);
  assert.match(out, /@container \(width > 50rem\) \{\n  \.kdm-home-row1 \{\n    gap: 32px;/);
  // Wider conditions come before narrower ones so the narrow layout wins.
  assert.ok(out.indexOf("@container (width > 50rem)") < out.indexOf("@container (width < 400px)"));
});

test("a container condition parent in a column stretches instead of collapsing", () => {
  const result = page(el("outer", "container",
    ...nest(el("card1", "card", ...nest(el("row1", "container", "when its parent is narrower than 300px, it is hidden"))))));
  assert.deepEqual(rule(result, "card1"), ["container-type: inline-size;", "align-self: stretch;"]);
});

test("container condition mistakes", () => {
  assert.match(messages(page(el("x", "container", "when its parent is narrower than 400px, it is hidden")))[0], /needs a parent element/);
  assert.match(messages(page(el("p", "container", ...nest(el("x", "container", "when its parent is smaller than 400px, it is hidden")))))[0], /narrower or wider/);
  assert.match(messages(page(el("p", "container", ...nest(el("x", "container", "when its parent is narrower than 40%, it is hidden")))))[0], /narrower or wider/);
  const nested = page(el("p", "container", ...nest(el("x", "container", "on phones, when its parent is narrower than 400px, it is hidden"))));
  assert.match(messages(nested)[0], /cannot be nested/);
  const old = page(el("p", "container", ...nest(el("x", "container", "when its parent is narrower than 400px, it is hidden"))), { version: "0.1" });
  assert.ok(codes(old).includes("KDM2013"));
});

test("kadam.json breakpoints are validated and require kadam 0.3", () => {
  const pageSource = 'page "Home" {\n    x1 {\n        a container\n        on wide screens, it is hidden\n    }\n}\n';
  const good = project({
    "kadam.json": JSON.stringify({ kadam: "0.3", name: "t", breakpoints: { wide: 1440 }, pages: [{ source: "home.kdm", route: "/" }] }),
    "home.kdm": pageSource,
  });
  assert.deepEqual(good.diagnostics.map((d) => d.message), []);
  assert.ok(good.files.some((f) => String(f.contents).includes("@media (min-width: 1440px)")));
  const old = project({
    "kadam.json": JSON.stringify({ kadam: "0.1", name: "t", breakpoints: { wide: 1440 }, pages: [{ source: "home.kdm", route: "/" }] }),
    "home.kdm": pageSource,
  });
  assert.ok(old.diagnostics.some((d) => /requires "kadam": "0\.3"/.test(d.message)));
  for (const breakpoints of [{ phones: 400 }, { Wide: 1 }, { wide: 0 }, { wide: 1.5 }, [1440]]) {
    const bad = project({
      "kadam.json": JSON.stringify({ kadam: "0.3", name: "t", breakpoints, pages: [{ source: "home.kdm", route: "/" }] }),
      "home.kdm": pageSource,
    });
    assert.ok(bad.diagnostics.some((d) => d.code === "KDM4001"), JSON.stringify(breakpoints));
  }
});
