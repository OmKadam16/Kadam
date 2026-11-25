// `npm run probes`: print frontend coverage by plan phase.
import { runProbes } from "./frontend-probes.mjs";

const results = runProbes();
const byPhase = new Map();
for (const result of results) {
  const phase = result.probe.phase;
  if (!byPhase.has(phase)) byPhase.set(phase, []);
  byPhase.get(phase).push(result);
}

const passing = results.filter((r) => r.compiles).length;
console.log(`Frontend probes: ${passing}/${results.length} compile\n`);
for (const phase of [...byPhase.keys()].sort()) {
  const group = byPhase.get(phase);
  const ok = group.filter((r) => r.compiles).length;
  console.log(`${phase === "-" ? "baseline" : phase}  ${ok}/${group.length}`);
  for (const r of group) {
    const what = r.probe.statement === "" ? `${/^[aeiou]/.test(r.probe.kind) ? "an" : "a"} ${r.probe.kind}` : `${r.probe.kind}: ${r.probe.statement}`;
    console.log(`  ${r.compiles ? "✓" : "·"} ${what}${r.compiles ? "" : `   (${r.firstError})`}`);
  }
}
