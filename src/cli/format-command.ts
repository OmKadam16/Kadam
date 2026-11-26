import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { formatKadam } from "./format.js";

/**
 * F7: `kadam format [paths...]` rewrites .kdm files in their canonical layout.
 * `--check` changes nothing and exits 1 when a file is not formatted (for CI).
 * Directories are searched for .kdm files, skipping dist, node_modules and
 * dot folders.
 */
export function runFormatCommand(args: readonly string[]): number {
  const check = args.includes("--check");
  const paths = args.filter((arg) => arg !== "--check");
  for (const arg of paths) {
    if (arg.startsWith("-")) {
      console.error(`kadam format: unexpected argument ${JSON.stringify(arg)}`);
      return 2;
    }
  }
  const files: string[] = [];
  for (const path of paths.length === 0 ? ["."] : paths) {
    if (!existsSync(path)) {
      console.error(`kadam format: ${path} does not exist`);
      return 2;
    }
    if (statSync(path).isDirectory()) collect(path, files);
    else if (path.endsWith(".kdm")) files.push(path);
    else {
      console.error(`kadam format: ${path} is not a .kdm file`);
      return 2;
    }
  }
  let unformatted = 0;
  let failed = 0;
  for (const file of files.sort()) {
    const source = readFileSync(file, "utf8");
    const result = formatKadam(source);
    if (!result.ok) {
      console.error(`${file}:${result.line}: ${result.message}; nothing was changed`);
      failed += 1;
      continue;
    }
    if (!result.changed) continue;
    unformatted += 1;
    if (check) console.log(`not formatted: ${file}`);
    else {
      writeFileSync(file, result.text);
      console.log(`formatted ${file}`);
    }
  }
  if (check && unformatted === 0 && failed === 0) console.log(`kadam format: ${files.length} file${files.length === 1 ? " is" : "s are"} formatted`);
  if (!check && unformatted === 0 && failed === 0) console.log(`kadam format: nothing to change in ${files.length} file${files.length === 1 ? "" : "s"}`);
  if (failed > 0) return 1;
  return check && unformatted > 0 ? 1 : 0;
}

function collect(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "dist" || name === "node_modules") continue;
    const path = dir === "." ? name : join(dir, name);
    if (statSync(path).isDirectory()) collect(path, out);
    else if (name.endsWith(".kdm")) out.push(relative(".", path) || path);
  }
}
