import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createWatcher, isIgnoredChange } from "../dist/server/watch.js";
import { standardProject } from "./helpers/dev-project.mjs";

test("output, dependencies, and dotfiles are ignored", () => {
  assert.equal(isIgnoredChange("dist/index.html", "dist"), true);
  assert.equal(isIgnoredChange("node_modules/pkg/index.js", "dist"), true);
  assert.equal(isIgnoredChange(".git/config", "dist"), true);
  assert.equal(isIgnoredChange(".env", "dist"), true);
  assert.equal(isIgnoredChange("pages/home.kdm", "dist"), false);
  assert.equal(isIgnoredChange("assets/logo.svg", "dist"), false);
});

test("a polling watcher reports a changed page", async () => {
  const projectRoot = standardProject();
  const changed = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("watcher did not report the change")),
      8000,
    );
    const watcher = createWatcher({
      projectRoot,
      outDir: join(projectRoot, "dist"),
      poll: true,
      debounceMs: 10,
      onChange: (paths) => {
        clearTimeout(timer);
        watcher.close();
        resolve(paths);
      },
    });
    watcher.update(["kadam.json", "pages/home.kdm"]);

    setTimeout(() => {
      mkdirSync(join(projectRoot, "pages"), { recursive: true });
      writeFileSync(
        join(projectRoot, "pages", "home.kdm"),
        "kadam 0.1\n\npage \"Home\" {\n}\n",
        "utf8",
      );
    }, 350);
  });

  const paths = await changed;
  assert.deepEqual(paths, ["pages/home.kdm"]);
});
