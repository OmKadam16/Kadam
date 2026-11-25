import { useState, type DragEvent as ReactDragEvent } from "react";
import type {
  LayerDirection,
  LayerDropPosition,
  LayerKind,
  OutlinePayload,
} from "../../shared/protocol.js";
import {
  countLayers,
  humanizeLayerName,
  isContainerLayer,
  layerIcon,
  layerTypeLabel,
} from "../layers.js";

interface LayersPanelProps {
  readonly outline: OutlinePayload | null;
  readonly selectedNodeId: string | null;
  readonly addTargetName: string | null;
  readonly busy: boolean;
  readonly onSelect: (node: OutlinePayload) => void;
  readonly onAdd: (kind: LayerKind) => void;
  readonly onMove: (node: OutlinePayload, direction: LayerDirection) => void;
  readonly onReorder: (
    targetId: string,
    destinationId: string,
    position: LayerDropPosition,
  ) => void;
  readonly onDelete: (node: OutlinePayload) => void;
}

interface DropTarget {
  readonly id: string;
  readonly position: LayerDropPosition;
}

const ADD_KINDS: readonly { readonly value: LayerKind; readonly label: string }[] = [
  { value: "container", label: "Container" },
  { value: "heading", label: "Heading" },
  { value: "paragraph", label: "Paragraph" },
  { value: "button", label: "Button" },
  { value: "card", label: "Card" },
];

export function LayersPanel({
  outline,
  selectedNodeId,
  addTargetName,
  busy,
  onSelect,
  onAdd,
  onMove,
  onReorder,
  onDelete,
}: LayersPanelProps) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<LayerKind>("container");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const beginDrag = (
    node: OutlinePayload,
    event: ReactDragEvent<HTMLDivElement>,
  ): void => {
    if (node.type !== "element" || busy) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.id);
    setDraggingId(node.id);
    setDropTarget(null);
  };

  const hoverRow = (
    node: OutlinePayload,
    event: ReactDragEvent<HTMLDivElement>,
  ): void => {
    if (draggingId === null || draggingId === node.id) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ id: node.id, position: dropPosition(node, event) });
  };

  const leaveRow = (
    node: OutlinePayload,
    event: ReactDragEvent<HTMLDivElement>,
  ): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDropTarget((current) => (current?.id === node.id ? null : current));
  };

  const dropRow = (
    node: OutlinePayload,
    event: ReactDragEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    const targetId =
      event.dataTransfer.getData("text/plain") || draggingId;
    const position = dropTarget?.id === node.id
      ? dropTarget.position
      : dropPosition(node, event);
    setDraggingId(null);
    setDropTarget(null);
    if (targetId === null || targetId === node.id) return;
    onReorder(targetId, node.id, position);
  };

  const clearDrag = (): void => {
    setDraggingId(null);
    setDropTarget(null);
  };

  return (
    <section className="panel layers-panel">
      <header className="panel-header layers-header">
        <h2>Layers</h2>
        <span className="count">{countLayers(outline)}</span>
        <button
          type="button"
          className="icon-button layer-add-toggle"
          aria-label="Add layer"
          aria-expanded={adding}
          title="Add a layer"
          disabled={outline === null || busy}
          onClick={() => setAdding((open) => !open)}
        >
          {adding ? "×" : "+"}
        </button>
      </header>

      {adding ? (
        <form
          className="layer-add"
          onSubmit={(event) => {
            event.preventDefault();
            onAdd(kind);
            setAdding(false);
          }}
        >
          <label>
            <span>New layer</span>
            <select
              aria-label="New layer type"
              value={kind}
              disabled={busy}
              onChange={(event) => setKind(event.target.value as LayerKind)}
            >
              {ADD_KINDS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="button primary small" disabled={busy}>
            Add
          </button>
          <p>
            Adds inside <strong>{addTargetName ?? "the page"}</strong>.
          </p>
        </form>
      ) : null}

      <div className="panel-scroll layers-scroll">
        {outline === null ? (
          <p className="empty">No page or component layers.</p>
        ) : (
          <ul className="layer-list">
            <LayerRow
              node={outline}
              depth={0}
              siblings={[outline]}
              index={0}
              selectedNodeId={selectedNodeId}
              busy={busy}
              draggingId={draggingId}
              dropTarget={dropTarget}
              onSelect={onSelect}
              onMove={onMove}
              onDelete={onDelete}
              onDragStart={beginDrag}
              onDragOver={hoverRow}
              onDragLeave={leaveRow}
              onDrop={dropRow}
              onDragEnd={clearDrag}
            />
          </ul>
        )}
      </div>
    </section>
  );
}

interface LayerRowProps {
  readonly node: OutlinePayload;
  readonly depth: number;
  readonly siblings: readonly OutlinePayload[];
  readonly index: number;
  readonly selectedNodeId: string | null;
  readonly busy: boolean;
  readonly draggingId: string | null;
  readonly dropTarget: DropTarget | null;
  readonly onSelect: (node: OutlinePayload) => void;
  readonly onMove: (node: OutlinePayload, direction: LayerDirection) => void;
  readonly onDelete: (node: OutlinePayload) => void;
  readonly onDragStart: (
    node: OutlinePayload,
    event: ReactDragEvent<HTMLDivElement>,
  ) => void;
  readonly onDragOver: (
    node: OutlinePayload,
    event: ReactDragEvent<HTMLDivElement>,
  ) => void;
  readonly onDragLeave: (
    node: OutlinePayload,
    event: ReactDragEvent<HTMLDivElement>,
  ) => void;
  readonly onDrop: (
    node: OutlinePayload,
    event: ReactDragEvent<HTMLDivElement>,
  ) => void;
  readonly onDragEnd: () => void;
}

function LayerRow({
  node,
  depth,
  siblings,
  index,
  selectedNodeId,
  busy,
  draggingId,
  dropTarget,
  onSelect,
  onMove,
  onDelete,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: LayerRowProps) {
  const isElement = node.type === "element";
  const isSelected = selectedNodeId === node.id;
  const canMoveUp = index > 0;
  const canMoveDown = index < siblings.length - 1;
  const dropPosition =
    dropTarget?.id === node.id ? dropTarget.position : null;

  return (
    <li>
      <div
        className={`layer-row${isSelected ? " is-selected" : ""}${
          node.type === "page" || node.type === "component" ? " is-root" : ""
        }${draggingId === node.id ? " is-dragging" : ""}${
          dropPosition === null ? "" : ` is-drop-${dropPosition}`
        }`}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
        data-layer-id={node.id}
        draggable={isElement && !busy}
        title={isElement ? "Drag to move this layer" : undefined}
        onDragStart={(event) => onDragStart(node, event)}
        onDragOver={(event) => onDragOver(node, event)}
        onDragLeave={(event) => onDragLeave(node, event)}
        onDrop={(event) => onDrop(node, event)}
        onDragEnd={onDragEnd}
      >
        <button
          type="button"
          className="layer-main"
          onClick={() => onSelect(node)}
          title={`${layerTypeLabel(node.kind, node.type)} · ${node.name}`}
        >
          <span className={`layer-icon${isContainerLayer(node) ? " is-container" : ""}`}>
            {layerIcon(node.kind)}
          </span>
          <span className="layer-name">{humanizeLayerName(node.name)}</span>
          <span className="layer-kind">{layerTypeLabel(node.kind, node.type)}</span>
        </button>

        {isElement ? (
          <div className="layer-actions">
            <button
              type="button"
              aria-label={`Move ${node.name} up`}
              title="Move layer up"
              disabled={busy || !canMoveUp}
              onClick={() => onMove(node, "up")}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${node.name} down`}
              title="Move layer down"
              disabled={busy || !canMoveDown}
              onClick={() => onMove(node, "down")}
            >
              ↓
            </button>
            <button
              type="button"
              className="layer-delete"
              aria-label={`Delete ${node.name}`}
              title="Delete layer"
              disabled={busy}
              onClick={() => onDelete(node)}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>

      {node.children.length === 0 ? null : (
        <ul className="layer-list">
          {node.children.map((child, childIndex) => (
            <LayerRow
              key={child.id}
              node={child}
              depth={depth + 1}
              siblings={node.children}
              index={childIndex}
              selectedNodeId={selectedNodeId}
              busy={busy}
              draggingId={draggingId}
              dropTarget={dropTarget}
              onSelect={onSelect}
              onMove={onMove}
              onDelete={onDelete}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function dropPosition(
  node: OutlinePayload,
  event: ReactDragEvent<HTMLDivElement>,
): LayerDropPosition {
  if (node.type !== "element") return "inside";
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = rect.height === 0
    ? 0.5
    : (event.clientY - rect.top) / rect.height;
  if (isContainerLayer(node) && ratio >= 0.25 && ratio <= 0.75) {
    return "inside";
  }
  return ratio < 0.5 ? "before" : "after";
}
