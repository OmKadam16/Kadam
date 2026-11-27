import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { compileText } from "../compiler/compile.js";
import { compileProject } from "../compiler/project.js";
import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import { explainCode } from "../core/diagnostics/explanations.js";
import { lex } from "../core/lexer/lexer.js";
import type { Token } from "../core/lexer/token.js";
import { BUILTIN_KIND_INFO } from "../core/parser/kind.js";
import { PROPERTIES } from "../core/parser/properties.js";
import { matchLine, STATEMENT_TEMPLATES } from "../core/parser/registry.js";
import { SourceFile } from "../core/source/source-file.js";
import { compileV02Text } from "../v02/compile.js";
import { parseText } from "../core/parser/parser.js";
import { isProseSource, PROSE_SENTENCES } from "../core/prose/translate.js";

/**
 * F7: what the language server knows, built only from the compiler's own
 * entry points, so the editor reports exactly what `kadam check` reports.
 */

export interface LspPosition {
  readonly line: number;
  readonly character: number;
}

export interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

export interface LspDiagnostic {
  readonly range: LspRange;
  readonly severity: 1 | 2 | 3;
  readonly code: string;
  readonly source: "kadam";
  readonly message: string;
  /** D-50: the fixes, as edits, for code actions. */
  readonly data?: { readonly fixes: readonly { readonly title: string; readonly range: LspRange; readonly newText: string }[] };
}

export interface FileDiagnostics {
  readonly path: string;
  readonly diagnostics: readonly LspDiagnostic[];
}

/** The nearest folder at or above `file` that holds kadam.json, if any. */
export function projectRootOf(file: string): string | null {
  let dir = dirname(resolve(file));
  for (;;) {
    if (existsSync(join(dir, "kadam.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Diagnostics for a file and, when it is in a project, every file of that
 * project (a component edit can break a page). `open` holds unsaved text by
 * absolute path.
 */
export function diagnose(file: string, open: ReadonlyMap<string, string>): FileDiagnostics[] {
  const absolute = resolve(file);
  const root = projectRootOf(absolute);
  const text = open.get(absolute) ?? readFileSync(absolute, "utf8");
  let diagnostics: readonly Diagnostic[];
  let base: string;
  if (text.startsWith("kadam 0.2") || root === null) {
    base = dirname(absolute);
    diagnostics = text.startsWith("kadam 0.2")
      ? compileV02Text(relative(base, absolute), text).diagnostics
      : compileText(relative(base, absolute), text).diagnostics;
  } else {
    base = root;
    const overrides = new Map<string, string>();
    for (const [path, contents] of open) {
      if (path.startsWith(root + sep)) overrides.set(relative(root, path).split(sep).join("/"), contents);
    }
    diagnostics = compileProject({ projectRoot: root, sourceOverrides: overrides }).diagnostics;
  }
  const byFile = new Map<string, LspDiagnostic[]>([[absolute, []]]);
  for (const diagnostic of diagnostics) {
    const path = resolve(base, diagnostic.span.file);
    const lines = (open.get(path) ?? safeRead(path) ?? "").split("\n");
    const list = byFile.get(path) ?? [];
    list.push(toLsp(diagnostic, lines));
    byFile.set(path, list);
  }
  return [...byFile].map(([path, list]) => ({ path, diagnostics: list }));
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function toLsp(diagnostic: Diagnostic, lines: readonly string[]): LspDiagnostic {
  const position = (line: number, column: number): LspPosition => ({
    line: Math.max(0, line - 1),
    character: utf16Column(lines[line - 1] ?? "", column),
  });
  return {
    range: { start: position(diagnostic.span.start.line, diagnostic.span.start.column), end: position(diagnostic.span.end.line, diagnostic.span.end.column) },
    severity: diagnostic.severity === "error" ? 1 : diagnostic.severity === "warning" ? 2 : 3,
    code: diagnostic.code,
    source: "kadam",
    message: diagnostic.hint === undefined ? diagnostic.message : `${diagnostic.message}\nhint: ${diagnostic.hint}`,
    ...(diagnostic.fixes === undefined || diagnostic.fixes.length === 0
      ? {}
      : {
          data: {
            fixes: diagnostic.fixes.map((fix) => ({
              title: `Fix: ${fix.label}`,
              range: { start: position(fix.span.start.line, fix.span.start.column), end: position(fix.span.end.line, fix.span.end.column) },
              newText: fix.text,
            })),
          },
        }),
  };
}

/** Kadam columns count code points from 1; LSP characters count UTF-16 units from 0. */
function utf16Column(line: string, column: number): number {
  return Array.from(line).slice(0, Math.max(0, column - 1)).join("").length;
}

export interface CompletionItem {
  readonly label: string;
  readonly detail: string;
  readonly kind: number;
  readonly textEdit: { readonly range: LspRange; readonly newText: string };
  readonly filterText: string;
}

let sentences: readonly { readonly text: string; readonly detail: string }[] | null = null;

/** Every canonical sentence: template examples, the property table, and kind sentences. */
function allSentences(): readonly { readonly text: string; readonly detail: string }[] {
  if (sentences !== null) return sentences;
  const seen = new Map<string, string>();
  for (const template of STATEMENT_TEMPLATES) {
    for (const example of template.examples ?? []) if (!seen.has(example)) seen.set(example, template.description);
  }
  for (const property of PROPERTIES) if (!seen.has(property.example)) seen.set(property.example, property.description);
  for (const kind of Object.keys(BUILTIN_KIND_INFO)) {
    const sentence = `${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind}`;
    if (!seen.has(sentence)) seen.set(sentence, "Kind sentence");
  }
  sentences = [...seen].map(([text, detail]) => ({ text, detail })).sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  return sentences;
}

/** Sentences that continue what the line already says, plus project components after `a `. */
export function complete(file: string, text: string, position: LspPosition): CompletionItem[] {
  const line = text.split("\n")[position.line] ?? "";
  const before = line.slice(0, position.character);
  const indent = before.length - before.trimStart().length;
  const typed = before.trimStart().toLowerCase();
  const range = { start: { line: position.line, character: indent }, end: { line: position.line, character: line.length } };
  const items: CompletionItem[] = [];
  // D-50: a paragraph page is completed with paragraph sentences.
  const sentences = isProseSource(text) ? PROSE_SENTENCES : allSentences();
  for (const sentence of sentences) {
    if (!sentence.text.toLowerCase().startsWith(typed)) continue;
    items.push({ label: sentence.text, detail: sentence.detail, kind: 15, textEdit: { range, newText: sentence.text }, filterText: sentence.text });
  }
  if (/^an? \w*$/.test(typed)) {
    for (const component of projectComponents(file)) {
      const sentence = `${/^[AEIOU]/.test(component.name) ? "an" : "a"} ${component.name}`;
      if (sentence.toLowerCase().startsWith(typed)) {
        items.push({ label: sentence, detail: `Component from ${component.path}`, kind: 7, textEdit: { range, newText: sentence }, filterText: sentence });
      }
    }
  }
  return items.slice(0, 200);
}

function lineTokens(line: string): Token[] {
  return lex(new SourceFile("line.kdm", line)).tokens.filter((token) => token.kind !== "newline" && token.kind !== "eof" && token.kind !== "comment");
}

/** What the sentence on this line is, and what any diagnostic codes on it mean. */
export function hover(text: string, position: LspPosition, diagnostics: readonly LspDiagnostic[]): string | null {
  const line = (text.split("\n")[position.line] ?? "").trim();
  const parts: string[] = [];
  // D-50: a paragraph sentence is explained by the block sentences it means.
  if (isProseSource(text)) {
    const meant = proseMeaning(text, position);
    if (meant !== null) parts.push(meant);
  }
  if (!isProseSource(text) && line !== "" && !line.endsWith("{") && line !== "}" && !line.startsWith("//") && !line.startsWith("kadam ")) {
    const result = matchLine(lineTokens(line));
    const template = result.selected?.template;
    if (template !== undefined) {
      const examples = (template.examples ?? []).slice(0, 4).map((example) => `- \`${example}\``).join("\n");
      parts.push(`**${template.description}**${template.since === undefined ? "" : ` (kadam ${template.since})`}${examples === "" ? "" : `\n\n${examples}`}`);
    }
  }
  for (const diagnostic of diagnostics) {
    if (diagnostic.range.start.line > position.line || diagnostic.range.end.line < position.line) continue;
    const explanation = explainCode(diagnostic.code);
    if (explanation !== undefined) parts.push(`**${explanation.code}**: ${explanation.meaning}. See ${explanation.reference}.`);
  }
  return parts.length === 0 ? null : parts.join("\n\n---\n\n");
}

export interface Location {
  readonly path: string;
  readonly range: LspRange;
}

/**
 * Go to definition for the word under the cursor: a component name, a page
 * named in `go to page "..."`, a state, or an element named in quotes.
 */
export function definition(file: string, text: string, position: LspPosition): Location | null {
  const lines = text.split("\n");
  const line = lines[position.line] ?? "";
  const word = wordAt(line, position.character);
  if (word === null) return null;
  const at = (path: string, lineIndex: number, column: number, length: number): Location => ({
    path,
    range: { start: { line: lineIndex, character: column }, end: { line: lineIndex, character: column + length } },
  });
  // A page title in `go to page "Pricing"`.
  const page = /go to page "([^"]+)"/.exec(line);
  if (page !== null && line.indexOf(page[1]!) <= position.character && position.character <= line.indexOf(page[1]!) + page[1]!.length) {
    const target = projectPages(file).find((candidate) => candidate.title === page[1]);
    if (target !== undefined) return at(target.path, target.line, target.column, page[1]!.length);
  }
  // A component name.
  const component = projectComponents(file).find((candidate) => candidate.name === word);
  if (component !== undefined) return at(component.path, component.line, component.column, word.length);
  // An element (header `name {`) or a state (`it remembers name, ...`) in this file.
  for (let index = 0; index < lines.length; index += 1) {
    const header = new RegExp(`^(\\s*)${word} \\{\\s*$`).exec(lines[index]!);
    if (header !== null && index !== position.line) return at(file, index, header[1]!.length, word.length);
    const state = new RegExp(`^(\\s*it remembers )${word},`).exec(lines[index]!);
    if (state !== null) return at(file, index, state[1]!.length, word.length);
  }
  return null;
}

function wordAt(line: string, character: number): string | null {
  const isWord = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);
  let start = character;
  while (start > 0 && isWord(line[start - 1])) start -= 1;
  let end = character;
  while (end < line.length && isWord(line[end])) end += 1;
  return end > start ? line.slice(start, end) : null;
}

interface Declared {
  readonly name: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

function manifestOf(file: string): { root: string; manifest: { components?: unknown; pages?: unknown } } | null {
  const root = projectRootOf(file);
  if (root === null) return null;
  try {
    return { root, manifest: JSON.parse(readFileSync(join(root, "kadam.json"), "utf8")) as { components?: unknown; pages?: unknown } };
  } catch {
    return null;
  }
}

function projectComponents(file: string): Declared[] {
  const project = manifestOf(file);
  if (project === null || !Array.isArray(project.manifest.components)) return [];
  const out: Declared[] = [];
  for (const entry of project.manifest.components as unknown[]) {
    const source = typeof entry === "string" ? entry : (entry as { source?: unknown })?.source;
    if (typeof source !== "string") continue;
    const path = join(project.root, source);
    const lines = (safeRead(path) ?? "").split("\n");
    lines.forEach((text, index) => {
      const match = /^(\s*component )([A-Z][A-Za-z0-9]*)/.exec(text);
      if (match !== null) out.push({ name: match[2]!, path, line: index, column: match[1]!.length });
    });
  }
  return out;
}

function projectPages(file: string): { title: string; path: string; line: number; column: number }[] {
  const project = manifestOf(file);
  if (project === null || !Array.isArray(project.manifest.pages)) return [];
  const out: { title: string; path: string; line: number; column: number }[] = [];
  for (const entry of project.manifest.pages as { source?: unknown }[]) {
    if (typeof entry?.source !== "string") continue;
    const path = join(project.root, entry.source);
    (safeRead(path) ?? "").split("\n").forEach((text, index) => {
      const match = /^(\s*page ")([^"]+)"/.exec(text);
      if (match !== null) out.push({ title: match[2]!, path, line: index, column: match[1]!.length });
    });
  }
  return out;
}

/** The block sentences that the sentence under the cursor became, as Markdown. */
function proseMeaning(text: string, position: LspPosition): string | null {
  const translation = parseText("page.kdm", text, { validate: false, allowComponentKinds: true }).prose;
  if (translation === undefined) return null;
  const generated = translation.text.split("\n");
  const line = position.line + 1;
  const lines: string[] = [];
  let sentence: string | null = null;
  translation.lineSpans.forEach((span, index) => {
    if (span === null || index === 0 || span.start.line > line || span.end.line < line) return;
    // Within the line, only the sentence the cursor is on.
    const column = position.character + 1;
    if (span.start.line === line && span.start.column > column + 1) return;
    if (span.end.line === line && span.end.column < column) return;
    const written = (generated[index - 1] ?? "").trim();
    if (written === "" || written === "}" || written === "kadam 0.3" || written.startsWith("page ")) return;
    sentence ??= text.slice(span.start.offset, span.end.offset);
    lines.push(written.endsWith("{") ? `// named ${written.slice(0, -1).trim()}` : written);
  });
  if (lines.length === 0) return null;
  return `**Means** (kadam 0.4 is built as these block sentences):\n\n\`\`\`kdm\n${lines.join("\n")}\n\`\`\``;
}
