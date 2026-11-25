import { test } from "node:test";
import assert from "node:assert/strict";

import { runProbes } from "./helpers/frontend-probes.mjs";

test("frontend coverage probes match the recorded checklist", () => {
  const changed = runProbes()
    .filter((result) => result.compiles !== result.probe.compiles)
    .map(
      (result) =>
        `${result.probe.id} [${result.probe.phase}] ${result.probe.kind}: ${result.probe.statement} -> ` +
        (result.compiles ? "now compiles" : `now fails (${result.firstError})`),
    );
  assert.deepEqual(
    changed,
    [],
    "update test/fixtures/frontend-probes/probes.json in the same change as the feature",
  );
});
