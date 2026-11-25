import {
  DiagnosticBag,
  type Diagnostic,
} from "../core/diagnostics/diagnostic.js";
import { parseSource } from "../core/parser/parser.js";
import { analyzeDocument, type SemanticPage } from "../core/semantics/analyze.js";
import {
  createSourceFile,
  type SourceFile,
} from "../core/source/source-file.js";
import { emitBaseCss, emitPageCss } from "./emit-css.js";
import { emitHtml } from "./emit-html.js";
import { InternalCompilerError } from "./internal-error.js";
import type { PageIR } from "./ir.js";
import { lowerDocument } from "./lower.js";
import { normalizeRoute, pageCssFileName } from "./routes.js";

export type OutputFileKind = "html" | "css" | "asset";

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
}

export interface CompileResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly page: PageIR | null;
  readonly files: readonly OutputFile[];
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
  const parsed = parseSource(source);
  const document = parsed.document;
  const route = normalizeRoute(options.route ?? "/");
  const pages =
    options.pages ??
    (document.page === null
      ? []
      : [{ title: document.page.title, route }]);

  const diagnostics = new DiagnosticBag();
  diagnostics.addAll(sourceDiagnostics);
  diagnostics.addAll(parsed.diagnostics);
  if (document.page !== null) {
    diagnostics.addAll(analyzeDocument(document, { pages }));
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
    });
    const files: readonly OutputFile[] = [
      {
        path: page.outputPath,
        contents: emitHtml(page),
        kind: "html",
      },
      {
        path: "assets/kadam.css",
        contents: emitBaseCss(),
        kind: "css",
      },
      {
        path: `assets/${pageCssFileName(page.routeSlug)}`,
        contents: emitPageCss(page),
        kind: "css",
      },
    ];
    return { ok: true, diagnostics: checked, page, files };
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
