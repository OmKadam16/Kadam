import { readFileSync } from "node:fs";

import { CODE_EXPLANATIONS, explainCode } from "../core/diagnostics/explanations.js";
import { parseText } from "../core/parser/parser.js";
import { isProseSource } from "../core/prose/translate.js";
import { libraryComponentNames } from "../compiler/project.js";
import { describeLibraryComponent, isLibraryComponent, printLibraryComponent, printLibraryList } from "./library-command.js";

/**
 * F7: `kadam explain KDM3005` prints what a diagnostic code means and where
 * its rules are written down. Offline: everything is in the package.
 * `kadam explain` alone lists every code.
 */
export function runExplainCommand(args: readonly string[]): number {
  const json = args.includes("--json");
  const wanted = args.filter((arg) => arg !== "--json" && arg !== "--library");
  // D-50: `kadam explain --blocks page.kdm` prints a paragraph page in the block form.
  const blocksAt = args.indexOf("--blocks");
  if (blocksAt !== -1) {
    const path = args[blocksAt + 1];
    if (path === undefined) {
      console.error("kadam explain: --blocks needs a kadam 0.4 page, for example kadam explain --blocks pages/home.kdm");
      return 2;
    }
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      console.error(`kadam explain: cannot read ${path}`);
      return 2;
    }
    if (!isProseSource(text)) {
      console.error(`kadam explain: ${path} is not a kadam 0.4 page; it is already in the block form`);
      return 2;
    }
    const parsed = parseText(path, text, { validate: false, allowComponentKinds: true });
    process.stdout.write(parsed.prose?.text ?? "");
    return 0;
  }
  // D-46: `kadam explain --library` lists the standard components.
  if (args.includes("--library")) {
    if (json) console.log(JSON.stringify(libraryNames().map(describeLibraryComponent), null, 2));
    else printLibraryList();
    return 0;
  }
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
  const found: unknown[] = [];
  for (const code of wanted) {
    // D-46: `kadam explain Card` describes a library component.
    if (isLibraryComponent(code)) {
      const info = describeLibraryComponent(code);
      found.push(info);
      if (!json) printLibraryComponent(info);
      continue;
    }
    const entry = explainCode(code);
    if (entry === undefined) {
      console.error(`kadam explain: unknown code or library component ${JSON.stringify(code)}; codes look like KDM3005 (run kadam explain to list them, or kadam explain --library for components)`);
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

function libraryNames(): string[] {
  return libraryComponentNames();
}
