import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DevSession } from "../dist/server/dev-session.js";
import {
  HOME_PAGE,
  createProject,
  manifestFor,
  standardProject,
  writeProjectFile,
} from "./helpers/dev-project.mjs";

function homeHtml(session) {
  const contents = session.snapshot?.files.get("index.html")?.contents;
  assert.equal(typeof contents, "string");
  return contents;
}

test("the initial build produces a success status and watch paths", () => {
  const projectRoot = standardProject();
  const session = new DevSession({ projectRoot });
  const outcome = session.build();

  assert.equal(outcome.ok, true, JSON.stringify(outcome.diagnostics));
  assert.equal(outcome.status.phase, "success");
  assert.equal(outcome.status.served, "current");
  assert.equal(outcome.status.buildId, 1);
  assert.equal(outcome.status.routes.length, 2);
  assert.deepEqual(
    outcome.status.routes.map((route) => route.route),
    ["/", "/about/"],
  );
  assert.equal(session.basePath, "");
  assert.ok(session.snapshot);
  assert.deepEqual(session.watchPaths, [
    "kadam.json",
    "pages/about.kdm",
    "pages/home.kdm",
  ]);
});

test("source overrides compile in memory without writing and preserve last-good output", () => {
  const projectRoot = standardProject();
  const session = new DevSession({ projectRoot });
  const initial = session.build();
  assert.equal(initial.ok, true);

  session.setSourceOverrides(
    new Map([
      [
        "pages/home.kdm",
        HOME_PAGE.replace('the text says "Home page"', 'the text says "Preview"'),
      ],
    ]),
  );
  const preview = session.build();
  assert.equal(preview.ok, true, JSON.stringify(preview.diagnostics));
  assert.equal(preview.plan.kind, "reload");
  assert.match(homeHtml(session), /Preview/);
  assert.equal(
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
    HOME_PAGE,
  );

  session.setSourceOverrides(
    new Map([
      [
        "pages/home.kdm",
        'kadam 0.1\n\npage "Home" {\n    broken1 {\n        a button\n    }\n}\n',
      ],
    ]),
  );
  const broken = session.build();
  assert.equal(broken.ok, false);
  assert.equal(broken.status.served, "last-success");
  assert.match(homeHtml(session), /Preview/);

  session.clearSourceOverrides();
  const restored = session.build();
  assert.equal(restored.ok, true);
  assert.equal(restored.plan.kind, "reload");
  assert.match(homeHtml(session), /Home page/);
  assert.doesNotMatch(homeHtml(session), /Preview/);
});

test("a style-only edit plans a CSS update and an HTML edit plans a reload", () => {
  const projectRoot = standardProject();
  const session = new DevSession({ projectRoot });
  session.build();

  writeProjectFile(
    projectRoot,
    "pages/home.kdm",
    HOME_PAGE.replace("the text is 40px", "the text is 44px"),
  );
  const styled = session.build(["pages/home.kdm"]);
  assert.equal(styled.ok, true);
  assert.deepEqual(styled.plan, {
    kind: "css",
    paths: ["assets/kadam.home.css"],
  });

  writeProjectFile(
    projectRoot,
    "pages/home.kdm",
    HOME_PAGE.replace('"Home page"', '"Home page edited"'),
  );
  const edited = session.build(["pages/home.kdm"]);
  assert.equal(edited.ok, true);
  assert.deepEqual(edited.plan, { kind: "reload", reason: "html" });
  assert.match(homeHtml(session), /Home page edited/);
});

test("a failed build keeps the last successful snapshot and reports its diagnostics", () => {
  const projectRoot = standardProject();
  const session = new DevSession({ projectRoot });
  const good = session.build();
  assert.equal(good.ok, true);
  const goodHash = session.snapshot.hash;
  const goodHtml = homeHtml(session);

  writeProjectFile(
    projectRoot,
    "pages/home.kdm",
    `kadam 0.1

page "Home" {
    headline1 {
        a main heading
    }
}
`,
  );

  const broken = session.build(["pages/home.kdm"]);
  assert.equal(broken.ok, false);
  assert.equal(broken.status.phase, "failure");
  assert.equal(broken.status.served, "last-success");
  assert.equal(broken.status.buildId, 1);
  assert.equal(session.snapshot.hash, goodHash);
  assert.equal(homeHtml(session), goodHtml);

  assert.ok(broken.status.diagnostics.length > 0);
  assert.equal(broken.status.diagnostics[0].code, "KDM3009");
  assert.equal(broken.status.diagnostics[0].file, "pages/home.kdm");
  assert.equal(broken.status.diagnostics[0].line, 4);
  assert.ok(!broken.status.diagnostics[0].file.startsWith("/"));

  writeProjectFile(projectRoot, "pages/home.kdm", HOME_PAGE);
  const recovered = session.build(["pages/home.kdm"]);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.status.served, "current");
  assert.equal(recovered.status.diagnostics.length, 0);
  assert.equal(recovered.status.buildId, 2);
});

test("an initial failure has no snapshot and serves nothing", () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": `kadam 0.1

page "Home" {
    broken1 {
        a button
    }
}
`,
    },
    manifestFor([{ source: "pages/home.kdm", route: "/" }]),
  );

  const session = new DevSession({ projectRoot });
  const outcome = session.build();
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status.served, "none");
  assert.equal(outcome.status.buildId, 0);
  assert.equal(session.snapshot, null);
  assert.deepEqual(session.watchPaths, ["kadam.json", "pages/home.kdm"]);
});

test("basePath is reflected in generated URLs", () => {
  const projectRoot = standardProject({ basePath: "/site" });
  const session = new DevSession({ projectRoot });
  const outcome = session.build();
  assert.equal(outcome.ok, true);
  assert.equal(session.basePath, "/site");
  assert.match(homeHtml(session), /href="\/site\/assets\/kadam\.css"/);
  assert.match(homeHtml(session), /href="\/site\/about\/"/);
});

test("diagnostics never expose absolute paths", () => {
  const projectRoot = standardProject();
  const session = new DevSession({ projectRoot });
  session.build();

  writeProjectFile(projectRoot, "pages/home.kdm", "not kadam at all\n");
  const outcome = session.build(["pages/home.kdm"]);
  assert.equal(outcome.ok, false);

  for (const diagnostic of outcome.status.diagnostics) {
    assert.ok(!diagnostic.file.startsWith("/"), diagnostic.file);
    assert.ok(!diagnostic.file.includes(projectRoot), diagnostic.file);
  }
  assert.equal(readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"), "not kadam at all\n");
});

const CARD_COMPONENT = `kadam 0.1

component PriceCard takes a title as text {
    card1 {
        a card
        title1 {
            a section heading
            the heading text says "{$title}"
        }
    }
}
`;

const COMPONENT_HOME = `kadam 0.1

page "Home" {
    pricing1 {
        a PriceCard
        with a title of "Starter"
    }
}
`;

test("component sources are watched, rebuilt, and recover like page sources", () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": COMPONENT_HOME,
      "components/PriceCard.kdm": CARD_COMPONENT,
    },
    manifestFor([{ source: "pages/home.kdm", route: "/" }], {
      components: ["components/PriceCard.kdm"],
    }),
  );

  const session = new DevSession({ projectRoot });
  const initial = session.build();
  assert.equal(initial.ok, true, JSON.stringify(initial.diagnostics));
  assert.deepEqual(session.watchPaths, [
    "components/PriceCard.kdm",
    "kadam.json",
    "pages/home.kdm",
  ]);
  assert.match(homeHtml(session), /Starter/);

  writeProjectFile(
    projectRoot,
    "components/PriceCard.kdm",
    CARD_COMPONENT.replace(
      'the heading text says "{$title}"',
      'the heading text says "Plan: {$title}"',
    ),
  );
  const edited = session.build(["components/PriceCard.kdm"]);
  assert.equal(edited.ok, true, JSON.stringify(edited.diagnostics));
  assert.deepEqual(edited.plan, { kind: "reload", reason: "html" });
  assert.match(homeHtml(session), /Plan: Starter/);

  writeProjectFile(
    projectRoot,
    "components/PriceCard.kdm",
    CARD_COMPONENT.replace('"{$title}"', '"{$missing}"'),
  );
  const broken = session.build(["components/PriceCard.kdm"]);
  assert.equal(broken.ok, false);
  assert.equal(broken.status.served, "last-success");
  assert.match(homeHtml(session), /Plan: Starter/);
  assert.ok(
    broken.status.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "KDM3027" &&
        diagnostic.file === "components/PriceCard.kdm",
    ),
    JSON.stringify(broken.status.diagnostics),
  );
  assert.ok(session.watchPaths.includes("components/PriceCard.kdm"));
});
