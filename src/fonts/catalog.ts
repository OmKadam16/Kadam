// D-51: fonts. The catalog of every free family, the built-in families that
// ship in the package, and the families a project installed in `fonts/`.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the package keeps its fonts: `library/fonts/`. */
export const FONTS_ROOT = fileURLToPath(new URL("../../library/fonts/", import.meta.url));

export type FontCategory = "sans-serif" | "serif" | "monospace" | "display" | "handwriting" | "other";

/** One family in the catalog (`library/fonts/catalog.json`). */
export interface CatalogFont {
  readonly id: string;
  readonly family: string;
  readonly category: FontCategory;
  readonly weights: readonly number[];
  readonly styles: readonly ("normal" | "italic")[];
  /** Alphabets, e.g. latin, cyrillic, devanagari. Chinese, Japanese and Korean slices are one entry. */
  readonly subsets: readonly string[];
  readonly variable: boolean;
  readonly license: string;
}

/** One file of a family: a style, a weight or weight range, and the characters it covers. */
export interface FontFile {
  readonly file: string;
  readonly subset: string;
  /** A CSS weight or range: "400" or "100 900". */
  readonly weight: string;
  readonly style: "normal" | "italic";
  readonly unicodeRange?: string | undefined;
}

/** `font.json`: a family on disk, built in or installed with `kadam fonts add`. */
export interface FontDescription {
  readonly id: string;
  readonly family: string;
  readonly category: FontCategory;
  readonly license: string;
  readonly version: string;
  readonly weights: readonly number[];
  readonly styles: readonly ("normal" | "italic")[];
  readonly files: readonly FontFile[];
}

/** A family ready to use: its files on disk and where it came from. */
export interface InstalledFont {
  readonly family: string;
  readonly category: FontCategory;
  readonly weights: readonly number[];
  readonly styles: readonly ("normal" | "italic")[];
  /** Absolute directory holding the files. */
  readonly directory: string;
  /** The folder name the files are copied under in the build: `fonts/<id>/`. */
  readonly id: string;
  readonly files: readonly FontFile[];
  readonly origin: "built-in" | "project";
}

let catalogCache: readonly CatalogFont[] | null = null;

/** Every family in the catalog, in name order. */
export function fontCatalog(): readonly CatalogFont[] {
  if (catalogCache !== null) return catalogCache;
  const path = join(FONTS_ROOT, "catalog.json");
  if (!existsSync(path)) return (catalogCache = []);
  const raw = JSON.parse(readFileSync(path, "utf8")) as { fonts: [string, string, FontCategory, number[], ("normal" | "italic")[], string[], number, string][] };
  catalogCache = raw.fonts.map(([id, family, category, weights, styles, subsets, variable, license]) => ({
    id, family, category, weights, styles, subsets, variable: variable === 1, license,
  }));
  return catalogCache;
}

/** The catalog entry for a family name (any case), or null. */
export function catalogFont(name: string): CatalogFont | null {
  const key = fontKey(name);
  return fontCatalog().find((font) => fontKey(font.family) === key || font.id === key) ?? null;
}

/** "Playfair Display" and "playfair-display" and "PlayfairDisplay" are one key. */
export function fontKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

let builtInCache: ReadonlyMap<string, InstalledFont> | null = null;

/** The families that ship in the package, by key. */
export function builtInFonts(): ReadonlyMap<string, InstalledFont> {
  if (builtInCache !== null) return builtInCache;
  builtInCache = readFontDirectories(FONTS_ROOT, "built-in");
  return builtInCache;
}

function readFontDirectories(root: string, origin: InstalledFont["origin"]): Map<string, InstalledFont> {
  const out = new Map<string, InstalledFont>();
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root).sort()) {
    const directory = join(root, name);
    const description = join(directory, "font.json");
    if (!statSync(directory).isDirectory() || !existsSync(description)) continue;
    const font = JSON.parse(readFileSync(description, "utf8")) as FontDescription;
    out.set(fontKey(font.family), {
      family: font.family, category: font.category, weights: font.weights, styles: font.styles,
      directory, id: font.id, files: font.files, origin,
    });
  }
  return out;
}

const FONT_FILE = /\.(woff2|woff|ttf|otf)$/i;
const STYLE_WORDS: readonly [RegExp, number][] = [
  [/^(thin|hairline)$/, 100], [/^(extralight|ultralight)$/, 200], [/^light$/, 300],
  [/^(regular|normal|book|roman)$/, 400], [/^medium$/, 500], [/^(semibold|demibold)$/, 600],
  [/^bold$/, 700], [/^(extrabold|ultrabold)$/, 800], [/^(black|heavy)$/, 900],
];

/**
 * The project's `fonts/` folder: families installed with `kadam fonts add`
 * (a folder with font.json), and loose files the author dropped in.
 * `Acme Sans-BoldItalic.woff2` is "Acme Sans", weight 700, italic.
 */
export function projectFonts(projectRoot: string): ReadonlyMap<string, InstalledFont> {
  const root = join(projectRoot, "fonts");
  const out = readFontDirectories(root, "project");
  if (!existsSync(root)) return out;
  const loose = new Map<string, { family: string; files: FontFile[] }>();
  for (const name of readdirSync(root).sort()) {
    if (!FONT_FILE.test(name) || !statSync(join(root, name)).isFile()) continue;
    const { family, weight, style } = parseFontFileName(basename(name, extname(name)));
    const key = fontKey(family);
    const entry = loose.get(key) ?? { family, files: [] };
    entry.files.push({ file: name, subset: "all", weight, style });
    loose.set(key, entry);
  }
  for (const [key, entry] of loose) {
    if (out.has(key)) continue;
    const weights = [...new Set(entry.files.flatMap((file) => weightsOf(file.weight)))].sort((a, b) => a - b);
    const styles = [...new Set(entry.files.map((file) => file.style))].sort();
    const known = catalogFont(entry.family);
    out.set(key, {
      family: entry.family, category: known?.category ?? "sans-serif", weights, styles,
      directory: root, id: "", files: entry.files, origin: "project",
    });
  }
  return out;
}

/** Splits `Acme Sans-SemiBoldItalic` into family, weight and style. A variable file says `[wght]` or `Variable`. */
export function parseFontFileName(stem: string): { family: string; weight: string; style: "normal" | "italic" } {
  let family = stem.trim();
  let weight = "400";
  let style: "normal" | "italic" = "normal";
  if (/(\[wght\]|[-_ ]?variable(?:font)?(?:_wght)?)/i.test(family)) {
    family = family.replace(/[-_ ]?(\[wght\]|variable(?:font)?(?:_wght)?)/i, "");
    weight = "100 900";
  }
  const suffix = /[-_ ]([A-Za-z]+)$/.exec(family);
  if (suffix !== null) {
    let word = suffix[1]!.toLowerCase();
    let found = false;
    if (word.endsWith("italic")) {
      style = "italic";
      word = word.slice(0, -"italic".length);
      found = true;
    }
    if (word === "") found = true;
    for (const [pattern, value] of STYLE_WORDS) {
      if (pattern.test(word)) {
        if (weight !== "100 900") weight = String(value);
        found = true;
      }
    }
    if (found) family = family.slice(0, suffix.index);
  }
  return { family: family.replace(/[_]+/g, " ").trim(), weight, style };
}

function weightsOf(weight: string): number[] {
  const [low, high] = weight.split(" ").map(Number);
  if (high === undefined) return [low!];
  const out: number[] = [];
  for (let value = Math.ceil(low! / 100) * 100; value <= high; value += 100) out.push(value);
  return out;
}

/** Up to three catalog or installed names closest to a misspelled one, for fixes. */
export function closestFontNames(name: string, installed: Iterable<string>): string[] {
  const key = fontKey(name);
  const names = [...new Set([...installed, ...fontCatalog().map((font) => font.family)])];
  return names
    .map((candidate) => ({ candidate, distance: editDistance(key, fontKey(candidate)) }))
    .filter(({ distance, candidate }) => distance <= Math.max(2, Math.floor(fontKey(candidate).length / 4)))
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 6) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** Built-in and project fonts together; the project's own win. */
export function availableFonts(projectRoot: string | null): ReadonlyMap<string, InstalledFont> {
  const out = new Map(builtInFonts());
  if (projectRoot !== null) for (const [key, font] of projectFonts(projectRoot)) out.set(key, font);
  return out;
}
