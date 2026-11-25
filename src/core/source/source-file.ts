import { DiagnosticBag, type Diagnostic } from "../diagnostics/diagnostic.js";

export interface Position {
  /** UTF-16 code unit offset into the normalized source. */
  readonly offset: number;
  /** 1-based line number. */
  readonly line: number;
  /** 1-based column, counted in Unicode code points. */
  readonly column: number;
}

export interface Span {
  readonly file: string;
  readonly start: Position;
  readonly end: Position;
}

export interface SourceFileLimits {
  readonly maxBytes: number;
  readonly maxLineLength: number;
}

export const DEFAULT_SOURCE_LIMITS: SourceFileLimits = {
  maxBytes: 1024 * 1024,
  maxLineLength: 4096,
};

export interface SourceFileResult {
  readonly source: SourceFile;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Immutable normalized source text plus a line map.
 * Newlines are LF; a leading BOM is removed. No filesystem access.
 */
export class SourceFile {
  readonly path: string;
  readonly text: string;
  readonly #lineStarts: readonly number[];

  constructor(path: string, text: string) {
    this.path = path;
    this.text = normalizeSourceText(text);
    this.#lineStarts = buildLineStarts(this.text);
  }

  get lineCount(): number {
    return this.#lineStarts.length;
  }

  get length(): number {
    return this.text.length;
  }

  lineStart(line: number): number {
    const start = this.#lineStarts[line - 1];
    if (start === undefined) {
      throw new RangeError(`line ${line} is outside the source`);
    }
    return start;
  }

  lineEnd(line: number): number {
    if (line < 1 || line > this.#lineStarts.length) {
      throw new RangeError(`line ${line} is outside the source`);
    }
    if (line === this.#lineStarts.length) return this.text.length;
    return this.#lineStarts[line]! - 1;
  }

  lineText(line: number): string {
    return this.text.slice(this.lineStart(line), this.lineEnd(line));
  }

  positionAt(offset: number): Position {
    const bounded = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.#lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = this.#lineStarts[mid]!;
      if (start <= bounded) low = mid + 1;
      else high = mid - 1;
    }
    const index = Math.max(0, high);
    const lineStartOffset = this.#lineStarts[index]!;
    const column =
      Array.from(this.text.slice(lineStartOffset, bounded)).length + 1;
    return { offset: bounded, line: index + 1, column };
  }

  span(startOffset: number, endOffset: number): Span {
    return {
      file: this.path,
      start: this.positionAt(startOffset),
      end: this.positionAt(endOffset),
    };
  }

  lineSpan(line: number): Span {
    return this.span(this.lineStart(line), this.lineEnd(line));
  }
}

export function createSourceFile(
  path: string,
  text: string,
  limits: SourceFileLimits = DEFAULT_SOURCE_LIMITS,
): SourceFileResult {
  const source = new SourceFile(path, text);
  const diagnostics = new DiagnosticBag();

  const bytes = Buffer.byteLength(source.text, "utf8");
  if (bytes > limits.maxBytes) {
    diagnostics.error(
      "KDM1005",
      `source file is ${bytes} bytes; the limit is ${limits.maxBytes}`,
      source.span(0, 0),
      "split the project into smaller page files",
    );
  }

  for (let line = 1; line <= source.lineCount; line += 1) {
    const characters = Array.from(source.lineText(line)).length;
    if (characters > limits.maxLineLength) {
      diagnostics.error(
        "KDM1005",
        `line ${line} has ${characters} characters; the limit is ${limits.maxLineLength}`,
        source.lineSpan(line),
        "put each statement on its own line",
      );
      if (diagnostics.truncated) break;
    }
  }

  return { source, diagnostics: diagnostics.sorted() };
}

function normalizeSourceText(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, "\n");
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}
