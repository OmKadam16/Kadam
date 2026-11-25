import type { ElementNode, PageNode, PropertyBindingNode } from "../ast/nodes.js";
import type { DiagnosticBag } from "../diagnostics/diagnostic.js";
import type { SourceFile, Span } from "../source/source-file.js";
import { closestMatches } from "../parser/suggest.js";

/**
 * kadam 0.3 (F5 step 1, D-40): build-time data. A project data file is a JSON
 * array of flat records. A page repeats a component once per record:
 *
 *     card {
 *         a ProjectCard for each project in projects
 *         with a title of the title of project
 *     }
 *
 * Expansion happens before component validation, so each repeated instance is
 * checked exactly like one written by hand, and the output stays static HTML.
 */

export type DataValue = string | number | boolean;
export type DataFieldType = "text" | "number" | "yes/no";

export interface DataSet {
  readonly name: string;
  readonly path: string;
  readonly records: readonly Readonly<Record<string, DataValue | null>>[];
  /** Every field any record has, with its one type. */
  readonly fields: ReadonlyMap<string, DataFieldType>;
}

export const MAX_DATA_RECORDS = 1000;
const FIELD_NAME = /^[a-z][A-Za-z0-9]{0,63}$/;

/** Parse and check one data file. Returns null when it has errors. */
export function parseDataFile(name: string, source: SourceFile, diagnostics: DiagnosticBag): DataSet | null {
  const whole = source.span(0, 0);
  const fail = (message: string, hint: string, span: Span = whole): null => {
    diagnostics.error("KDM4010", `data file '${source.path}': ${message}`, span, hint);
    return null;
  };
  let raw: unknown;
  try {
    raw = JSON.parse(source.text);
  } catch (error) {
    const match = /position (\d+)/.exec(String(error));
    const offset = match === null ? 0 : Number(match[1]);
    return fail("is not valid JSON", "check for a missing comma, quote, or bracket", source.span(offset, offset));
  }
  if (!Array.isArray(raw)) return fail("must be a JSON array of records", 'use: [ { "title": "Kadam", "year": 2026 } ]');
  if (raw.length > MAX_DATA_RECORDS) return fail(`has ${raw.length} records; the limit is ${MAX_DATA_RECORDS}`, "split the data into smaller files");

  const fields = new Map<string, DataFieldType>();
  const records: Record<string, DataValue | null>[] = [];
  let ok = true;
  raw.forEach((record: unknown, index) => {
    const where = `record ${index + 1}`;
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      ok = fail(`${where} is not an object`, 'each record is an object, e.g. { "title": "Kadam" }') ?? false;
      return;
    }
    const copy: Record<string, DataValue | null> = {};
    for (const [field, value] of Object.entries(record as Record<string, unknown>)) {
      if (!FIELD_NAME.test(field)) {
        ok = fail(`${where} has the field "${field}"; field names are lowerCamel words`, 'rename it, e.g. "releaseYear"') ?? false;
        continue;
      }
      if (value === null) {
        copy[field] = null;
        continue;
      }
      const type: DataFieldType | null =
        typeof value === "string" ? "text" : typeof value === "number" && Number.isFinite(value) ? "number" : typeof value === "boolean" ? "yes/no" : null;
      if (type === null) {
        ok = fail(`${where} field "${field}" is not text, a number, or true/false`, "nested objects and arrays are not supported yet; flatten the record") ?? false;
        continue;
      }
      const known = fields.get(field);
      if (known !== undefined && known !== type) {
        ok = fail(`${where} field "${field}" is ${type}, but earlier records have ${known}`, "use one type for each field") ?? false;
        continue;
      }
      fields.set(field, type);
      copy[field] = value as DataValue;
    }
    records.push(copy);
  });
  if (!ok) return null;
  return { name, path: source.path, records, fields };
}

/**
 * Replace every repeating instance with one instance per record. `data` is
 * null for a single-file build, which has no project data.
 */
/** A null entry is a declared file that already reported its own error. */
export function expandData(page: PageNode, data: ReadonlyMap<string, DataSet | null> | null, diagnostics: DiagnosticBag): PageNode {
  if (!usesData(page.elements)) return page;
  const names = new Set<string>();
  const collect = (elements: readonly ElementNode[]): void => {
    for (const element of elements) {
      names.add(element.name);
      collect(element.children);
    }
  };
  collect(page.elements);

  const expandList = (elements: readonly ElementNode[]): ElementNode[] =>
    elements.flatMap((element) => (element.kind?.repeat === undefined ? [{ ...element, children: expandList(element.children) }] : repeat(element)));

  const repeat = (element: ElementNode): ElementNode[] => {
    const clause = element.kind!.repeat!;
    if (data === null) {
      diagnostics.error("KDM3042", `data list "${clause.source}" needs a project`, clause.sourceSpan, 'build the project, and declare the file in kadam.json: "data": { "projects": "data/projects.json" }');
      return [];
    }
    const set = data.get(clause.source);
    if (set === null) return [];
    if (set === undefined) {
      const known = [...data.keys()];
      const close = closestMatches(clause.source, known, 3);
      diagnostics.error(
        "KDM3042",
        `unknown data "${clause.source}"`,
        clause.sourceSpan,
        close.length > 0 ? `did you mean: ${close.join(", ")}?` : `declare it in kadam.json: "data": { "${clause.source}": "data/${clause.source}.json" }`,
      );
      return [];
    }
    if (element.children.length > 0) {
      diagnostics.error("KDM3040", "a repeated instance cannot have child elements yet", element.children[0]!.nameSpan, "move the content into the component, and pass the values in as parameters");
      return [];
    }

    let ok = true;
    for (const binding of element.properties) {
      const field = binding.field;
      if (field === undefined) continue;
      if (field.item !== clause.item) {
        diagnostics.error("KDM3043", `"${field.item}" is not the record name here`, field.span, `this list names each record "${clause.item}": the ${field.name} of ${clause.item}`);
        ok = false;
        continue;
      }
      const type = set.fields.get(field.name);
      if (type === undefined && set.records.length > 0) {
        const close = closestMatches(field.name, [...set.fields.keys()], 3);
        diagnostics.error(
          "KDM3043",
          `the records in "${set.name}" have no field "${field.name}"`,
          field.span,
          close.length > 0 ? `did you mean: ${close.join(", ")}?` : `the fields are: ${[...set.fields.keys()].join(", ")}`,
        );
        ok = false;
      } else if (type === "yes/no") {
        diagnostics.error("KDM3043", `the field "${field.name}" is true or false, which cannot be shown as a value`, field.span, "use a text or number field");
        ok = false;
      }
    }
    if (!ok) return [];

    const kind = { ...element.kind!, repeat: undefined };
    delete (kind as { repeat?: unknown }).repeat;
    const instances: ElementNode[] = [];
    set.records.forEach((record, index) => {
      const name = `${element.name}${index + 1}`;
      if (names.has(name)) {
        diagnostics.error("KDM3044", `the data list makes an element named "${name}", which is already used`, element.nameSpan, `rename "${element.name}" or the other "${name}"`);
        ok = false;
        return;
      }
      const properties: PropertyBindingNode[] = [];
      for (const binding of element.properties) {
        if (binding.field === undefined) {
          properties.push(binding);
          continue;
        }
        // A missing or null field leaves the parameter to its default.
        const value = record[binding.field.name];
        if (value === undefined || value === null) continue;
        const { field: _field, ...literal } = binding;
        properties.push({ ...literal, value: String(value) });
      }
      instances.push({ ...element, name, kind, properties, children: [] });
    });
    return ok ? instances : [];
  };

  return { ...page, elements: expandList(page.elements) };
}

export function usesData(elements: readonly ElementNode[]): boolean {
  return elements.some((element) => element.kind?.repeat !== undefined || usesData(element.children));
}
