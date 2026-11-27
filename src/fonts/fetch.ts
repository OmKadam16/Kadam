// D-51: downloading a free family from Fontsource. Only `kadam fonts add` and
// the maintainers' bundling script use this; builds never touch the network.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FontCategory, FontDescription, FontFile } from "./catalog.js";

const CJK = /^(japanese|korean|chinese-simplified|chinese-traditional|chinese-hongkong)$/;
const API = "https://api.fontsource.org/v1";
const CDN = "https://cdn.jsdelivr.net/fontsource/fonts";

interface FontsourceFont {
  readonly id: string;
  readonly family: string;
  readonly subsets: readonly string[];
  readonly weights: readonly number[];
  readonly styles: readonly ("normal" | "italic")[];
  readonly variable: boolean;
  readonly category: string;
  readonly license: string;
  readonly npmVersion: string;
  readonly unicodeRange: Readonly<Record<string, string>>;
}

export interface DownloadOptions {
  /** Only these weights of a family that is not variable. */
  readonly weights?: readonly number[] | undefined;
  /** Only these alphabets (latin, cyrillic, devanagari...). */
  readonly subsets?: readonly string[] | undefined;
  readonly onProgress?: ((done: number, total: number) => void) | undefined;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

async function getBytes(url: string): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url);
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    if (attempt === 2 || response.status === 404) throw new Error(`${url} answered ${response.status}`);
  }
}

/** Downloads one family by Fontsource id into `directory`, with font.json and its licence. */
export async function downloadFont(id: string, directory: string, options: DownloadOptions = {}): Promise<FontDescription> {
  const font = await getJson<FontsourceFont>(`${API}/fonts/${encodeURIComponent(id)}`);
  let axes: Record<string, { min: string; max: string }> = {};
  if (font.variable) {
    try {
      axes = (await getJson<{ axes: Record<string, { min: string; max: string }> }>(`${API}/variable/${encodeURIComponent(id)}`)).axes;
    } catch {
      axes = {};
    }
  }
  // The range table names every file; Chinese, Japanese and Korean come as numbered slices.
  const keys = Object.keys(font.unicodeRange).length > 0 ? Object.keys(font.unicodeRange) : font.subsets;
  const cjk = font.subsets.filter((subset) => CJK.test(subset));
  const subsets = keys.filter((subset) => options.subsets === undefined || options.subsets.includes(subset)
    || (/^\[\d+\]$/.test(subset) && cjk.some((name) => options.subsets!.includes(name))));
  const wght = axes.wght;
  const plan: { url: string; file: FontFile }[] = [];
  for (const style of font.styles) {
    for (const subset of subsets) {
      const unicodeRange = font.unicodeRange[subset];
      const slug = subset.replace(/[[\]]/g, "");
      if (wght !== undefined) {
        const name = `${slug}-wght-${style}.woff2`;
        plan.push({ url: `${CDN}/${id}:vf@${font.npmVersion}/${slug}-wght-${style}.woff2`, file: { file: name, subset, weight: `${wght.min} ${wght.max}`, style, unicodeRange } });
        continue;
      }
      for (const weight of font.weights) {
        if (options.weights !== undefined && !options.weights.includes(weight)) continue;
        const name = `${slug}-${weight}-${style}.woff2`;
        plan.push({ url: `${CDN}/${id}@${font.npmVersion}/${slug}-${weight}-${style}.woff2`, file: { file: name, subset, weight: String(weight), style, unicodeRange } });
      }
    }
  }
  mkdirSync(directory, { recursive: true });
  let done = 0;
  const missing = new Set<string>();
  const queue = [...plan];
  const workers = Array.from({ length: 8 }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      try {
        writeFileSync(join(directory, item.file.file), await getBytes(item.url));
      } catch (error) {
        // A family can lack one style in one alphabet; leave that file out.
        if (!String(error).includes("answered 404")) throw error;
        missing.add(item.file.file);
      }
      options.onProgress?.(++done, plan.length);
    }
  });
  await Promise.all(workers);
  try {
    writeFileSync(join(directory, "LICENSE"), await getBytes(`${CDN}/${id}@${font.npmVersion}/LICENSE`));
  } catch {
    writeFileSync(join(directory, "LICENSE"), `${font.family} is licensed under ${font.license}.\n`);
  }
  const weights = wght === undefined
    ? font.weights.filter((weight) => options.weights === undefined || options.weights.includes(weight))
    : font.weights.filter((weight) => weight >= Number(wght.min) && weight <= Number(wght.max));
  const description: FontDescription = {
    id: font.id,
    family: font.family,
    category: toCategory(font.category),
    license: font.license,
    version: font.npmVersion,
    weights,
    styles: font.styles,
    files: plan.map((item) => item.file).filter((file) => !missing.has(file.file)).sort((a, b) => a.file.localeCompare(b.file)),
  };
  writeFileSync(join(directory, "font.json"), `${JSON.stringify(description, null, 2)}\n`);
  if (plan.length > 0 && missing.size > plan.length / 4) {
    throw new Error(`${missing.size} of ${plan.length} files were missing upstream`);
  }
  return description;
}

export function toCategory(value: string): FontCategory {
  return value === "sans-serif" || value === "serif" || value === "monospace" || value === "display" || value === "handwriting" ? value : "other";
}

/** The catalog file: every Fontsource family, compact. */
export async function downloadCatalog(): Promise<string> {
  const list = await getJson<FontsourceFont[]>(`${API}/fonts`);
  const rows = list
    .filter((font) => font.category !== "icons")
    .map((font) => {
      const subsets = font.subsets;
      return [font.id, font.family, toCategory(font.category), font.weights, font.styles, subsets, font.variable ? 1 : 0, font.license];
    })
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  return `{"version":1,"fonts":[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]}\n`;
}
