import { CODE_EXPLANATIONS, explainCode } from "../core/diagnostics/explanations.js";

/**
 * F7: `kadam explain KDM3005` prints what a diagnostic code means and where
 * its rules are written down. Offline: everything is in the package.
 * `kadam explain` alone lists every code.
 */
export function runExplainCommand(args: readonly string[]): number {
  const json = args.includes("--json");
  const wanted = args.filter((arg) => arg !== "--json");
  if (wanted.length === 0) {
    if (json) {
      console.log(JSON.stringify(CODE_EXPLANATIONS, null, 2));
      return 0;
    }
    let area = "";
    for (const entry of CODE_EXPLANATIONS) {
      if (entry.area !== area) {
        area = entry.area;
        console.log(`\n${area[0]!.toUpperCase()}${area.slice(1)}`);
      }
      console.log(`  ${entry.code}  ${entry.meaning}`);
    }
    return 0;
  }
  let status = 0;
  const found = [];
  for (const code of wanted) {
    const entry = explainCode(code);
    if (entry === undefined) {
      console.error(`kadam explain: unknown code ${JSON.stringify(code)}; codes look like KDM3005 (run kadam explain to list them)`);
      status = 2;
      continue;
    }
    found.push(entry);
    if (!json) {
      console.log(`${entry.code} (${entry.area})`);
      console.log(`  ${entry.meaning}`);
      console.log(`  Rules: ${entry.reference}`);
    }
  }
  if (json) console.log(JSON.stringify(found, null, 2));
  return status;
}
