import {
  LANGUAGE_VERSION,
  isUiLanguageVersion,
  type UiLanguageVersion,
} from "../version.js";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DocumentNode, ElementNode } from "../core/ast/nodes.js";
import {
  DiagnosticBag,
  type Diagnostic,
} from "../core/diagnostics/diagnostic.js";
import { buildComponentCatalog, type ComponentFile } from "../core/components/catalog.js";
import {
  validateComponentCatalog,
  validatePageComponents,
} from "../core/components/validate.js";
import { parseComponentSource } from "../core/parser/component.js";
import { parseSource } from "../core/parser/parser.js";
import { parseThemeSource, type ThemeColor } from "../core/parser/theme.js";
import { checkContrast } from "./contrast.js";
import { validateDocument } from "../core/parser/validate.js";
import { expandPage } from "../core/components/expand.js";
import { fragmentFiles } from "./fragment.js";
import { bindServerLoads, calledFunctions, compileServerModule, serverFiles, type ServerModule } from "./server.js";
import {
  banEscapeHatches,
  checkStylesheetClasses,
  collectEscapeHatches,
  usedStylesheets,
  type EscapeHatch,
} from "../core/semantics/escape-hatches.js";
import { checkLoadOrigins, expandData, generatePages, parseDataFile, readsRecordFields, type DataSet } from "../core/data/data.js";
import { expandDocuments } from "../core/data/markdown.js";
import {
  analyzeDocument,
  type SemanticPage,
} from "../core/semantics/analyze.js";
import {
  createSourceFile,
  type SourceFile,
  type Span,
} from "../core/source/source-file.js";
import { baseCssUsage, emitBaseCss, emitPageCss } from "./emit-css.js";
import { emitSitemap } from "./emit-sitemap.js";
import { emitHtml } from "./emit-html.js";
import { InternalCompilerError } from "./internal-error.js";
import type { PageIR } from "./ir.js";
import { lowerDocument } from "./lower.js";
import {
  loadManifest,
  type KadamManifest,
  type ManifestPageEntry,
} from "./manifest.js";
import {
  normalizeAssetPath,
  normalizeBasePath,
  normalizeRoute,
  pageCssFileName,
} from "./routes.js";
import { runtimeFiles, type OutputFile } from "./compile.js";

const DOWNLOAD_EXTENSIONS: ReadonlySet<string> = new Set(["pdf", "zip", "csv", "txt"]);

export const SUPPORTED_ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "svg",
  "avif",
  "gif",
  "woff",
  "woff2",
  // kadam 0.3 media, captions, and page icons. Which extension fits which use
  // is checked during semantic analysis (ASSET_EXTENSIONS).
  "mp4",
  "webm",
  "mp3",
  "ogg",
  "wav",
  "m4a",
  "vtt",
  "ico",
]);

export interface ProjectCompileOptions {
  /** Root directory of the project containing kadam.json. */
  readonly projectRoot: string;
  /**
   * Output directory. A relative path is resolved against the current working
   * directory; when omitted, the manifest `outDir` (or "dist") is resolved
   * against the project root.
   */
  readonly outDir?: string | undefined;
  /** Base path override for deployment (e.g. "/subpath"). Defaults to manifest basePath or "". */
  readonly basePath?: string | undefined;
  /** In-memory override for kadam.json (used for tests or a language server). */
  readonly manifestText?: string | undefined;
  /** In-memory file content overrides (path -> content). */
  readonly sourceOverrides?: ReadonlyMap<string, string | Uint8Array> | undefined;
  /** kadam 0.3 (F6, D-42): ban escape hatches, as "strict": true in kadam.json does. */
  readonly strict?: boolean | undefined;
  /** kadam 0.3 (F6, D-43): build every page as a fragment for an existing page. */
  readonly fragment?: boolean | undefined;
  /** Internal (F6, D-43): used by the Web Components target, see expandPage. */
  readonly slotOutlets?: boolean | undefined;
}

export interface ProjectCompileResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly manifest: KadamManifest | null;
  readonly pages: readonly PageIR[];
  readonly files: readonly OutputFile[];
  /** Absolute path of the output directory. */
  readonly outDir: string;
  readonly sources: readonly SourceFile[];
  /** kadam 0.3 (F6, D-42): every escape hatch the project uses. */
  readonly escapeHatches?: readonly EscapeHatch[];
  /** F8: origins of embeds, which a server's policy must allow as frames. */
  readonly frameOrigins?: readonly string[];
}

interface LoadedPage {
  readonly entry: ManifestPageEntry;
  readonly sourcePath: string;
  readonly resolvedPath: string;
  readonly route: string;
  readonly source: SourceFile;
  readonly document: DocumentNode;
}

interface ResolvedAsset {
  /** Normalized project-relative path; also the output path. */
  readonly sourcePath: string;
  readonly absolutePath: string;
}

/**
 * Compile a multi-page project declared by `kadam.json`.
 *
 * The pipeline is deliberately two-phase: every page is read, parsed, analyzed,
 * and every asset is validated before a single output file is produced. A
 * failure in any page or asset therefore yields `ok: false` with no files, so a
 * caller can never write a partially successful site.
 */
export function compileProject(
  options: ProjectCompileOptions,
): ProjectCompileResult {
  const projectRoot = resolve(options.projectRoot);
  const realProjectRoot = safeRealpath(projectRoot);
  const diagnostics = new DiagnosticBag();
  const sources: SourceFile[] = [];

  // Step 1: load and validate the manifest.
  const manifestLoad = loadManifest(projectRoot, options.manifestText);
  if (manifestLoad.manifestSource !== null) {
    sources.push(manifestLoad.manifestSource);
  }
  diagnostics.addAll(manifestLoad.diagnostics);

  const manifest = manifestLoad.manifest;
  const outDir = resolveOutputDirectory(
    projectRoot,
    options.outDir,
    manifest?.outDir,
  );
  const basePath = normalizeBasePath(
    options.basePath ?? manifest?.basePath ?? "",
  );
  const manifestSpan = rootSpan(manifestLoad.manifestPath);

  if (manifest === null || diagnostics.hasErrors) {
    return {
      ok: false,
      diagnostics: diagnostics.sorted(),
      manifest: null,
      pages: [],
      files: [],
      outDir,
      sources,
    };
  }

  // Step 2: read and parse every declared page. Component kinds are allowed
  // here; the catalog and page-instance validators run before expansion.
  const loadedPages: LoadedPage[] = [];
  // Files without a `kadam` directive use the manifest's language version.
  const defaultLanguageVersion: UiLanguageVersion = isUiLanguageVersion(manifest.kadam)
    ? manifest.kadam
    : LANGUAGE_VERSION;
  const breakpoints =
    manifest.breakpoints === undefined ? undefined : new Map(Object.entries(manifest.breakpoints));

  // kadam 0.3 project theme (D-38): its colors are usable in every page and component.
  let themeColors: readonly ThemeColor[] = [];
  if (manifest.theme !== undefined) {
    const themeSource = loadProjectSource({
      projectRoot,
      realProjectRoot,
      outDir,
      sourcePath: manifest.theme,
      kind: "theme",
      code: "KDM4002",
      missingSpan: manifestSpan,
      overrides: options.sourceOverrides,
      diagnostics,
      sources,
    });
    if (themeSource !== null) {
      const theme = parseThemeSource(themeSource);
      diagnostics.addAll(theme.diagnostics);
      themeColors = theme.colors;
    }
  }
  const colorTokens = new Set(themeColors.map((color) => color.name));

  // D-44: the server module pages call. It is compiled, never run.
  let server: ServerModule | null = null;
  if (manifest.server !== undefined) {
    const serverSource = loadProjectSource({
      projectRoot, realProjectRoot, outDir, sourcePath: manifest.server.module, kind: "server", code: "KDM4012",
      missingSpan: manifestSpan, overrides: options.sourceOverrides, diagnostics, sources,
    });
    if (serverSource !== null) server = compileServerModule(manifest.server.module, serverSource.text, manifest.server.target, diagnostics).server;
    if (server === null) {
      // Page errors about server loads would only repeat this one.
      return { ok: false, diagnostics: diagnostics.sorted(), manifest, pages: [], files: [], outDir, sources };
    }
  }

  // kadam 0.3 (F5): project data files, read once and shared by every page.
  const data = new Map<string, DataSet | null>();
  for (const [name, sourcePath] of Object.entries(manifest.data ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const dataSource = loadProjectSource({
      projectRoot,
      realProjectRoot,
      outDir,
      sourcePath,
      kind: "data",
      code: "KDM4010",
      missingSpan: manifestSpan,
      overrides: options.sourceOverrides,
      diagnostics,
      sources,
    });
    data.set(name, dataSource === null ? null : parseDataFile(name, dataSource, diagnostics));
  }

  // kadam 0.3 (F5 step 4): Markdown documents, read once per path.
  const documents = new Map<string, SourceFile | null>();
  const readDocument = (path: string, span: Span): SourceFile | null => {
    if (!documents.has(path)) {
      documents.set(
        path,
        loadProjectSource({
          projectRoot,
          realProjectRoot,
          outDir,
          sourcePath: path,
          kind: "document",
          code: "KDM4011",
          missingSpan: span,
          overrides: options.sourceOverrides,
          diagnostics,
          sources,
        }),
      );
    }
    return documents.get(path)!;
  };

  for (const pageEntry of manifest.pages) {
    const sourcePath = pageEntry.source;
    const source = loadProjectSource({
      projectRoot,
      realProjectRoot,
      outDir,
      sourcePath,
      kind: "page",
      code: "KDM4002",
      missingSpan: manifestSpan,
      overrides: options.sourceOverrides,
      diagnostics,
      sources,
    });
    if (source === null) continue;

    const parsed = parseSource(source, {
      validate: false,
      allowComponentKinds: true,
      defaultLanguageVersion,
      breakpoints,
      colorTokens,
    });
    diagnostics.addAll(parsed.diagnostics);

    reportVersionMismatch(parsed.document, manifest.kadam, sourcePath, diagnostics);
    if (parsed.document.page === null) continue;

    const template = bindServerLoads(parsed.document.page, server, diagnostics);
    if (manifest.server !== undefined && /^\/(server|_kadam)(\/|$)/.test(pageEntry.route)) {
      diagnostics.error("KDM4012", `the route "${pageEntry.route}" is used by the generated server`, manifestSpan, "choose another route for this page");
      continue;
    }
    checkLoadOrigins(template.elements, manifest.connect ?? [], diagnostics);
    const dynamicRoute = pageEntry.route.split("/").some((segment) => segment.startsWith(":"));
    // kadam 0.3 (F5 step 3): a page made for each record becomes one page per record.
    const generated =
      template.repeat !== undefined
        ? generatePages(template, pageEntry.route, data, diagnostics)
        : [{ page: template, route: pageEntry.route }];
    if (template.repeat === undefined && dynamicRoute) {
      diagnostics.error(
        "KDM3044",
        `the route "${pageEntry.route}" has a :field segment, but ${sourcePath} is not made for each record`,
        template.titleSpan,
        'write the page header as: page "{the title of post}" for each post in posts {',
      );
      continue;
    }
    if (template.repeat === undefined && parsed.document.languageVersion === "0.3" && readsRecordFields(template)) {
      diagnostics.error(
        "KDM3041",
        "text reads a record field, but this page is not made for each record",
        template.titleSpan,
        'write the page header as: page "{the title of post}" for each post in posts {',
      );
      continue;
    }
    for (const { page, route } of generated) {
      loadedPages.push({
        // A generated page's title comes from its record, not the manifest.
        entry: template.repeat === undefined ? pageEntry : { ...pageEntry, title: undefined },
        sourcePath,
        resolvedPath: resolve(projectRoot, sourcePath),
        route: normalizeRoute(route),
        source,
        // Documents and data lists become ordinary elements before any component check.
        document: { ...parsed.document, page: expandData(expandDocuments(page, readDocument, diagnostics), data, diagnostics) },
      });
    }
  }

  // Step 3: read and parse every declared component. Parser diagnostics stay
  // on each ComponentFile because buildComponentCatalog() owns merging them.
  const componentFiles: ComponentFile[] = [];
  for (const entry of manifest.components) {
    const sourcePath = entry.source;
    const source = entry.library === "kadam" ? loadLibrarySource(sourcePath, diagnostics, sources) : loadProjectSource({
      projectRoot,
      realProjectRoot,
      outDir,
      sourcePath,
      kind: "component",
      code: "KDM4007",
      missingSpan: rootSpan(sourcePath),
      overrides: options.sourceOverrides,
      diagnostics,
      sources,
    });
    if (source === null) continue;

    const parsed = parseComponentSource(source, { defaultLanguageVersion, breakpoints, colorTokens });
    reportVersionMismatch(parsed.document, manifest.kadam, sourcePath, diagnostics);
    componentFiles.push({
      source,
      namespace: entry.namespace,
      document: parsed.document,
      diagnostics: parsed.diagnostics,
    });
  }

  if (diagnostics.hasErrors) {
    return {
      ok: false,
      diagnostics: diagnostics.sorted(),
      manifest,
      pages: [],
      files: [],
      outDir,
      sources,
    };
  }

  const catalogResult = buildComponentCatalog(componentFiles);
  diagnostics.addAll(catalogResult.diagnostics);
  if (diagnostics.hasErrors) {
    return {
      ok: false,
      diagnostics: diagnostics.sorted(),
      manifest,
      pages: [],
      files: [],
      outDir,
      sources,
    };
  }
  const catalog = catalogResult.catalog;

  // Step 4: project-wide symbol table: page titles are navigation identities.
  const titleMap = new Map<string, { page: LoadedPage; span: Span }>();
  for (const loaded of loadedPages) {
    const page = loaded.document.page!;
    const previous = titleMap.get(page.title);
    if (previous !== undefined) {
      diagnostics.error(
        "KDM3011",
        `duplicate page title ${JSON.stringify(page.title)}`,
        page.span,
        "each page in the project must declare a unique title",
        [{ span: previous.span, message: "first declared here" }],
      );
    } else {
      titleMap.set(page.title, { page: loaded, span: page.span });
    }

    if (loaded.entry.title !== undefined && loaded.entry.title !== page.title) {
      diagnostics.error(
        "KDM4001",
        `page title mismatch for '${loaded.sourcePath}': manifest declared ${JSON.stringify(
          loaded.entry.title,
        )}, but the page declares ${JSON.stringify(page.title)}`,
        page.span,
        "align the title in kadam.json with the page title in the .kdm file",
      );
    }
  }

  const semanticPages: SemanticPage[] = loadedPages.map((loaded) => ({
    title: loaded.document.page!.title,
    route: loaded.route,
  }));

  // Step 5: validate component declarations and page instances against the
  // complete project page-title table.
  diagnostics.addAll(
    validateComponentCatalog(catalog, { pages: semanticPages }),
  );
  for (const loaded of loadedPages) {
    // Page-only pages are covered by analyzeDocument(). validatePageComponents()
    // is for resolving component instances and may also visit page-owned
    // statements, so call it only where a component kind is present.
    if (findComponentKindSpan(loaded.document.page!.elements) === null) continue;
    diagnostics.addAll(
      validatePageComponents(loaded.document.page!, catalog, {
        pages: semanticPages,
      }),
    );
  }
  if (diagnostics.hasErrors) {
    return {
      ok: false,
      diagnostics: diagnostics.sorted(),
      manifest,
      pages: [],
      files: [],
      outDir,
      sources,
    };
  }

  // Step 6: expand every page after catalog validation, then validate the
  // resulting built-in tree. Page-only pages are cloned with identical content.
  const expandedPages: LoadedPage[] = [];
  for (const loaded of loadedPages) {
    const expansion = expandPage(loaded.document.page!, catalog, { slotOutlets: options.slotOutlets });
    diagnostics.addAll(expansion.diagnostics);
    if (expansion.page === null) continue;

    const document: DocumentNode = {
      ...loaded.document,
      page: expansion.page,
    };
    validateDocument(document, diagnostics);
    expandedPages.push({ ...loaded, document });
  }
  if (diagnostics.hasErrors) {
    return {
      ok: false,
      diagnostics: diagnostics.sorted(),
      manifest,
      pages: [],
      files: [],
      outDir,
      sources,
    };
  }

  // Step 7: semantic analysis uses the complete project route table, so a
  // navigation target may point at any declared page.
  for (const loaded of expandedPages) {
    diagnostics.addAll(
      analyzeDocument(loaded.document, {
        pages: semanticPages,
        hasSiteUrl: manifest.siteUrl !== undefined,
        fonts: new Set(Object.keys(manifest.fonts ?? {})),
      }),
    );
  }

  // Step 8: validate every referenced asset before any output exists.
  const references = new Map<string, Span>();
  const downloads = new Set<string>();
  for (const loaded of expandedPages) {
    collectAssetReferences(loaded.document.page!.elements, references, manifest.fonts ?? {}, downloads);
    for (const setting of loaded.document.page!.settings) {
      if ((setting.property === "icon" || setting.property === "share image") && !references.has(setting.value)) {
        references.set(setting.value, setting.valueSpan);
      }
    }
  }

  // kadam 0.3 (F6, D-42): existing stylesheets, read once; classes are checked against them.
  const sheets = new Map<string, string | null>();
  const sheetAssets = new Map<string, ResolvedAsset>();
  for (const path of manifest.stylesheets ?? []) {
    const asset = resolveAsset({
      projectRoot, realProjectRoot, outDir, rawPath: path, span: manifestSpan,
      overrides: options.sourceOverrides, diagnostics, stylesheet: true,
    });
    sheets.set(path, asset === null ? null : new TextDecoder().decode(readAssetContents(asset, options.sourceOverrides)));
    if (asset !== null) sheetAssets.set(path, asset);
  }
  // F6 (D-42): external modules are copied as they are; Kadam never reads them.
  for (const loaded of expandedPages) {
    for (const external of loaded.document.page!.externals ?? []) {
      const asset = resolveAsset({
        projectRoot, realProjectRoot, outDir, rawPath: external.file, span: external.fileSpan,
        overrides: options.sourceOverrides, diagnostics, script: true,
      });
      if (asset !== null) sheetAssets.set(asset.sourcePath, asset);
    }
  }
  const escapeHatches: EscapeHatch[] = [];
  for (const loaded of expandedPages) collectEscapeHatches(loaded.document.page!, escapeHatches);
  if (options.strict === true || manifest.strict === true) banEscapeHatches(escapeHatches, diagnostics);
  const usedSheets = new Set<string>();
  for (const loaded of expandedPages) {
    checkStylesheetClasses(loaded.document.page!.elements, sheets, diagnostics);
    for (const file of usedStylesheets(loaded.document.page!.elements)) usedSheets.add(file);
  }

  const assets = new Map<string, ResolvedAsset>();
  for (const [file, asset] of sheetAssets) {
    if (usedSheets.has(file) || asset.sourcePath.endsWith("js")) assets.set(asset.sourcePath, asset);
  }
  for (const [rawPath, span] of references) {
    const asset = resolveAsset({
      projectRoot,
      realProjectRoot,
      outDir,
      rawPath,
      span,
      overrides: options.sourceOverrides,
      diagnostics,
      download: downloads.has(rawPath),
    });
    if (asset === null) continue;
    if (!assets.has(asset.sourcePath)) assets.set(asset.sourcePath, asset);
  }

  if (diagnostics.hasErrors) {
    return {
      ok: false,
      diagnostics: diagnostics.sorted(),
      manifest,
      pages: [],
      files: [],
      outDir,
      sources,
    };
  }

  // Step 9: lower, emit, and copy assets. All of this happens in memory.
  try {
    const pageRoutes = new Map(
      semanticPages.map((page) => [page.title, page.route]),
    );

    const loweredPages: PageIR[] = [];
    for (const loaded of expandedPages) {
      loweredPages.push(
        lowerDocument(loaded.document, {
          route: loaded.route,
          pageRoutes,
          basePath,
          siteUrl: manifest.siteUrl,
          fonts: manifest.fonts,
          themeColors,
        }),
      );
      // D-39: contrast warnings for kadam 0.3 pages; they never block output.
      if (loaded.document.languageVersion !== "0.1") {
        for (const warning of checkContrast(loweredPages.at(-1)!)) diagnostics.warning(warning.code, warning.message, warning.span, warning.hint);
      }
    }

    const files: OutputFile[] = [];

    for (const page of loweredPages) {
      files.push({
        path: page.outputPath,
        contents: emitHtml(page),
        kind: "html",
      });
    }

    files.push({
      path: "assets/kadam.css",
      contents: emitBaseCss(baseCssUsage(loweredPages)),
      kind: "css",
    });

    for (const page of loweredPages) {
      files.push({
        path: `assets/${pageCssFileName(page.routeSlug)}`,
        contents: emitPageCss(page),
        kind: "css",
      });
      files.push(...runtimeFiles(page));
    }

    if (manifest.siteUrl !== undefined) {
      files.push({ path: "sitemap.xml", contents: emitSitemap(loweredPages), kind: "xml" });
    }

    for (const asset of assets.values()) {
      files.push({
        path: asset.sourcePath,
        contents: readAssetContents(asset, options.sourceOverrides),
        kind: "asset",
      });
    }

    // F8: embeds load in frames from these origins once clicked.
    const frameOrigins = [...new Set(loweredPages.flatMap((page) => (page.runtime?.embeds ?? []).map(([, url]) => new URL(url).origin)))].sort(compareText);
    // D-44: the generated server and the module it calls.
    if (server !== null) {
      const forms = loweredPages.flatMap((page) =>
        (page.runtime?.forms ?? []).map(([form, sent, failed]) => ({ form, html: page.outputPath, sent, failed })));
      files.push(...serverFiles(server, calledFunctions(expandedPages.map((loaded) => loaded.document.page!)), forms, manifest.connect ?? [], basePath, frameOrigins));
    }
    files.sort((a, b) => compareText(a.path, b.path));
    const output = options.fragment === true ? fragmentFiles(loweredPages, files.filter((file) => file.kind === "asset")) : files;

    return {
      ok: true,
      diagnostics: diagnostics.sorted(),
      manifest,
      pages: loweredPages,
      files: output,
      outDir,
      sources,
      escapeHatches,
      ...(frameOrigins.length === 0 ? {} : { frameOrigins }),
    };
  } catch (error) {
    diagnostics.error(
      "KDM9002",
      error instanceof InternalCompilerError
        ? `internal emission failure: ${error.message}`
        : "internal emission failure",
      error instanceof InternalCompilerError ? error.span : manifestSpan,
    );

    return {
      ok: false,
      diagnostics: diagnostics.sorted(),
      manifest,
      pages: [],
      files: [],
      outDir,
      sources,
    };
  }
}

interface ProjectSourceRequest {
  readonly projectRoot: string;
  readonly realProjectRoot: string;
  readonly outDir: string;
  readonly sourcePath: string;
  readonly kind: "page" | "component" | "theme" | "data" | "document" | "server";
  readonly code: "KDM4002" | "KDM4007" | "KDM4010" | "KDM4011" | "KDM4012";
  readonly missingSpan: Span;
  readonly overrides: ProjectCompileOptions["sourceOverrides"];
  readonly diagnostics: DiagnosticBag;
  readonly sources: SourceFile[];
}

function loadProjectSource(request: ProjectSourceRequest): SourceFile | null {
  const resolvedPath = resolve(request.projectRoot, request.sourcePath);

  if (!isInside(request.projectRoot, resolvedPath)) {
    request.diagnostics.error(
      request.code,
      `${request.kind} file '${request.sourcePath}' resolves outside the project root`,
      rootSpan(request.sourcePath),
      "declare a project-relative path without '..'",
    );
    return null;
  }

  if (
    request.outDir !== request.projectRoot &&
    isInsideOrEqual(request.outDir, resolvedPath)
  ) {
    request.diagnostics.error(
      request.code,
      `${request.kind} file '${request.sourcePath}' is inside the output directory`,
      rootSpan(request.sourcePath),
      "keep project sources outside the build output directory",
    );
    return null;
  }

  let text: string | undefined;
  const override =
    request.overrides?.get(request.sourcePath) ??
    request.overrides?.get(resolvedPath);
  if (override !== undefined) {
    text =
      typeof override === "string"
        ? override
        : new TextDecoder().decode(override);
  } else if (!existsSync(resolvedPath)) {
    request.diagnostics.error(
      request.code,
      `${request.kind} file '${request.sourcePath}' is missing or unreadable`,
      request.missingSpan,
      `create the file '${request.sourcePath}' or update kadam.json`,
    );
    return null;
  } else {
    try {
      text = readFileSync(resolvedPath, "utf8");
    } catch (error) {
      request.diagnostics.error(
        request.code,
        `cannot read ${request.kind} file '${request.sourcePath}': ${errorMessage(error)}`,
        rootSpan(request.sourcePath),
      );
      return null;
    }
  }

  if (text === undefined) return null;

  if (!isFileOrOverridden(resolvedPath, override)) {
    request.diagnostics.error(
      request.code,
      `${request.kind} source '${request.sourcePath}' is not a regular file`,
      rootSpan(request.sourcePath),
    );
    return null;
  }

  const realSource = safeRealpath(resolvedPath);
  if (existsSync(resolvedPath) && !isInside(request.realProjectRoot, realSource)) {
    request.diagnostics.error(
      request.code,
      `${request.kind} file '${request.sourcePath}' escapes the project root through a symbolic link`,
      rootSpan(request.sourcePath),
    );
    return null;
  }

  const created = createSourceFile(request.sourcePath, text);
  request.sources.push(created.source);
  request.diagnostics.addAll(created.diagnostics);
  return created.source;
}

function findComponentKindSpan(elements: readonly ElementNode[]): Span | null {
  for (const element of elements) {
    if (element.kind?.reference.type === "component-kind") {
      return element.kind.reference.span;
    }
    const child = findComponentKindSpan(element.children);
    if (child !== null) return child;
  }
  return null;
}

interface ResolveAssetArguments {
  /** kadam 0.3 (F4): a download link may also copy pdf, zip, csv, and txt files. */
  readonly download?: boolean;
  /** kadam 0.3 (F6): an existing stylesheet listed in kadam.json. */
  readonly stylesheet?: boolean;
  /** kadam 0.3 (F6): an external function's JavaScript module. */
  readonly script?: boolean;
  readonly projectRoot: string;
  readonly realProjectRoot: string;
  readonly outDir: string;
  readonly rawPath: string;
  readonly span: Span;
  readonly overrides: ProjectCompileOptions["sourceOverrides"];
  readonly diagnostics: DiagnosticBag;
}

function resolveAsset(args: ResolveAssetArguments): ResolvedAsset | null {
  const { diagnostics, span } = args;
  const normalized = normalizeAssetPath(args.rawPath);

  if (normalized === null) {
    diagnostics.error(
      "KDM4003",
      `invalid asset path ${JSON.stringify(args.rawPath)}; path traversal is not permitted`,
      span,
      'use a normalized project-relative path such as "assets/logo.svg"',
    );
    return null;
  }

  if (normalized === "kadam.json" || normalized.endsWith(".kdm")) {
    diagnostics.error(
      "KDM4003",
      `'${normalized}' is a Kadam source file and cannot be copied as an asset`,
      span,
      "reference an image or font file from the project's asset directory",
    );
    return null;
  }

  const dot = normalized.lastIndexOf(".");
  const extension = dot === -1 ? "" : normalized.slice(dot + 1).toLowerCase();
  if (
    !SUPPORTED_ASSET_EXTENSIONS.has(extension) &&
    !(args.download === true && DOWNLOAD_EXTENSIONS.has(extension)) &&
    !(args.stylesheet === true && extension === "css") &&
    !(args.script === true && (extension === "js" || extension === "mjs"))
  ) {
    diagnostics.error(
      "KDM4003",
      `unsupported asset extension '.${extension}' in '${args.rawPath}'`,
      span,
      `supported asset types are: ${[...SUPPORTED_ASSET_EXTENSIONS].join(", ")}`,
    );
    return null;
  }

  const absolutePath = resolve(args.projectRoot, normalized);
  const override =
    args.overrides?.get(normalized) ?? args.overrides?.get(absolutePath);

  if (args.outDir !== args.projectRoot && isInsideOrEqual(args.outDir, absolutePath)) {
    diagnostics.error(
      "KDM4003",
      `asset '${normalized}' is inside the output directory`,
      span,
      "keep project assets outside the build output directory",
    );
    return null;
  }

  if (override === undefined) {
    if (!existsSync(absolutePath) || !isRegularFile(absolutePath)) {
      diagnostics.error(
        "KDM4003",
        `referenced asset '${normalized}' does not exist`,
        span,
        `create the file '${normalized}' inside the project`,
      );
      return null;
    }

    const realAsset = safeRealpath(absolutePath);
    if (!isInside(args.realProjectRoot, realAsset)) {
      diagnostics.error(
        "KDM4003",
        `asset '${normalized}' escapes the project root through a symbolic link`,
        span,
        "assets must live inside the project directory",
      );
      return null;
    }
  }

  return { sourcePath: normalized, absolutePath };
}

function readAssetContents(
  asset: ResolvedAsset,
  overrides: ProjectCompileOptions["sourceOverrides"],
): Uint8Array {
  const override =
    overrides?.get(asset.sourcePath) ?? overrides?.get(asset.absolutePath);
  if (override !== undefined) {
    return typeof override === "string"
      ? Buffer.from(override, "utf8")
      : override;
  }
  return readFileSync(asset.absolutePath);
}

function collectAssetReferences(
  elements: readonly ElementNode[],
  out: Map<string, Span>,
  fonts: Readonly<Record<string, { readonly source: string }>>,
  downloads: Set<string>,
): void {
  for (const element of elements) {
    for (const scoped of element.statements) {
      // kadam 0.3: background images (any scope) and the files of used fonts.
      const statement = scoped.type === "responsive" || scoped.type === "scoped" ? scoped.statement : scoped;
      if (statement.type === "background-image" && !out.has(statement.value)) {
        out.set(statement.value, statement.valueSpan);
      }
      // F6: files named by url() in a raw css value.
      if (statement.type === "raw-css") {
        for (const asset of statement.assets) if (!out.has(asset.path)) out.set(asset.path, asset.span);
      }
      // F4: download links copy their file.
      if (statement.type === "click" && statement.action.type === "download") {
        downloads.add(statement.action.path);
        if (!out.has(statement.action.path)) out.set(statement.action.path, statement.action.valueSpan);
      }
      if (statement.type === "custom-font") {
        const source = fonts[statement.name]?.source;
        if (source !== undefined && !out.has(source)) out.set(source, statement.nameSpan);
      }
    }
    for (const statement of element.statements) {
      if (
        (statement.type === "image-source" ||
          statement.type === "media-source" ||
          statement.type === "captions" ||
          statement.type === "poster") &&
        statement.value.trim() !== ""
      ) {
        if (!out.has(statement.value)) {
          out.set(statement.value, statement.valueSpan);
        }
      }
    }
    collectAssetReferences(element.children, out, fonts, downloads);
  }
}

function resolveOutputDirectory(
  projectRoot: string,
  outDirOption: string | undefined,
  manifestOutDir: string | undefined,
): string {
  if (outDirOption !== undefined) return resolve(outDirOption);
  return resolve(projectRoot, manifestOutDir ?? "dist");
}

function rootSpan(file: string): Span {
  return {
    file,
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 },
  };
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isFileOrOverridden(
  path: string,
  override: string | Uint8Array | undefined,
): boolean {
  if (override !== undefined) return true;
  return isRegularFile(path);
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isInside(root: string, target: string): boolean {
  const relation = relative(root, target);
  return (
    relation !== "" &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

function isInsideOrEqual(root: string, target: string): boolean {
  return resolve(root) === resolve(target) || isInside(root, target);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Spec §4.1: in a project that declares a language version, a file directive
 * must match it. Unsupported versions are already reported by the parser.
 */
function reportVersionMismatch(
  document: DocumentNode,
  projectVersion: string | undefined,
  sourcePath: string,
  diagnostics: DiagnosticBag,
): void {
  const version = document.version;
  if (version === null || projectVersion === undefined) return;
  if (!isUiLanguageVersion(version) || !isUiLanguageVersion(projectVersion)) return;
  if (version === projectVersion) return;
  diagnostics.error(
    "KDM4004",
    `'${sourcePath}' declares kadam ${version} but kadam.json declares ${projectVersion}`,
    document.versionSpan ?? document.span,
    `change the directive to kadam ${projectVersion}, or remove it to inherit the project version`,
  );
}

/** D-46: the standard component library ships in the package, next to `dist`. */
export const LIBRARY_ROOT = fileURLToPath(new URL("../../library/", import.meta.url));

/** The names of the standard library's components. */
export function libraryComponentNames(): string[] {
  try {
    return readdirSync(LIBRARY_ROOT).filter((name) => name.endsWith(".kdm")).map((name) => name.slice(0, -4)).sort(compareText);
  } catch {
    return [];
  }
}

function loadLibrarySource(sourcePath: string, diagnostics: DiagnosticBag, sources: SourceFile[]): SourceFile | null {
  const name = sourcePath.slice("kadam/".length, -".kdm".length);
  const file = join(LIBRARY_ROOT, `${name}.kdm`);
  if (!existsSync(file)) {
    diagnostics.error("KDM4009", `the kadam library has no component named ${name}`, rootSpan("kadam.json"),
      `library components: ${libraryComponentNames().join(", ")}`);
    return null;
  }
  const created = createSourceFile(sourcePath, readFileSync(file, "utf8"));
  diagnostics.addAll(created.diagnostics);
  sources.push(created.source);
  return created.source;
}
