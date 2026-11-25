import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  SourceHistory,
  applyValidatedSourceEdit,
  buildOutline,
  createSourceDocument,
  findElementByOffset,
  findOutlineNode,
  insertSourceStatement,
  outlineNodeAt,
  parseEditorDocument,
  quoteTextLiteral,
  saveSourceDocument,
  setValidatedElementBackground,
  setValidatedElementBorder,
  setValidatedElementCorners,
  setValidatedElementText,
  type BackgroundInput,
  type BorderInput,
  type CornersInput,
  type OutlineKind,
  type OutlineNode,
  type SourceDocument,
  type SourceEditRequest,
  type StatementNode,
} from "kadam";
import { compileProject, type Diagnostic } from "kadam";
import type {
  BackgroundValue,
  BorderValue,
  CornersValue,
  InspectorPayload,
  LayerKind,
  LayerRequestBody,
  NewlineStyle,
  StyleRequestBody,
  StyleSelector,
  OutlinePayload,
  SourceDocumentPayload,
  SourceKind,
  SpanPayload,
  StudioDiagnostic,
  TreeEntry,
} from "../shared/protocol.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".freebuff",
  "node_modules",
  "studio",
]);
const MAX_TREE_ENTRIES = 2000;

export class StudioRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "StudioRequestError";
    this.status = status;
    this.code = code;
  }
}

interface ManifestSummary {
  readonly name: string;
  readonly outDir: string;
  readonly pages: ReadonlyMap<
    string,
    { readonly route: string; readonly title?: string | undefined }
  >;
  readonly components: ReadonlySet<string>;
}

export interface ProjectEditFailure {
  readonly ok: false;
  readonly document: SourceDocument;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly diagnostics: readonly Diagnostic[];
}

export type ProjectEditResult =
  | {
      readonly ok: true;
      readonly document: SourceDocument;
      readonly diagnostics: readonly Diagnostic[];
    }
  | ProjectEditFailure;

export type ProjectPropertyResult =
  | {
      readonly ok: true;
      readonly document: SourceDocument;
      readonly diagnostics: readonly Diagnostic[];
    }
  | ProjectEditFailure;

export type ProjectStyleResult = ProjectPropertyResult;

export type StyleRequest = Pick<
  StyleRequestBody,
  "selector" | "statement"
>;

export type ProjectLayerResult =
  | {
      readonly ok: true;
      readonly document: SourceDocument;
      readonly outline: OutlinePayload | null;
      readonly selectedId: string | null;
      readonly message: string;
      readonly diagnostics: readonly Diagnostic[];
    }
  | ProjectEditFailure;

export type ProjectSaveResult =
  | {
      readonly ok: true;
      readonly status: "saved" | "unchanged";
      readonly document: SourceDocument;
    }
  | {
      readonly ok: false;
      readonly document: SourceDocument;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly diskText?: string;
      };
    };

export type PropertyRequest =
  | { readonly property: "text"; readonly value: string }
  | { readonly property: "background"; readonly value: BackgroundInput }
  | { readonly property: "border"; readonly value: BorderInput }
  | { readonly property: "corners"; readonly value: CornersInput };

/**
 * In-memory Studio session for one project root.
 *
 * Every accepted edit is validated by the real project compiler through
 * `sourceOverrides`; nothing is written until `save()`.
 */
export class StudioProject {
  readonly projectRoot: string;
  readonly #realRoot: string;
  readonly #documents = new Map<string, SourceHistory>();

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    this.#realRoot = realpathSync(this.projectRoot);
  }

  get name(): string {
    return this.manifest().name;
  }

  get manifestPath(): string {
    return "kadam.json";
  }

  manifest(): ManifestSummary {
    const fallback: ManifestSummary = {
      name: basename(this.projectRoot),
      outDir: "dist",
      pages: new Map(),
      components: new Set(),
    };

    const path = join(this.projectRoot, "kadam.json");
    if (!existsSync(path)) return fallback;

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return fallback;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return fallback;
    }

    const record = parsed as Record<string, unknown>;
    const pages = new Map<
      string,
      { readonly route: string; readonly title?: string | undefined }
    >();
    const rawPages = Array.isArray(record.pages) ? record.pages : [];
    for (const raw of rawPages) {
      if (typeof raw !== "object" || raw === null) continue;
      const page = raw as Record<string, unknown>;
      const source =
        typeof page.source === "string"
          ? page.source
          : typeof page.file === "string"
            ? page.file
            : null;
      if (source === null || typeof page.route !== "string") continue;
      const normalized = normalizeRelative(source);
      if (normalized === null) continue;
      pages.set(normalized, {
        route: page.route,
        ...(typeof page.title === "string" ? { title: page.title } : {}),
      });
    }

    const components = new Set<string>();
    const rawComponents = Array.isArray(record.components)
      ? record.components
      : [];
    for (const raw of rawComponents) {
      const source =
        typeof raw === "string"
          ? raw
          : typeof raw === "object" && raw !== null
            ? (raw as Record<string, unknown>).source
            : null;
      if (typeof source !== "string") continue;
      const normalized = normalizeRelative(source);
      if (normalized !== null) components.add(normalized);
    }

    const declaredOutDir =
      typeof record.outDir === "string" && record.outDir.trim() !== ""
        ? normalizeRelative(record.outDir)
        : null;

    return {
      name:
        typeof record.name === "string" && record.name.trim() !== ""
          ? record.name
          : fallback.name,
      outDir: declaredOutDir ?? "dist",
      pages,
      components,
    };
  }

  entries(): TreeEntry[] {
    const manifest = this.manifest();
    const outDir = manifest.outDir.replace(/\/+$/, "");
    const entries: TreeEntry[] = [];

    const walk = (directory: string): void => {
      if (entries.length >= MAX_TREE_ENTRIES) return;

      let children;
      try {
        children = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      children.sort((a, b) => compareText(a.name, b.name));

      for (const child of children) {
        if (entries.length >= MAX_TREE_ENTRIES) return;
        if (child.isSymbolicLink()) continue;
        const absolute = join(directory, child.name);
        const relation = toProjectPath(relative(this.projectRoot, absolute));

        if (child.isDirectory()) {
          if (child.name.startsWith(".")) continue;
          if (IGNORED_DIRECTORIES.has(child.name)) continue;
          if (outDir !== "" && (relation === outDir || relation.startsWith(`${outDir}/`))) {
            continue;
          }
          walk(absolute);
          continue;
        }

        if (!child.isFile() || !child.name.endsWith(".kdm")) continue;
        const page = manifest.pages.get(relation);
        const kind: SourceKind = manifest.components.has(relation)
          ? "component"
          : "page";
        entries.push({
          path: relation,
          label: basename(relation, ".kdm"),
          kind,
          ...(page === undefined ? {} : { route: page.route }),
        });
      }
    };

    walk(this.projectRoot);
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "page" ? -1 : 1;
      return compareText(a.path, b.path);
    });
    return entries;
  }

  documentKind(path: string): SourceKind {
    const normalized = normalizeSourcePath(path);
    const manifest = this.manifest();
    if (manifest.components.has(normalized)) return "component";
    if (manifest.pages.has(normalized)) return "page";
    return normalized.startsWith("components/") ? "component" : "page";
  }

  open(path: string): SourceDocument {
    const normalized = normalizeSourcePath(path);
    const existing = this.#documents.get(normalized);
    if (existing !== undefined) return existing.document;

    const absolute = this.sourcePath(normalized);
    let raw: string;
    try {
      raw = readFileSync(absolute, "utf8");
    } catch {
      throw new StudioRequestError(
        404,
        "not-found",
        `source file '${normalized}' does not exist`,
      );
    }

    const document = createSourceDocument(normalized, raw);
    this.#documents.set(normalized, new SourceHistory(document));
    return document;
  }

  openDocuments(): readonly SourceDocumentPayload[] {
    return [...this.#documents.values()]
      .map((history) => documentPayload(history.document, this.documentKind(history.document.path)))
      .sort((a, b) => compareText(a.path, b.path));
  }

  /** Only unsaved buffers shadow disk sources in the preview. */
  overrides(): Map<string, string> {
    const overrides = new Map<string, string>();
    for (const [path, history] of this.#documents) {
      if (history.document.dirty) overrides.set(path, history.document.text);
    }
    return overrides;
  }

  edit(request: SourceEditRequest): ProjectEditResult {
    const document = this.open(request.path);
    const history = this.#history(document.path);
    const normalizedRequest: SourceEditRequest =
      request.path === document.path ? request : { ...request, path: document.path };
    const result = applyValidatedSourceEdit({
      projectRoot: this.projectRoot,
      document,
      request: normalizedRequest,
      sourceOverrides: this.overrides(),
    });

    if (!result.ok) {
      return {
        ok: false,
        document,
        error: result.error,
        diagnostics: result.diagnostics,
      };
    }

    history.commit(result.document);
    return {
      ok: true,
      document: result.document,
      diagnostics: result.diagnostics,
    };
  }

  save(path: string): ProjectSaveResult {
    const document = this.open(path);
    const result = saveSourceDocument({
      projectRoot: this.projectRoot,
      document,
    });

    if (!result.ok) {
      return {
        ok: false,
        document,
        error: {
          code: result.error.code,
          message: result.error.message,
          ...(result.error.diskText === undefined
            ? {}
            : { diskText: result.error.diskText }),
        },
      };
    }

    this.#history(result.document.path).commit(result.document);
    return {
      ok: true,
      status: result.status,
      document: result.document,
    };
  }

  reload(path: string): SourceDocument {
    const normalized = normalizeSourcePath(path);
    const previous = this.#documents.get(normalized)?.document ?? this.open(path);
    const absolute = this.sourcePath(normalized);
    const raw = readFileSync(absolute, "utf8");
    const document = createSourceDocument(normalized, raw, {
      version: previous.version + 1,
    });
    this.#history(normalized).commit(document);
    return document;
  }

  check(): { readonly valid: boolean; readonly diagnostics: readonly StudioDiagnostic[] } {
    const result = compileProject({
      projectRoot: this.projectRoot,
      sourceOverrides: this.overrides(),
    });
    return {
      valid: result.ok,
      diagnostics: serializeDiagnostics(result.diagnostics, this.projectRoot),
    };
  }

  outline(path: string): OutlinePayload | null {
    const document = this.open(path);
    const kind = this.documentKind(document.path);
    const result = buildOutline(document.path, document.text, kind);
    return result.outline === null ? null : outlinePayload(result.outline);
  }

  inspect(
    path: string,
    target: { readonly targetId?: string | undefined; readonly offset?: number | undefined },
  ): InspectorPayload {
    const document = this.open(path);
    const kind = this.documentKind(document.path);
    const outline = buildOutline(document.path, document.text, kind).outline;

    let node: OutlineNode | null = null;
    if (target.targetId !== undefined) {
      node = findOutlineNode(outline, target.targetId);
    } else if (target.offset !== undefined) {
      node = outlineNodeAt(outline, target.offset);
    } else {
      throw new StudioRequestError(
        400,
        "missing-target",
        "inspect requires targetId or offset",
      );
    }

    if (node === null || node.type !== "element") {
      throw new StudioRequestError(
        404,
        "target-not-found",
        "the selected element is not present in the current source",
      );
    }

    const parsed = parseEditorDocument(document, kind);
    const element = findElementByOffset(parsed, node.nameSpan.start.offset);
    if (element === null) {
      throw new StudioRequestError(
        404,
        "target-not-found",
        "the selected element is not present in the current source",
      );
    }

    let text: string | null = null;
    let background: BackgroundValue | null = null;
    let border: BorderValue | null = null;
    let corners: CornersValue | null = null;

    for (const statement of element.statements) {
      if (statement.type === "text" && text === null) {
        text = statement.value;
      } else if (statement.type === "background" && background === null) {
        background =
          statement.mode === "solid"
            ? { mode: "solid", color: statement.color.raw }
            : statement.mode === "none"
              ? { mode: "none" }
              : {
                  mode: "gradient",
                  from: statement.from.raw,
                  to: statement.to.raw,
                  conjunction: statement.conjunction,
                };
      } else if (statement.type === "border" && border === null) {
        border =
          statement.mode === "none"
            ? { mode: "none" }
            : {
                mode: "solid",
                color: statement.color.raw,
                width: lengthText(statement.width),
              };
      } else if (statement.type === "corners" && corners === null) {
        corners =
          statement.mode === "custom"
            ? { mode: "custom", radius: lengthText(statement.radius) }
            : { mode: statement.mode };
      }
    }

    return {
      targetId: node.id,
      name: node.name,
      kind: node.kind,
      text,
      background,
      border,
      corners,
      span: spanPayload(node.span),
      nameSpan: spanPayload(node.nameSpan),
    };
  }

  setProperty(
    path: string,
    targetId: string,
    request: PropertyRequest,
  ): ProjectPropertyResult {
    const document = this.open(path);
    const documentKind = this.documentKind(document.path);
    const history = this.#history(document.path);
    const options = {
      document,
      documentKind,
      targetId,
      projectRoot: this.projectRoot,
      sourceOverrides: this.overrides(),
    };

    let result;
    switch (request.property) {
      case "text":
        result = setValidatedElementText({ ...options, value: request.value });
        break;
      case "background": {
        const background = setValidatedElementBackground({
          ...options,
          background: request.value,
        });
        if (
          !background.ok &&
          background.error?.code === "background-not-found"
        ) {
          const statement = backgroundStatement(request.value);
          if (statement === null) {
            return {
              ok: false,
              document,
              error: {
                code: "invalid-background",
                message: "the background value is invalid",
              },
              diagnostics: [],
            };
          }
          const inserted = insertSourceStatement({
            document,
            documentKind,
            targetId,
            statement,
            placement: "before-children",
          });
          if (!inserted.ok) {
            return {
              ok: false,
              document,
              error: inserted.error,
              diagnostics: [],
            };
          }
          const validated = applyValidatedSourceEdit({
            projectRoot: this.projectRoot,
            document,
            request: inserted.request,
            sourceOverrides: this.overrides(),
          });
          if (!validated.ok) {
            return {
              ok: false,
              document,
              error: null,
              diagnostics: validated.diagnostics,
            };
          }
          history.commit(validated.document);
          return {
            ok: true,
            document: validated.document,
            diagnostics: validated.diagnostics,
          };
        }
        result = background;
        break;
      }
      case "border":
        result = setValidatedElementBorder({ ...options, border: request.value });
        break;
      case "corners":
        result = setValidatedElementCorners({
          ...options,
          corners: request.value,
        });
        break;
    }

    if (!result.ok) {
      return {
        ok: false,
        document,
        error: result.error,
        diagnostics: result.diagnostics,
      };
    }

    history.commit(result.document);
    return {
      ok: true,
      document: result.document,
      diagnostics: result.diagnostics,
    };
  }

  setStyle(
    path: string,
    targetId: string,
    request: StyleRequest,
  ): ProjectStyleResult {
    const document = this.open(path);
    const documentKind = this.documentKind(document.path);
    const history = this.#history(document.path);
    const outline = buildOutline(
      document.path,
      document.text,
      documentKind,
    ).outline;
    const node = findOutlineNode(outline, targetId);
    if (node === null || node.type !== "element") {
      return layerFailure(
        document,
        "target-not-found",
        "the selected element is not present in the current source",
      );
    }

    const parsed = parseEditorDocument(document, documentKind);
    const element = findElementByOffset(parsed, node.nameSpan.start.offset);
    if (element === null) {
      return layerFailure(
        document,
        "target-not-found",
        "the selected element is not present in the current source",
      );
    }

    const statement = request.statement?.trim() ?? null;
    if (
      statement !== null &&
      (statement.length === 0 || /[\r\n{}]/.test(statement))
    ) {
      return layerFailure(
        document,
        "invalid-statement",
        "a style statement must be a single non-empty line",
      );
    }

    const matches = element.statements.filter((candidate) =>
      matchesStyleSelector(candidate, request.selector),
    );

    let edit: SourceEditRequest | null = null;
    if (matches.length > 0) {
      edit = statementReplacementEdit(document, matches, statement);
    } else if (statement !== null) {
      const inserted = insertSourceStatement({
        document,
        documentKind,
        targetId,
        statement,
        placement: "before-children",
      });
      if (!inserted.ok) {
        return layerFailure(document, inserted.error.code, inserted.error.message);
      }
      edit = inserted.request;
    }

    if (edit === null) {
      return { ok: true, document, diagnostics: [] };
    }

    const validated = applyValidatedSourceEdit({
      projectRoot: this.projectRoot,
      document,
      request: edit,
      sourceOverrides: this.overrides(),
    });
    if (!validated.ok) {
      return layerFailure(
        document,
        null,
        "the style change does not compile",
        validated.diagnostics,
      );
    }

    history.commit(validated.document);
    return {
      ok: true,
      document: validated.document,
      diagnostics: validated.diagnostics,
    };
  }

  changeLayer(request: LayerRequestBody): ProjectLayerResult {
    const document = this.open(request.path);
    const documentKind = this.documentKind(document.path);
    const history = this.#history(document.path);
    const outline = buildOutline(
      document.path,
      document.text,
      documentKind,
    ).outline;
    if (outline === null) {
      return layerFailure(
        document,
        "outline-unavailable",
        "the source has no page or component outline",
      );
    }

    if (request.action === "add") {
      const name = uniqueLayerName(outline, LAYER_NAME_BASE[request.kind]);
      const inserted = insertSourceStatement({
        document,
        documentKind,
        targetId: request.targetId,
        statement: layerStatement(request.kind, name, request.text),
      });
      if (!inserted.ok) {
        return layerFailure(document, inserted.error.code, inserted.error.message);
      }

      const validated = applyValidatedSourceEdit({
        projectRoot: this.projectRoot,
        document,
        request: inserted.request,
        sourceOverrides: this.overrides(),
      });
      if (!validated.ok) {
        return layerFailure(
          document,
          null,
          "the new layer does not compile",
          validated.diagnostics,
        );
      }

      history.commit(validated.document);
      const nextOutline = buildOutline(
        validated.document.path,
        validated.document.text,
        documentKind,
      ).outline;
      const added = findOutlineByName(nextOutline, name);
      return {
        ok: true,
        document: validated.document,
        outline: nextOutline === null ? null : outlinePayload(nextOutline),
        selectedId: added?.id ?? null,
        message: `Added ${name}.`,
        diagnostics: validated.diagnostics,
      };
    }

    const target = findOutlineNode(outline, request.targetId);
    if (target === null) {
      return layerFailure(
        document,
        "target-not-found",
        `layer '${request.targetId}' was not found`,
      );
    }
    if (target.type !== "element") {
      return layerFailure(
        document,
        "not-a-layer",
        "only element layers can be moved or deleted",
      );
    }

    if (request.action === "reorder") {
      const destination = findOutlineNode(outline, request.destinationId);
      if (destination === null) {
        return layerFailure(
          document,
          "destination-not-found",
          `destination layer '${request.destinationId}' was not found`,
        );
      }
      if (
        target.id === destination.id ||
        outlineContainsId(target, destination.id)
      ) {
        return layerFailure(
          document,
          "invalid-destination",
          "a layer cannot be moved relative to itself or one of its descendants",
        );
      }
      if (request.position === "inside") {
        if (!isContainerOutline(destination)) {
          return layerFailure(
            document,
            "not-a-container",
            `layer '${destination.name}' cannot contain children`,
          );
        }
      } else if (destination.type !== "element") {
        return layerFailure(
          document,
          "invalid-destination",
          "a layer can only be placed before or after an element layer",
        );
      }

      const text = document.text;
      const targetStart = lineStart(text, target.span.start.offset);
      const targetEnd = lineEnd(text, target.span.end.offset);
      const targetIndent = leadingIndent(text, target.span.start.offset);
      const destinationIndent = leadingIndent(
        text,
        destination.span.start.offset,
      );
      const firstChild = destination.children[0];
      const childIndent =
        firstChild === undefined
          ? `${destinationIndent}    `
          : leadingIndent(text, firstChild.span.start.offset);
      const newIndent =
        request.position === "inside" ? childIndent : destinationIndent;
      const insertionOriginal =
        request.position === "inside"
          ? lineStart(text, destination.span.end.offset)
          : request.position === "before"
            ? lineStart(text, destination.span.start.offset)
            : lineEnd(text, destination.span.end.offset);

      let movedBlock = reindentBlock(
        text.slice(targetStart, targetEnd),
        targetIndent,
        newIndent,
      );
      if (!movedBlock.endsWith("\n")) movedBlock += "\n";

      const blockLength = targetEnd - targetStart;
      const withoutTarget =
        text.slice(0, targetStart) + text.slice(targetEnd);
      let insertion = insertionOriginal;
      if (insertion >= targetEnd) insertion -= blockLength;
      else if (insertion > targetStart) insertion = targetStart;
      const nextText =
        withoutTarget.slice(0, insertion) +
        movedBlock +
        withoutTarget.slice(insertion);

      const validated = applyValidatedSourceEdit({
        projectRoot: this.projectRoot,
        document,
        request: {
          path: document.path,
          baseVersion: document.version,
          from: 0,
          to: text.length,
          originalText: text,
          replacementText: nextText,
          intent: "manual",
        },
        sourceOverrides: this.overrides(),
      });
      if (!validated.ok) {
        return layerFailure(
          document,
          null,
          "the reordered layers do not compile",
          validated.diagnostics,
        );
      }

      history.commit(validated.document);
      const nextOutline = buildOutline(
        validated.document.path,
        validated.document.text,
        documentKind,
      ).outline;
      const moved = findOutlineByName(nextOutline, target.name);
      return {
        ok: true,
        document: validated.document,
        outline: nextOutline === null ? null : outlinePayload(nextOutline),
        selectedId: moved?.id ?? null,
        message:
          request.position === "inside"
            ? `Moved ${target.name} inside ${destination.name}.`
            : `Moved ${target.name} ${request.position} ${destination.name}.`,
        diagnostics: validated.diagnostics,
      };
    }

    if (request.action === "move") {
      const parent = findOutlineParent(outline, target.id);
      const siblings = parent === null ? [] : parent.children;
      const index = siblings.findIndex((sibling) => sibling.id === target.id);
      const neighborIndex = request.direction === "up" ? index - 1 : index + 1;
      const neighbor = siblings[neighborIndex];
      if (index < 0 || neighbor === undefined) {
        return layerFailure(
          document,
          "no-neighbor",
          `layer '${target.name}' cannot move ${request.direction}`,
        );
      }

      const text = document.text;
      const upper = request.direction === "up" ? neighbor : target;
      const lower = request.direction === "up" ? target : neighbor;
      const upperStart = lineStart(text, upper.span.start.offset);
      const upperEnd = lineEnd(text, upper.span.end.offset);
      const lowerStart = lineStart(text, lower.span.start.offset);
      const lowerEnd = lineEnd(text, lower.span.end.offset);
      const from = upperStart;
      const to = lowerEnd;
      const replacement =
        text.slice(lowerStart, lowerEnd) +
        text.slice(upperEnd, lowerStart) +
        text.slice(upperStart, upperEnd);

      const validated = applyValidatedSourceEdit({
        projectRoot: this.projectRoot,
        document,
        request: {
          path: document.path,
          baseVersion: document.version,
          from,
          to,
          originalText: text.slice(from, to),
          replacementText: replacement,
          intent: "manual",
        },
        sourceOverrides: this.overrides(),
      });
      if (!validated.ok) {
        return layerFailure(
          document,
          null,
          "the reordered layers do not compile",
          validated.diagnostics,
        );
      }

      history.commit(validated.document);
      const nextOutline = buildOutline(
        validated.document.path,
        validated.document.text,
        documentKind,
      ).outline;
      return {
        ok: true,
        document: validated.document,
        outline: nextOutline === null ? null : outlinePayload(nextOutline),
        selectedId: target.id,
        message: `Moved ${target.name} ${request.direction}.`,
        diagnostics: validated.diagnostics,
      };
    }

    const text = document.text;
    const from = lineStart(text, target.span.start.offset);
    const to = lineEnd(text, target.span.end.offset);
    const validated = applyValidatedSourceEdit({
      projectRoot: this.projectRoot,
      document,
      request: {
        path: document.path,
        baseVersion: document.version,
        from,
        to,
        originalText: text.slice(from, to),
        replacementText: "",
        intent: "manual",
      },
      sourceOverrides: this.overrides(),
    });
    if (!validated.ok) {
      return layerFailure(
        document,
        null,
        "the layer cannot be deleted without breaking the project",
        validated.diagnostics,
      );
    }

    history.commit(validated.document);
    const nextOutline = buildOutline(
      validated.document.path,
      validated.document.text,
      documentKind,
    ).outline;
    return {
      ok: true,
      document: validated.document,
      outline: nextOutline === null ? null : outlinePayload(nextOutline),
      selectedId: null,
      message: `Deleted ${target.name}.`,
      diagnostics: validated.diagnostics,
    };
  }

  #history(path: string): SourceHistory {
    const history = this.#documents.get(path);
    if (history === undefined) {
      throw new StudioRequestError(
        400,
        "document-not-open",
        `source file '${path}' is not open`,
      );
    }
    return history;
  }

  #sourcePath(path: string): string {
    const absolute = resolve(this.projectRoot, path);
    if (!isInside(this.projectRoot, absolute)) {
      throw new StudioRequestError(
        403,
        "path-outside-project",
        `'${path}' resolves outside the project root`,
      );
    }

    let stats;
    try {
      stats = lstatSync(absolute);
    } catch {
      throw new StudioRequestError(
        404,
        "not-found",
        `source file '${path}' does not exist`,
      );
    }
    if (!stats.isFile()) {
      throw new StudioRequestError(
        403,
        "invalid-path",
        `'${path}' is not a regular source file`,
      );
    }

    const real = realpathSync(absolute);
    if (!isInside(this.#realRoot, real)) {
      throw new StudioRequestError(
        403,
        "path-outside-project",
        `'${path}' escapes the project root through a symbolic link`,
      );
    }
    return absolute;
  }

  /** Validate a path without opening it, used by save-oriented tests. */
  sourcePath(path: string): string {
    return this.#sourcePath(normalizeSourcePath(path));
  }
}

const LAYER_NAME_BASE: Readonly<Record<LayerKind, string>> = {
  container: "newContainer",
  heading: "newHeading",
  paragraph: "newParagraph",
  button: "newButton",
  card: "newCard",
};

const LAYER_CONTAINER_KINDS: ReadonlySet<string> = new Set([
  "container",
  "card",
  "navigation bar",
  "slot",
]);

function backgroundStatement(input: BackgroundInput): string | null {
  if (input.mode === "none") return "has no background";
  if (input.mode === "solid") {
    return `has a ${input.color.trim()} background`;
  }
  if (input.mode === "gradient") {
    return `has a ${input.from.trim()} ${input.conjunction ?? "and"} ${input.to.trim()} gradient`;
  }
  return null;
}

function layerStatement(
  kind: LayerKind,
  name: string,
  text?: string,
): string {
  const label = text?.trim();
  switch (kind) {
    case "container":
      return `${name} {\n    a container\n}`;
    case "heading":
      return `${name} {\n    a section heading\n    the text says ${quoteTextLiteral(label || "New heading")}\n}`;
    case "paragraph":
      return `${name} {\n    a paragraph\n    the text says ${quoteTextLiteral(label || "New paragraph")}\n}`;
    case "button":
      return `${name} {\n    a button\n    the button text says ${quoteTextLiteral(label || "Button")}\n}`;
    case "card":
      return `${name} {\n    a card\n}`;
  }
}

function uniqueLayerName(outline: OutlineNode, base: string): string {
  const names = new Set<string>();
  collectOutlineNames(outline, names);
  let suffix = 1;
  while (names.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

function collectOutlineNames(node: OutlineNode, names: Set<string>): void {
  names.add(node.name);
  for (const child of node.children) collectOutlineNames(child, names);
}

function findOutlineByName(
  outline: OutlineNode | null,
  name: string,
): OutlineNode | null {
  if (outline === null) return null;
  if (outline.name === name) return outline;
  for (const child of outline.children) {
    const found = findOutlineByName(child, name);
    if (found !== null) return found;
  }
  return null;
}

function findOutlineParent(
  root: OutlineNode,
  targetId: string,
): OutlineNode | null {
  for (const child of root.children) {
    if (child.id === targetId) return root;
    const found = findOutlineParent(child, targetId);
    if (found !== null) return found;
  }
  return null;
}

function outlineContainsId(node: OutlineNode, id: string): boolean {
  if (node.id === id) return true;
  return node.children.some((child) => outlineContainsId(child, id));
}

function isContainerOutline(node: OutlineNode): boolean {
  if (node.type !== "element") return true;
  return node.kind !== null && LAYER_CONTAINER_KINDS.has(node.kind);
}

function leadingIndent(text: string, offset: number): string {
  const start = lineStart(text, offset);
  return /^[ \t]*/.exec(text.slice(start, offset))?.[0] ?? "";
}

function reindentBlock(
  block: string,
  oldIndent: string,
  newIndent: string,
): string {
  return block
    .split("\n")
    .map((line, index, lines) => {
      if (index === lines.length - 1 && line === "") return "";
      if (line.trim() === "") return line;
      const content = line.startsWith(oldIndent)
        ? line.slice(oldIndent.length)
        : line.trimStart();
      return `${newIndent}${content}`;
    })
    .join("\n");
}

function statementReplacementEdit(
  document: SourceDocument,
  matches: readonly StatementNode[],
  statement: string | null,
): SourceEditRequest | null {
  const text = document.text;
  const ranges = matches
    .map((match) => ({
      from: lineStart(text, match.span.start.offset),
      to: lineEnd(text, match.span.end.offset),
      indent: leadingIndent(text, match.span.start.offset),
    }))
    .sort((a, b) => a.from - b.from);
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (first === undefined || last === undefined) return null;

  let replacement = "";
  let cursor = first.from;
  let inserted = false;
  for (const range of ranges) {
    replacement += text.slice(cursor, range.from);
    if (statement !== null && !inserted) {
      replacement += `${range.indent}${statement}\n`;
      inserted = true;
    }
    cursor = range.to;
  }
  replacement += text.slice(cursor, last.to);

  return {
    path: document.path,
    baseVersion: document.version,
    from: first.from,
    to: last.to,
    originalText: text.slice(first.from, last.to),
    replacementText: replacement,
    intent: "inspector",
  };
}

function matchesStyleSelector(
  statement: StatementNode,
  selector: StyleSelector,
): boolean {
  switch (selector.family) {
    case "typography":
      return (
        statement.type === "typography" &&
        statement.property === selector.key
      );
    case "font-family":
      return statement.type === "font-family";
    case "shadow":
      return statement.type === "shadow";
    case "size":
      return statement.type === "size";
    case "visibility":
      return statement.type === "visibility";
    case "spacing":
      return (
        statement.type === "spacing" &&
        statement.property === selector.key &&
        statement.sides.some((side) => selector.sides.includes(side))
      );
    case "layout":
      if (statement.type !== "layout") return false;
      if (selector.key === "align") {
        return (
          statement.property === "align" &&
          (selector.axis === "both" ||
            statement.axis === "both" ||
            statement.axis === selector.axis)
        );
      }
      return statement.property === selector.key;
    case "hover":
      return (
        statement.type === "hover" &&
        (selector.key === undefined || statement.effect.type === selector.key)
      );
    case "motion":
      return statement.type === "motion";
    case "gradient-direction":
      return statement.type === "gradient-direction";
  }
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function lineEnd(text: string, offset: number): number {
  const end = text.indexOf("\n", offset);
  return end === -1 ? text.length : end + 1;
}

function layerFailure(
  document: SourceDocument,
  code: string | null,
  message: string,
  diagnostics: readonly Diagnostic[] = [],
): ProjectEditFailure {
  return {
    ok: false,
    document,
    error: code === null ? null : { code, message },
    diagnostics,
  };
}

export function documentPayload(
  document: SourceDocument,
  kind: SourceKind,
): SourceDocumentPayload {
  return {
    path: document.path,
    text: document.text,
    version: document.version,
    kind,
    dirty: document.dirty,
    newline: document.newline as NewlineStyle,
    bom: document.bom,
  };
}

export function serializeDiagnostics(
  diagnostics: readonly Diagnostic[],
  projectRoot: string,
): StudioDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    file: projectRelative(diagnostic.span.file, projectRoot),
    from: diagnostic.span.start.offset,
    to: diagnostic.span.end.offset,
    line: diagnostic.span.start.line,
    column: diagnostic.span.start.column,
    ...(diagnostic.hint === undefined ? {} : { hint: diagnostic.hint }),
  }));
}

export function normalizeSourcePath(path: string): string {
  const normalized = normalizeRelative(path);
  if (normalized === null || !normalized.endsWith(".kdm")) {
    throw new StudioRequestError(
      400,
      "invalid-path",
      `'${path}' is not a project-relative .kdm source file`,
    );
  }
  return normalized;
}

function normalizeRelative(path: string): string | null {
  const unified = path.replaceAll("\\", "/");
  if (
    unified === "" ||
    unified.startsWith("/") ||
    /^[A-Za-z]:/.test(unified) ||
    unified.startsWith("~")
  ) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join("/");
}

function outlinePayload(node: OutlineNode): OutlinePayload {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    kind: node.kind,
    span: spanPayload(node.span),
    nameSpan: spanPayload(node.nameSpan),
    children: node.children.map(outlinePayload),
  };
}

function spanPayload(span: {
  readonly start: {
    readonly offset: number;
    readonly line: number;
    readonly column: number;
  };
  readonly end: {
    readonly offset: number;
    readonly line: number;
    readonly column: number;
  };
}): SpanPayload {
  return {
    from: span.start.offset,
    to: span.end.offset,
    line: span.start.line,
    column: span.start.column,
    endLine: span.end.line,
    endColumn: span.end.column,
  };
}

function lengthText(length: {
  readonly value: number;
  readonly unit: "px" | "rem" | null;
}): string {
  return length.unit === null ? "0" : `${length.value}${length.unit}`;
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

function toProjectPath(path: string): string {
  return path.split(sep).join("/");
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

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
