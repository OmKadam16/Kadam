import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { PROJECT_TEMPLATES } from "./templates.generated.js";

/**
 * F7: `kadam new <directory> [--template <name>]` starts a project from one of
 * the reference projects. `kadam new --list` lists the templates. It writes
 * only into a new or empty directory, and never touches the network.
 */
export function runNewCommand(args: readonly string[]): number {
  if (args.includes("--list")) {
    for (const template of PROJECT_TEMPLATES) console.log(`  ${template.name.padEnd(10)} ${template.description}`);
    return 0;
  }
  let target: string | undefined;
  let name = "minimal";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--template" || argument === "-t") {
      const value = args[index + 1];
      if (value === undefined) return usage("--template needs a name");
      name = value;
      index += 1;
    } else if (argument.startsWith("--template=")) {
      name = argument.slice("--template=".length);
    } else if (argument.startsWith("-")) {
      return usage(`unexpected argument ${JSON.stringify(argument)}`);
    } else if (target === undefined) {
      target = argument;
    } else {
      return usage(`unexpected argument ${JSON.stringify(argument)}`);
    }
  }
  if (target === undefined) return usage("expected a directory for the new project");
  const template = PROJECT_TEMPLATES.find((candidate) => candidate.name === name);
  if (template === undefined) {
    console.error(`kadam new: unknown template ${JSON.stringify(name)}; templates: ${PROJECT_TEMPLATES.map((t) => t.name).join(", ")}`);
    return 2;
  }
  const root = resolve(target);
  if (existsSync(root) && readdirSync(root).length > 0) {
    console.error(`kadam new: ${target} is not empty; choose a new directory`);
    return 1;
  }
  const projectName = basename(root).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-site";
  for (const [path, contents] of Object.entries(template.files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, path === "kadam.json" ? renameProject(contents, projectName) : contents);
  }
  console.log(`Created ${target} from the ${template.name} template (${Object.keys(template.files).length} files).`);
  console.log("");
  console.log("Next:");
  console.log(`  cd ${target}`);
  console.log("  kadam dev");
  return 0;
}

function renameProject(manifest: string, name: string): string {
  const parsed = JSON.parse(manifest) as Record<string, unknown>;
  return `${JSON.stringify({ ...parsed, name }, null, 2)}\n`;
}

function usage(problem: string): number {
  console.error(`kadam new: ${problem}`);
  console.error("usage: kadam new <directory> [--template <name>]   (kadam new --list shows the templates)");
  return 2;
}
