import type {
  ComponentNode,
  ElementNode,
  KindNode,
  PageNode,
} from "../core/ast/nodes.js";
import type { Diagnostic } from "../core/diagnostics/diagnostic.js";
import { DiagnosticBag } from "../core/diagnostics/diagnostic.js";
import { parseComponentSource } from "../core/parser/component.js";
import { parseSource } from "../core/parser/parser.js";
import { createSourceFile, type Span } from "../core/source/source-file.js";

export type OutlineKind = "page" | "component";

export type OutlineNodeType = "page" | "component" | "variant" | "element";

export interface OutlineNode {
  /** Stable within one outline while the source structure is unchanged. */
  readonly id: string;
  readonly type: OutlineNodeType;
  readonly name: string;
  readonly kind: string | null;
  readonly span: Span;
  readonly nameSpan: Span;
  readonly children: readonly OutlineNode[];
}

export interface OutlineResult {
  readonly outline: OutlineNode | null;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Return the outline path from the root to the deepest node containing the
 * UTF-16 source offset. The offset is exclusive of every node's end span.
 */
export function outlinePathAt(
  outline: OutlineNode | null,
  offset: number,
): readonly OutlineNode[] {
  if (outline === null || !containsOffset(outline, offset)) return [];
  for (const child of outline.children) {
    if (containsOffset(child, offset)) {
      return [outline, ...outlinePathAt(child, offset)];
    }
  }
  return [outline];
}

/** Return the deepest outline node containing the UTF-16 source offset. */
export function outlineNodeAt(
  outline: OutlineNode | null,
  offset: number,
): OutlineNode | null {
  const path = outlinePathAt(outline, offset);
  return path.length === 0 ? null : path[path.length - 1]!;
}

function containsOffset(node: OutlineNode, offset: number): boolean {
  return offset >= node.span.start.offset && offset < node.span.end.offset;
}

/** Find a node by its stable outline ID. */
export function findOutlineNode(
  outline: OutlineNode | null,
  id: string,
): OutlineNode | null {
  if (outline === null) return null;
  if (outline.id === id) return outline;
  for (const child of outline.children) {
    const found = findOutlineNode(child, id);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Build a source outline without touching the filesystem.
 *
 * Outline parsing skips semantic validation: the editor still needs a partial
 * tree while a buffer is incomplete. Parser and size diagnostics are returned
 * alongside the tree.
 */
export function buildOutline(
  path: string,
  text: string,
  kind: OutlineKind,
): OutlineResult {
  const created = createSourceFile(path, text);
  const parsed =
    kind === "component"
      ? parseComponentSource(created.source)
      : parseSource(created.source, {
          validate: false,
          allowComponentKinds: true,
        });

  const diagnostics = new DiagnosticBag();
  diagnostics.addAll(created.diagnostics);
  diagnostics.addAll(parsed.diagnostics);

  const outline =
    kind === "component"
      ? componentOutline(parsed.document.component)
      : pageOutline(parsed.document.page);

  return { outline, diagnostics: diagnostics.sorted() };
}

function pageOutline(page: PageNode | null): OutlineNode | null {
  if (page === null) return null;
  return {
    id: "page",
    type: "page",
    name: page.title,
    kind: null,
    span: page.span,
    nameSpan: page.titleSpan,
    children: elementOutlines(page.elements, ""),
  };
}

function componentOutline(component: ComponentNode | null): OutlineNode | null {
  if (component === null) return null;

  const children: OutlineNode[] = elementOutlines(
    component.elements,
    component.name,
  );
  for (const variant of component.variants) {
    children.push({
      id: `variant:${variant.name}`,
      type: "variant",
      name: variant.name,
      kind: null,
      span: variant.span,
      nameSpan: variant.nameSpan,
      children: elementOutlines(
        variant.elements,
        `${component.name}/variant/${variant.name}`,
      ),
    });
  }

  return {
    id: "component",
    type: "component",
    name: component.name,
    kind: null,
    span: component.span,
    nameSpan: component.nameSpan,
    children,
  };
}

function elementOutlines(
  elements: readonly ElementNode[],
  parentPath: string,
): OutlineNode[] {
  return elements.map((element) => {
    const path =
      parentPath.length === 0 ? element.name : `${parentPath}/${element.name}`;
    return {
      id: `element:${path}`,
      type: "element",
      name: element.name,
      kind: kindLabel(element.kind),
      span: element.span,
      nameSpan: element.nameSpan,
      children: elementOutlines(element.children, path),
    };
  });
}

function kindLabel(kind: KindNode | null): string | null {
  if (kind === null) return null;

  const reference = kind.reference;
  let name: string;
  switch (reference.type) {
    case "builtin-kind":
      name = reference.name;
      break;
    case "component-kind":
      name =
        reference.namespace === null
          ? reference.name
          : `${reference.name} from ${reference.namespace}`;
      break;
    case "slot-kind":
      name = reference.name === null ? "slot" : `${reference.name} slot`;
      break;
    case "unknown-kind":
      name = reference.name;
      break;
  }

  return kind.variant === undefined
    ? name
    : `${name} in the ${kind.variant.name} variant`;
}
