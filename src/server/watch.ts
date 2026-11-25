import { readdirSync, statSync, watch as watchFs, type FSWatcher } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { SUPPORTED_ASSET_EXTENSIONS } from "../compiler/project.js";

export interface WatcherOptions {
  readonly projectRoot: string;
  readonly outDir: string;
  readonly onChange: (paths: readonly string[]) => void;
  readonly debounceMs?: number;
  readonly poll?: boolean;
  readonly logger?: ((message: string) => void) | undefined;
}

export interface Watcher {
  /** Replace the exact set of project-relative paths to observe. */
  update(paths: readonly string[]): void;
  close(): void;
  readonly mode: "watch" | "poll";
}

const FALLBACK_IGNORED_DIRS = new Set(["node_modules", ".git"]);

export function isIgnoredChange(
  path: string,
  outDirRelative: string,
): boolean {
  const posix = path.replaceAll("\\", "/");
  if (posix === "") return true;
  if (
    outDirRelative !== "" &&
    (posix === outDirRelative || posix.startsWith(`${outDirRelative}/`))
  ) {
    return true;
  }

  const segments = posix.split("/").filter((segment) => segment !== "");
  for (const segment of segments) {
    if (segment.startsWith(".") || FALLBACK_IGNORED_DIRS.has(segment)) {
      return true;
    }
  }

  const name = segments[segments.length - 1] ?? "";
  return (
    name.endsWith(".kadam-tmp") ||
    name.endsWith(".swp") ||
    name.endsWith(".swo") ||
    name.endsWith("~")
  );
}

export function createWatcher(options: WatcherOptions): Watcher {
  const projectRoot = resolve(options.projectRoot);
  const outDirAbsolute = resolve(options.outDir);
  const outDirRelative = relative(projectRoot, outDirAbsolute)
    .split(sep)
    .join("/");
  const debounceMs = options.debounceMs ?? 75;
  const log = options.logger ?? (() => {});

  let relevant = new Set<string>();
  let mode: "watch" | "poll" = options.poll === true ? "poll" : "watch";
  let watcher: FSWatcher | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const pending = new Set<string>();

  function isRelevant(path: string): boolean {
    if (isIgnoredChange(path, outDirRelative)) return false;
    if (relevant.size > 0) return relevant.has(path);
    if (path === "kadam.json") return true;
    if (path.endsWith(".kdm")) return true;
    const dot = path.lastIndexOf(".");
    return (
      dot !== -1 &&
      SUPPORTED_ASSET_EXTENSIONS.has(path.slice(dot + 1).toLowerCase())
    );
  }

  function enqueue(path: string): void {
    if (closed || !isRelevant(path)) return;
    pending.add(path);
    if (debounceTimer !== null) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (pending.size === 0) return;
      const paths = [...pending].sort();
      pending.clear();
      try {
        options.onChange(paths);
      } catch (error) {
        log(
          `kadam dev: change handling failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }, debounceMs);
  }

  function stopWatch(): void {
    if (watcher !== null) {
      try {
        watcher.close();
      } catch {
        // Already closed.
      }
      watcher = null;
    }
  }

  function startWatch(): void {
    if (closed) return;
    try {
      watcher = watchFs(projectRoot, { recursive: true }, (_event, filename) => {
        if (filename === null) return;
        enqueue(filename.toString().split(sep).join("/"));
      });
      watcher.on("error", (error) => {
        log(
          `kadam dev: file watcher failed (${error.message}); using polling.`,
        );
        stopWatch();
        startPolling();
      });
    } catch (error) {
      log(
        `kadam dev: file watching is unavailable (${
          error instanceof Error ? error.message : String(error)
        }); using polling.`,
      );
      startPolling();
    }
  }

  const observed = new Map<string, string>();

  function scan(report: boolean): void {
    const found = new Set<string>();

    const visit = (directory: string, prefix: string): void => {
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (isIgnoredChange(path, outDirRelative)) continue;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          visit(join(directory, entry.name), path);
          continue;
        }
        if (!entry.isFile() || !isRelevant(path)) continue;
        found.add(path);
        let key: string;
        try {
          const stats = statSync(join(directory, entry.name));
          key = `${stats.mtimeMs}:${stats.size}`;
        } catch {
          continue;
        }
        const previous = observed.get(path);
        observed.set(path, key);
        if (report && previous !== key && previous !== undefined) {
          enqueue(path);
        }
      }
    };

    visit(projectRoot, "");

    for (const path of [...observed.keys()]) {
      if (!found.has(path)) {
        observed.delete(path);
        if (report) enqueue(path);
      }
    }
  }

  function startPolling(): void {
    if (closed) return;
    mode = "poll";
    stopWatch();
    if (pollTimer !== null) return;
    scan(false);
    pollTimer = setInterval(() => {
      if (!closed) scan(true);
    }, 300);
  }

  if (mode === "watch") startWatch();
  else startPolling();

  return {
    update(paths: readonly string[]): void {
      relevant = new Set(paths);
      if (mode === "poll") scan(false);
    },
    close(): void {
      closed = true;
      stopWatch();
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pending.clear();
    },
    get mode(): "watch" | "poll" {
      return mode;
    },
  };
}
