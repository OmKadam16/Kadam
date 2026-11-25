import { test } from "node:test";
import assert from "node:assert/strict";

import { DevSession } from "../dist/server/dev-session.js";
import {
  createProject,
  manifestFor,
} from "./helpers/dev-project.mjs";

function fiftyPageProject() {
  const files = {};
  const pages = [];
  for (let index = 0; index < 50; index += 1) {
    const title = `Page ${index}`;
    files[`pages/page${index}.kdm`] = `kadam 0.1

page "${title}" {
    heading${index} {
        a main heading
        the text says "${title}"
    }

    body${index} {
        a paragraph
        the text says "Deterministic content for page ${index}."
    }
}
`;
    pages.push({
      title,
      source: `pages/page${index}.kdm`,
      route: index === 0 ? "/" : `/page${index}`,
    });
  }
  return createProject(files, manifestFor(pages));
}

test("a 50-page project rebuilds within the M4 target", () => {
  const projectRoot = fiftyPageProject();
  const session = new DevSession({ projectRoot });
  const measurements = [];

  for (let index = 0; index < 3; index += 1) {
    const outcome = session.build();
    assert.equal(outcome.ok, true, JSON.stringify(outcome.diagnostics));
    assert.equal(outcome.status.routes.length, 50);
    measurements.push(outcome.status.compileMs);
  }

  const sorted = [...measurements].sort((a, b) => a - b);
  const median = sorted[1];
  console.log(
    `# 50-page rebuild: ${measurements.join(" ms, ")} ms (median ${median} ms)`,
  );

  // Generous bound: the measured quantity is reported above, and this test is
  // about preventing an order-of-magnitude regression, not benchmarking noise.
  assert.ok(
    median < 3000,
    `median 50-page rebuild was ${median} ms, expected under 3000 ms`,
  );
});
