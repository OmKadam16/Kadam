import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));
const validFixture = fileURLToPath(
  new URL("../test/fixtures/valid/minimal.kdm", import.meta.url),
);
const invalidFixture = fileURLToPath(
  new URL("../test/fixtures/invalid/unknown-kind.kdm", import.meta.url),
);
const componentExample = fileURLToPath(
  new URL("../examples/components", import.meta.url),
);

function writeProjectFile(projectRoot, path, contents) {
  const target = join(projectRoot, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function listFiles(root, prefix = "") {
  const result = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) result.push(...listFiles(root, path));
    else result.push(path);
  }
  return result.sort();
}

test("CLI reports the implementation and language versions", async () => {
  const { stdout } = await run(process.execPath, [cli, "--version"]);
  assert.equal(stdout.trim(), "kadam 0.1.0 (language 0.1, 0.3)");
});

test("CLI exits with a usage error when no command is supplied", async () => {
  await assert.rejects(
    () => run(process.execPath, [cli]),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.code, 2);
      return true;
    },
  );
});

test("kadam parse prints the AST as JSON for a valid file", async () => {
  const { stdout, stderr } = await run(process.execPath, [cli, "parse", validFixture]);
  assert.equal(stderr, "");
  const document = JSON.parse(stdout);
  assert.equal(document.type, "document");
  assert.equal(document.version, "0.1");
  assert.equal(document.page.title, "Minimal");
});

test("kadam parse reports diagnostics and exits non-zero for an invalid file", async () => {
  await assert.rejects(
    () => run(process.execPath, [cli, "parse", invalidFixture]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /error\[KDM3001\]/);
      assert.match(error.stderr, /unknown element kind "gizmo"/);
      assert.match(error.stderr, /:3:11/);
      return true;
    },
  );
});

test("kadam check validates the component example without writing output", async () => {
  const { stderr } = await run(process.execPath, [
    cli,
    "check",
    "--project",
    componentExample,
  ]);
  assert.equal(stderr, "");
  assert.equal(existsSync(join(componentExample, "dist")), false);
});

test("kadam build writes the component example deterministically", async () => {
  const firstRoot = mkdtempSync(join(tmpdir(), "kadam-components-build-"));
  const secondRoot = mkdtempSync(join(tmpdir(), "kadam-components-build-"));
  const first = join(firstRoot, "site");
  const second = join(secondRoot, "site");

  await run(process.execPath, [
    cli,
    "build",
    "--project",
    componentExample,
    "--out",
    first,
  ]);
  await run(process.execPath, [
    cli,
    "build",
    "--project",
    componentExample,
    "--out",
    second,
  ]);

  assert.deepEqual(listFiles(first), [
    "about/index.html",
    "assets/kadam-mark.svg",
    "assets/kadam.about.css",
    "assets/kadam.css",
    "assets/kadam.home.css",
    "assets/kadam.services.css",
    "index.html",
    "services/index.html",
  ]);
  for (const path of listFiles(first)) {
    assert.deepEqual(
      readFileSync(join(first, path)),
      readFileSync(join(second, path)),
      path,
    );
  }

  const home = readFileSync(join(first, "index.html"), "utf8");
  assert.match(home, /data-kdm-id="home-pricing1-card1"/);
  assert.match(home, /data-kdm-id="home-pricing3-card1"/);
  assert.match(home, /id="home-email1-field1-input"/);
  assert.match(home, /id="home-email2-field1-input"/);
  assert.match(home, /Best value/);
  assert.equal(home.includes("<script"), false);
});

test("a component error exits nonzero and points at the component file", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "kadam-component-error-"));
  writeProjectFile(
    projectRoot,
    "kadam.json",
    JSON.stringify(
      {
        kadam: "0.1",
        name: "Broken",
        components: ["components/Broken.kdm"],
        pages: [{ source: "pages/home.kdm", route: "/" }],
      },
      null,
      2,
    ),
  );
  writeProjectFile(
    projectRoot,
    "pages/home.kdm",
    `kadam 0.1

page "Home" {
    card1 {
        a Broken
    }
}
`,
  );
  writeProjectFile(
    projectRoot,
    "components/Broken.kdm",
    `kadam 0.1

component Broken {
    card1 {
        a card
        title1 {
            a section heading
            the heading text says "{$missing}"
        }
    }
}
`,
  );

  await assert.rejects(
    () => run(process.execPath, [cli, "check", "--project", projectRoot]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /components\/Broken\.kdm:8:\d+/);
      assert.match(error.stderr, /error\[KDM3027\]/);
      return true;
    },
  );
  assert.equal(existsSync(join(projectRoot, "dist")), false);
});

test("kadam keywords prints the lexicon in sorted, machine-readable form", async () => {
  const { KEYWORDS, NAMED_COLORS } = await import("../dist/core/lexer/lexicon.js");
  const plain = await run(process.execPath, [cli, "keywords"]);
  assert.deepEqual(plain.stdout.trim().split("\n"), [...KEYWORDS].sort());

  const json = JSON.parse(
    (await run(process.execPath, [cli, "keywords", "--colors", "--core", "--json"])).stdout,
  );
  assert.deepEqual(Object.keys(json), ["colors", "core"]);
  assert.deepEqual(json.colors, [...NAMED_COLORS].sort());
  assert.ok(json.core.includes("module"));

  const properties = (await run(process.execPath, [cli, "keywords", "--properties"])).stdout.trim().split("\n");
  assert.ok(properties.includes("line height") && properties.includes("text size"));

  await assert.rejects(run(process.execPath, [cli, "keywords", "--bogus"]), (error) => {
    assert.equal(error.code, 2);
    return true;
  });
});
