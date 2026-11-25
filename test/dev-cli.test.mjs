import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  HOME_PAGE,
  standardProject,
  writeProjectFile,
} from "./helpers/dev-project.mjs";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "cli", "main.js");

test("kadam check accepts a valid project without writing output", async () => {
  const projectRoot = standardProject();
  const sourceBefore = readFileSync(join(projectRoot, "pages", "home.kdm"), "utf8");

  const { stdout, stderr } = await run(process.execPath, [
    cli,
    "check",
    "--project",
    projectRoot,
  ]);

  assert.equal(stderr, "");
  assert.match(stdout, /is valid \(2 pages\)/);
  assert.match(stdout, /No files were written/);
  assert.equal(existsSync(join(projectRoot, "dist")), false);
  assert.equal(
    readFileSync(join(projectRoot, "pages", "home.kdm"), "utf8"),
    sourceBefore,
  );
});

test("kadam check reports diagnostics and exits nonzero", async () => {
  const projectRoot = standardProject();
  writeProjectFile(
    projectRoot,
    "pages/home.kdm",
    `kadam 0.1

page "Home" {
    broken1 {
        a button
    }
}
`,
  );
  const sourceBefore = readFileSync(join(projectRoot, "pages", "home.kdm"), "utf8");

  await assert.rejects(
    () =>
      run(process.execPath, [cli, "check", "--project", projectRoot]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /error\[KDM3009\]/);
      assert.match(error.stderr, /No files were written/);
      return true;
    },
  );

  assert.equal(existsSync(join(projectRoot, "dist")), false);
  assert.equal(
    readFileSync(join(projectRoot, "pages", "home.kdm"), "utf8"),
    sourceBefore,
  );
});

test("kadam check validates a single page", async () => {
  const projectRoot = standardProject();
  const file = join(projectRoot, "pages", "solo.kdm");
  writeProjectFile(
    projectRoot,
    "pages/solo.kdm",
    `kadam 0.1

page "Solo" {
    headline1 {
        a main heading
        the text says "Solo page"
    }
}
`,
  );
  const { stdout } = await run(process.execPath, [cli, "check", file]);
  assert.match(stdout, /is valid \(1 page\)/);
});

test("kadam dev serves the project and stops cleanly on SIGINT", async () => {
  const projectRoot = standardProject();
  const child = spawn(
    process.execPath,
    [
      cli,
      "dev",
      "--project",
      projectRoot,
      "--port",
      "0",
      "--no-open",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`dev server did not start:\n${stdout}\n${stderr}`)),
        15000,
      );
      const check = () => {
        const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match !== null) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      };
      child.stdout.on("data", check);
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`dev exited early (${code}):\n${stdout}\n${stderr}`));
      });
      check();
    });

    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<title>Home<\/title>/);

    child.kill("SIGINT");
    const code = await new Promise((resolve) => child.on("exit", resolve));
    assert.equal(code, 0);
    assert.match(stdout, /stopped/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
});

test("kadam dev reports a busy explicit port", async () => {
  const projectRoot = standardProject();
  const held = createServer();
  await new Promise((resolve) => held.listen(0, "127.0.0.1", resolve));
  const port = held.address().port;

  try {
    await assert.rejects(
      () =>
        run(process.execPath, [
          cli,
          "dev",
          "--project",
          projectRoot,
          "--port",
          String(port),
          "--no-open",
        ]),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /already in use/);
        return true;
      },
    );
  } finally {
    await new Promise((resolve) => held.close(resolve));
  }
});
