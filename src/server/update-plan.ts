import { createHash } from "node:crypto";
import type { OutputFileKind } from "../compiler/compile.js";

export interface SnapshotEntry {
  readonly contents: string | Uint8Array;
  readonly kind: OutputFileKind;
}

export type Snapshot = ReadonlyMap<string, SnapshotEntry>;

export interface OutputSnapshot {
  readonly files: Snapshot;
  readonly hash: string;
  readonly buildId: number;
}

export type PlannedUpdate =
  | { readonly kind: "none" }
  | { readonly kind: "css"; readonly paths: readonly string[] }
  | {
      readonly kind: "reload";
      readonly reason: "first-build" | "html" | "assets";
    };

export interface OutputFileLike {
  readonly path: string;
  readonly contents: string | Uint8Array;
  readonly kind: OutputFileKind;
}

export function snapshotFromFiles(
  files: readonly OutputFileLike[],
  buildId: number,
): OutputSnapshot {
  const map = new Map<string, SnapshotEntry>();
  for (const file of files) {
    map.set(file.path, { contents: file.contents, kind: file.kind });
  }
  return { files: map, hash: hashSnapshot(map), buildId };
}

export function hashSnapshot(files: Snapshot): string {
  const hash = createHash("sha256");
  const paths = [...files.keys()].sort();
  for (const path of paths) {
    const entry = files.get(path)!;
    hash.update(path);
    hash.update("\0");
    hash.update(entry.kind);
    hash.update("\0");
    hash.update(toBuffer(entry.contents));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Decide how much of the browser to refresh.
 *
 * HTML changes, route changes, and asset changes require a reload. When the
 * output diff proves that only generated stylesheets changed, the client can
 * swap stylesheet URLs and keep scroll position and form state.
 */
export function planUpdate(
  previous: OutputSnapshot | null,
  next: OutputSnapshot,
  changedPaths: readonly string[] = [],
): PlannedUpdate {
  void changedPaths;

  if (previous === null) return { kind: "reload", reason: "first-build" };
  if (previous.hash === next.hash) return { kind: "none" };

  const changed = new Set<string>();

  for (const [path, entry] of next.files) {
    const before = previous.files.get(path);
    if (
      before === undefined ||
      before.kind !== entry.kind ||
      !contentsEqual(before.contents, entry.contents)
    ) {
      changed.add(path);
    }
  }

  for (const path of previous.files.keys()) {
    if (!next.files.has(path)) changed.add(path);
  }

  if (changed.size === 0) return { kind: "none" };

  let htmlChanged = false;
  let assetChanged = false;
  const cssPaths: string[] = [];

  for (const path of changed) {
    const kind = next.files.get(path)?.kind ?? previous.files.get(path)?.kind;
    if (kind === "html") htmlChanged = true;
    else if (kind === "asset" || kind === "js") assetChanged = true;
    else if (kind === "css") cssPaths.push(path);
  }

  if (htmlChanged) return { kind: "reload", reason: "html" };
  if (assetChanged) return { kind: "reload", reason: "assets" };
  return { kind: "css", paths: cssPaths.sort() };
}

function contentsEqual(
  a: string | Uint8Array,
  b: string | Uint8Array,
): boolean {
  if (a === b) return true;
  return toBuffer(a).equals(toBuffer(b));
}

function toBuffer(value: string | Uint8Array): Buffer {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
}
