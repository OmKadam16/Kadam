import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { builtInFonts, catalogFont, closestFontNames, fontCatalog, fontKey, projectFonts, type CatalogFont } from "../fonts/catalog.js";
import { downloadFont } from "../fonts/fetch.js";

/**
 * D-51: fonts from the command line.
 *
 *   kadam fonts list [--category serif] [--built-in] [--search grotesk]
 *   kadam fonts info Lora
 *   kadam fonts add "Bricolage Grotesque" [--weights 400,700] [--alphabets latin,devanagari] [-p dir]
 *
 * `add` is the only Kadam command that uses the network; builds never do.
 */
export async function runFontsCommand(args: readonly string[]): Promise<number> {
  const [action, ...rest] = args;
  if (action === "list") return list(rest);
  if (action === "info") return info(rest);
  if (action === "add") return add(rest);
  return usage(action === undefined ? "name an action: list, info or add" : `unknown action ${JSON.stringify(action)}`);
}

function usage(problem: string): number {
  console.error(`kadam fonts: ${problem}
usage:
  kadam fonts list [--category <sans-serif|serif|monospace|display|handwriting>] [--built-in] [--search <words>]
  kadam fonts info <Family>
  kadam fonts add <Family...> [--weights 400,700] [--alphabets latin,devanagari] [-p <dir>]`);
  return 2;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function positional(args: readonly string[], valued: readonly string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (valued.includes(args[index]!)) index++;
    else if (!args[index]!.startsWith("-")) out.push(args[index]!);
  }
  return out;
}

function list(args: readonly string[]): number {
  const category = option(args, "--category");
  const search = option(args, "--search")?.toLowerCase();
  const builtIn = builtInFonts();
  const fonts = fontCatalog().filter((font) =>
    (category === undefined || font.category === category)
    && (search === undefined || font.family.toLowerCase().includes(search))
    && (!args.includes("--built-in") || builtIn.has(fontKey(font.family))));
  for (const font of fonts) {
    const mark = builtIn.has(fontKey(font.family)) ? "built in" : "add";
    console.log(`${font.family.padEnd(36)} ${font.category.padEnd(12)} ${mark}`);
  }
  console.log(`\n${fonts.length} of ${fontCatalog().length} fonts; ${builtIn.size} are built in. "add" fonts install with: kadam fonts add "<Family>"`);
  return 0;
}

function find(name: string): CatalogFont | null {
  const font = catalogFont(name);
  if (font !== null) return font;
  const close = closestFontNames(name, []);
  console.error(`kadam fonts: no free font is called ${JSON.stringify(name)}${close.length > 0 ? `; did you mean ${close.map((option) => JSON.stringify(option)).join(" or ")}?` : ""}`);
  return null;
}

function info(args: readonly string[]): number {
  const names = positional(args, []);
  if (names.length === 0) return usage("name a font, for example kadam fonts info Lora");
  let failed = false;
  for (const name of names) {
    const font = find(name);
    if (font === null) {
      failed = true;
      continue;
    }
    const builtIn = builtInFonts().has(fontKey(font.family));
    console.log(`${font.family}
  style      ${font.category}
  weights    ${font.weights.join(", ")}${font.variable ? " (variable)" : ""}
  italic     ${font.styles.includes("italic") ? "yes" : "no"}
  alphabets  ${font.subsets.join(", ")}
  licence    ${font.license}
  ${builtIn ? "built in: write The page font is " + font.family + "." : `install:   kadam fonts add "${font.family}"`}`);
  }
  return failed ? 1 : 0;
}

async function add(args: readonly string[]): Promise<number> {
  const valued = ["-p", "--project", "--weights", "--alphabets"];
  const names = positional(args, valued);
  if (names.length === 0) return usage('name a font, for example kadam fonts add "Bricolage Grotesque"');
  const root = resolve(option(args, "-p") ?? option(args, "--project") ?? ".");
  const weights = option(args, "--weights")?.split(",").map(Number);
  const alphabets = option(args, "--alphabets")?.split(",").map((value) => value.trim());
  if (weights?.some((weight) => !Number.isInteger(weight) || weight < 100 || weight > 900) === true) return usage("--weights takes numbers like 400,700");
  let failed = false;
  for (const name of names) {
    const font = find(name);
    if (font === null) {
      failed = true;
      continue;
    }
    const directory = join(root, "fonts", font.id);
    if (projectFonts(root).has(fontKey(font.family)) && existsSync(join(directory, "font.json"))) {
      console.log(`${font.family} is already in fonts/${font.id}/`);
      continue;
    }
    if (builtInFonts().has(fontKey(font.family)) && weights === undefined && alphabets === undefined) {
      console.log(`${font.family} is built in; write The page font is ${font.family}. (nothing to add)`);
      continue;
    }
    try {
      const description = await downloadFont(font.id, directory, {
        weights,
        subsets: alphabets,
        onProgress: (done, total) => {
          if (process.stdout.isTTY) process.stdout.write(`\r${font.family}: ${done} of ${total} files`);
        },
      });
      if (process.stdout.isTTY) process.stdout.write("\n");
      console.log(`Added ${description.family} to fonts/${font.id}/ (${description.files.length} files, ${description.license}).
Use it: The page font is ${description.family}.`);
    } catch (error) {
      process.stdout.write("\n");
      console.error(`kadam fonts: could not download ${font.family}: ${error instanceof Error ? error.message : String(error)}`);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}
