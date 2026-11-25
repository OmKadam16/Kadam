import type { ElementNode } from "../ast/nodes.js";

/** True when an element is a slot declaration or a slot fill group. */
export function isSlotElement(element: ElementNode): boolean {
  const reference = element.kind?.reference;
  return reference?.type === "slot-kind";
}

/** The slot name, or null for the unnamed slot. */
export function slotName(element: ElementNode): string | null {
  const reference = element.kind?.reference;
  return reference?.type === "slot-kind" ? reference.name : null;
}

/** True when a component body or variant declares any content slot. */
export function containsSlot(elements: readonly ElementNode[]): boolean {
  return collectSlots(elements).total > 0;
}

export interface SlotInfo {
  /** True when the body declares a plain `a slot`. */
  readonly hasUnnamed: boolean;
  /** Named slot declarations, first declaration per name. */
  readonly named: ReadonlyMap<string, ElementNode>;
  readonly total: number;
}

/** Collect slot declarations from a component body or variant. */
export function collectSlots(elements: readonly ElementNode[]): SlotInfo {
  let hasUnnamed = false;
  const named = new Map<string, ElementNode>();

  const walk = (list: readonly ElementNode[]): void => {
    for (const element of list) {
      if (isSlotElement(element)) {
        const name = slotName(element);
        if (name === null) hasUnnamed = true;
        else if (!named.has(name)) named.set(name, element);
      }
      walk(element.children);
    }
  };

  walk(elements);
  return { hasUnnamed, named, total: named.size + (hasUnnamed ? 1 : 0) };
}
