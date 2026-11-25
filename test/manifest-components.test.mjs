import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadManifest } from "../dist/compiler/manifest.js";

function codes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function load(extra = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), "kadam-manifest-components-"));
  writeFileSync(
    join(projectRoot, "kadam.json"),
    JSON.stringify(
      {
        kadam: "0.1",
        name: "Components",
        pages: [{ source: "pages/home.kdm", route: "/" }],
        ...extra,
      },
      null,
      2,
    ),
    "utf8",
  );
  return loadManifest(projectRoot);
}

test("components are optional and default to an empty list", () => {
  const result = load();
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.manifest);
  assert.deepEqual(result.manifest.components, []);
});

test("component source paths are normalized and preserved in declaration order", () => {
  const result = load({
    components: [
      "components\\PriceCard.kdm",
      "components/Button.kdm",
    ],
  });

  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.manifest);
  assert.deepEqual(result.manifest.components, [
    { source: "components/PriceCard.kdm", namespace: null },
    { source: "components/Button.kdm", namespace: null },
  ]);
});

test("object component entries carry an optional namespace", () => {
  const result = load({
    components: [
      "components/Button.kdm",
      { source: "libs/ui/Card.kdm", namespace: "ui" },
      { source: "libs/ui/Field.kdm" },
    ],
  });

  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.manifest);
  assert.deepEqual(result.manifest.components, [
    { source: "components/Button.kdm", namespace: null },
    { source: "libs/ui/Card.kdm", namespace: "ui" },
    { source: "libs/ui/Field.kdm", namespace: null },
  ]);
});

test("malformed component entries and namespaces fail with KDM4009", () => {
  const invalid = [
    [{ source: "components/A.kdm", namespace: "UI" }],
    [{ source: "components/A.kdm", namespace: "a-b" }],
    [{ source: "components/A.kdm", namespace: 1 }],
    [{ source: "components/A.kdm", extra: true }],
    [{ namespace: "ui" }],
    [null],
  ];

  for (const components of invalid) {
    const result = load({ components });
    assert.equal(result.manifest, null, JSON.stringify(components));
    assert.ok(
      codes(result).includes("KDM4009"),
      `${JSON.stringify(components)}: ${codes(result).join(", ")}`,
    );
  }
});

test("component entries must be non-empty project-relative .kdm paths", () => {
  const invalid = [
    "components/A.kdm",
    42,
    "",
    "/components/A.kdm",
    "C:\\A.kdm",
    "../A.kdm",
    "components/../A.kdm",
    "components/A.txt",
    "components/A\0.kdm",
  ];

  for (const components of invalid) {
    const result = load({ components });
    assert.equal(result.manifest, null, String(components));
    assert.ok(
      codes(result).includes("KDM4007"),
      `${String(components)}: ${codes(result).join(", ")}`,
    );
  }
});

test("duplicate component paths and page/component collisions fail with KDM4008", () => {
  const duplicate = load({
    components: ["components/A.kdm", "components\\A.kdm"],
  });
  assert.equal(duplicate.manifest, null);
  assert.ok(codes(duplicate).includes("KDM4008"));

  const collision = load({
    components: ["pages/home.kdm"],
  });
  assert.equal(collision.manifest, null);
  assert.ok(codes(collision).includes("KDM4008"));
});
