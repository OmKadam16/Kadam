import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

import { compileProject } from "../dist/compiler/project.js";

// F1 exit criterion: generated pages pass axe-core (WCAG 2.x A/AA) with zero
// violations. axe-core and jsdom are dev dependencies only (D-15).
//
// jsdom does not render, so `color-contrast` cannot be measured here; it is
// disabled and remains a browser-test item (F2 Playwright suite).

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const root = fileURLToPath(new URL("..", import.meta.url));

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// The kadam 0.3 reference projects also pass axe best practices (heading
// order, landmark rules). The 0.1 examples are held to WCAG only: their
// authored content skips from h1 to h3, which is a best-practice finding in
// example content (the 0.3 outline check warns about it), not compiler output.
const PROJECTS = [
  ["examples/reference/marketing", [...WCAG, "best-practice"]],
  ["examples/reference/docs", [...WCAG, "best-practice"]],
  ["examples/canonical", [...WCAG, "best-practice"]],
  ["examples/portfolio", WCAG],
  ["examples/components", WCAG],
];

async function axeViolations(html, stylesheets, tags) {
  // Inline the stylesheets so `display: none` and layout-dependent rules see them.
  const styled = html.replace(
    /<link rel="stylesheet" href="[^"]*">/g,
    "",
  ).replace("</head>", `<style>${stylesheets.join("\n")}</style>\n</head>`);
  const dom = new JSDOM(styled, { runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(axeSource);
  const results = await dom.window.axe.run(dom.window.document, {
    runOnly: { type: "tag", values: tags },
    rules: { "color-contrast": { enabled: false } },
    resultTypes: ["violations"],
  });
  dom.window.close();
  // axe returns arrays from the jsdom realm; copy into this realm to compare.
  return Array.from(results.violations, (violation) => ({
    id: violation.id,
    help: violation.help,
    targets: Array.from(violation.nodes, (node) => Array.from(node.target).join(" ")),
  }));
}

for (const [relative, tags] of PROJECTS) {
  test(`axe-core finds no violations in ${relative}`, async () => {
    const result = compileProject({ projectRoot: `${root}${relative}` });
    assert.deepEqual(
      result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message),
      [],
    );
    const css = result.files
      .filter((file) => file.path.endsWith(".css"))
      .map((file) => [file.path, String(file.contents)]);
    const pages = result.files.filter((file) => file.path.endsWith(".html"));
    assert.ok(pages.length > 0);
    for (const page of pages) {
      const slug = page.path === "index.html" ? "home" : page.path.replace(/\/index\.html$/, "").replaceAll("/", "-");
      const sheets = css
        .filter(([path]) => path === "assets/kadam.css" || path === `assets/kadam.${slug}.css`)
        .map(([, contents]) => contents);
      const violations = await axeViolations(String(page.contents), sheets, tags);
      assert.deepEqual(violations, [], `${relative}/${page.path}`);
    }
  });
}
