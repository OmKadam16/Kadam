import { useEffect, useState } from "react";
import type {
  BackgroundValue,
  BorderValue,
  CornersValue,
  InspectorPayload,
  PropertyValue,
} from "../../shared/protocol.js";

type EditableProperty = "text" | "background" | "border" | "corners";

interface InspectorProps {
  readonly element: InspectorPayload | null;
  readonly busy: boolean;
  readonly onApply: (property: EditableProperty, value: PropertyValue) => void;
  readonly onClear: () => void;
}

export function Inspector({
  element,
  busy,
  onApply,
  onClear,
}: InspectorProps) {
  const [text, setText] = useState("");
  const [backgroundMode, setBackgroundMode] =
    useState<"solid" | "none" | "gradient">("solid");
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [gradientFrom, setGradientFrom] = useState("#ffffff");
  const [gradientTo, setGradientTo] = useState("#000000");
  const [gradientConjunction, setGradientConjunction] =
    useState<"and" | "to">("and");
  const [borderMode, setBorderMode] = useState<"none" | "solid">("solid");
  const [borderColor, setBorderColor] = useState("#d4d4d4");
  const [borderWidth, setBorderWidth] = useState("1px");
  const [cornersMode, setCornersMode] =
    useState<"default" | "full" | "custom">("default");
  const [cornerRadius, setCornerRadius] = useState("8px");

  useEffect(() => {
    if (element === null) return;
    setText(element.text ?? "");

    if (element.background !== null) {
      setBackgroundMode(element.background.mode);
      if (element.background.mode === "solid") {
        setBackgroundColor(element.background.color);
      } else if (element.background.mode === "gradient") {
        setGradientFrom(element.background.from);
        setGradientTo(element.background.to);
        setGradientConjunction(element.background.conjunction);
      }
    }

    if (element.border !== null) {
      setBorderMode(element.border.mode);
      if (element.border.mode === "solid") {
        setBorderColor(element.border.color);
        setBorderWidth(element.border.width);
      }
    }

    if (element.corners !== null) {
      setCornersMode(element.corners.mode);
      if (element.corners.mode === "custom") {
        setCornerRadius(element.corners.radius);
      }
    }
  }, [element]);

  return (
    <section className="inspector">
      <header className="panel-header">
        <h2>Inspector</h2>
        {element === null ? null : (
          <button
            type="button"
            className="icon-button"
            onClick={onClear}
            title="Clear selection"
          >
            ×
          </button>
        )}
      </header>

      {element === null ? (
        <div className="inspector-empty">
          <p>Select an element in the preview to edit its source.</p>
          <p className="hint">
            Clicks select elements while the preview is in Select mode.
          </p>
        </div>
      ) : (
        <div className="inspector-body">
          <div className="element-summary">
            <div>
              <h3>{element.name}</h3>
              <p>
                {element.kind ?? "element"} · {element.targetId}
              </p>
            </div>
            <span className="element-lines">
              line {element.span.line}
            </span>
          </div>

          <form
            className="inspector-section"
            onSubmit={(event) => {
              event.preventDefault();
              onApply("text", text);
            }}
          >
            <div className="section-title">
              <h4>Text</h4>
              {element.text === null ? (
                <span className="section-note">no text statement</span>
              ) : null}
            </div>
            <input
              aria-label="Element text"
              value={text}
              disabled={busy || element.text === null}
              onChange={(event) => setText(event.target.value)}
              placeholder="Visible text"
            />
            <button
              type="submit"
              className="button small"
              disabled={busy || element.text === null}
            >
              Apply text
            </button>
          </form>

          <div className="inspector-section">
            <div className="section-title">
              <h4>Background</h4>
              {element.background === null ? (
                <span className="section-note">will be inserted</span>
              ) : null}
            </div>
            <form
              className="control-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  let value: BackgroundValue;
                  if (backgroundMode === "none") {
                    value = { mode: "none" };
                  } else if (backgroundMode === "solid") {
                    value = { mode: "solid", color: backgroundColor.trim() };
                  } else {
                    value = {
                      mode: "gradient",
                      from: gradientFrom.trim(),
                      to: gradientTo.trim(),
                      conjunction: gradientConjunction,
                    };
                  }
                  onApply("background", value);
                }}
              >
                <label>
                  <span>Mode</span>
                  <select
                    value={backgroundMode}
                    disabled={busy}
                    onChange={(event) =>
                      setBackgroundMode(
                        event.target.value as "solid" | "none" | "gradient",
                      )
                    }
                  >
                    <option value="solid">solid</option>
                    <option value="none">none</option>
                    <option value="gradient">gradient</option>
                  </select>
                </label>
                {backgroundMode === "solid" ? (
                  <label>
                    <span>Color</span>
                    <input
                      value={backgroundColor}
                      disabled={busy}
                      onChange={(event) => setBackgroundColor(event.target.value)}
                      placeholder="#2563EB"
                    />
                  </label>
                ) : null}
                {backgroundMode === "gradient" ? (
                  <>
                    <label>
                      <span>From</span>
                      <input
                        value={gradientFrom}
                        disabled={busy}
                        onChange={(event) => setGradientFrom(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>To</span>
                      <input
                        value={gradientTo}
                        disabled={busy}
                        onChange={(event) => setGradientTo(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Join</span>
                      <select
                        value={gradientConjunction}
                        disabled={busy}
                        onChange={(event) =>
                          setGradientConjunction(
                            event.target.value as "and" | "to",
                          )
                        }
                      >
                        <option value="and">and</option>
                        <option value="to">to</option>
                      </select>
                    </label>
                  </>
                ) : null}
                <button type="submit" className="button small" disabled={busy}>
                  Apply background
                </button>
            </form>
          </div>

          <form
            className="inspector-section"
            onSubmit={(event) => {
              event.preventDefault();
              const value: BorderValue =
                borderMode === "none"
                  ? { mode: "none" }
                  : {
                      mode: "solid",
                      color: borderColor.trim(),
                      width: borderWidth.trim(),
                    };
              onApply("border", value);
            }}
          >
            <div className="section-title">
              <h4>Border</h4>
              {element.border === null ? (
                <span className="section-note">will be inserted</span>
              ) : null}
            </div>
            <div className="control-grid">
              <label>
                <span>Mode</span>
                <select
                  value={borderMode}
                  disabled={busy}
                  onChange={(event) =>
                    setBorderMode(event.target.value as "none" | "solid")
                  }
                >
                  <option value="solid">solid</option>
                  <option value="none">none</option>
                </select>
              </label>
              {borderMode === "solid" ? (
                <>
                  <label>
                    <span>Color</span>
                    <input
                      value={borderColor}
                      disabled={busy}
                      onChange={(event) => setBorderColor(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Width</span>
                    <input
                      value={borderWidth}
                      disabled={busy}
                      onChange={(event) => setBorderWidth(event.target.value)}
                      placeholder="1px"
                    />
                  </label>
                </>
              ) : null}
              <button type="submit" className="button small" disabled={busy}>
                Apply border
              </button>
            </div>
          </form>

          <form
            className="inspector-section"
            onSubmit={(event) => {
              event.preventDefault();
              let value: CornersValue;
              if (cornersMode === "custom") {
                value = { mode: "custom", radius: cornerRadius.trim() };
              } else {
                value = { mode: cornersMode };
              }
              onApply("corners", value);
            }}
          >
            <div className="section-title">
              <h4>Corners</h4>
              {element.corners === null ? (
                <span className="section-note">will be inserted</span>
              ) : null}
            </div>
            <div className="control-grid">
              <label>
                <span>Mode</span>
                <select
                  value={cornersMode}
                  disabled={busy}
                  onChange={(event) =>
                    setCornersMode(
                      event.target.value as "default" | "full" | "custom",
                    )
                  }
                >
                  <option value="default">default</option>
                  <option value="full">full</option>
                  <option value="custom">custom</option>
                </select>
              </label>
              {cornersMode === "custom" ? (
                <label>
                  <span>Radius</span>
                  <input
                    value={cornerRadius}
                    disabled={busy}
                    onChange={(event) => setCornerRadius(event.target.value)}
                    placeholder="8px"
                  />
                </label>
              ) : null}
              <button type="submit" className="button small" disabled={busy}>
                Apply corners
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
