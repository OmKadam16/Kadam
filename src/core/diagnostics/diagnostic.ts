import type { Span } from "../source/source-file.js";

export type Severity = "error" | "warning" | "info";

export type DiagnosticCode =
  | "KDM1001"
  | "KDM1002"
  | "KDM1003"
  | "KDM1004"
  | "KDM1005"
  | "KDM2001"
  | "KDM2002"
  | "KDM2003"
  | "KDM2004"
  | "KDM2005"
  | "KDM2006"
  | "KDM2007"
  | "KDM2008"
  | "KDM2009"
  | "KDM2010"
  | "KDM2011"
  | "KDM2012"
  | "KDM2013"
  | "KDM3001"
  | "KDM3002"
  | "KDM3003"
  | "KDM3004"
  | "KDM3005"
  | "KDM3006"
  | "KDM3007"
  | "KDM3008"
  | "KDM3009"
  | "KDM3010"
  | "KDM3011"
  | "KDM3012"
  | "KDM3013"
  | "KDM3014"
  | "KDM3015"
  | "KDM3020"
  | "KDM3021"
  | "KDM3022"
  | "KDM3023"
  | "KDM3024"
  | "KDM3025"
  | "KDM3026"
  | "KDM3027"
  | "KDM3028"
  | "KDM3029"
  | "KDM3030"
  | "KDM3031"
  | "KDM3032"
  | "KDM3033"
  | "KDM3034"
  | "KDM3035"
  | "KDM3036"
  | "KDM3037"
  | "KDM3038"
  | "KDM3039"
  | "KDM4001"
  | "KDM4002"
  | "KDM4003"
  | "KDM4004"
  | "KDM4005"
  | "KDM4006"
  | "KDM4007"
  | "KDM4008"
  | "KDM4009"
  | "KDM5001"
  | "KDM5002"
  | "KDM5003"
  | "KDM5004"
  | "KDM5005"
  | "KDM5006"
  | "KDM5007"
  | "KDM5008"
  | "KDM5009"
  | "KDM5010"
  | "KDM5011"
  | "KDM5012"
  | "KDM5013"
  | "KDM5014"
  | "KDM5015"
  | "KDM5016"
  | "KDM9001"
  | "KDM9002"
  | "KDM9003";

export interface RelatedDiagnostic {
  readonly span: Span;
  readonly message: string;
}

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  readonly message: string;
  readonly span: Span;
  readonly hint?: string;
  readonly related?: readonly RelatedDiagnostic[];
}

export interface DiagnosticSpec {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly span: Span;
  readonly hint?: string;
  readonly related?: readonly RelatedDiagnostic[];
}

const MAX_DIAGNOSTICS = 100;

export class DiagnosticBag {
  readonly #items: Diagnostic[] = [];
  #truncated = false;

  get items(): readonly Diagnostic[] {
    return this.#items;
  }

  add(diagnostic: Diagnostic): void {
    if (this.#truncated) return;
    if (this.#items.length >= MAX_DIAGNOSTICS - 1) {
      this.#truncated = true;
      this.#items.push({
        code: "KDM9003",
        severity: "error",
        message: `too many diagnostics; reporting stopped after ${MAX_DIAGNOSTICS - 1}`,
        span: diagnostic.span,
        hint: "fix the reported errors, then run the compiler again",
      });
      return;
    }
    this.#items.push(diagnostic);
  }

  error(
    code: DiagnosticCode,
    message: string,
    span: Span,
    hint?: string,
    related?: readonly RelatedDiagnostic[],
  ): void {
    this.add({
      code,
      severity: "error",
      message,
      span,
      ...(hint === undefined ? {} : { hint }),
      ...(related === undefined || related.length === 0 ? {} : { related }),
    });
  }

  /** A warning never blocks output (spec Appendix B.1). */
  warning(
    code: DiagnosticCode,
    message: string,
    span: Span,
    hint?: string,
    related?: readonly RelatedDiagnostic[],
  ): void {
    this.add({
      code,
      severity: "warning",
      message,
      span,
      ...(hint === undefined ? {} : { hint }),
      ...(related === undefined || related.length === 0 ? {} : { related }),
    });
  }

  addSpec(spec: DiagnosticSpec): void {
    this.error(spec.code, spec.message, spec.span, spec.hint, spec.related);
  }

  addAll(diagnostics: readonly Diagnostic[]): void {
    for (const diagnostic of diagnostics) this.add(diagnostic);
  }

  get hasErrors(): boolean {
    return this.#items.some((item) => item.severity === "error");
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  /** Deterministic order: file path, start offset, code, then message. */
  sorted(): readonly Diagnostic[] {
    return [...this.#items].sort((a, b) => {
      const file = compareText(a.span.file, b.span.file);
      if (file !== 0) return file;
      if (a.span.start.offset !== b.span.start.offset) {
        return a.span.start.offset - b.span.start.offset;
      }
      const code = compareText(a.code, b.code);
      if (code !== 0) return code;
      return compareText(a.message, b.message);
    });
  }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
