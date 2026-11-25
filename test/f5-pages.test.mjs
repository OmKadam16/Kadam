import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileProject } from "../dist/compiler/project.js";

// F5 step 3 (D-40): one page per record.

const POSTS = JSON.stringify([
  { slug: "hello-world", title: "Hello world", summary: "The first post." },
  { slug: "data-lists", title: "Data lists", summary: "Repeating components." },
]);

const POST_PAGE = [
  "kadam 0.3",
  "",
  'page "{the title of post}" for each post in posts {',
  "    headline {",
  "        a main heading",
  '        the text says "{the title of post}"',
  "    }",
  "    summary1 {",
  "        a paragraph",
  '        the text says "{the summary of post}"',
  "    }",
  "    back {",
  "        a link",
  '        the text says "All posts"',
  '        when clicked, go to page "Blog"',
  "    }",
  "}",
  "",
].join("\n");

const BLOG_PAGE = [
  "kadam 0.3",
  "",
  'page "Blog" {',
  "    first {",
  "        a link",
  '        the text says "Read the first post"',
  '        when clicked, go to page "Hello world"',
  "    }",
  "}",
  "",
].join("\n");

function project({ post = POST_PAGE, posts = POSTS, route = "/blog/:slug", kadam = "0.3", blog = BLOG_PAGE } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kadam-pages-"));
  mkdirSync(join(root, "pages"));
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "pages", "post.kdm"), post);
  writeFileSync(join(root, "pages", "blog.kdm"), blog);
  writeFileSync(join(root, "data", "posts.json"), posts);
  writeFileSync(
    join(root, "kadam.json"),
    JSON.stringify({
      kadam,
      name: "blog",
      data: { posts: "data/posts.json" },
      pages: [
        { source: "pages/blog.kdm", route: "/" },
        { source: "pages/post.kdm", route },
      ],
    }),
  );
  return compileProject({ projectRoot: root, write: false });
}

const codes = (result) => result.diagnostics.map((d) => d.code);
const file = (result, path) => String(result.files.find((f) => f.path === path)?.contents ?? "");

test("a page made for each record builds one checked page per record", () => {
  const result = project();
  assert.deepEqual(codes(result), []);
  const first = file(result, "blog/hello-world/index.html");
  const second = file(result, "blog/data-lists/index.html");
  assert.match(first, /<title>Hello world<\/title>/);
  assert.match(first, /The first post\./);
  assert.match(second, /<h1[^>]*>Data lists<\/h1>/);
  // Navigation works both ways, by page title.
  assert.match(file(result, "index.html"), /href="\/blog\/hello-world\/"/);
  assert.match(first, /href="\/"/);
});

test("fields, routes, and record names are checked", () => {
  const typo = project({ post: POST_PAGE.replace("{the summary of post}", "{the sumary of post}") });
  assert.deepEqual(codes(typo), ["KDM3043"]);
  assert.match(typo.diagnostics[0].hint, /did you mean: summary/);
  assert.deepEqual(codes(project({ route: "/blog/:slg" })), ["KDM3043"]);
  assert.deepEqual(codes(project({ route: "/blog" })), ["KDM3044"]);
  const badSlug = project({ posts: JSON.stringify([{ slug: "Hello World", title: "A", summary: "x" }]) });
  assert.deepEqual(codes(badSlug), ["KDM3043"]);
  assert.match(badSlug.diagnostics[0].message, /cannot be part of a URL/);
  const same = project({ posts: JSON.stringify([{ slug: "a", title: "A", summary: "x" }, { slug: "a", title: "B", summary: "y" }]) });
  assert.deepEqual(codes(same), ["KDM4005"]);
  const missing = project({ posts: JSON.stringify([{ slug: "a", title: "A" }, { slug: "b", title: "B", summary: "y" }]) });
  assert.deepEqual(codes(missing), ["KDM3043"]);
  assert.match(missing.diagnostics[0].message, /record 1 in "posts" has no summary/);
});

test("two records with the same title are duplicate pages", () => {
  const result = project({ posts: JSON.stringify([{ slug: "a", title: "A", summary: "x" }, { slug: "b", title: "A", summary: "y" }]) });
  assert.ok(codes(result).includes("KDM3011"));
});

test("record fields need a page made for each record, and kadam 0.3", () => {
  const loose = BLOG_PAGE.replace('"Read the first post"', '"{the title of post}"');
  assert.deepEqual(codes(project({ blog: loose })), ["KDM3041"]);
  const plain = POST_PAGE.replace(" for each post in posts", "").replace('page "{the title of post}"', 'page "Post"');
  assert.deepEqual(codes(project({ post: plain.replace(/\{the \w+ of post\}/g, "x") })), ["KDM3044"]);
  assert.ok(codes(project({ kadam: "0.1" })).includes("KDM4001"));
});

test("it is centered centers the box itself, and is kadam 0.3", async () => {
  const { compileText } = await import("../dist/compiler/compile.js");
  const page = (v) => compileText("home.kdm", [`kadam ${v}`, 'page "Home" {', "    col {", "        a container", "        it is at most 720px wide", "        it is centered", "    }", "}", ""].join("\n"));
  const result = page("0.3");
  assert.deepEqual(codes(result), []);
  const css = String(result.files.find((f) => f.path === "assets/kadam.home.css").contents);
  assert.match(css, /\.kdm-home-col \{\n {2}max-width: 720px;\n {2}margin-inline: auto;\n\}/);
  assert.ok(codes(page("0.1")).includes("KDM2013"));
});
