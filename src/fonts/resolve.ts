// D-51: turn the font names pages use into fonts with files: kadam.json
// first, then the project's fonts/ folder, then the built-in families.

import { join } from "node:path";
import type { ElementNode, PageNode } from "../core/ast/nodes.js";
import type { ManifestFont } from "../compiler/manifest.js";
import { FONT_STACKS } from "../compiler/defaults.js";
import { availableFonts, fontKey, type FontCategory, type InstalledFont } from "./catalog.js";

export interface ResolvedFonts {
  /** Every usable name, as written, to its font. */
  readonly fonts: Readonly<Record<string, ManifestFont>>;
  /** Each font file a page uses: read from `file`, written to `path`. */
  readonly files: readonly { readonly file: string; readonly path: string }[];
}

const HANDWRITING_STACK = `"Segoe Print", "Bradley Hand", cursive, ${FONT_STACKS["sans serif"]}`;

export function fallbackFor(category: FontCategory): Pick<ManifestFont, "fallback" | "fallbackStack"> {
  if (category === "serif") return { fallback: "serif" };
  if (category === "monospace") return { fallback: "monospace" };
  if (category === "handwriting") return { fallback: "sans serif", fallbackStack: HANDWRITING_STACK };
  return { fallback: "sans serif" };
}

function toManifestFont(font: InstalledFont): ManifestFont {
  const folder = font.id === "" ? "fonts" : `fonts/${font.id}`;
  return {
    source: "",
    weight: "400",
    style: "normal",
    ...fallbackFor(font.category),
    family: font.family,
    weights: font.weights,
    faces: font.files.map((file) => ({
      file: join(font.directory, file.file),
      path: `${folder}/${file.file}`,
      weight: file.weight,
      style: file.style,
      unicodeRange: file.unicodeRange,
    })),
  };
}

/** Resolves `names` (as written in pages) on top of the kadam.json fonts. */
export function resolveFonts(
  declared: Readonly<Record<string, ManifestFont>>,
  names: Iterable<string>,
  projectRoot: string | null,
): ResolvedFonts {
  const fonts: Record<string, ManifestFont> = { ...declared };
  const files = new Map<string, string>();
  let available: ReadonlyMap<string, InstalledFont> | null = null;
  for (const name of names) {
    if (name in fonts) continue;
    available ??= availableFonts(projectRoot);
    const found = available.get(fontKey(name));
    if (found === undefined) continue;
    const font = toManifestFont(found);
    fonts[name] = font;
    for (const face of font.faces ?? []) files.set(face.path, face.file);
  }
  return { fonts, files: [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, file]) => ({ file, path })) };
}

/** D-51: every font name a page uses: `the font is "..."` and the page and heading fonts. */
export function collectFontNames(page: PageNode, out: Set<string>): void {
  for (const setting of page.settings) if (setting.property === "custom font") out.add(setting.name);
  const visit = (elements: readonly ElementNode[]): void => {
    for (const element of elements) {
      for (const scoped of element.statements) {
        const statement = scoped.type === "responsive" || scoped.type === "scoped" ? scoped.statement : scoped;
        if (statement.type === "custom-font") out.add(statement.name);
      }
      visit(element.children);
    }
  };
  visit(page.elements);
}
