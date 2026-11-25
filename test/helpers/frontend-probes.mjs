// Frontend coverage probes (docs/frontend-plan.md §11).
//
// Each probe is one everyday frontend need written the way an author would
// first try it. A probe "compiles" when a kadam 0.3 page containing it builds
// with zero diagnostics. The fixture records the expected result, so a probe
// that starts (or stops) compiling fails CI until the checklist is updated.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { compileText } from "../../dist/compiler/compile.js";

const fixture = fileURLToPath(
  new URL("../fixtures/frontend-probes/probes.json", import.meta.url),
);

export function loadProbes() {
  return JSON.parse(readFileSync(fixture, "utf8")).probes;
}

const TEXT_KINDS = new Set(["button", "paragraph", "main heading", "section heading", "minor heading"]);

/** Build the smallest page that exercises one probe. */
export function probeSource(probe) {
  if (probe.kind === "page") {
    return `kadam 0.3\npage "P" {\n    ${probe.statement}\n    x1 {\n        a container\n    }\n}\n`;
  }
  const lines = [`a ${probe.kind}`];
  const ownText = probe.statement.startsWith("the text says");
  if (TEXT_KINDS.has(probe.kind) && !ownText) lines.push('the text says "Hi"');
  if (probe.kind === "link") {
    lines.push('the text says "Hi"', 'when clicked, open "https://example.com" in a new tab');
  }
  if (probe.kind === "text field") lines.push('the label says "Name"');
  if (probe.statement !== "") lines.push(probe.statement);
  // Optional extra body lines: the minimum content a kind requires.
  for (const line of probe.body ?? []) lines.push(line);
  const body = lines.map((line) => `        ${line}`).join("\n");
  return `kadam 0.3\npage "P" {\n    x1 {\n${body}\n    }\n}\n`;
}

export function runProbe(probe) {
  const result = compileText("probe.kdm", probeSource(probe));
  const first = result.diagnostics[0];
  return {
    probe,
    compiles: result.ok && result.diagnostics.length === 0,
    firstError: first === undefined ? null : `${first.code}: ${first.message}`,
  };
}

export function runProbes() {
  return loadProbes().map(runProbe);
}
