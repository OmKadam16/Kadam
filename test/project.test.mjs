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
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { compileProject } from "../dist/compiler/project.js";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "cli", "main.js");

const HOME_PAGE = `kadam 0.1

page "Home" {
    aboutLink1 {
        a link
        the link text says "About us"
        when clicked, go to page "About"
    }

    logo1 {
        an image
        it shows "assets/logo.svg"
        the description says "The Kadam logo"
    }
}
`;

const ABOUT_PAGE = `kadam 0.1

page "About" {
    homeLink1 {
        a link
        the link text says "Home"
        when clicked, go to page "Home"
    }

    teamLink1 {
        a link
        the link text says "Team"
        when clicked, go to page "Team"
    }

    logo2 {
        an image
        it shows "assets/logo.svg"
        the description says "The Kadam logo again"
    }
}
`;

const TEAM_PAGE = `kadam 0.1

page "Team" {
    aboutLink1 {
        a link
        the link text says "About"
        when clicked, go to page "About"
    }

    hero1 {
        an image
        it shows "assets/hero.webp"
        the description says "The team at work"
    }
}
`;

const LOGO = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n";
const HERO = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02, 0x03]);

function standardManifest(extra = {}) {
  return {
    kadam: "0.1",
    name: "MultiPage",
    pages: [
      { title: "Home", source: "pages/home.kdm", route: "/" },
      { title: "About", source: "pages/about.kdm", route: "/about" },
      { title: "Team", source: "pages/team.kdm", route: "/about/team" },
    ],
    ...extra,
  };
}

function createProject(files, manifest) {
  const projectRoot = mkdtempSync(join(tmpdir(), "kadam-project-"));
  if (manifest !== undefined) {
    writeFileSync(
      join(projectRoot, "kadam.json"),
      typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2),
      "utf8",
    );
  }
  for (const [path, contents] of Object.entries(files)) {
    const target = join(projectRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return projectRoot;
}

function standardProject(extra = {}) {
  return createProject(
    {
      "pages/home.kdm": HOME_PAGE,
      "pages/about.kdm": ABOUT_PAGE,
      "pages/team.kdm": TEAM_PAGE,
      "assets/logo.svg": LOGO,
      "assets/hero.webp": HERO,
    },
    standardManifest(extra),
  );
}

function singlePageProject(source, manifest) {
  return createProject({ "pages/home.kdm": source }, manifest ?? {
    kadam: "0.1",
    name: "Single",
    pages: [{ title: "Home", source: "pages/home.kdm", route: "/" }],
  });
}

function manifestWith(pages, extra = {}) {
  return { kadam: "0.1", name: "Project", pages, ...extra };
}

function filesByPath(result) {
  return new Map(result.files.map((file) => [file.path, file.contents]));
}

function textAt(files, path) {
  const contents = files.get(path);
  assert.ok(contents !== undefined, `expected output ${path}`);
  return typeof contents === "string" ? contents : contents.toString("utf8");
}

function bytesAt(files, path) {
  const contents = files.get(path);
  assert.ok(contents !== undefined, `expected output ${path}`);
  return Buffer.from(contents);
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
          readFileSync(path),
        );
      }
    }
  };
  visit(directory);
  return result;
}

function diagnosticCodes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

// --- Valid multi-page projects -------------------------------------------

test("a multi-page project builds nested routes, page CSS, and copied assets", () => {
  const projectRoot = standardProject();
  const result = compileProject({ projectRoot });

  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(
    result.files.map((file) => file.path),
    [
      "about/index.html",
      "about/team/index.html",
      "assets/hero.webp",
      "assets/kadam.about-team.css",
      "assets/kadam.about.css",
      "assets/kadam.css",
      "assets/kadam.home.css",
      "assets/logo.svg",
      "index.html",
    ],
  );

  const files = filesByPath(result);
  const home = textAt(files, "index.html");
  const about = textAt(files, "about/index.html");
  const team = textAt(files, "about/team/index.html");

  assert.match(home, /<title>Home<\/title>/);
  assert.match(home, /href="\/about\/"/);
  assert.match(home, /href="\/assets\/kadam\.home\.css"/);
  assert.match(home, /href="\/assets\/kadam\.css"/);
  assert.match(home, /src="\/assets\/logo\.svg"/);

  assert.match(about, /href="\/"/);
  assert.match(about, /href="\/about\/team\/"/);
  assert.match(about, /href="\/assets\/kadam\.about\.css"/);

  assert.match(team, /href="\/about\/"/);
  assert.match(team, /href="\/assets\/kadam\.about-team\.css"/);
  assert.match(team, /src="\/assets\/hero\.webp"/);

  assert.deepEqual(bytesAt(files, "assets/logo.svg"), Buffer.from(LOGO));
  assert.deepEqual(bytesAt(files, "assets/hero.webp"), HERO);
  assert.match(textAt(files, "assets/kadam.about.css"), /body \{/);

  // One copy per referenced asset even though two pages use the logo.
  assert.equal(result.pages.length, 3);
  assert.deepEqual(
    result.files.filter((file) => file.path === "assets/logo.svg").length,
    1,
  );
});

test("root and nested routes map to directory-style output", () => {
  const projectRoot = standardProject();
  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true);

  assert.deepEqual(
    result.pages.map((page) => [page.route, page.routeSlug, page.outputPath]),
    [
      ["/", "home", "index.html"],
      ["/about/", "about", "about/index.html"],
      ["/about/team/", "about-team", "about/team/index.html"],
    ],
  );
});

test("the manifest outDir is resolved against the project root", () => {
  const projectRoot = standardProject({ outDir: "public" });
  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true);
  assert.equal(result.outDir, join(projectRoot, "public"));
});

test("an explicit outDir overrides the manifest", () => {
  const projectRoot = standardProject({ outDir: "public" });
  const outDir = join(mkdtempSync(join(tmpdir(), "kadam-out-")), "site");
  const result = compileProject({ projectRoot, outDir });
  assert.equal(result.ok, true);
  assert.equal(result.outDir, outDir);
});

test("a base path prefixes navigation, stylesheets, and asset URLs", () => {
  const projectRoot = standardProject();
  const result = compileProject({ projectRoot, basePath: "/site" });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const files = filesByPath(result);
  const home = textAt(files, "index.html");
  const team = textAt(files, "about/team/index.html");

  assert.match(home, /href="\/site\/about\/"/);
  assert.match(home, /href="\/site\/assets\/kadam\.css"/);
  assert.match(home, /src="\/site\/assets\/logo\.svg"/);
  assert.match(team, /href="\/site\/about\/"/);
  assert.match(team, /href="\/site\/assets\/kadam\.about-team\.css"/);
  assert.match(team, /src="\/site\/assets\/hero\.webp"/);
});

test("project compilation is byte-identical across runs", () => {
  const projectRoot = standardProject();
  const first = compileProject({ projectRoot });
  const second = compileProject({ projectRoot });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.files, second.files);
  assert.equal(JSON.stringify(first.pages), JSON.stringify(second.pages));
});

// --- Manifest validation --------------------------------------------------

test("invalid JSON in the manifest fails with KDM4001", () => {
  const projectRoot = createProject({ "pages/home.kdm": HOME_PAGE }, "{ pages: []");
  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.deepEqual(diagnosticCodes(result), ["KDM4001"]);
  assert.deepEqual(result.files, []);
});

test("a manifest without a name, pages, or with unknown keys is rejected", () => {
  const missingName = createProject(
    { "pages/home.kdm": HOME_PAGE },
    { pages: [{ source: "pages/home.kdm", route: "/" }] },
  );
  assert.ok(diagnosticCodes(compileProject({ projectRoot: missingName })).includes("KDM4001"));

  const noPages = createProject({ "pages/home.kdm": HOME_PAGE }, {
    name: "Empty",
    pages: [],
  });
  assert.ok(diagnosticCodes(compileProject({ projectRoot: noPages })).includes("KDM4006"));

  const unknownKey = createProject(
    { "pages/home.kdm": HOME_PAGE },
    { name: "Unknown", pages: [{ source: "pages/home.kdm", route: "/" }], theme: "dark" },
  );
  assert.ok(diagnosticCodes(compileProject({ projectRoot: unknownKey })).includes("KDM4001"));
});

test("manifest paths may not traverse outside the project", () => {
  const sourceTraversal = createProject({}, {
    name: "Traversal",
    pages: [{ source: "../home.kdm", route: "/" }],
  });
  assert.ok(
    diagnosticCodes(compileProject({ projectRoot: sourceTraversal })).includes("KDM4001"),
  );

  const outTraversal = createProject({ "pages/home.kdm": HOME_PAGE }, {
    name: "Traversal",
    outDir: "../outside",
    pages: [{ source: "pages/home.kdm", route: "/" }],
  });
  assert.ok(
    diagnosticCodes(compileProject({ projectRoot: outTraversal })).includes("KDM4001"),
  );
});

test("a missing page file fails with KDM4002 and no output", () => {
  const projectRoot = createProject({}, {
    name: "Missing",
    pages: [
      { source: "pages/home.kdm", route: "/" },
      { source: "pages/missing.kdm", route: "/missing" },
    ],
  });
  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("KDM4002"));
  assert.deepEqual(result.files, []);
});

test("duplicate routes fail with KDM4005", () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": HOME_PAGE,
      "pages/about.kdm": ABOUT_PAGE,
    },
    manifestWith([
      { source: "pages/home.kdm", route: "/about" },
      { source: "pages/about.kdm", route: "/about/" },
    ]),
  );
  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("KDM4005"));
});

test("duplicate page titles fail with KDM3011", () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": HOME_PAGE,
      "pages/about.kdm": ABOUT_PAGE.replace('page "About"', 'page "Home"'),
    },
    manifestWith([
      { source: "pages/home.kdm", route: "/" },
      { source: "pages/about.kdm", route: "/about" },
    ]),
  );
  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("KDM3011"));
  assert.deepEqual(result.files, []);
});

test("a manifest title that disagrees with the page is rejected", () => {
  const projectRoot = createProject(
    { "pages/home.kdm": HOME_PAGE },
    manifestWith([{ title: "Landing", source: "pages/home.kdm", route: "/" }]),
  );
  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("KDM4001"));
});

// --- Navigation -----------------------------------------------------------

test("internal navigation resolves by page title across the project", () => {
  const projectRoot = standardProject();
  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true);

  const files = filesByPath(result);
  assert.match(textAt(files, "index.html"), /href="\/about\/"/);
  assert.match(textAt(files, "about/index.html"), /href="\/about\/team\/"/);
  assert.match(textAt(files, "about/team/index.html"), /href="\/about\/"/);
});

test("an unknown navigation target fails with KDM3007", () => {
  const projectRoot = singlePageProject(`kadam 0.1

page "Home" {
    link1 {
        a link
        the link text says "Nowhere"
        when clicked, go to page "Nowhere"
    }
}
`);
  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.deepEqual(diagnosticCodes(result), ["KDM3007"]);
  assert.deepEqual(result.files, []);
});

// --- Assets ---------------------------------------------------------------

test("a referenced asset that does not exist fails with KDM4003", () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": `kadam 0.1

page "Home" {
    image1 {
        an image
        it shows "assets/missing.png"
        the description says "Missing"
    }
}
`,
    },
    manifestWith([{ source: "pages/home.kdm", route: "/" }]),
  );
  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes("KDM4003"));
  assert.deepEqual(result.files, []);
});

test("asset paths may not traverse outside the project", () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": `kadam 0.1

page "Home" {
    image1 {
        an image
        it shows "../outside.png"
        the description says "Escape attempt"
    }
}
`,
      "../outside.png": Buffer.from([1, 2, 3]),
    },
    manifestWith([{ source: "pages/home.kdm", route: "/" }]),
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  const codes = diagnosticCodes(result);
  assert.ok(codes.includes("KDM3005"), JSON.stringify(codes));
  assert.ok(codes.includes("KDM4003"), JSON.stringify(codes));
  assert.deepEqual(result.files, []);
});

test("Kadam sources and unsupported file types are not copied as assets", () => {
  const projectWith = (assetPath) =>
    createProject(
      {
        "pages/home.kdm": `kadam 0.1

page "Home" {
    image1 {
        an image
        it shows "${assetPath}"
        the description says "Not an asset"
    }
}
`,
        "pages/other.png": "not an image",
        "notes.txt": "notes",
      },
      manifestWith([{ source: "pages/home.kdm", route: "/" }]),
    );

  for (const assetPath of ["pages/home.kdm", "notes.txt", "kadam.json"]) {
    const result = compileProject({ projectRoot: projectWith(assetPath) });
    assert.equal(result.ok, false, assetPath);
    assert.ok(
      diagnosticCodes(result).includes("KDM4003"),
      `${assetPath}: ${diagnosticCodes(result).join(", ")}`,
    );
    assert.deepEqual(result.files, []);
  }
});

// --- CLI ------------------------------------------------------------------

test("kadam build --project writes a complete site", async () => {
  const projectRoot = standardProject();
  const workspace = mkdtempSync(join(tmpdir(), "kadam-cli-"));
  const outDir = join(workspace, "dist");

  const built = await run(process.execPath, [
    cli,
    "build",
    "--project",
    projectRoot,
    "--out",
    outDir,
  ]);
  assert.match(built.stdout, /Built project/);

  const tree = readTree(outDir);
  assert.deepEqual(
    [...tree.keys()],
    [
      "about/index.html",
      "about/team/index.html",
      "assets/hero.webp",
      "assets/kadam.about-team.css",
      "assets/kadam.about.css",
      "assets/kadam.css",
      "assets/kadam.home.css",
      "assets/logo.svg",
      "index.html",
    ],
  );
  assert.match(tree.get("about/index.html").toString("utf8"), /href="\/about\/team\/"/);
  assert.deepEqual(tree.get("assets/hero.webp"), HERO);
});

test("kadam build --project defaults to dist inside the project root", async () => {
  const projectRoot = standardProject();
  await run(process.execPath, [cli, "build", "--project", projectRoot]);

  const tree = readTree(join(projectRoot, "dist"));
  assert.ok(tree.has("index.html"));
  assert.ok(tree.has("about/team/index.html"));
});

test("a failing page leaves an existing output directory untouched", async () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": HOME_PAGE,
      "pages/broken.kdm": `kadam 0.1

page "Broken" {
    button1 {
        a button
    }
}
`,
    },
    manifestWith([
      { source: "pages/home.kdm", route: "/" },
      { source: "pages/broken.kdm", route: "/broken" },
    ]),
  );

  const outDir = join(mkdtempSync(join(tmpdir(), "kadam-atomic-")), "dist");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "previous.txt"), "keep me", "utf8");

  await assert.rejects(
    () => run(process.execPath, [cli, "build", "--project", projectRoot, "--out", outDir]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /error\[KDM3009\]/);
      assert.match(error.stderr, /no files were written/);
      return true;
    },
  );

  assert.equal(readFileSync(join(outDir, "previous.txt"), "utf8"), "keep me");
  assert.equal(existsSync(join(outDir, "index.html")), false);
  assert.equal(existsSync(join(outDir, "broken", "index.html")), false);
});

test("kadam build refuses an output directory containing project sources", async () => {
  const projectRoot = standardProject();
  await assert.rejects(
    () => run(process.execPath, [cli, "build", "--project", projectRoot, "--out", projectRoot]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /cannot be the project root|cannot contain the project source/);
      return true;
    },
  );
  assert.equal(readFileSync(join(projectRoot, "pages", "home.kdm"), "utf8"), HOME_PAGE);
  assert.equal(existsSync(join(projectRoot, "index.html")), false);
});
