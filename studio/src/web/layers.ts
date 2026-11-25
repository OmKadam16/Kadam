import type { OutlinePayload } from "../shared/protocol.js";

const CONTAINER_KINDS = new Set([
  "container",
  "card",
  "navigation bar",
  "slot",
]);

const KIND_ICONS: Readonly<Record<string, string>> = {
  container: "▢",
  card: "▧",
  "navigation bar": "▤",
  "main heading": "T",
  "section heading": "T",
  "minor heading": "T",
  paragraph: "¶",
  button: "▭",
  link: "↗",
  "text field": "⌨",
  image: "◫",
  divider: "—",
};

export function findLayer(
  outline: OutlinePayload | null,
  id: string,
): OutlinePayload | null {
  if (outline === null) return null;
  if (outline.id === id) return outline;
  for (const child of outline.children) {
    const found = findLayer(child, id);
    if (found !== null) return found;
  }
  return null;
}

export function findLayerByQuery(
  outline: OutlinePayload | null,
  query: string,
): OutlinePayload | null {
  if (outline === null) return null;
  const wanted = normalizeLayerQuery(query);
  if (wanted.length === 0) return null;

  const all: OutlinePayload[] = [];
  collectLayers(outline, all);
  return (
    all.find(
      (node) =>
        normalizeLayerQuery(node.name) === wanted ||
        normalizeLayerQuery(humanizeLayerName(node.name)) === wanted,
    ) ??
    all.find((node) => {
      const name = normalizeLayerQuery(node.name);
      const label = normalizeLayerQuery(humanizeLayerName(node.name));
      return name.includes(wanted) || label.includes(wanted);
    }) ??
    null
  );
}

export function isContainerLayer(node: OutlinePayload): boolean {
  if (node.type !== "element") return true;
  return node.kind !== null && CONTAINER_KINDS.has(node.kind);
}

export function countLayers(outline: OutlinePayload | null): number {
  if (outline === null) return 0;
  let count = 0;
  for (const child of outline.children) {
    count += 1 + countLayers(child);
  }
  return count;
}

export function humanizeLayerName(name: string): string {
  const stripped = name.replace(/\d+$/, "");
  const spaced = stripped
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (spaced.length === 0) return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function layerIcon(kind: string | null): string {
  return kind === null ? "◇" : KIND_ICONS[kind] ?? "◇";
}

export function layerTypeLabel(
  kind: string | null,
  type: OutlinePayload["type"],
): string {
  if (kind !== null) return kind;
  if (type === "page") return "page";
  if (type === "component") return "component";
  if (type === "variant") return "variant";
  return "element";
}

function collectLayers(
  node: OutlinePayload,
  out: OutlinePayload[],
): void {
  out.push(node);
  for (const child of node.children) collectLayers(child, out);
}

function normalizeLayerQuery(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(?:the|layer|element|selected)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}
