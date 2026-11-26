import { UI_LANGUAGE_VERSIONS, isUiLanguageVersion } from "../version.js";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  DiagnosticBag,
  type Diagnostic,
} from "../core/diagnostics/diagnostic.js";
import { SourceFile, type Span } from "../core/source/source-file.js";
import { normalizeRoute } from "./routes.js";

export interface ManifestPageEntry {
  /** Relative path to the .kdm page source file. */
  readonly source: string;
  /** Alternative property name for source in kadam.json. */
  readonly file?: string | undefined;
  /** URL route, must start with '/'. */
  readonly route: string;
  /** Optional human-facing page title. */
  readonly title?: string | undefined;
}

export interface ManifestComponentEntry {
  /** Relative path to the .kdm component source file. */
  readonly source: string;
  /** Optional library namespace; null means the project namespace. */
  readonly namespace: string | null;
}

export interface KadamManifest {
  /** Project name. */
  readonly name: string;
  /** Project version, e.g. "1.0.0". */
  readonly version?: string | undefined;
  /** Language version, e.g. "0.1". */
  readonly kadam?: string | undefined;
  /** Declared pages in the project. */
  readonly pages: readonly ManifestPageEntry[];
  /** Declared component sources, relative to the project root. */
  readonly components: readonly ManifestComponentEntry[];
  /** Asset directory, relative to project root. Defaults to "assets". */
  readonly assets?: string | undefined;
  /** Output directory, relative to project root. Defaults to "dist". */
  readonly outDir?: string | undefined;
  /** Deployment base path, e.g. "/subpath". Defaults to "". */
  readonly basePath?: string | undefined;
  /**
   * kadam 0.3: absolute origin the site is served from, e.g.
   * "https://example.com". Enables canonical URLs, share images, and
   * sitemap.xml.
   */
  readonly siteUrl?: string | undefined;
  /**
   * kadam 0.3: extra min-width breakpoints, e.g. { "wide": 1440 }, used as
   * `on wide screens, ...`. Values are viewport widths in px.
   */
  readonly breakpoints?: Readonly<Record<string, number>> | undefined;
  /**
   * kadam 0.3: local font files, e.g.
   * { "Inter": { "source": "assets/fonts/Inter.woff2", "weight": "100 900" } },
   * used as `the font is "Inter"`. No remote fonts: builds stay network-free.
   */
  readonly fonts?: Readonly<Record<string, ManifestFont>> | undefined;
  /** kadam 0.3: project theme file with theme colors (D-38). */
  readonly theme?: string | undefined;
  /** kadam 0.3 (D-41): origins pages may load data from at run time. */
  readonly connect?: readonly string[] | undefined;
  /** kadam 0.3 (F6, D-42): existing stylesheets whose classes elements may use. */
  readonly stylesheets?: readonly string[] | undefined;
  /** kadam 0.3 (F6, D-42): ban every escape hatch. */
  readonly strict?: boolean | undefined;
  /** D-44: the kadam 0.2 module pages call, and the target its server is generated for. */
  readonly server?: { readonly module: string; readonly target: "typescript" } | undefined;
  /** kadam 0.3 (F5): data names to project-relative JSON files, e.g. { "projects": "data/projects.json" }. */
  readonly data?: Readonly<Record<string, string>> | undefined;
}

export interface ManifestFont {
  readonly source: string;
  /** A CSS weight or range, e.g. "400" or "100 900". Defaults to "400". */
  readonly weight: string;
  readonly style: "normal" | "italic";
  /** Preset stack used while the font loads, or when it is missing. */
  readonly fallback: "sans serif" | "serif" | "monospace";
}

export interface LoadedManifest {
  readonly manifest: KadamManifest | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly manifestPath: string;
  readonly manifestSource: SourceFile | null;
}

const KNOWN_TOP_LEVEL_KEYS = new Set([
  "name",
  "version",
  "kadam",
  "pages",
  "components",
  "assets",
  "outDir",
  "basePath",
  "siteUrl",
  "breakpoints",
  "fonts",
  "theme",
  "data",
  "connect",
  "stylesheets",
  "strict",
  "server",
]);

const KNOWN_PAGE_KEYS = new Set([
  "source",
  "file",
  "route",
  "title",
]);

export function loadManifest(
  projectRoot: string,
  manifestTextOverride?: string,
): LoadedManifest {
  const manifestPath = join(projectRoot, "kadam.json");
  const diagnostics = new DiagnosticBag();

  let text: string;
  if (manifestTextOverride !== undefined) {
    text = manifestTextOverride;
  } else {
    if (!existsSync(manifestPath)) {
      const span: Span = {
        file: manifestPath,
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 1, offset: 0 },
      };
      diagnostics.error(
        "KDM4001",
        `missing project manifest 'kadam.json' in ${projectRoot}`,
        span,
        "create a kadam.json manifest listing project pages",
      );
      return {
        manifest: null,
        diagnostics: diagnostics.sorted(),
        manifestPath,
        manifestSource: null,
      };
    }

    try {
      text = readFileSync(manifestPath, "utf8");
    } catch (error) {
      const span: Span = {
        file: manifestPath,
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 1, offset: 0 },
      };
      diagnostics.error(
        "KDM4001",
        `cannot read project manifest 'kadam.json': ${
          error instanceof Error ? error.message : String(error)
        }`,
        span,
      );
      return {
        manifest: null,
        diagnostics: diagnostics.sorted(),
        manifestPath,
        manifestSource: null,
      };
    }
  }

  const manifestSource = new SourceFile(manifestPath, text);
  const rootSpan: Span = {
    file: manifestPath,
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 },
  };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    diagnostics.error(
      "KDM4001",
      `invalid JSON in 'kadam.json': ${
        error instanceof Error ? error.message : String(error)
      }`,
      rootSpan,
      "fix the JSON syntax error in kadam.json",
    );
    return {
      manifest: null,
      diagnostics: diagnostics.sorted(),
      manifestPath,
      manifestSource,
    };
  }

  if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) {
    diagnostics.error(
      "KDM4001",
      "project manifest 'kadam.json' must be a JSON object",
      rootSpan,
      'use a top-level JSON object such as { "name": "MyWebsite", "pages": [...] }',
    );
    return {
      manifest: null,
      diagnostics: diagnostics.sorted(),
      manifestPath,
      manifestSource,
    };
  }

  const raw = parsedJson as Record<string, unknown>;

  // Check unknown top-level keys
  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      diagnostics.error(
        "KDM4001",
        `unknown manifest property ${JSON.stringify(key)}`,
        rootSpan,
        `supported properties are: ${[...KNOWN_TOP_LEVEL_KEYS].join(", ")}`,
      );
    }
  }

  // Validate name
  if (typeof raw.name !== "string" || raw.name.trim() === "") {
    diagnostics.error(
      "KDM4001",
      "project manifest requires a non-empty string 'name'",
      rootSpan,
      'add a "name": "ProjectName" property',
    );
  }

  // Validate language version kadam
  if ("kadam" in raw) {
    if (!isUiLanguageVersion(raw.kadam)) {
      diagnostics.error(
        "KDM4004",
        `unsupported language version ${JSON.stringify(raw.kadam)}; expected ${UI_LANGUAGE_VERSIONS.map((v) => JSON.stringify(v)).join(" or ")}`,
        rootSpan,
        'set "kadam": "0.1"',
      );
    }
  }

  // Validate version
  if ("version" in raw && typeof raw.version !== "string") {
    diagnostics.error(
      "KDM4001",
      "'version' in kadam.json must be a string",
      rootSpan,
    );
  }

  // Validate assets directory
  if ("assets" in raw) {
    if (typeof raw.assets !== "string" || raw.assets.trim() === "") {
      diagnostics.error(
        "KDM4001",
        "'assets' in kadam.json must be a non-empty string",
        rootSpan,
      );
    } else {
      const normalizedAssets = raw.assets.replaceAll("\\", "/");
      if (
        normalizedAssets.startsWith("/") ||
        /^[A-Za-z]:/.test(normalizedAssets) ||
        normalizedAssets.split("/").includes("..")
      ) {
        diagnostics.error(
          "KDM4001",
          `invalid assets path ${JSON.stringify(raw.assets)}; path traversal is not permitted`,
          rootSpan,
          "use a relative directory path inside the project root",
        );
      }
    }
  }

  // Validate outDir
  if ("outDir" in raw) {
    if (typeof raw.outDir !== "string" || raw.outDir.trim() === "") {
      diagnostics.error(
        "KDM4001",
        "'outDir' in kadam.json must be a non-empty string",
        rootSpan,
      );
    } else {
      const normalizedOutDir = raw.outDir.replaceAll("\\", "/");
      if (
        normalizedOutDir === "." ||
        normalizedOutDir.startsWith("/") ||
        /^[A-Za-z]:/.test(normalizedOutDir) ||
        normalizedOutDir.split("/").includes("..")
      ) {
        diagnostics.error(
          "KDM4001",
          `invalid outDir ${JSON.stringify(raw.outDir)}; it must be a relative directory inside the project`,
          rootSpan,
          'use a directory such as "dist"',
        );
      }
    }
  }

  // Validate basePath
  if ("basePath" in raw) {
    if (typeof raw.basePath !== "string") {
      diagnostics.error(
        "KDM4001",
        "'basePath' in kadam.json must be a string",
        rootSpan,
      );
    } else if (raw.basePath !== "") {
      if (!raw.basePath.startsWith("/")) {
        diagnostics.error(
          "KDM4001",
          `'basePath' ${JSON.stringify(raw.basePath)} must start with '/'`,
          rootSpan,
          'use a path such as "/my-site" or ""',
        );
      }
      if (
        raw.basePath.includes("..") ||
        raw.basePath.includes("?") ||
        raw.basePath.includes("#")
      ) {
        diagnostics.error(
          "KDM4001",
          `'basePath' ${JSON.stringify(raw.basePath)} cannot contain '..', '?', or '#' `,
          rootSpan,
        );
      }
    }
  }

  // Validate siteUrl (kadam 0.3)
  if ("siteUrl" in raw) {
    if (raw.kadam !== "0.3") {
      diagnostics.error(
        "KDM4001",
        "'siteUrl' in kadam.json requires \"kadam\": \"0.3\"",
        rootSpan,
        'set "kadam": "0.3", or remove siteUrl',
      );
    } else if (!isSiteOrigin(raw.siteUrl)) {
      diagnostics.error(
        "KDM4001",
        `'siteUrl' ${JSON.stringify(raw.siteUrl)} must be an absolute http or https origin`,
        rootSpan,
        'use an origin such as "https://example.com"; put any subpath in basePath',
      );
    }
  }

  // Validate breakpoints (kadam 0.3)
  if ("breakpoints" in raw) {
    const value = raw.breakpoints;
    const hint = 'use an object of names to pixel widths, e.g. "breakpoints": { "wide": 1440 }';
    if (raw.kadam !== "0.3") {
      diagnostics.error("KDM4001", "'breakpoints' in kadam.json requires \"kadam\": \"0.3\"", rootSpan, 'set "kadam": "0.3", or remove breakpoints');
    } else if (typeof value !== "object" || value === null || Array.isArray(value)) {
      diagnostics.error("KDM4001", "'breakpoints' in kadam.json must be an object", rootSpan, hint);
    } else {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 8) {
        diagnostics.error("KDM4001", "'breakpoints' in kadam.json has at most 8 entries", rootSpan, hint);
      }
      for (const [name, width] of entries) {
        if (!BREAKPOINT_NAME.test(name) || RESERVED_BREAKPOINTS.has(name)) {
          diagnostics.error(
            "KDM4001",
            `invalid breakpoint name ${JSON.stringify(name)}`,
            rootSpan,
            "use one lower-case word other than phones, tablets, or desktops, e.g. \"wide\"",
          );
        } else if (typeof width !== "number" || !Number.isInteger(width) || width < 1 || width > 10000) {
          diagnostics.error(
            "KDM4001",
            `breakpoint ${JSON.stringify(name)} must be a whole number of pixels from 1 to 10000`,
            rootSpan,
            hint,
          );
        }
      }
    }
  }

  // Validate fonts (kadam 0.3)
  if ("fonts" in raw) {
    const value = raw.fonts;
    const hint = 'use "fonts": { "Inter": { "source": "assets/fonts/Inter.woff2", "weight": "100 900", "fallback": "sans serif" } }';
    if (raw.kadam !== "0.3") {
      diagnostics.error("KDM4001", "'fonts' in kadam.json requires \"kadam\": \"0.3\"", rootSpan, 'set "kadam": "0.3", or remove fonts');
    } else if (typeof value !== "object" || value === null || Array.isArray(value)) {
      diagnostics.error("KDM4001", "'fonts' in kadam.json must be an object", rootSpan, hint);
    } else {
      for (const [name, font] of Object.entries(value as Record<string, unknown>)) {
        const entry = font as Record<string, unknown>;
        const problem =
          !FONT_NAME.test(name) ? `invalid font name ${JSON.stringify(name)}; use letters, digits, spaces, and hyphens`
          : typeof font !== "object" || font === null || Array.isArray(font) ? `font ${JSON.stringify(name)} must be an object`
          : Object.keys(entry).some((key) => !FONT_KEYS.has(key)) ? `font ${JSON.stringify(name)} has an unknown key; use source, weight, style, fallback`
          : typeof entry.source !== "string" || !/\.(woff2?|WOFF2?)$/.test(entry.source) ? `font ${JSON.stringify(name)} needs a local .woff2 or .woff source`
          : entry.weight !== undefined && (typeof entry.weight !== "string" || !FONT_WEIGHT.test(entry.weight)) ? `font ${JSON.stringify(name)} weight must be like "400" or "100 900"`
          : entry.style !== undefined && entry.style !== "normal" && entry.style !== "italic" ? `font ${JSON.stringify(name)} style must be "normal" or "italic"`
          : entry.fallback !== undefined && entry.fallback !== "sans serif" && entry.fallback !== "serif" && entry.fallback !== "monospace" ? `font ${JSON.stringify(name)} fallback must be "sans serif", "serif", or "monospace"`
          : null;
        if (problem !== null) diagnostics.error("KDM4001", problem, rootSpan, hint);
      }
    }
  }

  // Validate theme (kadam 0.3)
  if ("theme" in raw) {
    if (raw.kadam !== "0.3") {
      diagnostics.error("KDM4001", "'theme' in kadam.json requires \"kadam\": \"0.3\"", rootSpan, 'set "kadam": "0.3", or remove theme');
    } else if (typeof raw.theme !== "string" || !raw.theme.endsWith(".kdm")) {
      diagnostics.error("KDM4001", "'theme' in kadam.json must be the path of a .kdm file", rootSpan, 'use "theme": "theme.kdm"');
    }
  }

  // Validate connect origins (kadam 0.3, D-41)
  if ("connect" in raw) {
    const value = raw.connect;
    const hint = 'use "connect": ["https://api.example.com"]';
    if (raw.kadam !== "0.3") {
      diagnostics.error("KDM4001", "'connect' in kadam.json requires \"kadam\": \"0.3\"", rootSpan, 'set "kadam": "0.3", or remove connect');
    } else if (!Array.isArray(value) || value.length > 16) {
      diagnostics.error("KDM4001", "'connect' in kadam.json must be a list of at most 16 origins", rootSpan, hint);
    } else {
      for (const origin of value) {
        let valid = false;
        if (typeof origin === "string") {
          try {
            const url = new URL(origin);
            const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
            valid = url.origin === origin && (url.protocol === "https:" || (url.protocol === "http:" && local));
          } catch {
            valid = false;
          }
        }
        if (!valid) diagnostics.error("KDM4001", `connect origin ${JSON.stringify(origin)} must be an https origin with no path, such as "https://api.example.com"`, rootSpan, hint);
      }
    }
  }

  // Validate existing stylesheets (kadam 0.3, F6, D-42)
  if ("stylesheets" in raw) {
    const value = raw.stylesheets;
    const hint = 'use "stylesheets": ["styles/legacy.css"]';
    if (raw.kadam !== "0.3") {
      diagnostics.error("KDM4001", "'stylesheets' in kadam.json requires \"kadam\": \"0.3\"", rootSpan, 'set "kadam": "0.3", or remove stylesheets');
    } else if (!Array.isArray(value) || value.length > 16) {
      diagnostics.error("KDM4001", "'stylesheets' in kadam.json must be a list of at most 16 .css paths", rootSpan, hint);
    } else {
      for (const path of value) {
        if (typeof path !== "string" || !path.endsWith(".css") || path.startsWith("/") || path.split("/").includes("..")) {
          diagnostics.error("KDM4001", `stylesheet ${JSON.stringify(path)} must be a project-relative .css path`, rootSpan, hint);
        }
      }
    }
  }

  // D-44: the server module.
  if ("server" in raw) {
    const value = raw.server as Record<string, unknown> | null;
    const hint = 'use "server": { "module": "server/shop.kdm", "target": "typescript" }';
    if (raw.kadam !== "0.3") {
      diagnostics.error("KDM4001", "'server' in kadam.json requires \"kadam\": \"0.3\"", rootSpan, 'set "kadam": "0.3", or remove server');
    } else if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).some((key) => key !== "module" && key !== "target")) {
      diagnostics.error("KDM4001", "'server' in kadam.json must be an object with module and target", rootSpan, hint);
    } else if (typeof value.module !== "string" || !value.module.endsWith(".kdm") || value.module.startsWith("/") || value.module.split("/").includes("..")) {
      diagnostics.error("KDM4001", "server module must be a project-relative .kdm path", rootSpan, hint);
    } else if (value.target !== "typescript") {
      diagnostics.error("KDM4001", `server target ${JSON.stringify(value.target)} is not supported yet; use "typescript"`, rootSpan, hint);
    }
  }

  if ("strict" in raw && typeof raw.strict !== "boolean") {
    diagnostics.error("KDM4001", "'strict' in kadam.json must be true or false", rootSpan, 'use "strict": true');
  }

  // Validate data files (kadam 0.3, F5)
  if ("data" in raw) {
    const value = raw.data;
    const hint = 'use "data": { "projects": "data/projects.json" }';
    if (raw.kadam !== "0.3") {
      diagnostics.error("KDM4001", "'data' in kadam.json requires \"kadam\": \"0.3\"", rootSpan, 'set "kadam": "0.3", or remove data');
    } else if (typeof value !== "object" || value === null || Array.isArray(value)) {
      diagnostics.error("KDM4001", "'data' in kadam.json must be an object", rootSpan, hint);
    } else {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 32) diagnostics.error("KDM4001", "'data' in kadam.json has at most 32 entries", rootSpan, hint);
      for (const [name, path] of entries) {
        if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(name)) {
          diagnostics.error("KDM4001", `data name "${name}" must be one lowerCamel word`, rootSpan, hint);
        } else if (typeof path !== "string" || !path.endsWith(".json")) {
          diagnostics.error("KDM4001", `data "${name}" must be the path of a .json file`, rootSpan, hint);
        }
      }
    }
  }

  // Validate pages
  if (!("pages" in raw)) {
    diagnostics.error(
      "KDM4001",
      "project manifest requires a 'pages' array",
      rootSpan,
      'add a "pages": [...] array listing project pages',
    );
    return {
      manifest: null,
      diagnostics: diagnostics.sorted(),
      manifestPath,
      manifestSource,
    };
  }

  if (!Array.isArray(raw.pages)) {
    diagnostics.error(
      "KDM4001",
      "'pages' in kadam.json must be an array",
      rootSpan,
    );
    return {
      manifest: null,
      diagnostics: diagnostics.sorted(),
      manifestPath,
      manifestSource,
    };
  }

  if (raw.pages.length === 0) {
    diagnostics.error(
      "KDM4006",
      "project declares no pages; at least one page is required",
      rootSpan,
      'declare at least one page in the "pages" array',
    );
    return {
      manifest: null,
      diagnostics: diagnostics.sorted(),
      manifestPath,
      manifestSource,
    };
  }

  const seenRoutes = new Map<string, Span>();
  const seenSources = new Map<string, Span>();
  const pages: ManifestPageEntry[] = [];

  for (let i = 0; i < raw.pages.length; i += 1) {
    const item = raw.pages[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      diagnostics.error(
        "KDM4001",
        `page entry at index ${i} must be an object`,
        rootSpan,
      );
      continue;
    }

    const pageRaw = item as Record<string, unknown>;

    // Check unknown keys in page entry
    for (const key of Object.keys(pageRaw)) {
      if (!KNOWN_PAGE_KEYS.has(key)) {
        diagnostics.error(
          "KDM4001",
          `unknown page entry property ${JSON.stringify(key)} at index ${i}`,
          rootSpan,
          `supported page properties are: ${[...KNOWN_PAGE_KEYS].join(", ")}`,
        );
      }
    }

    // Source / file validation
    const sourceVal = pageRaw.source ?? pageRaw.file;
    if (typeof sourceVal !== "string" || sourceVal.trim() === "") {
      diagnostics.error(
        "KDM4001",
        `page entry at index ${i} requires a non-empty 'source' or 'file' path`,
        rootSpan,
        'specify "source": "pages/home.kdm"',
      );
      continue;
    }

    const normalizedSource = sourceVal.replaceAll("\\", "/");
    if (
      normalizedSource.startsWith("/") ||
      /^[A-Za-z]:/.test(normalizedSource) ||
      normalizedSource.split("/").includes("..")
    ) {
      diagnostics.error(
        "KDM4001",
        `invalid page source path ${JSON.stringify(sourceVal)}; path traversal is not permitted`,
        rootSpan,
        "use a project-relative path without '..'",
      );
      continue;
    }

    if (!normalizedSource.endsWith(".kdm")) {
      diagnostics.error(
        "KDM4001",
        `page source path ${JSON.stringify(sourceVal)} must use the .kdm extension`,
        rootSpan,
      );
      continue;
    }

    if (seenSources.has(normalizedSource)) {
      diagnostics.error(
        "KDM4001",
        `duplicate page source path ${JSON.stringify(sourceVal)}`,
        rootSpan,
        "each page source file may be declared at most once",
      );
      continue;
    }
    seenSources.set(normalizedSource, rootSpan);

    // Route validation
    if (typeof pageRaw.route !== "string" || pageRaw.route.trim() === "") {
      diagnostics.error(
        "KDM4001",
        `page entry for '${sourceVal}' requires a non-empty 'route'`,
        rootSpan,
        'specify "route": "/" or "route": "/about"',
      );
      continue;
    }

    const routeVal = pageRaw.route;
    if (!routeVal.startsWith("/")) {
      diagnostics.error(
        "KDM4001",
        `route ${JSON.stringify(routeVal)} must start with '/'`,
        rootSpan,
        'start route with a slash, such as "/" or "/about"',
      );
      continue;
    }

    if (routeVal.includes("..") || routeVal.includes("?") || routeVal.includes("#")) {
      diagnostics.error(
        "KDM4001",
        `route ${JSON.stringify(routeVal)} cannot contain '..', '?', or '#' `,
        rootSpan,
      );
      continue;
    }

    if (routeVal.includes("\\") || /\s/.test(routeVal)) {
      diagnostics.error(
        "KDM4001",
        `route ${JSON.stringify(routeVal)} cannot contain backslashes or whitespace`,
        rootSpan,
        'use lowercase, URL-safe segments such as "/about/team"',
      );
      continue;
    }

    const invalidSegment = routeSegments(routeVal).find(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        // kadam 0.3 (F5 step 3): `:slug` takes its value from each record.
        !(/^[A-Za-z0-9._~-]+$/.test(segment) || (raw.kadam === "0.3" && /^:[a-z][A-Za-z0-9]{0,63}$/.test(segment))),
    );
    if (invalidSegment !== undefined) {
      diagnostics.error(
        "KDM4001",
        `route ${JSON.stringify(routeVal)} contains an invalid segment ${JSON.stringify(invalidSegment)}`,
        rootSpan,
        raw.kadam === "0.3"
          ? "route segments may contain letters, digits, '.', '_', '~', and '-', or be :field for a page made for each record"
          : "route segments may contain letters, digits, '.', '_', '~', and '-'",
      );
      continue;
    }

    const normalizedRoute = normalizeRoute(routeVal);
    if (seenRoutes.has(normalizedRoute)) {
      diagnostics.error(
        "KDM4005",
        `duplicate route ${JSON.stringify(routeVal)}`,
        rootSpan,
        "routes must be unique across the project",
        [{ span: seenRoutes.get(normalizedRoute)!, message: "first declared here" }],
      );
      continue;
    }
    seenRoutes.set(normalizedRoute, rootSpan);

    // Title validation
    let titleVal: string | undefined;
    if ("title" in pageRaw) {
      if (typeof pageRaw.title !== "string" || pageRaw.title.trim() === "") {
        diagnostics.error(
          "KDM4001",
          `'title' in page entry for '${sourceVal}' must be a non-empty string`,
          rootSpan,
        );
        continue;
      }
      titleVal = pageRaw.title;
    }

    pages.push({
      source: normalizedSource,
      file: normalizedSource,
      route: routeVal,
      title: titleVal,
    });
  }

  // Validate components. Components are optional, but each entry is a
  // project-relative .kdm file and may not collide with a page or another
  // component.
  const components: ManifestComponentEntry[] = [];
  const seenComponents = new Map<string, Span>();
  if ("components" in raw) {
    if (!Array.isArray(raw.components)) {
      diagnostics.error(
        "KDM4007",
        "'components' in kadam.json must be an array",
        rootSpan,
        'add a "components": ["components/Button.kdm"] array',
      );
    } else {
      for (let i = 0; i < raw.components.length; i += 1) {
        const item = raw.components[i];
        let sourceValue: unknown;
        let namespaceValue: unknown = undefined;

        if (typeof item === "string") {
          sourceValue = item;
        } else if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          const entry = item as Record<string, unknown>;
          for (const key of Object.keys(entry)) {
            if (key !== "source" && key !== "namespace") {
              diagnostics.error(
                "KDM4009",
                `unknown component entry property ${JSON.stringify(key)} at index ${i}`,
                rootSpan,
                "supported component properties are: source, namespace",
              );
            }
          }
          sourceValue = entry.source;
          namespaceValue = entry.namespace;
          if (
            namespaceValue !== undefined &&
            (typeof namespaceValue !== "string" ||
              !/^[a-z][A-Za-z0-9]{0,63}$/.test(namespaceValue))
          ) {
            diagnostics.error(
              "KDM4009",
              `invalid component namespace ${JSON.stringify(namespaceValue)} at index ${i}`,
              rootSpan,
              'use a lower-camel identifier such as "ui"',
            );
            continue;
          }
        } else {
          diagnostics.error(
            "KDM4009",
            `component entry at index ${i} must be a path or an object with 'source'`,
            rootSpan,
            'use "components/Button.kdm" or { "source": "libs/ui/Button.kdm", "namespace": "ui" }',
          );
          continue;
        }

        if (typeof sourceValue !== "string" || sourceValue.trim() === "") {
          diagnostics.error(
            "KDM4009",
            `component entry at index ${i} requires a non-empty 'source' path`,
            rootSpan,
            'use a project-relative path such as "components/Button.kdm"',
          );
          continue;
        }

        const normalizedComponent = sourceValue.replaceAll("\\", "/");
        if (
          normalizedComponent.startsWith("/") ||
          /^[A-Za-z]:/.test(normalizedComponent) ||
          normalizedComponent.includes("\0") ||
          normalizedComponent.split("/").includes("..") ||
          !normalizedComponent.endsWith(".kdm")
        ) {
          diagnostics.error(
            "KDM4007",
            `invalid component source path ${JSON.stringify(sourceValue)}`,
            rootSpan,
            'use a project-relative .kdm path without "..", drive letters, or a leading slash',
          );
          continue;
        }

        if (seenComponents.has(normalizedComponent)) {
          diagnostics.error(
            "KDM4008",
            `duplicate component source path ${JSON.stringify(sourceValue)}`,
            rootSpan,
            "each component source file may be declared at most once",
            [{ span: seenComponents.get(normalizedComponent)!, message: "first declared here" }],
          );
          continue;
        }

        const pageSourceSpan = seenSources.get(normalizedComponent);
        if (pageSourceSpan !== undefined) {
          diagnostics.error(
            "KDM4008",
            `component source path ${JSON.stringify(sourceValue)} is already declared as a page`,
            rootSpan,
            "a file must contain either a page or a component, not both",
            [{ span: pageSourceSpan, message: "page declared here" }],
          );
          continue;
        }

        seenComponents.set(normalizedComponent, rootSpan);
        components.push({
          source: normalizedComponent,
          namespace:
            typeof namespaceValue === "string" ? namespaceValue : null,
        });
      }
    }
  }

  const manifest: KadamManifest = {
    name: typeof raw.name === "string" ? raw.name : "",
    version: typeof raw.version === "string" ? raw.version : undefined,
    kadam: typeof raw.kadam === "string" ? raw.kadam : undefined,
    pages,
    components,
    assets: typeof raw.assets === "string" ? raw.assets : "assets",
    outDir: typeof raw.outDir === "string" ? raw.outDir : "dist",
    basePath: typeof raw.basePath === "string" ? raw.basePath : undefined,
    siteUrl: typeof raw.siteUrl === "string" ? raw.siteUrl.replace(/\/$/, "") : undefined,
    fonts: readFonts(raw.fonts),
    theme: typeof raw.theme === "string" ? raw.theme : undefined,
    connect: Array.isArray(raw.connect) ? (raw.connect as string[]) : undefined,
    stylesheets: Array.isArray(raw.stylesheets) ? (raw.stylesheets as string[]) : undefined,
    strict: raw.strict === true ? true : undefined,
    server:
      typeof raw.server === "object" && raw.server !== null && typeof (raw.server as Record<string, unknown>).module === "string"
        ? { module: (raw.server as { module: string }).module, target: "typescript" }
        : undefined,
    data:
      typeof raw.data === "object" && raw.data !== null && !Array.isArray(raw.data)
        ? (raw.data as Record<string, string>)
        : undefined,
    breakpoints:
      typeof raw.breakpoints === "object" && raw.breakpoints !== null && !Array.isArray(raw.breakpoints)
        ? (raw.breakpoints as Record<string, number>)
        : undefined,
  };

  return {
    manifest: diagnostics.hasErrors ? null : manifest,
    diagnostics: diagnostics.sorted(),
    manifestPath,
    manifestSource,
  };
}

const BREAKPOINT_NAME = /^[a-z]{2,20}$/;
const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$/;
const FONT_WEIGHT = /^[1-9]00(?: [1-9]00)?$/;
const FONT_KEYS: ReadonlySet<string> = new Set(["source", "weight", "style", "fallback"]);

function readFonts(value: unknown): Readonly<Record<string, ManifestFont>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const fonts: Record<string, ManifestFont> = {};
  for (const [name, font] of Object.entries(value as Record<string, Record<string, unknown>>)) {
    fonts[name] = {
      source: String(font.source),
      weight: typeof font.weight === "string" ? font.weight : "400",
      style: font.style === "italic" ? "italic" : "normal",
      fallback: font.fallback === "serif" || font.fallback === "monospace" ? font.fallback : "sans serif",
    };
  }
  return fonts;
}
const RESERVED_BREAKPOINTS: ReadonlySet<string> = new Set(["phones", "tablets", "desktops"]);

/** An absolute http(s) origin with no path, query, or fragment. */
function isSiteOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      (url.pathname === "/" || url.pathname === "") &&
      url.search === "" &&
      url.hash === "" &&
      !value.includes("@")
    );
  } catch {
    return false;
  }
}

function routeSegments(route: string): string[] {
  return route.slice(1).split("/").filter((segment) => segment !== "");
}
