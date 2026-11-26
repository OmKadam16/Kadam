/**
 * F7: the canonical layout of a .kdm file. Only whitespace changes; words,
 * quoted text, comments and statement order never do, so a formatted file
 * means exactly what it meant before.
 *
 * - Four spaces of indentation per open brace.
 * - One space between words outside quotes and comments; none before a comma.
 * - No trailing whitespace, at most one blank line in a row, no blank line
 *   just inside a brace, LF line endings, and one final newline.
 */

export type FormatResult =
  | { readonly ok: true; readonly text: string; readonly changed: boolean }
  | { readonly ok: false; readonly line: number; readonly message: string };

export function formatKadam(source: string): FormatResult {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const out: string[] = [];
  let depth = 0;
  let blank = false;
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!.trim();
    if (raw === "") {
      blank = out.length > 0;
      continue;
    }
    const line = normalizeSpaces(raw);
    if (line === null) return { ok: false, line: index + 1, message: "a quoted string is not closed on this line" };
    const closes = line.startsWith("}");
    if (closes) depth -= 1;
    if (depth < 0) return { ok: false, line: index + 1, message: "this } has no matching {" };
    // No blank line right after an opening brace or right before a closing one.
    if (blank && !closes && !(out.at(-1)?.endsWith("{") ?? false)) out.push("");
    blank = false;
    out.push(`${"    ".repeat(depth)}${line}`);
    if (opensBlock(line)) depth += 1;
  }
  if (depth !== 0) return { ok: false, line: lines.length, message: `${depth} { ${depth === 1 ? "is" : "are"} not closed` };
  const formatted = out.length === 0 ? "" : `${out.join("\n")}\n`;
  return { ok: true, text: formatted, changed: formatted !== source };
}

/** Collapse runs of spaces outside quotes and comments; null when a quote is left open. */
function normalizeSpaces(line: string): string | null {
  let out = "";
  let index = 0;
  while (index < line.length) {
    const character = line[index]!;
    if (character === '"') {
      let end = index + 1;
      while (end < line.length && line[end] !== '"') end += line[end] === "\\" ? 2 : 1;
      if (end >= line.length) return null;
      out += line.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (character === "/" && line[index + 1] === "/") {
      out += line.slice(index);
      break;
    }
    if (character === " " || character === "\t") {
      while (index < line.length && (line[index] === " " || line[index] === "\t")) index += 1;
      if (line[index] !== "," && out !== "") out += " ";
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}

/** True when the line ends with `{` outside quotes and comments. */
function opensBlock(line: string): boolean {
  let last = "";
  let index = 0;
  while (index < line.length) {
    const character = line[index]!;
    if (character === '"') {
      index += 1;
      while (index < line.length && line[index] !== '"') index += line[index] === "\\" ? 2 : 1;
      index += 1;
      last = '"';
      continue;
    }
    if (character === "/" && line[index + 1] === "/") break;
    if (character !== " ") last = character;
    index += 1;
  }
  return last === "{";
}
