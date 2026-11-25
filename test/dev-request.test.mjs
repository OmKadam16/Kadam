import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contentTypeFor,
  injectClientScript,
  resolveRequestPath,
} from "../dist/server/request.js";

const FILES = new Set([
  "index.html",
  "about/index.html",
  "assets/kadam.css",
  "assets/logo.svg",
]);

test("routes resolve to generated files at the root and at depth", () => {
  assert.deepEqual(resolveRequestPath("/", "", FILES), {
    kind: "file",
    path: "index.html",
  });
  assert.deepEqual(resolveRequestPath("/index.html", "", FILES), {
    kind: "file",
    path: "index.html",
  });
  assert.deepEqual(resolveRequestPath("/about", "", FILES), {
    kind: "redirect",
    location: "/about/",
  });
  assert.deepEqual(resolveRequestPath("/about/", "", FILES), {
    kind: "file",
    path: "about/index.html",
  });
  assert.deepEqual(resolveRequestPath("/assets/kadam.css", "", FILES), {
    kind: "file",
    path: "assets/kadam.css",
  });
  assert.equal(resolveRequestPath("/missing", "", FILES).kind, "not-found");
});

test("a base path prefixes lookups and redirects", () => {
  assert.deepEqual(resolveRequestPath("/", "/site", FILES), {
    kind: "redirect",
    location: "/site/",
  });
  assert.deepEqual(resolveRequestPath("/site", "/site", FILES), {
    kind: "redirect",
    location: "/site/",
  });
  assert.deepEqual(resolveRequestPath("/site/", "/site", FILES), {
    kind: "file",
    path: "index.html",
  });
  assert.deepEqual(resolveRequestPath("/site/about", "/site", FILES), {
    kind: "redirect",
    location: "/site/about/",
  });
  assert.deepEqual(resolveRequestPath("/site/about/", "/site", FILES), {
    kind: "file",
    path: "about/index.html",
  });
  assert.equal(resolveRequestPath("/about/", "/site", FILES).kind, "not-found");
});

test("traversal and malformed encodings are rejected before lookup", () => {
  for (const path of [
    "/../secret",
    "/%2e%2e/secret",
    "/assets/%2e%2e/index.html",
    "/assets/..%2findex.html",
    "/%00",
    "/a%5Cb",
    "/%E0%A4%A",
  ]) {
    assert.equal(
      resolveRequestPath(path, "", FILES).kind,
      "bad-request",
      path,
    );
  }
});

test("MIME types are limited to the asset allowlist", () => {
  assert.equal(contentTypeFor("index.html"), "text/html; charset=utf-8");
  assert.equal(contentTypeFor("assets/kadam.css"), "text/css; charset=utf-8");
  assert.equal(contentTypeFor("assets/logo.svg"), "image/svg+xml");
  assert.equal(contentTypeFor("assets/font.woff2"), "font/woff2");
  assert.equal(contentTypeFor("assets/photo.webp"), "image/webp");
  assert.equal(contentTypeFor("assets/data.bin"), null);
  assert.equal(contentTypeFor("no-extension"), null);
});

test("the client tag is injected exactly once and compiler output is untouched", () => {
  const html = "<!doctype html>\n<html><body>\n<main>Hi</main>\n</body>\n</html>\n";
  const injected = injectClientScript(html);

  assert.equal(injected.match(/__kadam\/client\.js/g)?.length, 1);
  assert.ok(injected.indexOf("__kadam/client.js") < injected.indexOf("</body>"));
  assert.equal(
    injected.replace(
      '<script src="/__kadam/client.js" defer></script>\n',
      "",
    ),
    html,
  );

  const withoutBody = "<main>only</main>";
  assert.match(injectClientScript(withoutBody), /<main>only<\/main>\n<script/);
});
