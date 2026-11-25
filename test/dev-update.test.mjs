import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planUpdate,
  snapshotFromFiles,
} from "../dist/server/update-plan.js";

function snapshot(files, buildId) {
  return snapshotFromFiles(files, buildId);
}

test("identical output produces no browser update", () => {
  const files = [
    { path: "index.html", contents: "<html></html>", kind: "html" },
    { path: "assets/kadam.home.css", contents: "body {}", kind: "css" },
  ];
  const first = snapshot(files, 1);
  const second = snapshot(files, 2);
  assert.deepEqual(planUpdate(first, second), { kind: "none" });
});

test("the first successful build asks for a reload", () => {
  const next = snapshot(
    [{ path: "index.html", contents: "<html></html>", kind: "html" }],
    1,
  );
  assert.deepEqual(planUpdate(null, next), {
    kind: "reload",
    reason: "first-build",
  });
});

test("stylesheets alone produce a CSS-only update", () => {
  const before = snapshot(
    [
      { path: "index.html", contents: "<html></html>", kind: "html" },
      { path: "assets/kadam.home.css", contents: "h1 { font-size: 40px; }", kind: "css" },
      { path: "assets/kadam.css", contents: "body {}", kind: "css" },
    ],
    1,
  );
  const after = snapshot(
    [
      { path: "index.html", contents: "<html></html>", kind: "html" },
      { path: "assets/kadam.home.css", contents: "h1 { font-size: 44px; }", kind: "css" },
      { path: "assets/kadam.css", contents: "body {}", kind: "css" },
    ],
    2,
  );

  assert.deepEqual(planUpdate(before, after), {
    kind: "css",
    paths: ["assets/kadam.home.css"],
  });
});

test("HTML changes force a full reload", () => {
  const before = snapshot(
    [
      { path: "index.html", contents: "<h1>One</h1>", kind: "html" },
      { path: "assets/kadam.home.css", contents: "h1 {}", kind: "css" },
    ],
    1,
  );
  const after = snapshot(
    [
      { path: "index.html", contents: "<h1>Two</h1>", kind: "html" },
      { path: "assets/kadam.home.css", contents: "h1 {}", kind: "css" },
    ],
    2,
  );
  assert.deepEqual(planUpdate(before, after), {
    kind: "reload",
    reason: "html",
  });
});

test("asset changes reload so images and fonts refresh", () => {
  const before = snapshot(
    [
      { path: "index.html", contents: "<img>", kind: "html" },
      { path: "assets/logo.svg", contents: "a", kind: "asset" },
    ],
    1,
  );
  const after = snapshot(
    [
      { path: "index.html", contents: "<img>", kind: "html" },
      { path: "assets/logo.svg", contents: "b", kind: "asset" },
    ],
    2,
  );
  assert.deepEqual(planUpdate(before, after), {
    kind: "reload",
    reason: "assets",
  });
});

test("removing a page is an HTML change", () => {
  const before = snapshot(
    [
      { path: "index.html", contents: "home", kind: "html" },
      { path: "about/index.html", contents: "about", kind: "html" },
    ],
    1,
  );
  const after = snapshot(
    [{ path: "index.html", contents: "home", kind: "html" }],
    2,
  );
  assert.deepEqual(planUpdate(before, after), {
    kind: "reload",
    reason: "html",
  });
});
