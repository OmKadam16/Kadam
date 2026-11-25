import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  BootstrapPayload,
  LayerDirection,
  LayerDropPosition,
  LayerKind,
  OutlinePayload,
  PropertyValue,
  SourceDocumentPayload,
  StyleSelector,
  StudioDiagnostic,
  StudioRoute,
  StudioStatus,
} from "../shared/protocol.js";
import { ApiError, api } from "./api.js";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel.js";
import {
  EditorPane,
  type EditorHandle,
  type SourceHighlight,
} from "./components/EditorPane.js";
import { Explorer } from "./components/Explorer.js";
import { Inspector } from "./components/Inspector.js";
import { LayersPanel } from "./components/LayersPanel.js";
import { NaturalLanguageBar } from "./components/NaturalLanguageBar.js";
import {
  PreviewPane,
  type DeviceId,
  type PreviewMode,
} from "./components/PreviewPane.js";
import {
  findLayer,
  findLayerByQuery,
  humanizeLayerName,
  isContainerLayer,
} from "./layers.js";
import { parseNaturalLanguage } from "./natural-language.js";

type EditableProperty = "text" | "background" | "border" | "corners";

type LayerOperation =
  | {
      readonly action: "add";
      readonly targetId: string;
      readonly kind: LayerKind;
      readonly text?: string;
    }
  | {
      readonly action: "move";
      readonly targetId: string;
      readonly direction: LayerDirection;
    }
  | {
      readonly action: "reorder";
      readonly targetId: string;
      readonly destinationId: string;
      readonly position: LayerDropPosition;
    }
  | {
      readonly action: "delete";
      readonly targetId: string;
    };

interface Notice {
  readonly kind: "info" | "success" | "error";
  readonly message: string;
}

interface PendingSelection {
  readonly path: string;
  readonly from: number;
  readonly to: number;
}

interface TextPatch {
  readonly from: number;
  readonly to: number;
  readonly originalText: string;
  readonly replacementText: string;
}

type SaveState = "idle" | "saving";

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [doc, setDoc] = useState<SourceDocumentPayload | null>(null);
  const [outline, setOutline] = useState<OutlinePayload | null>(null);
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<readonly StudioDiagnostic[]>(
    [],
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [inspect, setInspect] = useState<
    import("../shared/protocol.js").InspectorPayload | null
  >(null);
  const [previewRoute, setPreviewRoute] = useState("/");
  const [device, setDevice] = useState<DeviceId>("desktop");
  const [mode, setMode] = useState<PreviewMode>("select");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [unsynced, setUnsynced] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  const [highlight, setHighlight] = useState<SourceHighlight | null>(null);
  const [previewWidth, setPreviewWidth] = useState(initialPreviewWidth);

  const editorRef = useRef<EditorHandle>(null);
  const activePathRef = useRef<string | null>(null);
  const shadowRef = useRef("");
  const versionRef = useRef(1);
  const statusRef = useRef<StudioStatus | null>(null);
  const syncChainRef = useRef<Promise<void>>(Promise.resolve());
  const debounceRef = useRef<number | null>(null);
  const outlineTimerRef = useRef<number | null>(null);
  const editRejectedRef = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "kadam-studio:preview-width",
        String(previewWidth),
      );
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, [previewWidth]);

  useEffect(() => {
    const onResize = (): void => {
      // The preview stacks above the editor below 940px, where its saved
      // column width is not applied. Keep that preference for wider windows.
      if (window.innerWidth <= 940) return;
      setPreviewWidth((width) => Math.min(width, maxPreviewWidth()));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const beginPreviewResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = previewWidth;
      document.body.classList.add("is-resizing-preview-column");

      const onMove = (moveEvent: PointerEvent): void => {
        setPreviewWidth(
          Math.max(
            MIN_PREVIEW_WIDTH,
            Math.min(
              maxPreviewWidth(),
              startWidth + (startX - moveEvent.clientX),
            ),
          ),
        );
      };
      const finish = (): void => {
        document.body.classList.remove("is-resizing-preview-column");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [previewWidth],
  );

  const resizePreviewWithKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? 28 : -28;
      setPreviewWidth((width) =>
        Math.max(
          MIN_PREVIEW_WIDTH,
          Math.min(maxPreviewWidth(), width + delta),
        ),
      );
    },
    [],
  );

  const applyStatus = useCallback((next: StudioStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const refreshCheck = useCallback(async () => {
    try {
      const result = await api.check(activePathRef.current ?? undefined);
      setDiagnostics(result.diagnostics);
    } catch {
      // The next edit or poll reports the actionable error.
    }
  }, []);

  const refreshOutline = useCallback(
    async (path: string): Promise<OutlinePayload | null> => {
      try {
        const result = await api.outline(path);
        if (path === activePathRef.current) setOutline(result.outline);
        return result.outline;
      } catch {
        // An outline is presentation data; do not fail the editor for it.
        return null;
      }
    },
    [],
  );

  const scheduleOutline = useCallback(
    (path: string) => {
      if (outlineTimerRef.current !== null) {
        window.clearTimeout(outlineTimerRef.current);
      }
      outlineTimerRef.current = window.setTimeout(() => {
        outlineTimerRef.current = null;
        void refreshOutline(path);
      }, 350);
    },
    [refreshOutline],
  );

  const syncOnce = useCallback(async (): Promise<void> => {
    const path = activePathRef.current;
    const editor = editorRef.current;
    if (path === null || editor === null) return;

    const text = editor.getText();
    if (text === shadowRef.current) {
      setUnsynced(false);
      return;
    }

    const patch = diffText(shadowRef.current, text);
    if (patch === null) {
      setUnsynced(false);
      return;
    }

    try {
      const result = await api.edit({
        path,
        baseVersion: versionRef.current,
        ...patch,
        intent: "manual",
      });
      if (path !== activePathRef.current) return;

      shadowRef.current = result.document.text;
      versionRef.current = result.document.version;
      editRejectedRef.current = false;
      setRejected(false);
      setDoc(result.document);
      setDiagnostics(result.diagnostics);
      applyStatus(result.status);
      setUnsynced(editor.getText() !== result.document.text);
      scheduleOutline(path);
    } catch (error) {
      if (path !== activePathRef.current) return;
      if (error instanceof ApiError) {
        editRejectedRef.current = true;
        setRejected(true);
        if (error.diagnostics !== undefined) {
          setDiagnostics(error.diagnostics);
        }
        setNotice({
          kind: "error",
          message: `${error.code}: ${error.message}`,
        });
      } else {
        setNotice({ kind: "error", message: errorMessage(error) });
      }
    }
  }, [applyStatus, scheduleOutline]);

  const enqueueSync = useCallback(() => {
    syncChainRef.current = syncChainRef.current
      .then(syncOnce)
      .catch(() => {
        // syncOnce reports its own failures.
      });
  }, [syncOnce]);

  const flushPending = useCallback(async () => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    enqueueSync();
    await syncChainRef.current;
  }, [enqueueSync]);

  const scheduleSync = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      enqueueSync();
    }, 220);
  }, [enqueueSync]);

  const openFile = useCallback(
    async (path: string, routeHint?: string) => {
      await flushPending();
      try {
        const result = await api.file(path);
        activePathRef.current = path;
        shadowRef.current = result.document.text;
        versionRef.current = result.document.version;
        editRejectedRef.current = false;
        setRejected(false);
        setDoc(result.document);
        setUnsynced(false);
        setSelectedNodeId(null);
        setInspect(null);
        setPendingSelection(null);
        setHighlight(null);
        setSaveState("idle");
        if (routeHint !== undefined) {
          setPreviewRoute(
            canonicalRoute(routeHint, statusRef.current?.routes ?? []),
          );
        }
        void refreshOutline(path);
      } catch (error) {
        setNotice({ kind: "error", message: errorMessage(error) });
      }
    },
    [flushPending, refreshOutline],
  );

  const handleSave = useCallback(async () => {
    const path = activePathRef.current;
    if (path === null) return;

    setSaveState("saving");
    await flushPending();
    if (editRejectedRef.current) {
      setSaveState("idle");
      setNotice({
        kind: "error",
        message: "Fix the compiler errors before saving.",
      });
      return;
    }

    try {
      const result = await api.save({ path });
      shadowRef.current = result.document.text;
      versionRef.current = result.document.version;
      setDoc(result.document);
      setUnsynced(false);
      setSaveState("idle");
      applyStatus(result.preview);
      setNotice({
        kind: "success",
        message:
          result.status === "saved" ? "Saved to disk." : "Already saved.",
      });
      void refreshCheck();
    } catch (error) {
      setSaveState("idle");
      if (error instanceof ApiError && error.diskText !== undefined) {
        setNotice({
          kind: "error",
          message: `${error.message} Use Reload to discard this buffer.`,
        });
      } else {
        setNotice({ kind: "error", message: errorMessage(error) });
      }
    }
  }, [applyStatus, flushPending, refreshCheck]);

  const reloadActive = useCallback(async () => {
    const path = activePathRef.current;
    if (path === null) return;

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    await syncChainRef.current;

    try {
      const result = await api.reload({ path });
      activePathRef.current = path;
      shadowRef.current = result.document.text;
      versionRef.current = result.document.version;
      editRejectedRef.current = false;
      setRejected(false);
      setDoc(result.document);
      setUnsynced(false);
      setSelectedNodeId(null);
      setInspect(null);
      setHighlight(null);
      setSaveState("idle");
      editorRef.current?.replaceText(result.document.text);
      applyStatus(result.status);
      setNotice({ kind: "success", message: "Reloaded from disk." });
      void refreshCheck();
      void refreshOutline(path);
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    }
  }, [applyStatus, refreshCheck, refreshOutline]);

  const selectNode = useCallback(
    async (nodeId: string, route: string) => {
      const currentStatus = statusRef.current;
      if (currentStatus === null) return;

      try {
        const map = await api.studioMap(currentStatus.buildId);
        const wantedRoute = routeKey(route);
        const page =
          map.pages.find(
            (candidate) =>
              routeKey(candidate.route) === wantedRoute &&
              candidate.elements.some((element) => element.nodeId === nodeId),
          ) ??
          map.pages.find((candidate) =>
            candidate.elements.some((element) => element.nodeId === nodeId),
          );
        const element = page?.elements.find(
          (candidate) => candidate.nodeId === nodeId,
        );

        if (page === undefined || element === undefined) {
          setNotice({
            kind: "error",
            message: "That element is no longer in the current build.",
          });
          return;
        }

        if (activePathRef.current !== page.sourceFile) {
          await openFile(page.sourceFile, page.route);
        }

        const from = element.span.start.offset;
        const to = element.span.end.offset;
        const nameFrom = element.nameSpan.start.offset;
        const nameTo = element.nameSpan.end.offset;
        if (
          !Number.isFinite(from) ||
          !Number.isFinite(to) ||
          !Number.isFinite(nameFrom) ||
          !Number.isFinite(nameTo)
        ) {
          setNotice({
            kind: "error",
            message: "That element has no usable source span.",
          });
          return;
        }

        setSelectedNodeId(nodeId);
        setPendingSelection({
          path: page.sourceFile,
          from: nameFrom,
          to: nameTo,
        });
        setHighlight({ from, to });

        const inspected = await api.inspect(page.sourceFile, {
          offset: nameFrom,
        });
        setInspect(inspected.element);
      } catch (error) {
        setNotice({ kind: "error", message: errorMessage(error) });
      }
    },
    [openFile],
  );

  const applyProperty = useCallback(
    async (
      property: EditableProperty,
      value: PropertyValue,
    ): Promise<boolean> => {
      const path = activePathRef.current;
      if (path === null || inspect === null) return false;

      setBusy(true);
      try {
        await flushPending();
        if (editRejectedRef.current) {
          setNotice({
            kind: "error",
            message: "Fix the compiler errors before using the inspector.",
          });
          return false;
        }

        const result = await api.property({
          path,
          targetId: inspect.targetId,
          property,
          value,
        });
        shadowRef.current = result.document.text;
        versionRef.current = result.document.version;
        editRejectedRef.current = false;
        setRejected(false);
        setDoc(result.document);
        setInspect(result.element);
        setHighlight({
          from: result.element.span.from,
          to: result.element.span.to,
        });
        setDiagnostics(result.diagnostics);
        applyStatus(result.status);
        setUnsynced(false);
        editorRef.current?.replaceText(result.document.text);
        editorRef.current?.selectRange(
          result.element.nameSpan.from,
          result.element.nameSpan.to,
        );
        setNotice({ kind: "success", message: `Updated ${property}.` });
        void refreshOutline(path);
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.diagnostics !== undefined) {
          setDiagnostics(error.diagnostics);
        }
        setNotice({ kind: "error", message: errorMessage(error) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applyStatus, flushPending, inspect, refreshOutline],
  );

  const applyStyle = useCallback(
    async (
      selector: StyleSelector,
      statement: string | null,
      summary: string,
    ): Promise<boolean> => {
      const path = activePathRef.current;
      if (path === null || inspect === null) return false;

      setBusy(true);
      try {
        await flushPending();
        if (editRejectedRef.current) {
          setNotice({
            kind: "error",
            message: "Fix the compiler errors before editing styles.",
          });
          return false;
        }

        const result = await api.style({
          path,
          targetId: inspect.targetId,
          selector,
          statement,
        });
        shadowRef.current = result.document.text;
        versionRef.current = result.document.version;
        editRejectedRef.current = false;
        setRejected(false);
        setDoc(result.document);
        setInspect(result.element);
        setHighlight({
          from: result.element.span.from,
          to: result.element.span.to,
        });
        setDiagnostics(result.diagnostics);
        applyStatus(result.status);
        setUnsynced(false);
        editorRef.current?.replaceText(result.document.text);
        editorRef.current?.selectRange(
          result.element.nameSpan.from,
          result.element.nameSpan.to,
        );
        setNotice({ kind: "success", message: summary });
        void refreshOutline(path);
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.diagnostics !== undefined) {
          setDiagnostics(error.diagnostics);
        }
        setNotice({ kind: "error", message: errorMessage(error) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applyStatus, flushPending, inspect, refreshOutline],
  );

  const selectLayerNode = useCallback(async (node: OutlinePayload) => {
    const path = activePathRef.current;
    if (path === null) return;

    setSelectedNodeId(node.id);
    setHighlight({ from: node.span.from, to: node.span.to });
    setPendingSelection({
      path,
      from: node.nameSpan.from,
      to: node.nameSpan.to,
    });

    if (node.type !== "element") {
      setInspect(null);
      return;
    }

    try {
      const result = await api.inspect(path, { targetId: node.id });
      setInspect(result.element);
    } catch {
      setInspect(null);
    }
  }, []);

  const applyLayer = useCallback(
    async (operation: LayerOperation): Promise<boolean> => {
      const path = activePathRef.current;
      if (path === null) return false;

      setBusy(true);
      try {
        await flushPending();
        if (editRejectedRef.current) {
          setNotice({
            kind: "error",
            message: "Fix the compiler errors before changing layers.",
          });
          return false;
        }

        const result = await api.layer({ path, ...operation });
        shadowRef.current = result.document.text;
        versionRef.current = result.document.version;
        editRejectedRef.current = false;
        setRejected(false);
        setDoc(result.document);
        setOutline(result.outline);
        setDiagnostics(result.diagnostics);
        applyStatus(result.status);
        setUnsynced(false);
        editorRef.current?.replaceText(result.document.text);

        const selected =
          result.selectedId === null || result.outline === null
            ? null
            : findLayer(result.outline, result.selectedId);
        if (selected !== null) {
          await selectLayerNode(selected);
        } else {
          setSelectedNodeId(null);
          setInspect(null);
          setHighlight(null);
        }

        setNotice({ kind: "success", message: result.message });
        void refreshCheck();
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.diagnostics !== undefined) {
          setDiagnostics(error.diagnostics);
        }
        setNotice({ kind: "error", message: errorMessage(error) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applyStatus, flushPending, refreshCheck, selectLayerNode],
  );

  const runNaturalLanguage = useCallback(
    async (text: string): Promise<boolean> => {
      const parsed = parseNaturalLanguage(text);
      if (!parsed.ok) {
        setNotice({ kind: "error", message: parsed.message });
        return false;
      }

      const action = parsed.action;
      if (action.kind === "property") {
        if (inspect === null) {
          setNotice({
            kind: "error",
            message: "Select an element layer before editing its style.",
          });
          return false;
        }
        return applyProperty(action.property, action.value);
      }

      if (action.kind === "style") {
        if (inspect === null) {
          setNotice({
            kind: "error",
            message: "Select an element layer before editing its style.",
          });
          return false;
        }
        return applyStyle(action.selector, action.statement, action.summary);
      }

      if (action.kind === "select") {
        const node = findLayerByQuery(outline, action.name);
        if (node === null) {
          setNotice({ kind: "error", message: `No layer named “${action.name}”.` });
          return false;
        }
        await selectLayerNode(node);
        setNotice({ kind: "success", message: action.summary });
        return true;
      }

      const selected =
        selectedNodeId === null ? null : findLayer(outline, selectedNodeId);

      if (action.kind === "add") {
        const target =
          selected !== null && isContainerLayer(selected) ? selected : outline;
        if (target === null) {
          setNotice({ kind: "error", message: "There is no page to add to." });
          return false;
        }
        return applyLayer({
          action: "add",
          targetId: target.id,
          kind: action.layerKind,
          ...(action.text === undefined ? {} : { text: action.text }),
        });
      }

      if (selected === null || selected.type !== "element") {
        setNotice({
          kind: "error",
          message: "Select an element layer first.",
        });
        return false;
      }

      if (action.kind === "move") {
        return applyLayer({
          action: "move",
          targetId: selected.id,
          direction: action.direction,
        });
      }

      if (
        !window.confirm(
          `Delete layer “${humanizeLayerName(selected.name)}”?`,
        )
      ) {
        return false;
      }
      return applyLayer({ action: "delete", targetId: selected.id });
    },
    [
      applyLayer,
      applyProperty,
      applyStyle,
      inspect,
      outline,
      selectLayerNode,
      selectedNodeId,
    ],
  );

  const handleEditorChange = useCallback(() => {
    setHighlight(null);
    setUnsynced(true);
    scheduleSync();
  }, [scheduleSync]);

  const openDiagnostic = useCallback(
    async (diagnostic: StudioDiagnostic) => {
      if (diagnostic.file !== activePathRef.current) {
        const entry = bootstrap?.entries.find(
          (candidate) => candidate.path === diagnostic.file,
        );
        await openFile(diagnostic.file, entry?.route);
      }
      setPendingSelection({
        path: diagnostic.file,
        from: diagnostic.from,
        to: diagnostic.to,
      });
    },
    [bootstrap, openFile],
  );

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const result = await api.bootstrap();
        if (cancelled) return;
        setBootstrap(result);
        applyStatus(result.status);
        const first =
          result.entries.find((entry) => entry.kind === "page") ??
          result.entries[0];
        const initialRoute =
          first === undefined
            ? result.status.routes[0]?.route ?? "/"
            : canonicalRoute(
                first.route ?? "/",
                result.status.routes,
              );
        setPreviewRoute(initialRoute);
        if (first === undefined) {
          void refreshCheck();
        } else {
          await openFile(first.path, initialRoute);
        }
      } catch (error) {
        if (!cancelled) setFatalError(errorMessage(error));
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [applyStatus, openFile, refreshCheck]);

  useEffect(() => {
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const next = await api.status();
        if (cancelled) return;
        const previous = statusRef.current;
        if (
          previous === null ||
          previous.buildId !== next.buildId ||
          previous.phase !== next.phase
        ) {
          applyStatus(next);
          setHighlight(null);
          await refreshCheck();
        }
      } catch {
        // The host may be restarting; the next poll retries.
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyStatus, refreshCheck]);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const record = data as Record<string, unknown>;
      if (
        record.type === "kadam-studio:select" &&
        typeof record.nodeId === "string"
      ) {
        void selectNode(
          record.nodeId,
          typeof record.route === "string" ? record.route : "/",
        );
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [selectNode]);

  useEffect(() => {
    if (
      pendingSelection === null ||
      doc?.path !== pendingSelection.path
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      editorRef.current?.selectRange(
        pendingSelection.from,
        pendingSelection.to,
      );
      setPendingSelection(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingSelection, doc?.path]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(
      () => setNotice(null),
      notice.kind === "error" ? 6000 : 3000,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!unsynced) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsynced]);

  if (fatalError !== null) {
    return (
      <div className="fatal">
        <div className="fatal-card">
          <h1>Kadam Studio</h1>
          <p>{fatalError}</p>
          <button
            type="button"
            className="button primary"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const routes = status?.routes ?? [];
  const modified = (doc?.dirty ?? false) || unsynced;
  const previewSource = previewUrl(previewRoute);
  const selectedLayer =
    selectedNodeId === null ? null : findLayer(outline, selectedNodeId);
  const addTarget =
    selectedLayer !== null && isContainerLayer(selectedLayer)
      ? selectedLayer
      : outline;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Kadam <span>Studio</span>
        </div>
        <div className="project-name">
          {bootstrap?.project.name ?? "Loading project…"}
        </div>
        <div className={`build-state ${status?.phase ?? "pending"}`}>
          <span className="status-dot" />
          <span>
            {status === null
              ? "Starting compiler…"
              : status.phase === "success"
                ? `Built in ${status.compileMs} ms · ${status.routes.length} page${
                    status.routes.length === 1 ? "" : "s"
                  }`
                : `Build failed · serving ${status.served}`}
          </span>
        </div>
        <div className="topbar-spacer" />
        {modified ? <span className="modified-badge">Unsaved</span> : null}
        <button
          type="button"
          className="button ghost"
          onClick={() => void reloadActive()}
          disabled={doc === null}
        >
          Reload
        </button>
        <button
          type="button"
          className="button primary"
          onClick={() => void handleSave()}
          disabled={doc === null || saveState === "saving" || rejected}
        >
          {saveState === "saving" ? "Saving…" : "Save"}
        </button>
      </header>

      <div
        className="workspace"
        style={{ "--preview-width": `${previewWidth}px` } as CSSProperties}
      >
        <aside className="left-column">
          <Explorer
            entries={bootstrap?.entries ?? []}
            activePath={doc?.path ?? null}
            onOpen={(path, route) => void openFile(path, route)}
          />
          <LayersPanel
            outline={outline}
            selectedNodeId={selectedNodeId}
            addTargetName={addTarget?.name ?? null}
            busy={busy}
            onSelect={(node) => void selectLayerNode(node)}
            onAdd={(kind) =>
              void applyLayer({
                action: "add",
                targetId: addTarget?.id ?? "page",
                kind,
              })
            }
            onMove={(node, direction) =>
              void applyLayer({
                action: "move",
                targetId: node.id,
                direction,
              })
            }
            onReorder={(targetId, destinationId, position) =>
              void applyLayer({
                action: "reorder",
                targetId,
                destinationId,
                position,
              })
            }
            onDelete={(node) => {
              if (
                window.confirm(
                  `Delete layer “${humanizeLayerName(node.name)}”?`,
                )
              ) {
                void applyLayer({ action: "delete", targetId: node.id });
              }
            }}
          />
        </aside>

        <main className="center-column">
          <div className="editor-header">
            <span className="file-path">{doc?.path ?? "No file open"}</span>
            <span className="editor-meta">
              {doc === null
                ? ""
                : `${doc.kind} · v${doc.version}${modified ? " · modified" : ""}`}
            </span>
          </div>
          {rejected ? (
            <div className="rejected-banner">
              The buffer does not compile. The preview and Save keep the last
              accepted source.
            </div>
          ) : null}
          <div className="editor-region">
            {doc === null ? (
              <div className="empty-state">
                Select a page or component to start editing.
              </div>
            ) : (
              <EditorPane
                key={doc.path}
                ref={editorRef}
                path={doc.path}
                initialText={doc.text}
                diagnostics={diagnostics}
                highlight={highlight}
                onChange={handleEditorChange}
                onSave={() => void handleSave()}
              />
            )}
          </div>
          <DiagnosticsPanel
            diagnostics={diagnostics}
            activePath={doc?.path ?? null}
            onSelect={(diagnostic) => void openDiagnostic(diagnostic)}
          />
        </main>

        <div
          className="preview-column-resizer"
          role="separator"
          aria-label="Resize preview column"
          aria-orientation="vertical"
          tabIndex={0}
          title="Drag to resize the preview"
          onPointerDown={beginPreviewResize}
          onKeyDown={resizePreviewWithKeyboard}
        />

        <aside className="right-column">
          <PreviewPane
            src={previewSource}
            route={previewRoute}
            routes={routes}
            device={device}
            onDeviceChange={setDevice}
            onRouteChange={setPreviewRoute}
            mode={mode}
            onModeChange={setMode}
            selectedNodeId={selectedNodeId}
            status={status}
          />
          <div className="right-sidebar">
            <NaturalLanguageBar
              selectedName={
                selectedLayer === null
                  ? null
                  : humanizeLayerName(selectedLayer.name)
              }
              busy={busy}
              onRun={runNaturalLanguage}
            />
            <Inspector
              element={inspect}
              busy={busy}
              onApply={(property, value) =>
                void applyProperty(property, value)
              }
              onClear={() => {
                setSelectedNodeId(null);
                setInspect(null);
              }}
            />
          </div>
        </aside>
      </div>

      {notice === null ? null : (
        <div className={`toast toast-${notice.kind}`}>
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function diffText(previous: string, next: string): TextPatch | null {
  let start = 0;
  const limit = Math.min(previous.length, next.length);
  while (
    start < limit &&
    previous.charCodeAt(start) === next.charCodeAt(start)
  ) {
    start += 1;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous.charCodeAt(previousEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  if (start === previousEnd && start === nextEnd) return null;
  return {
    from: start,
    to: previousEnd,
    originalText: previous.slice(start, previousEnd),
    replacementText: next.slice(start, nextEnd),
  };
}

const MIN_PREVIEW_WIDTH = 320;

function maxPreviewWidth(): number {
  return Math.max(340, window.innerWidth - 240 - 7 - 360);
}

function initialPreviewWidth(): number {
  if (typeof window === "undefined") return 520;
  const fallback = Math.round(window.innerWidth * 0.4);
  try {
    const saved = Number(
      window.localStorage.getItem("kadam-studio:preview-width"),
    );
    if (Number.isFinite(saved) && saved >= MIN_PREVIEW_WIDTH) {
      return Math.min(
        Math.max(MIN_PREVIEW_WIDTH, saved),
        maxPreviewWidth(),
      );
    }
  } catch {
    // Storage can be unavailable in private browsing.
  }
  return Math.min(
    Math.max(MIN_PREVIEW_WIDTH, fallback),
    maxPreviewWidth(),
  );
}

function canonicalRoute(
  route: string,
  routes: readonly StudioRoute[],
): string {
  const key = routeKey(route);
  return routes.find((item) => routeKey(item.route) === key)?.route ?? route;
}

function routeKey(route: string): string {
  const path = route.split("?")[0] ?? route;
  if (path === "" || path === "/") return "/";
  return `/${path.replace(/^\/+|\/+$/g, "")}/`;
}

function previewUrl(route: string): string {
  if (route === "" || route === "/") return "/__preview/";
  const path = route.startsWith("/") ? route : `/${route}`;
  return `/__preview${path}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
