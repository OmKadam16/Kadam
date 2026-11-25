import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileProject } from "../dist/compiler/project.js";
import { compileText } from "../dist/compiler/compile.js";
import { parseInline } from "../dist/core/data/markdown.js";
import { DevSession } from "../dist/server/dev-session.js";

// F5 step 4 (D-40): Markdown documents.

const DOC = [
  "# Getting started",
  "",
  "Kadam is **small** and *strict*. Run `kadam build` to build, and read",
  "the [spec](https://example.com/spec) for more. Small is **small**.",
  "",
  "## Install",
  "",
  "- Install Node",
  "- Run `npm install`",
  "",
  "1. First",
  "2. Second",
  "",
  "```",
  "kadam build",
  "kadam dev",
  "```",
  "",
  "---",
  "",
  "snake_case_names stay literal, and 2 * 3 is 6.",
  "",
].join("\n");

function project(doc = DOC, page = null, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "kadam-md-"));
  mkdirSync(join(root, "pages"));
  mkdirSync(join(root, "content"));
  writeFileSync(join(root, "content", "intro.md"), doc);
  for (const [path, text] of Object.entries(extra)) if (path !== "manifest") writeFileSync(join(root, path), text);
  writeFileSync(
    join(root, "pages", "home.kdm"),
    page ?? ["kadam 0.3", "", 'page "Home" {', "    intro {", "        an article", '        it shows the document "content/intro.md"', "    }", "}", ""].join("\n"),
  );
  writeFileSync(join(root, "kadam.json"), JSON.stringify({ kadam: "0.3", name: "md", pages: [{ source: "pages/home.kdm", route: "/" }], ...(extra.manifest ?? {}) }));
  const result = compileProject({ projectRoot: root, write: false });
  result.root = root;
  return result;
}
const codes = (result) => result.diagnostics.map((d) => d.code);
const html = (result, path = "index.html") => String(result.files.find((f) => f.path === path)?.contents ?? "");

test("a Markdown document becomes ordinary, checked elements", () => {
  const result = project();
  assert.deepEqual(codes(result), []);
  const out = html(result);
  assert.match(out, /<h1[^>]*>Getting started<\/h1>/);
  assert.match(out, /<h2[^>]*>Install<\/h2>/);
  // The same word bold twice is fine in a document.
  assert.equal((out.match(/<strong>small<\/strong>/g) ?? []).length, 2);
  assert.match(out, /<em>strict<\/em>/);
  assert.match(out, /<code class="kdm-inline-code">kadam build<\/code>/);
  assert.match(out, /<a class="kdm-inline-link" href="https:\/\/example.com\/spec"[^>]*>spec<\/a>/);
  assert.match(out, /<ul[^>]*>[\s\S]*Install Node[\s\S]*<\/ul>/);
  assert.match(out, /<ol[^>]*>[\s\S]*Second[\s\S]*<\/ol>/);
  assert.match(out, /<pre[^>]*><code[^>]*>kadam build/);
  assert.match(out, /<hr/);
  assert.match(out, /snake_case_names stay literal, and 2 \* 3 is 6\./);
  assert.match(String(result.files.find((f) => f.path === "assets/kadam.css").contents), /\.kdm-inline-code \{/);
  assert.ok(!result.files.some((f) => String(f.path).endsWith(".js")));
});

test("page rules see the document: a second main heading is an error", () => {
  const page = ["kadam 0.3", "", 'page "Home" {', "    title1 {", "        a main heading", '        the text says "Home"', "    }", "    intro {", "        an article", '        it shows the document "content/intro.md"', "    }", "}", ""].join("\n");
  assert.deepEqual(project(DOC, page).diagnostics.map((d) => d.message), ["a page has at most one main heading"]);
});

test("unsupported Markdown is a clear error, never passed through", () => {
  const cases = {
    "<div>raw</div>\n": /raw HTML/,
    "Text with <b>tags</b>.\n": /raw HTML/,
    "> quoted\n": /quotes/,
    "| a | b |\n": /tables/,
    "##### deep\n": /deeper than/,
    "```\nnever closed\n": /never closed/,
    "[local](pages/other.md)\n": /not a full http/,
    "**bold *and* italic**\n": /nested/,
    "![](assets/x.png)\n": /needs a description/,
    "- one\n  - nested\n": /nested lists/,
  };
  for (const [doc, message] of Object.entries(cases)) {
    const result = project(doc);
    assert.deepEqual(codes(result), ["KDM4011"], doc);
    assert.match(result.diagnostics[0].message, message, doc);
    assert.equal(result.diagnostics[0].span.file, "content/intro.md");
  }
});

test("missing documents, wrong kinds, single files, and kadam 0.1 are errors", () => {
  const page = (kind, path = "content/intro.md", v = "0.3") => ["kadam " + v, "", 'page "Home" {', "    intro {", `        ${kind}`, `        it shows the document "${path}"`, "    }", "}", ""].join("\n");
  assert.deepEqual(codes(project(DOC, page("an article", "content/nope.md"))), ["KDM4011"]);
  assert.ok(codes(project(DOC, page("a paragraph"))).length > 0);
  assert.deepEqual(codes(compileText("home.kdm", page("an article"))), ["KDM3042"]);
  assert.ok(codes(compileText("home.kdm", page("an article", "content/intro.md", "0.1"))).includes("KDM2013"));
});

test("a page made for each record can show its own Markdown body", () => {
  const post = ["kadam 0.3", "", 'page "{the title of post}" for each post in posts {', "    body1 {", "        an article", '        it shows the document "{the body of post}"', "    }", "}", ""].join("\n");
  const result = project("# Unused\n", ["kadam 0.3", "", 'page "Home" {', "    t {", "        a main heading", '        the text says "Home"', "    }", "}", ""].join("\n"), {
    "content/a.md": "# Post A\n\nAlpha body.\n",
    "content/b.md": "# Post B\n\nBeta body.\n",
    "posts.json": JSON.stringify([{ slug: "a", title: "A", body: "content/a.md" }, { slug: "b", title: "B", body: "content/b.md" }]),
    manifest: {
      data: { posts: "posts.json" },
      pages: [{ source: "pages/home.kdm", route: "/" }, { source: "pages/post.kdm", route: "/posts/:slug" }],
    },
  });
  // Write the post page after the project helper created the folder.
  writeFileSync(join(result.root, "pages", "post.kdm"), post);
  const built = compileProject({ projectRoot: result.root, write: false });
  assert.deepEqual(built.diagnostics.map((d) => d.message), []);
  assert.match(html(built, "posts/b/index.html"), /Beta body\./);
  const session = new DevSession({ projectRoot: result.root });
  assert.equal(session.build().ok, true);
  assert.ok(session.watchPaths.includes("content/a.md"));
});

test("inline parsing keeps plain punctuation", () => {
  assert.deepEqual(parseInline("a * b and \\*not italic\\*"), { text: "a * b and *not italic*", spans: [] });
  assert.equal(parseInline("[x](https://e.com)").spans[0].effect.url, "https://e.com");
});
