import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  StudioRoute,
  StudioStatus,
} from "../../shared/protocol.js";

export type PreviewMode = "select" | "interact";
export type DeviceId = "desktop" | "tablet" | "mobile";

export const DEVICE_SIZES: Readonly<
  Record<DeviceId, { readonly width: number; readonly height: number; readonly label: string }>
> = {
  desktop: { width: 1440, height: 900, label: "Desktop" },
  tablet: { width: 768, height: 1024, label: "Tablet" },
  mobile: { width: 390, height: 844, label: "Mobile" },
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;

interface PreviewPaneProps {
  readonly src: string;
  readonly route: string;
  readonly routes: readonly StudioRoute[];
  readonly device: DeviceId;
  readonly onDeviceChange: (device: DeviceId) => void;
  readonly onRouteChange: (route: string) => void;
  readonly mode: PreviewMode;
  readonly onModeChange: (mode: PreviewMode) => void;
  readonly selectedNodeId: string | null;
  readonly status: StudioStatus | null;
}

interface SelectionRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function PreviewPane({
  src,
  route,
  routes,
  device,
  onDeviceChange,
  onRouteChange,
  mode,
  onModeChange,
  selectedNodeId,
  status,
}: PreviewPaneProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [nonce, setNonce] = useState(0);
  const [rect, setRect] = useState<SelectionRect | null>(null);
  const [fit, setFit] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const size = DEVICE_SIZES[device];

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      setStageSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Fit is width-fit rather than page-fit: at a realistic desktop width this
  // keeps text legible and lets the stage scroll vertically.
  const fitScale =
    stageSize.width > 0 ? Math.min(stageSize.width / size.width, 1) : 1;
  const scale = fit ? Math.max(MIN_ZOOM, fitScale) : zoom;
  const percent = Math.round(scale * 100);

  const changeZoom = useCallback((next: number) => {
    setFit(false);
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(next.toFixed(2)))));
  }, []);

  const updateOverlay = useCallback(() => {
    const frame = frameRef.current;
    if (frame === null || selectedNodeId === null) {
      setRect(null);
      return;
    }

    let element: Element | null = null;
    try {
      const document = frame.contentDocument;
      if (document === null) {
        setRect(null);
        return;
      }
      element = document.querySelector(
        `[data-kdm-id="${escapeAttribute(selectedNodeId)}"]`,
      );
    } catch {
      setRect(null);
      return;
    }

    if (element === null) {
      setRect(null);
      return;
    }

    // These coordinates are relative to the iframe viewport, which is also
    // the coordinate space of the frame wrapper. The wrapper's transform
    // scales the outline along with the iframe.
    const elementRect = element.getBoundingClientRect();
    setRect({
      left: frame.clientLeft + elementRect.left,
      top: frame.clientTop + elementRect.top,
      width: elementRect.width,
      height: elementRect.height,
    });
  }, [selectedNodeId]);

  useEffect(() => {
    updateOverlay();

    const frame = frameRef.current;
    if (frame === null) return;

    let contentWindow: Window | null = null;
    const bindScroll = (): void => {
      try {
        contentWindow?.removeEventListener("scroll", updateOverlay, true);
        contentWindow = frame.contentWindow;
        contentWindow?.addEventListener("scroll", updateOverlay, true);
      } catch {
        contentWindow = null;
      }
      updateOverlay();
    };

    frame.addEventListener("load", bindScroll);
    bindScroll();
    window.addEventListener("resize", updateOverlay);

    return () => {
      frame.removeEventListener("load", bindScroll);
      try {
        contentWindow?.removeEventListener("scroll", updateOverlay, true);
      } catch {
        // The frame navigated away.
      }
      window.removeEventListener("resize", updateOverlay);
    };
  }, [updateOverlay, device, nonce, src]);

  useEffect(() => {
    const sendMode = (): void => {
      try {
        frameRef.current?.contentWindow?.postMessage(
          { type: "kadam-studio:mode", mode },
          window.location.origin,
        );
      } catch {
        // The frame may still be loading.
      }
    };
    sendMode();
    const frame = frameRef.current;
    frame?.addEventListener("load", sendMode);
    return () => frame?.removeEventListener("load", sendMode);
  }, [mode, src, nonce]);

  return (
    <section className="preview-pane">
      <header className="panel-header preview-header">
        <h2>Preview</h2>
        <span
          className={
            status?.phase === "success"
              ? "preview-state is-ok"
              : "preview-state is-bad"
          }
        >
          {status === null
            ? "starting"
            : status.phase === "success"
              ? `${status.compileMs} ms`
              : "build failed"}
        </span>
      </header>

      <div className="preview-toolbar">
        <select
          aria-label="Preview route"
          value={route}
          onChange={(event) => onRouteChange(event.target.value)}
        >
          {routes.map((item) => (
            <option key={item.route} value={item.route}>
              {item.title} — {item.route}
            </option>
          ))}
          {routes.some((item) => item.route === route) ? null : (
            <option value={route}>{route}</option>
          )}
        </select>
        <select
          aria-label="Preview device"
          value={device}
          onChange={(event) => onDeviceChange(event.target.value as DeviceId)}
        >
          {Object.entries(DEVICE_SIZES).map(([id, value]) => (
            <option key={id} value={id}>
              {value.label}
            </option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="Preview interaction">
          <button
            type="button"
            className={mode === "select" ? "is-active" : ""}
            aria-pressed={mode === "select"}
            onClick={() => onModeChange("select")}
            title="Clicks select elements instead of following links"
          >
            Select
          </button>
          <button
            type="button"
            className={mode === "interact" ? "is-active" : ""}
            aria-pressed={mode === "interact"}
            onClick={() => onModeChange("interact")}
            title="Clicks interact with the preview"
          >
            Interact
          </button>
        </div>
        <div className="zoom-controls" role="group" aria-label="Preview zoom">
          <button
            type="button"
            className="icon-button"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => changeZoom(scale - ZOOM_STEP)}
          >
            −
          </button>
          <span className="zoom-value" aria-live="polite">
            {percent}%
          </span>
          <button
            type="button"
            className="icon-button"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => changeZoom(scale + ZOOM_STEP)}
          >
            +
          </button>
          <button
            type="button"
            className={`zoom-fit${fit ? " is-active" : ""}`}
            title="Fit preview width to the panel"
            aria-pressed={fit}
            onClick={() => setFit(true)}
          >
            Fit
          </button>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Reload preview"
          aria-label="Reload preview"
          onClick={() => setNonce((value) => value + 1)}
        >
          ↻
        </button>
      </div>

      <div className="preview-stage" ref={stageRef}>
        <div
          className="preview-canvas"
          data-preview-scale={scale.toFixed(3)}
          style={{
            width: `${size.width * scale}px`,
            height: `${size.height * scale}px`,
          }}
        >
          <div
            className="preview-frame-wrap"
            style={{
              width: `${size.width}px`,
              height: `${size.height}px`,
              transform: `scale(${scale})`,
            }}
          >
            <iframe
              key={`${src}:${nonce}`}
              ref={frameRef}
              className="preview-frame"
              title="Kadam preview"
              src={src}
              width={size.width}
              height={size.height}
            />
            {rect === null ? null : (
              <div
                className="selection-outline"
                style={{
                  left: `${rect.left}px`,
                  top: `${rect.top}px`,
                  width: `${rect.width}px`,
                  height: `${rect.height}px`,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function escapeAttribute(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
