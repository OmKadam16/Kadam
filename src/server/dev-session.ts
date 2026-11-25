import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Diagnostic, Severity } from "../core/diagnostics/diagnostic.js";
import type { SourceFile } from "../core/source/source-file.js";
import { compileProject, type ProjectCompileOptions } from "../compiler/project.js";
import type { KadamManifest } from "../compiler/manifest.js";
import type { OutputFile } from "../compiler/compile.js";
import { normalizeBasePath } from "../compiler/routes.js";
import {
  planUpdate,
  snapshotFromFiles,
  type OutputSnapshot,
  type PlannedUpdate,
} from "./update-plan.js";

export interface SerializedLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message?: string;
}

export interface SerializedDiagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  /** Project-relative path; absolute paths never leave the process. */
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly hint?: string;
  readonly related?: readonly SerializedLocation[];
}

export interface RouteSummary {
  readonly route: string;
  readonly title: string;
}

export interface DevStatus {
  readonly buildId: number;
  readonly phase: "success" | "failure";
  readonly served: "current" | "last-success" | "none";
  readonly diagnostics: readonly SerializedDiagnostic[];
  readonly routes: readonly RouteSummary[];
  readonly compileMs: number;
  readonly changed: PlannedUpdate["kind"];
}

export interface BuildOutcome {
  readonly ok: boolean;
  readonly status: DevStatus;
  readonly plan: PlannedUpdate;
  readonly diagnostics: readonly Diagnostic[];
  readonly sources: readonly SourceFile[];
}

export interface DevSessionOptions {
  readonly projectRoot: string;
  readonly basePath?: string | undefined;
  /** Clock injection for deterministic tests. */
  readonly now?: (() => number) | undefined;
}

const MAX_REPORTED_DIAGNOSTICS = 100;

/**
 * Owns the last successful snapshot and the current diagnostic state.
 *
 * It is a thin wrapper around `compileProject`: no language rules, parsing,
 * analysis, or emission live here.
 */
export class DevSession {
  readonly projectRoot: string;
  readonly #basePathOption: string | undefined;
  readonly #now: () => number;

  #snapshot: OutputSnapshot | null = null;
  #status: DevStatus = {
    buildId: 0,
    phase: "failure",
    served: "none",
    diagnostics: [],
    routes: [],
    compileMs: 0,
    changed: "none",
  };
  #manifest: KadamManifest | null = null;
  #latestFiles: readonly OutputFile[] = [];
  /** Markdown documents the last build read; they are inputs too. */
  #latestDocuments: readonly string[] = [];
  #routes: readonly RouteSummary[] = [];
  #sourceOverrides: ReadonlyMap<string, string | Uint8Array> = new Map();
  #basePath = "";
  #outDir: string;

  constructor(options: DevSessionOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.#outDir = resolve(this.projectRoot, "dist");
    this.#basePathOption = options.basePath;
    this.#now = options.now ?? Date.now;
  }

  get snapshot(): OutputSnapshot | null {
    return this.#snapshot;
  }

  get status(): DevStatus {
    return this.#status;
  }

  /** Replace the in-memory source overlay used by later builds. */
  setSourceOverrides(
    overrides: ReadonlyMap<string, string | Uint8Array>,
  ): void {
    this.#sourceOverrides = new Map(overrides);
  }

  /** Return to disk sources on the next build. */
  clearSourceOverrides(): void {
    this.#sourceOverrides = new Map();
  }

  get basePath(): string {
    return this.#basePath;
  }

  /** Absolute output directory the compiler would use; watched but never written. */
  get outDir(): string {
    return this.#outDir;
  }

  /** kadam 0.3 (D-41): origins pages may load data from. */
  get connectOrigins(): readonly string[] {
    return this.#manifest?.connect ?? [];
  }

  /** Project-relative paths the watcher must observe. Empty means fallback. */
  get watchPaths(): readonly string[] {
    if (this.#manifest === null) return [];
    const paths = new Set<string>(["kadam.json"]);
    for (const page of this.#manifest.pages) paths.add(page.source);
    // Component files are compile inputs for every page that uses them, so a
    // component edit must rebuild even though it is never emitted as a route.
    for (const component of this.#manifest.components ?? []) {
      paths.add(component.source);
    }
    // The theme and data files feed every page too (kadam 0.3).
    if (this.#manifest.theme !== undefined) paths.add(this.#manifest.theme);
    for (const source of Object.values(this.#manifest.data ?? {})) paths.add(source);
    for (const path of this.#latestDocuments) paths.add(path);
    for (const file of this.#latestFiles) {
      if (file.kind === "asset") paths.add(file.path);
    }
    return [...paths].sort();
  }

  build(changedPaths: readonly string[] = []): BuildOutcome {
    const started = this.#now();
    const options: ProjectCompileOptions = {
      projectRoot: this.projectRoot,
      ...(this.#basePathOption === undefined
        ? {}
        : { basePath: this.#basePathOption }),
      ...(this.#sourceOverrides.size === 0
        ? {}
        : { sourceOverrides: this.#sourceOverrides }),
    };
    const result = compileProject(options);
    this.#latestDocuments = result.sources.map((source) => source.path).filter((path) => path.endsWith(".md"));
    const compileMs = this.#now() - started;

    this.#manifest = result.manifest;
    this.#outDir = result.outDir;
    this.#basePath = normalizeBasePath(
      this.#basePathOption ?? result.manifest?.basePath ?? "",
    );

    const diagnostics = result.diagnostics
      .slice(0, MAX_REPORTED_DIAGNOSTICS)
      .map((diagnostic) => serializeDiagnostic(diagnostic, this.projectRoot));

    if (!result.ok) {
      const previous = this.#snapshot;
      this.#status = {
        buildId: previous?.buildId ?? 0,
        phase: "failure",
        served: previous === null ? "none" : "last-success",
        diagnostics,
        routes: this.#routes,
        compileMs,
        changed: "none",
      };
      return {
        ok: false,
        status: this.#status,
        plan: { kind: "none" },
        diagnostics: result.diagnostics,
        sources: result.sources,
      };
    }

    const previous = this.#snapshot;
    const next = snapshotFromFiles(result.files, (previous?.buildId ?? 0) + 1);
    const plan = planUpdate(previous, next, changedPaths);

    this.#snapshot = next;
    this.#latestFiles = result.files;
    this.#routes = result.pages.map((page) => ({
      route: page.route,
      title: page.title,
    }));
    this.#status = {
      buildId: next.buildId,
      phase: "success",
      served: "current",
      diagnostics,
      routes: this.#routes,
      compileMs,
      changed: plan.kind,
    };

    return {
      ok: true,
      status: this.#status,
      plan,
      diagnostics: result.diagnostics,
      sources: result.sources,
    };
  }
}

function serializeDiagnostic(
  diagnostic: Diagnostic,
  projectRoot: string,
): SerializedDiagnostic {
  const span = diagnostic.span;
  const related = diagnostic.related?.map((item) => ({
    file: projectRelative(item.span.file, projectRoot),
    line: item.span.start.line,
    column: item.span.start.column,
    message: item.message,
  }));

  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    file: projectRelative(span.file, projectRoot),
    line: span.start.line,
    column: span.start.column,
    ...(diagnostic.hint === undefined ? {} : { hint: diagnostic.hint }),
    ...(related === undefined || related.length === 0 ? {} : { related }),
  };
}

function projectRelative(file: string, projectRoot: string): string {
  const resolved = isAbsolute(file) ? file : resolve(projectRoot, file);
  const relation = relative(projectRoot, resolved);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    return file.replaceAll("\\", "/");
  }
  return relation.split(sep).join("/");
}
