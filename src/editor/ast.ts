import type { DocumentNode, ElementNode } from "../core/ast/nodes.js";
import { parseComponentSource } from "../core/parser/component.js";
import { parseSource } from "../core/parser/parser.js";
import { createSourceFile } from "../core/source/source-file.js";
import type { SourceDocument } from "./source-document.js";
import type { OutlineKind } from "./outline.js";

/** Parse an editor buffer without project or filesystem access. */
export function parseEditorDocument(
  document: SourceDocument,
  kind: OutlineKind,
): DocumentNode {
  const created = createSourceFile(document.path, document.text);
  return kind === "component"
    ? parseComponentSource(created.source).document
    : parseSource(created.source, {
        validate: false,
        allowComponentKinds: true,
      }).document;
}

/** Find an element by the start offset of its name span. */
export function findElementByOffset(
  document: DocumentNode,
  offset: number,
): ElementNode | null {
  const roots: ElementNode[] = [
    ...(document.page?.elements ?? []),
    ...(document.component?.elements ?? []),
    ...(document.component?.variants.flatMap((variant) => variant.elements) ?? []),
  ];
  return findElementAt(roots, offset);
}

function findElementAt(
  elements: readonly ElementNode[],
  offset: number,
): ElementNode | null {
  for (const element of elements) {
    if (element.nameSpan.start.offset === offset) return element;
    const found = findElementAt(element.children, offset);
    if (found !== null) return found;
  }
  return null;
}
