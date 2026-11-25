import type {
  ComponentNode,
  ComponentParameterNode,
  ComponentVariantNode,
  DocumentNode,
  ElementNode,
} from "../ast/nodes.js";
import { DiagnosticBag, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../source/source-file.js";
import type { Span } from "../source/source-file.js";

export const DEFAULT_COMPONENT_VARIANT = "default";

/** Catalog key: the declared name in the project namespace, `ns/Name` in a library. */
export function componentKey(
  namespace: string | null | undefined,
  name: string,
): string {
  return namespace === null || namespace === undefined ? name : `${namespace}/${name}`;
}

export function componentDisplayName(
  namespace: string | null | undefined,
  name: string,
): string {
  return namespace === null || namespace === undefined ? name : `${name} from ${namespace}`;
}

export interface ComponentFile {
  readonly source: SourceFile;
  readonly document: DocumentNode;
  /** Library namespace; omitted or null means the project namespace. */
  readonly namespace?: string | null | undefined;
  readonly diagnostics?: readonly Diagnostic[] | undefined;
}

export interface ComponentUse {
  readonly component: string;
  readonly namespace: string | null;
  /** Resolved catalog key for cycle detection. */
  readonly key: string;
  readonly variant: string | null;
  readonly nameSpan: Span;
  readonly span: Span;
  readonly sourcePath: string;
}

export interface ComponentRecord {
  readonly name: string;
  readonly namespace: string | null;
  readonly key: string;
  readonly node: ComponentNode;
  readonly source: SourceFile;
  readonly parameters: ReadonlyMap<string, ComponentParameterNode>;
  readonly variants: ReadonlyMap<string, ComponentVariantNode>;
  readonly references: readonly ComponentUse[];
}

export interface ComponentCatalog {
  readonly records: ReadonlyMap<string, ComponentRecord>;
  readonly names: readonly string[];
  readonly namespaces: ReadonlySet<string>;
}

export interface ComponentCatalogResult {
  readonly catalog: ComponentCatalog;
  readonly diagnostics: readonly Diagnostic[];
}

/** Build a project-wide component symbol table. Pure and order-independent. */
export function buildComponentCatalog(
  files: readonly ComponentFile[],
): ComponentCatalogResult {
  const diagnostics = new DiagnosticBag();
  const records = new Map<string, ComponentRecord>();

  for (const file of files) {
    diagnostics.addAll(file.diagnostics ?? []);
    const component = file.document.component;
    if (component === null) {
      diagnostics.error(
        "KDM4008",
        "the component manifest entry does not contain a component declaration",
        file.document.span,
        "put exactly one component block in each component file",
      );
      continue;
    }

    const namespace = file.namespace ?? null;
    const key = componentKey(namespace, component.name);
    const previous = records.get(key);
    if (previous !== undefined) {
      diagnostics.error(
        namespace === null ? "KDM3020" : "KDM3035",
        `duplicate component name ${JSON.stringify(componentDisplayName(namespace, component.name))}`,
        component.nameSpan,
        namespace === null
          ? "component names must be unique across the project"
          : `component names must be unique inside namespace ${JSON.stringify(namespace)}`,
        [{ span: previous.node.nameSpan, message: "first declared here" }],
      );
      continue;
    }

    const parameters = new Map<string, ComponentParameterNode>();
    for (const parameter of component.parameters) {
      if (!parameters.has(parameter.name)) parameters.set(parameter.name, parameter);
    }

    const variants = new Map<string, ComponentVariantNode>();
    for (const variant of component.variants) {
      if (!variants.has(variant.name)) variants.set(variant.name, variant);
    }

    const references: ComponentUse[] = [];
    collectReferences(component.elements, file.source.path, references);
    for (const variant of component.variants) {
      collectReferences(variant.elements, file.source.path, references);
    }

    records.set(key, {
      name: component.name,
      namespace,
      key,
      node: component,
      source: file.source,
      parameters,
      variants,
      references,
    });
  }

  const names = [...records.keys()].sort(compareText);
  const namespaces = new Set<string>();
  for (const record of records.values()) {
    if (record.namespace !== null) namespaces.add(record.namespace);
  }

  return {
    catalog: { records, names, namespaces },
    diagnostics: diagnostics.sorted(),
  };
}

function collectReferences(
  elements: readonly ElementNode[],
  sourcePath: string,
  out: ComponentUse[],
): void {
  for (const element of elements) {
    if (element.kind?.reference.type === "component-kind") {
      const reference = element.kind.reference;
      out.push({
        component: reference.name,
        namespace: reference.namespace,
        key: componentKey(reference.namespace, reference.name),
        variant: element.kind.variant?.name ?? null,
        nameSpan: reference.span,
        span: element.kind.span,
        sourcePath,
      });
    }
    collectReferences(element.children, sourcePath, out);
  }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
