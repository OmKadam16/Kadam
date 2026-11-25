import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "cli", "main.js");
const example = join(root, "examples", "hello.kdm");
const golden = join(root, "test", "golden", "hello");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readTree(directory) {
  const result = new Map();
  const visit = (current) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else {
        result.set(
          relative(directory, path).split("\\").join("/"),
          readFileSync(path, "utf8"),
        );
      }
    }
  };
  visit(directory);
  return result;
}

test("kadam build writes the golden page and is byte-identical in two directories", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "kadam-build-"));
  const firstOut = join(workspace, "first");
  const secondOut = join(workspace, "second");

  const first = await run(process.execPath, [
    cli,
    "build",
    example,
    "--out",
    firstOut,
  ]);
  assert.match(first.stdout, /Built /);

  const second = await run(process.execPath, [
    cli,
    "build",
    example,
    "--out",
    secondOut,
  ]);
  assert.match(second.stdout, /Built /);

  const firstTree = readTree(firstOut);
  const secondTree = readTree(secondOut);
  assert.deepEqual([...firstTree.keys()], [
    "assets/kadam.css",
    "assets/kadam.home.css",
    "index.html",
  ]);
  assert.deepEqual(firstTree, secondTree);
  assert.equal(firstTree.get("index.html"), read("test/golden/hello/index.html"));
  assert.equal(
    firstTree.get("assets/kadam.css"),
    readFileSync(join(golden, "assets", "kadam.css"), "utf8"),
  );
  assert.equal(
    firstTree.get("assets/kadam.home.css"),
    readFileSync(join(golden, "assets", "kadam.home.css"), "utf8"),
  );
});

test("kadam build rejects an invalid file without creating output or changing source", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "kadam-invalid-"));
  const sourcePath = join(workspace, "broken.kdm");
  const source = `kadam 0.1

page "Broken" {
    button1 {
        a button
    }
}
`;
  writeFileSync(sourcePath, source, "utf8");
  const outDir = join(workspace, "dist");

  await assert.rejects(
    () =>
      run(process.execPath, [
        cli,
        "build",
        sourcePath,
        "--out",
        outDir,
      ]),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.code, 1);
      assert.match(error.stderr, /error\[KDM3009\]/);
      assert.match(error.stderr, /no files were written/);
      return true;
    },
  );

  assert.equal(existsSync(outDir), false);
  assert.equal(readFileSync(sourcePath, "utf8"), source);
});

test("kadam build reports malformed build arguments as usage errors", async () => {
  await assert.rejects(
    () =>
      run(process.execPath, [
        cli,
        "build",
        example,
        "--out",
      ]),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.code, 2);
      assert.match(error.stderr, /--out requires a directory path/);
      return true;
    },
  );
});
