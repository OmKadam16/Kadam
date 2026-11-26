import type { ManifestFont } from "./manifest.js";
import { checkContrast } from "./contrast.js";
import {
  DiagnosticBag,
  type Diagnostic,
} from "../core/diagnostics/diagnostic.js";
import { parseSource } from "../core/parser/parser.js";
import { expandDocuments } from "../core/data/markdown.js";
import { checkLoadOrigins } from "../core/data/data.js";
import { fragmentFiles } from "./fragment.js";
import {
  banEscapeHatches,
  checkStylesheetClasses,
  collectEscapeHatches,
  type EscapeHatch,
} from "../core/semantics/escape-hatches.js";
import { analyzeDocument, type SemanticPage } from "../core/semantics/analyze.js";
import {
  createSourceFile,
  type SourceFile,
} from "../core/source/source-file.js";
import { baseCssUsage, emitBaseCss, emitPageCss } from "./emit-css.js";
import { emitHtml } from "./emit-html.js";
import { emitNoscriptCss, emitRuntimeJs, noscriptStylesheetPath } from "./emit-js.js";
import { InternalCompilerError } from "./internal-error.js";
import type { PageIR } from "./ir.js";
import { lowerDocument } from "./lower.js";
import { normalizeRoute, pageCssFileName } from "./routes.js";

export type OutputFileKind = "html" | "css" | "asset" | "xml" | "js";

export interface OutputFile {
  /** Path relative to the output directory, using `/` separators. */
  readonly path: string;
  readonly contents: string | Uint8Array;
  readonly kind: OutputFileKind;
}

export interface CompileOptions {
  /** Route for the page. Defaults to `/` in single-file mode. */
  readonly route?: string | undefined;
  /** Known project pages. Defaults to the current page only. */
  readonly pages?: readonly SemanticPage[] | undefined;
  /** Optional deployment base path (e.g. "/subpath"). Defaults to "". */
  readonly basePath?: string | undefined;
  /** kadam 0.3 custom breakpoints (normally from kadam.json): name to px. */
  readonly breakpoints?: ReadonlyMap<string, number> | undefined;
  /** kadam 0.3 custom fonts (normally from kadam.json). */
  readonly fonts?: Readonly<Record<string, ManifestFont>> | undefined;
  /** kadam 0.3 (F6, D-42): ban escape hatches. */
  readonly strict?: boolean | undefined;
  /** kadam 0.3 (F6, D-43): build the page as a fragment for an existing page. */
  readonly fragment?: boolean | undefined;
}

export interface CompileResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly page: PageIR | null;
  readonly files: readonly OutputFile[];
  /** kadam 0.3 (F6, D-42): every escape hatch the page uses. */
  readonly escapeHatches?: readonly EscapeHatch[];
}

/** Compile an already-created source buffer. */
export function compileSource(
  source: SourceFile,
  options: CompileOptions = {},
): CompileResult {
  return compileWithSource(source, [], options);
}

/** Create a normalized source buffer and compile it. */
export function compileText(
  path: string,
  text: string,
  options: CompileOptions = {},
): CompileResult {
  const created = createSourceFile(path, text);
  return compileWithSource(created.source, created.diagnostics, options);
}

function compileWithSource(
  source: SourceFile,
  sourceDiagnostics: readonly Diagnostic[],
  options: CompileOptions,
): CompileResult {
  const parsed = parseSource(source, { breakpoints: options.breakpoints });
  const documentDiagnostics = new DiagnosticBag();
  // A single file has no project to read Markdown documents from.
  const document =
    parsed.document.page === null
      ? parsed.document
      : { ...parsed.document, page: expandDocuments(parsed.document.page, null, documentDiagnostics) };
  const route = normalizeRoute(options.route ?? "/");
  const pages =
    options.pages ??
    (document.page === null
      ? []
      : [{ title: document.page.title, route }]);

  const diagnostics = new DiagnosticBag();
  diagnostics.addAll(sourceDiagnostics);
  diagnostics.addAll(parsed.diagnostics);
  // A single file has no manifest, so it may only load from its own site.
  if (document.page !== null) checkLoadOrigins(document.page.elements, [], documentDiagnostics);
  // ... and has no stylesheets to take classes from.
  if (document.page !== null) checkStylesheetClasses(document.page.elements, null, documentDiagnostics);
  const escapeHatches = document.page === null ? [] : collectEscapeHatches(document.page);
  if (options.strict === true) banEscapeHatches(escapeHatches, documentDiagnostics);
  diagnostics.addAll(documentDiagnostics.sorted());
  if (document.page !== null) {
    diagnostics.addAll(analyzeDocument(document, { pages, fonts: new Set(Object.keys(options.fonts ?? {})) }));
  }
  const checked = diagnostics.sorted();
  if (checked.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics: checked, page: null, files: [] };
  }

  try {
    const pageRoutes = new Map(pages.map((page) => [page.title, page.route]));
    const page = lowerDocument(document, {
      route,
      pageRoutes,
      basePath: options.basePath,
      fonts: options.fonts,
    });
    const files: readonly OutputFile[] = [
      {
        path: page.outputPath,
        contents: emitHtml(page),
        kind: "html",
      },
      {
        path: "assets/kadam.css",
        contents: emitBaseCss(baseCssUsage([page])),
        kind: "css",
      },
      {
        path: `assets/${pageCssFileName(page.routeSlug)}`,
        contents: emitPageCss(page),
        kind: "css",
      },
      ...runtimeFiles(page),
    ];
    // D-39: contrast warnings for kadam 0.3 pages; they never block output.
    if (document.languageVersion !== "0.1") {
      const warnings = checkContrast(page);
      if (warnings.length > 0) {
        const bag = new DiagnosticBag();
        bag.addAll(checked);
        for (const warning of warnings) bag.warning(warning.code, warning.message, warning.span, warning.hint);
        return { ok: true, diagnostics: bag.sorted(), page, files: options.fragment === true ? fragmentFiles([page], []) : files, escapeHatches };
      }
    }
    return { ok: true, diagnostics: checked, page, files: options.fragment === true ? fragmentFiles([page], []) : files, escapeHatches };
  } catch (error) {
    const span =
      error instanceof InternalCompilerError
        ? error.span
        : document.span;
    const message =
      error instanceof InternalCompilerError
        ? `internal emission failure: ${error.message}`
        : "internal emission failure";
    const bag = new DiagnosticBag();
    bag.addAll(checked);
    bag.error("KDM9002", message, span);
    return {
      ok: false,
      diagnostics: bag.sorted(),
      page: null,
      files: [],
    };
  }
}

/** kadam 0.3 (D-36): the page runtime and its JavaScript-off stylesheet, only when needed. */
export function runtimeFiles(page: PageIR): OutputFile[] {
  if (page.runtime === undefined) return [];
  return [
    { path: page.runtime.script, contents: emitRuntimeJs(page.runtime), kind: "js" },
    { path: noscriptStylesheetPath(page)!, contents: emitNoscriptCss(page), kind: "css" },
  ];
}
