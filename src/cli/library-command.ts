import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import type { ComponentNode, ElementNode } from "../core/ast/nodes.js";
import { parseComponentSource } from "../core/parser/component.js";
import { SourceFile } from "../core/source/source-file.js";
import { LIBRARY_ROOT, libraryComponentNames } from "../compiler/project.js";

/**
 * D-46: the standard component library from the command line.
 *
 *   kadam explain Card      what a library component takes, its variants and slots
 *   kadam explain --library  every library component
 *   kadam eject Card         copy its source into the project to change it
 */

export interface LibraryComponentInfo {
  readonly name: string;
  readonly summary: string;
  readonly parameters: readonly { readonly name: string; readonly type: string; readonly default: string | null }[];
  readonly variants: readonly string[];
  readonly slots: readonly string[];
  readonly example: string;
}

export function isLibraryComponent(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && existsSync(join(LIBRARY_ROOT, `${name}.kdm`));
}

export function describeLibraryComponent(name: string): LibraryComponentInfo {
  const text = readFileSync(join(LIBRARY_ROOT, `${name}.kdm`), "utf8");
  const summary = text.split("\n").find((line) => line.startsWith("//"))?.replace(/^\/\/\s*/, "") ?? "";
  const component = parseComponentSource(new SourceFile(`kadam/${name}.kdm`, text)).document.component as ComponentNode;
  const slots: string[] = [];
  const visit = (element: ElementNode): void => {
    const reference = element.kind?.reference;
    if (reference?.type === "slot-kind") slots.push(reference.name === null ? "content (unnamed)" : `${reference.name} slot`);
    element.children.forEach(visit);
  };
  component.elements.forEach(visit);
  const parameters = component.parameters.map((parameter) => ({ name: parameter.name, type: parameter.valueType, default: parameter.defaultValue }));
  const article = (word: string): string => (/^[aeiou]/i.test(word) ? "an" : "a");
  const example = [
    `${name[0]!.toLowerCase()}${name.slice(1)}1 {`,
    `    a ${name} from kadam`,
    ...parameters.filter((parameter) => parameter.default === null).map((parameter) => `    with ${article(parameter.name)} ${parameter.name} of "${sampleValue(parameter.type)}"`),
    "}",
  ].join("\n");
  return { name, summary, parameters, variants: component.variants.map((variant) => variant.name), slots: [...new Set(slots)], example };
}

function sampleValue(type: string): string {
  switch (type) {
    case "page":
      return "Home";
    case "url":
      return "https://example.com";
    case "image":
      return "assets/picture.jpg";
    case "length":
      return "16px";
    case "color":
      return "#4F46E5";
    default:
      return "...";
  }
}

export function printLibraryComponent(info: LibraryComponentInfo): void {
  console.log(`${info.name} (the kadam library)`);
  if (info.summary !== "") console.log(`  ${info.summary}`);
  console.log("  Takes:");
  for (const parameter of info.parameters) {
    console.log(`    ${parameter.name.padEnd(12)} ${parameter.type}${parameter.default === null ? "" : `, defaulting to "${parameter.default}"`}`);
  }
  if (info.variants.length > 0) console.log(`  Variants: ${info.variants.join(", ")} (a ${info.name} from kadam in the ${info.variants[0]} variant)`);
  if (info.slots.length > 0) console.log(`  Slots: ${info.slots.join(", ")}`);
  console.log(`  Use it (list "${info.name}" in kadam.json: { "library": "kadam", "use": ["${info.name}"] }):`);
  for (const line of info.example.split("\n")) console.log(`    ${line}`);
}

export function printLibraryList(): void {
  for (const name of libraryComponentNames()) {
    console.log(`  ${name.padEnd(14)} ${describeLibraryComponent(name).summary}`);
  }
}

/** `kadam eject Card [-p project]`: the project gets its own copy of a library component. */
export function runEjectCommand(args: readonly string[]): number {
  let project = ".";
  const names: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "-p" || argument === "--project") {
      const value = args[index + 1];
      if (value === undefined) return usage("--project needs a directory");
      project = value;
      index += 1;
    } else if (argument.startsWith("-")) {
      return usage(`unexpected argument ${JSON.stringify(argument)}`);
    } else {
      names.push(argument);
    }
  }
  if (names.length === 0) return usage("name the library components to eject, for example kadam eject Card");
  const root = resolve(project);
  const manifestPath = join(root, "kadam.json");
  if (!existsSync(manifestPath)) {
    console.error(`kadam eject: no kadam.json in ${root}`);
    return 2;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { components?: unknown[]; pages?: { source?: string }[] };
  const components = Array.isArray(manifest.components) ? [...manifest.components] : [];
  for (const name of names) {
    if (!isLibraryComponent(name)) {
      console.error(`kadam eject: the kadam library has no component named ${name}; components: ${libraryComponentNames().join(", ")}`);
      return 2;
    }
    const target = join(root, "components", `${name}.kdm`);
    if (existsSync(target)) {
      console.error(`kadam eject: ${relative(process.cwd(), target)} already exists; nothing was changed`);
      return 2;
    }
  }
  const changed: string[] = [];
  for (const name of names) {
    mkdirSync(join(root, "components"), { recursive: true });
    writeFileSync(join(root, "components", `${name}.kdm`), readFileSync(join(LIBRARY_ROOT, `${name}.kdm`), "utf8"));
    changed.push(`components/${name}.kdm`);
    // The manifest: drop it from the library entry and list the copy.
    for (let index = 0; index < components.length; index += 1) {
      const entry = components[index] as { library?: unknown; use?: unknown };
      if (entry !== null && typeof entry === "object" && entry.library === "kadam" && Array.isArray(entry.use)) {
        const use = entry.use.filter((item) => item !== name);
        components[index] = { ...entry, use };
      }
    }
    components.push(`components/${name}.kdm`);
  }
  manifest.components = components.filter((entry) => {
    const library = entry as { library?: unknown; use?: unknown };
    return !(library !== null && typeof library === "object" && library.library === "kadam" && Array.isArray(library.use) && library.use.length === 0);
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  changed.push("kadam.json");
  // Uses of the component now name the project's copy.
  const pattern = new RegExp(`^(\\s*an? (?:${names.join("|")})) from kadam\\b`, "gm");
  for (const file of kdmFiles(root)) {
    const text = readFileSync(file, "utf8");
    const next = text.replace(pattern, "$1");
    if (next !== text) {
      writeFileSync(file, next);
      changed.push(relative(root, file));
    }
  }
  console.log(`kadam eject: ${names.join(", ")} ${names.length === 1 ? "is" : "are"} now part of the project. Changed:`);
  for (const path of changed) console.log(`  ${path}`);
  return 0;
}

function kdmFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...kdmFiles(path));
    else if (name.endsWith(".kdm")) out.push(path);
  }
  return out.sort();
}

function usage(message: string): number {
  console.error(`kadam eject: ${message}\nusage: kadam eject <Component...> [-p <project>]`);
  return 2;
}
