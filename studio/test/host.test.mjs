import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createStudioServer } from "../dist/host/server.js";

const HOME_PAGE = `kadam 0.1

// A page used by the Studio host tests.
page "Home" {
    hero1 {
        a main heading
        the text says "Hello Studio"
        has a white background
        has a 1px #D4D4D4 border
        has rounded corners
    }
}
`;

const BADGE_COMPONENT = `kadam 0.1

component Badge takes a label as text {
    label1 {
        a paragraph
        the text says "{$label}"
    }
}
`;

const MANIFEST = {
  kadam: "0.1",
  name: "StudioFixture",
  pages: [{ source: "pages/home.kdm", route: "/", title: "Home" }],
  components: ["components/Badge.kdm"],
  outDir: "dist",
};

function createProject() {
  const root = mkdtempSync(join(tmpdir(), "kadam-studio-"));
  writeProjectFile(root, "kadam.json", `${JSON.stringify(MANIFEST, null, 2)}\n`);
  writeProjectFile(root, "pages/home.kdm", HOME_PAGE);
  writeProjectFile(root, "components/Badge.kdm", BADGE_COMPONENT);
  return root;
}

function writeProjectFile(root, relative, contents) {
  const absolute = join(root, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
}

async function startServer(t, projectRoot) {
  const server = await createStudioServer({
    projectRoot,
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    watch: false,
    logger: () => {},
  });
  t.after(async () => {
    await server.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });
  return server;
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = options.headers ?? {};
    const payload =
      options.body === undefined
        ? undefined
        : Buffer.from(JSON.stringify(options.body), "utf8");
    const requestOptions = {
      method: options.method ?? "GET",
      headers: {
        ...(payload === undefined
          ? {}
          : {
              "content-type": "application/json",
              "content-length": String(payload.length),
            }),
        ...headers,
      },
    };
    if (headers.host !== undefined) requestOptions.setHost = false;

    const req = request(url, requestOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          bytes,
          body: bytes.toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("request timed out")));
    req.end(payload);
  });
}

async function getJson(origin, path, options = {}) {
  const response = await httpRequest(`${origin}${path}`, options);
  return {
    ...response,
    json: response.body === "" ? null : JSON.parse(response.body),
  };
}

async function postJson(origin, path, body, options = {}) {
  return getJson(origin, path, { ...options, method: "POST", body });
}

async function openPage(origin, path = "pages/home.kdm") {
  return getJson(origin, `/__studio/file?path=${encodeURIComponent(path)}`);
}

async function studioStatus(origin) {
  return getJson(origin, "/__kadam/status");
}

async function studioMap(origin) {
  const status = await studioStatus(origin);
  return getJson(
    origin,
    `/__kadam/studio-map?buildId=${status.json.buildId}`,
  );
}

test("bootstrap, tree, and file reads are project-relative", async (t) => {
  const projectRoot = createProject();
  const server = await startServer(t, projectRoot);

  const bootstrap = await getJson(server.origin, "/__studio/bootstrap");
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.json.project.name, "StudioFixture");
  assert.equal(bootstrap.json.project.manifestPath, "kadam.json");
  assert.equal(bootstrap.json.status.phase, "success");
  assert.equal(bootstrap.json.previewBase, "/__preview");

  const paths = bootstrap.json.entries.map((entry) => entry.path);
  assert.deepEqual(paths, ["pages/home.kdm", "components/Badge.kdm"]);
  const pageEntry = bootstrap.json.entries.find(
    (entry) => entry.path === "pages/home.kdm",
  );
  assert.equal(pageEntry.kind, "page");
  assert.equal(pageEntry.route, "/");
  const componentEntry = bootstrap.json.entries.find(
    (entry) => entry.path === "components/Badge.kdm",
  );
  assert.equal(componentEntry.kind, "component");

  const tree = await getJson(server.origin, "/__studio/tree");
  assert.equal(tree.status, 200);
  assert.deepEqual(tree.json.entries, bootstrap.json.entries);

  const file = await openPage(server.origin);
  assert.equal(file.status, 200);
  assert.equal(file.json.document.path, "pages/home.kdm");
  assert.equal(file.json.document.kind, "page");
  assert.equal(file.json.document.version, 1);
  assert.equal(file.json.document.dirty, false);
  assert.equal(file.json.document.text, HOME_PAGE);
  assert.equal(file.json.document.newline, "\n");
  assert.equal(file.json.document.bom, false);

  for (const path of [
    "kadam.json",
    "../outside.kdm",
    "/etc/passwd.kdm",
    "pages/home.txt",
  ]) {
    const rejected = await getJson(
      server.origin,
      `/__studio/file?path=${encodeURIComponent(path)}`,
    );
    assert.ok(
      rejected.status === 400 || rejected.status === 403,
      `${path} returned ${rejected.status}`,
    );
  }
});

test("valid edits compile in memory, update the preview, and save only on request", async (t) => {
  const projectRoot = createProject();
  const server = await startServer(t, projectRoot);

  const file = await openPage(server.origin);
  const text = file.json.document.text;
  const needle = '"Hello Studio"';
  const from = text.indexOf(needle);
  assert.ok(from > 0);

  const edit = await postJson(server.origin, "/__studio/edit", {
    path: "pages/home.kdm",
    baseVersion: file.json.document.version,
    from,
    to: from + needle.length,
    originalText: needle,
    replacementText: '"Hello Preview"',
    intent: "manual",
  });

  assert.equal(edit.status, 200, edit.body);
  assert.equal(edit.json.ok, true);
  assert.equal(edit.json.document.version, 2);
  assert.equal(edit.json.document.dirty, true);
  assert.match(edit.json.document.text, /Hello Preview/);
  assert.equal(edit.json.status.phase, "success");
  assert.equal(edit.json.diagnostics.length, 0);

  assert.match(
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
    /Hello Studio/,
  );

  const preview = await httpRequest(`${server.origin}/__preview/`);
  assert.equal(preview.status, 200);
  assert.match(preview.body, /Hello Preview/);
  assert.doesNotMatch(preview.body, /Hello Studio/);

  const save = await postJson(server.origin, "/__studio/save", {
    path: "pages/home.kdm",
  });
  assert.equal(save.status, 200, save.body);
  assert.equal(save.json.status, "saved");
  assert.equal(save.json.document.dirty, false);
  assert.equal(save.json.preview.phase, "success");
  assert.match(
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
    /Hello Preview/,
  );

  const unchanged = await postJson(server.origin, "/__studio/save", {
    path: "pages/home.kdm",
  });
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.json.status, "unchanged");
});

test("invalid edits are rejected with diagnostics and keep the last accepted document", async (t) => {
  const projectRoot = createProject();
  const server = await startServer(t, projectRoot);

  const file = await openPage(server.origin);
  const text = file.json.document.text;
  const needle = '"Hello Studio"';
  const from = text.indexOf(needle);

  const rejected = await postJson(server.origin, "/__studio/edit", {
    path: "pages/home.kdm",
    baseVersion: file.json.document.version,
    from,
    to: from + needle.length,
    originalText: needle,
    replacementText: '"Hello',
    intent: "manual",
  });

  assert.equal(rejected.status, 422);
  assert.equal(rejected.json.ok, false);
  assert.ok(
    rejected.json.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "KDM1002" && diagnostic.file === "pages/home.kdm",
    ),
    rejected.body,
  );
  assert.ok(Number.isInteger(rejected.json.diagnostics[0].from));

  // Rejected candidates never enter the session, so check still validates the
  // last accepted source rather than the rejected buffer.
  const check = await postJson(server.origin, "/__studio/check", {
    path: "pages/home.kdm",
  });
  assert.equal(check.status, 200);
  assert.equal(check.json.valid, true);
  assert.equal(check.json.diagnostics.length, 0);

  const after = await openPage(server.origin);
  assert.equal(after.json.document.text, HOME_PAGE);
  assert.equal(after.json.document.version, 1);
  assert.equal(after.json.document.dirty, false);
  assert.equal(
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
    HOME_PAGE,
  );

  const stale = await postJson(server.origin, "/__studio/edit", {
    path: "pages/home.kdm",
    baseVersion: 99,
    from,
    to: from + needle.length,
    originalText: needle,
    replacementText: '"Nope"',
    intent: "manual",
  });
  assert.equal(stale.status, 422);
  assert.equal(stale.json.error.code, "stale-version");
});

test("inspector reads AST properties and applies minimal source patches", async (t) => {
  const projectRoot = createProject();
  const server = await startServer(t, projectRoot);

  const map = await studioMap(server.origin);
  const page = map.json.pages.find((candidate) => candidate.route === "/");
  const hero = page.elements.find((element) => element.name === "hero1");
  assert.ok(hero);

  const inspected = await getJson(
    server.origin,
    `/__studio/inspect?path=pages/home.kdm&offset=${hero.nameSpan.start.offset}`,
  );
  assert.equal(inspected.status, 200, inspected.body);
  assert.equal(inspected.json.element.name, "hero1");
  assert.equal(inspected.json.element.targetId, "element:hero1");
  assert.equal(inspected.json.element.text, "Hello Studio");
  assert.deepEqual(inspected.json.element.background, {
    mode: "solid",
    color: "white",
  });
  assert.deepEqual(inspected.json.element.border, {
    mode: "solid",
    color: "#D4D4D4",
    width: "1px",
  });
  assert.deepEqual(inspected.json.element.corners, { mode: "default" });

  const text = await postJson(server.origin, "/__studio/property", {
    path: "pages/home.kdm",
    targetId: inspected.json.element.targetId,
    property: "text",
    value: "Hello Inspector",
  });
  assert.equal(text.status, 200, text.body);
  assert.equal(text.json.element.text, "Hello Inspector");
  assert.match(text.json.document.text, /the text says "Hello Inspector"/);
  assert.match(text.json.document.text, /A page used by the Studio host tests/);

  const background = await postJson(server.origin, "/__studio/property", {
    path: "pages/home.kdm",
    targetId: inspected.json.element.targetId,
    property: "background",
    value: { mode: "solid", color: "blue" },
  });
  assert.equal(background.status, 200, background.body);
  assert.match(background.json.document.text, /has a blue background/);
  assert.deepEqual(background.json.element.background, {
    mode: "solid",
    color: "blue",
  });

  const border = await postJson(server.origin, "/__studio/property", {
    path: "pages/home.kdm",
    targetId: inspected.json.element.targetId,
    property: "border",
    value: { mode: "none" },
  });
  assert.equal(border.status, 200, border.body);
  assert.match(border.json.document.text, /has no border/);
  assert.deepEqual(border.json.element.border, { mode: "none" });

  const corners = await postJson(server.origin, "/__studio/property", {
    path: "pages/home.kdm",
    targetId: inspected.json.element.targetId,
    property: "corners",
    value: { mode: "custom", radius: "12px" },
  });
  assert.equal(corners.status, 200, corners.body);
  assert.match(corners.json.document.text, /has 12px rounded corners/);
  assert.deepEqual(corners.json.element.corners, {
    mode: "custom",
    radius: "12px",
  });

  const invalid = await postJson(server.origin, "/__studio/property", {
    path: "pages/home.kdm",
    targetId: inspected.json.element.targetId,
    property: "background",
    value: { mode: "solid", color: "not-a-color" },
  });
  assert.equal(invalid.status, 422);
  const after = await openPage(server.origin);
  assert.match(after.json.document.text, /has a blue background/);
});

test("save reports external conflicts without overwriting the disk file", async (t) => {
  const projectRoot = createProject();
  const server = await startServer(t, projectRoot);

  const file = await openPage(server.origin);
  const text = file.json.document.text;
  const needle = '"Hello Studio"';
  const from = text.indexOf(needle);

  const edit = await postJson(server.origin, "/__studio/edit", {
    path: "pages/home.kdm",
    baseVersion: file.json.document.version,
    from,
    to: from + needle.length,
    originalText: needle,
    replacementText: '"Buffer Version"',
    intent: "manual",
  });
  assert.equal(edit.status, 200, edit.body);

  writeProjectFile(
    projectRoot,
    "pages/home.kdm",
    HOME_PAGE.replace('"Hello Studio"', '"Disk Version"'),
  );

  const save = await postJson(server.origin, "/__studio/save", {
    path: "pages/home.kdm",
  });
  assert.equal(save.status, 409, save.body);
  assert.equal(save.json.error.code, "conflict");
  assert.match(save.json.diskText, /Disk Version/);
  assert.match(
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
    /Disk Version/,
  );

  const stillBuffered = await openPage(server.origin);
  assert.match(stillBuffered.json.document.text, /Buffer Version/);
  assert.equal(stillBuffered.json.document.dirty, true);

  const reload = await postJson(server.origin, "/__studio/reload", {
    path: "pages/home.kdm",
  });
  assert.equal(reload.status, 200, reload.body);
  assert.match(reload.json.document.text, /Disk Version/);
  assert.equal(reload.json.document.dirty, false);
  assert.equal(reload.json.status.phase, "success");
});

test("layers can be added, reordered, deleted, and styled without existing properties", async (t) => {
  const projectRoot = createProject();
  const server = await startServer(t, projectRoot);

  const file = await openPage(server.origin);
  const outline = await getJson(
    server.origin,
    "/__studio/outline?path=pages%2Fhome.kdm",
  );
  assert.equal(outline.status, 200, outline.body);
  assert.equal(outline.json.outline.type, "page");
  assert.equal(outline.json.outline.id, "page");

  const added = await postJson(server.origin, "/__studio/layer", {
    path: "pages/home.kdm",
    action: "add",
    targetId: outline.json.outline.id,
    kind: "heading",
    text: "Layer heading",
  });
  assert.equal(added.status, 200, added.body);
  assert.equal(added.json.message, "Added newHeading1.");
  assert.equal(added.json.selectedId, "element:newHeading1");
  assert.match(added.json.document.text, /newHeading1/);
  assert.match(added.json.document.text, /the text says "Layer heading"/);
  assert.deepEqual(
    added.json.outline.children.map((child) => child.name),
    ["hero1", "newHeading1"],
  );
  assert.equal(added.json.status.phase, "success");

  const moved = await postJson(server.origin, "/__studio/layer", {
    path: "pages/home.kdm",
    action: "move",
    targetId: added.json.selectedId,
    direction: "up",
  });
  assert.equal(moved.status, 200, moved.body);
  assert.equal(moved.json.message, "Moved newHeading1 up.");
  assert.deepEqual(
    moved.json.outline.children.map((child) => child.name),
    ["newHeading1", "hero1"],
  );

  const container = await postJson(server.origin, "/__studio/layer", {
    path: "pages/home.kdm",
    action: "add",
    targetId: outline.json.outline.id,
    kind: "container",
  });
  assert.equal(container.status, 200, container.body);
  assert.equal(container.json.selectedId, "element:newContainer1");

  const nested = await postJson(server.origin, "/__studio/layer", {
    path: "pages/home.kdm",
    action: "reorder",
    targetId: added.json.selectedId,
    destinationId: container.json.selectedId,
    position: "inside",
  });
  assert.equal(nested.status, 200, nested.body);
  assert.equal(
    nested.json.selectedId,
    "element:newContainer1/newHeading1",
  );
  assert.deepEqual(
    nested.json.outline.children.map((child) => child.name),
    ["hero1", "newContainer1"],
  );
  assert.deepEqual(
    nested.json.outline.children[1].children.map((child) => child.name),
    ["newHeading1"],
  );
  assert.match(
    nested.json.document.text,
    /newContainer1 \{\n        a container\n        newHeading1 \{/,
  );

  const sibling = await postJson(server.origin, "/__studio/layer", {
    path: "pages/home.kdm",
    action: "reorder",
    targetId: nested.json.selectedId,
    destinationId: container.json.selectedId,
    position: "after",
  });
  assert.equal(sibling.status, 200, sibling.body);
  assert.equal(sibling.json.selectedId, "element:newHeading1");
  assert.deepEqual(
    sibling.json.outline.children.map((child) => child.name),
    ["hero1", "newContainer1", "newHeading1"],
  );

  const background = await postJson(server.origin, "/__studio/property", {
    path: "pages/home.kdm",
    targetId: container.json.selectedId,
    property: "background",
    value: { mode: "solid", color: "black" },
  });
  assert.equal(background.status, 200, background.body);
  assert.match(background.json.document.text, /has a black background/);
  assert.deepEqual(background.json.element.background, {
    mode: "solid",
    color: "black",
  });

  const deleted = await postJson(server.origin, "/__studio/layer", {
    path: "pages/home.kdm",
    action: "delete",
    targetId: sibling.json.selectedId,
  });
  assert.equal(deleted.status, 200, deleted.body);
  assert.equal(deleted.json.selectedId, null);
  assert.ok(
    !deleted.json.outline.children.some(
      (child) => child.name === "newHeading1",
    ),
  );

  // Layer operations are in-memory until Save.
  assert.equal(
    readFileSync(join(projectRoot, "pages/home.kdm"), "utf8"),
    HOME_PAGE,
  );
  assert.equal(file.json.document.version, 1);
});

test("style statements update typography, spacing, layout, effects, and visibility", async (t) => {
  const projectRoot = createProject();
  const server = await startServer(t, projectRoot);

  const outline = await getJson(
    server.origin,
    "/__studio/outline?path=pages%2Fhome.kdm",
  );
  const heroId = outline.json.outline.children[0].id;

  const color = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: heroId,
    selector: { family: "typography", key: "color" },
    statement: "the text is #2563EB",
  });
  assert.equal(color.status, 200, color.body);
  assert.match(color.json.document.text, /the text is #2563EB/);

  const size = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: heroId,
    selector: { family: "typography", key: "size" },
    statement: "the text is 20px",
  });
  assert.equal(size.status, 200, size.body);
  assert.match(size.json.document.text, /the text is 20px/);

  const shadow = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: heroId,
    selector: { family: "shadow" },
    statement: "has a strong shadow",
  });
  assert.equal(shadow.status, 200, shadow.body);
  assert.match(shadow.json.document.text, /has a strong shadow/);

  const hover = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: heroId,
    selector: { family: "hover", key: "background" },
    statement: "when hovered, the background turns black over 200ms",
  });
  assert.equal(hover.status, 200, hover.body);
  assert.match(
    hover.json.document.text,
    /when hovered, the background turns black over 200ms/,
  );

  const motion = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: heroId,
    selector: { family: "motion" },
    statement: "it fades in over 300ms when the page loads",
  });
  assert.equal(motion.status, 200, motion.body);
  assert.match(
    motion.json.document.text,
    /it fades in over 300ms when the page loads/,
  );

  const hidden = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: heroId,
    selector: { family: "visibility" },
    statement: "it is hidden",
  });
  assert.equal(hidden.status, 200, hidden.body);
  assert.match(hidden.json.document.text, /it is hidden/);

  const visible = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: heroId,
    selector: { family: "visibility" },
    statement: null,
  });
  assert.equal(visible.status, 200, visible.body);
  assert.doesNotMatch(visible.json.document.text, /it is hidden/);

  const container = await postJson(server.origin, "/__studio/layer", {
    path: "pages/home.kdm",
    action: "add",
    targetId: outline.json.outline.id,
    kind: "container",
  });
  assert.equal(container.status, 200, container.body);

  const direction = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: container.json.selectedId,
    selector: { family: "layout", key: "direction" },
    statement: "it arranges its children in a row",
  });
  assert.equal(direction.status, 200, direction.body);
  assert.match(direction.json.document.text, /arranges its children in a row/);

  const topPadding = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: container.json.selectedId,
    selector: { family: "spacing", key: "padding", sides: ["top"] },
    statement: "it has 8px padding on top",
  });
  assert.equal(topPadding.status, 200, topPadding.body);

  const gap = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: container.json.selectedId,
    selector: { family: "layout", key: "gap" },
    statement: "it has 16px gap between children",
  });
  assert.equal(gap.status, 200, gap.body);
  assert.match(gap.json.document.text, /16px gap between children/);

  const align = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: container.json.selectedId,
    selector: { family: "layout", key: "align", axis: "horizontal" },
    statement: "it centers its children horizontally",
  });
  assert.equal(align.status, 200, align.body);
  assert.match(align.json.document.text, /centers its children horizontally/);

  const padding = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: container.json.selectedId,
    selector: { family: "spacing", key: "padding", sides: ["left", "right"] },
    statement: "it has 24px padding on the left and right",
  });
  assert.equal(padding.status, 200, padding.body);
  assert.match(padding.json.document.text, /24px padding on the left and right/);

  // Replacing several spacing statements must insert one replacement and
  // preserve unrelated declarations that sit between them.
  const allPadding = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: container.json.selectedId,
    selector: {
      family: "spacing",
      key: "padding",
      sides: ["top", "right", "bottom", "left"],
    },
    statement: "it has 12px padding",
  });
  assert.equal(allPadding.status, 200, allPadding.body);
  assert.equal(
    (allPadding.json.document.text.match(/it has 12px padding/g) ?? []).length,
    1,
  );
  assert.match(allPadding.json.document.text, /16px gap between children/);
  assert.match(
    allPadding.json.document.text,
    /centers its children horizontally/,
  );
  assert.doesNotMatch(allPadding.json.document.text, /8px padding on top/);

  const removedPadding = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: container.json.selectedId,
    selector: {
      family: "spacing",
      key: "padding",
      sides: ["top", "right", "bottom", "left"],
    },
    statement: null,
  });
  assert.equal(removedPadding.status, 200, removedPadding.body);
  assert.doesNotMatch(removedPadding.json.document.text, /px padding/);
  assert.match(
    removedPadding.json.document.text,
    /16px gap between children/,
  );
  assert.match(
    removedPadding.json.document.text,
    /centers its children horizontally/,
  );

  const invalid = await postJson(server.origin, "/__studio/style", {
    path: "pages/home.kdm",
    targetId: heroId,
    selector: { family: "typography", key: "color" },
    statement: "the text is not-a-color",
  });
  assert.equal(invalid.status, 422);
  const after = await openPage(server.origin);
  assert.match(after.json.document.text, /the text is #2563EB/);
  assert.doesNotMatch(after.json.document.text, /not-a-color/);
});

test("the preview proxy injects the bridge and streams dev-server status", async (t) => {
  const projectRoot = createProject();
  const server = await startServer(t, projectRoot);

  const page = await httpRequest(`${server.origin}/__preview/`);
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.match(page.body, /Hello Studio/);
  assert.match(page.body, /\/__kadam\/client\.js/);
  assert.match(page.body, /\/__studio\/preview-bridge\.js/);
  assert.equal(page.body.match(/__studio\/preview-bridge\.js/g)?.length, 1);
  assert.match(page.headers["content-security-policy"], /frame-ancestors 'self'/);

  const bridge = await httpRequest(
    `${server.origin}/__studio/preview-bridge.js`,
  );
  assert.equal(bridge.status, 200);
  assert.match(bridge.headers["content-type"], /text\/javascript/);
  assert.match(bridge.body, /kadam-studio:select/);
  assert.doesNotMatch(bridge.body, /sourceFile/);

  const stylesheet = await httpRequest(
    `${server.origin}/__preview/assets/kadam.home.css`,
  );
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers["content-type"], /text\/css/);

  const status = await httpRequest(`${server.origin}/__kadam/status`);
  assert.equal(status.status, 200);
  assert.equal(JSON.parse(status.body).phase, "success");

  const sse = await openSse(`${server.origin}/__kadam/events`);
  t.after(() => sse.close());
  const first = await sse.nextEvent();
  assert.equal(first.event, "status");
  assert.equal(first.data.phase, "success");

  assert.equal(
    (await httpRequest(`${server.origin}/__preview/kadam.json`)).status,
    404,
  );
});

test("security boundaries reject foreign hosts, cross-origin writes, and symlink escapes", async (t) => {
  const projectRoot = createProject();
  const outside = mkdtempSync(join(tmpdir(), "kadam-studio-outside-"));
  const secret = join(outside, "leak.kdm");
  writeFileSync(secret, "page \"Secret\" {\n}\n", "utf8");
  symlinkSync(secret, join(projectRoot, "pages/leak.kdm"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));

  const server = await startServer(t, projectRoot);

  const shell = await httpRequest(`${server.origin}/`);
  assert.equal(shell.status, 200);
  assert.match(shell.headers["content-type"], /text\/html/);
  assert.match(shell.body, /Kadam Studio/);
  assert.match(shell.headers["content-security-policy"], /frame-ancestors 'none'/);

  const foreign = await httpRequest(`${server.origin}/__studio/bootstrap`, {
    headers: { host: "evil.example" },
  });
  assert.equal(foreign.status, 403);

  const crossOrigin = await postJson(
    server.origin,
    "/__studio/edit",
    {},
    { headers: { origin: "http://evil.example" } },
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.json.error.code, "cross-origin");

  const symlinkRead = await getJson(
    server.origin,
    "/__studio/file?path=pages%2Fleak.kdm",
  );
  assert.ok(
    symlinkRead.status === 403 || symlinkRead.status === 404,
    symlinkRead.body,
  );

  const traversal = await getJson(
    server.origin,
    "/__studio/file?path=..%2F..%2Fetc%2Fpasswd.kdm",
  );
  assert.equal(traversal.status, 400);

  const bootstrap = await getJson(server.origin, "/__studio/bootstrap");
  assert.ok(
    !bootstrap.json.entries.some((entry) => entry.path === "pages/leak.kdm"),
  );
});

function openSse(url) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { headers: { accept: "text/event-stream", connection: "keep-alive" } },
      (res) => {
        let buffer = "";
        const queue = [];
        let waiter = null;

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          let index;
          while ((index = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const event = parseEvent(frame);
            if (event === null) continue;
            if (waiter !== null) {
              const current = waiter;
              waiter = null;
              current(event);
            } else {
              queue.push(event);
            }
          }
        });

        resolve({
          nextEvent(timeoutMs = 5000) {
            if (queue.length > 0) return Promise.resolve(queue.shift());
            return new Promise((resolveEvent, rejectEvent) => {
              const timer = setTimeout(() => {
                waiter = null;
                rejectEvent(new Error("timed out waiting for an SSE event"));
              }, timeoutMs);
              waiter = (event) => {
                clearTimeout(timer);
                resolveEvent(event);
              };
            });
          },
          close() {
            req.destroy();
          },
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function parseEvent(frame) {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (data === "") return null;
  return { event, data: JSON.parse(data) };
}
