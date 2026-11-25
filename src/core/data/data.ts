import type { ElementNode, PageNode, PropertyBindingNode, RecordFieldReference, RuntimeList, ShapeFieldType, StatementNode } from "../ast/nodes.js";
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

  // kadam 0.3 (D-41): data an ancestor loads at run time, by name.
  type Loaded = { readonly element: ElementNode; readonly shape: Extract<StatementNode, { type: "data-shape" }> | null };
  const expandList = (elements: readonly ElementNode[], loaded: ReadonlyMap<string, Loaded>): ElementNode[] =>
    elements.flatMap((element) => {
      let scope = loaded;
      const load = element.statements.find((statement): statement is Extract<StatementNode, { type: "data-load" }> => statement.type === "data-load");
      if (load !== undefined) {
        const shape = element.statements.find((statement): statement is Extract<StatementNode, { type: "data-shape" }> => statement.type === "data-shape") ?? null;
        scope = new Map([...loaded, [load.name, { element, shape }]]);
      }
      if (element.kind?.repeat === undefined) return [{ ...element, children: expandList(element.children, scope) }];
      const runtime = loaded.get(element.kind.repeat.source);
      if (runtime !== undefined) return runtimeRepeat(element, runtime);
      return repeat(element);
    });

  /** One instance with typed placeholders; the runtime clones it per record. */
  const runtimeRepeat = (element: ElementNode, loaded: Loaded): ElementNode[] => {
    const clause = element.kind!.repeat!;
    if (data?.has(clause.source) === true) {
      diagnostics.error("KDM3042", `"${clause.source}" is both a data file and data loaded here`, clause.sourceSpan, "rename one of them");
      return [];
    }
    if (loaded.shape === null) return []; // reported with the loader
    const shape = loaded.shape;
    if (clause.item !== shape.item) {
      diagnostics.error("KDM3043", `the shape describes each "${shape.item}", but this list names each record "${clause.item}"`, clause.itemSpan, `write: for each ${shape.item} in ${clause.source}`);
      return [];
    }
    if (element.children.length > 0) {
      diagnostics.error("KDM3040", "a list of loaded data cannot have child elements yet", element.children[0]!.nameSpan, "move the content into the component, and pass the values in as parameters");
      return [];
    }
    const types = new Map(shape.fields.map((field) => [field.name, field.type]));
    let ok = true;
    const check = (field: RecordFieldReference): ShapeFieldType | null => {
      if (field.item !== clause.item) {
        diagnostics.error("KDM3043", `"${field.item}" is not the record name here`, field.span, `this list names each record "${clause.item}": the ${field.name} of ${clause.item}`);
        ok = false;
        return null;
      }
      const type = types.get(field.name);
      if (type === undefined) {
        const close = closestMatches(field.name, [...types.keys()], 3);
        diagnostics.error("KDM3043", `each ${shape.item} has no field "${field.name}"`, field.span, close.length > 0 ? `did you mean: ${close.join(", ")}?` : `the shape lists: ${[...types.keys()].join(", ")}`);
        ok = false;
        return null;
      }
      return type;
    };
    const properties: PropertyBindingNode[] = [];
    for (const binding of element.properties) {
      if (binding.field === undefined) {
        properties.push(binding);
        continue;
      }
      const type = check(binding.field);
      if (type === "yes/no") {
        diagnostics.error("KDM3043", `the field "${binding.field.name}" is true or false, which cannot be shown as a value`, binding.field.span, "use a text, number, or url field");
        ok = false;
      }
      if (type === null || type === "yes/no") continue;
      const { field: _field, ...literal } = binding;
      properties.push({ ...literal, value: runtimeFieldPlaceholder(binding.field.name, type) });
    }
    for (const filter of clause.filters ?? []) {
      const type = check(filter.field);
      const valueType = typeof filter.value === "string" ? "text" : typeof filter.value === "number" ? "number" : "yes/no";
      if (type !== null && (type === "url" ? "text" : type) !== valueType) {
        diagnostics.error("KDM3043", `the field "${filter.field.name}" is ${type}, but it is compared with ${valueType}`, filter.valueSpan, "compare it with a value of the same type");
        ok = false;
      }
    }
    if (clause.sort !== undefined) check(clause.sort.field);
    if (!ok) return [];
    const kind = { ...element.kind! };
    delete (kind as { repeat?: unknown }).repeat;
    const runtimeList: RuntimeList = {
      source: clause.source,
      item: clause.item,
      filters: clause.filters ?? [],
      sort: clause.sort ?? null,
      limit: clause.limit?.count ?? null,
      span: clause.span,
    };
    return [{ ...element, kind, properties, children: [], runtimeList }];
  };

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
    // Children fill the component's slots; they may read the record too.
    const childReads = new Set<string>();
    mapStrings(element.children, (text) => {
      for (const match of text.matchAll(RECORD_PLACEHOLDER)) {
        if (match[2] === clause.item) childReads.add(match[1]!);
      }
      return text;
    });

    let ok = true;
    /** The field's type, or null after reporting why it cannot be read. Undefined for an empty data set. */
    const check = (field: RecordFieldReference): DataFieldType | null | undefined => {
      if (field.item !== clause.item) {
        diagnostics.error("KDM3043", `"${field.item}" is not the record name here`, field.span, `this list names each record "${clause.item}": the ${field.name} of ${clause.item}`);
        ok = false;
        return null;
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
        return null;
      }
      return type;
    };
    for (const binding of element.properties) {
      if (binding.field === undefined) continue;
      if (check(binding.field) === "yes/no") {
        diagnostics.error("KDM3043", `the field "${binding.field.name}" is true or false, which cannot be shown as a value`, binding.field.span, "use a text or number field");
        ok = false;
      }
    }
    for (const filter of clause.filters ?? []) {
      const type = check(filter.field);
      const valueType: DataFieldType = typeof filter.value === "string" ? "text" : typeof filter.value === "number" ? "number" : "yes/no";
      if (type !== null && type !== undefined && type !== valueType) {
        diagnostics.error("KDM3043", `the field "${filter.field.name}" is ${type}, but it is compared with ${valueType}`, filter.valueSpan, type === "text" ? 'compare it with quoted text, e.g. "archived"' : type === "number" ? "compare it with a number" : "compare it with true or false");
        ok = false;
      }
    }
    if (clause.sort !== undefined) check(clause.sort.field);
    for (const field of childReads) {
      if (check({ name: field, item: clause.item, span: element.children[0]!.nameSpan }) === "yes/no") {
        diagnostics.error("KDM3043", `the field "${field}" is true or false, which cannot be shown as a value`, element.children[0]!.nameSpan, "use a text or number field");
        ok = false;
      }
    }
    if (!ok) return [];

    // Filter, then sort (stable; records without the field go last), then limit.
    let records = set.records.filter((record) =>
      (clause.filters ?? []).every((filter) => (record[filter.field.name] === filter.value) !== filter.negated),
    );
    const sort = clause.sort;
    if (sort !== undefined) {
      const key = sort.field.name;
      records = [...records].sort((a, b) => {
        const x = a[key];
        const y = b[key];
        const missingX = x === undefined || x === null;
        const missingY = y === undefined || y === null;
        if (missingX || missingY) return missingX === missingY ? 0 : missingX ? 1 : -1;
        const order = x! < y! ? -1 : x! > y! ? 1 : 0;
        return sort.descending ? -order : order;
      });
    }
    if (clause.limit !== undefined) records = records.slice(0, clause.limit.count);

    const kind = { ...element.kind!, repeat: undefined };
    delete (kind as { repeat?: unknown }).repeat;
    const instances: ElementNode[] = [];
    records.forEach((record, index) => {
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
      const missing = new Set<string>();
      const children = mapStrings(renameTree(element.children, name), (text) =>
        text.replace(RECORD_PLACEHOLDER, (placeholder, field: string, item: string) => {
          if (item !== clause.item) return placeholder;
          const value = record[field];
          if (value === undefined || value === null) {
            missing.add(field);
            return placeholder;
          }
          return String(value);
        }),
      );
      if (missing.size > 0) {
        diagnostics.error("KDM3043", `record ${index + 1} in "${set.name}" has no ${[...missing].join(" or ")}, which ${element.name} shows`, element.nameSpan, "add the field to that record");
        ok = false;
        return;
      }
      for (const child of flattenNames(children)) {
        if (names.has(child)) {
          diagnostics.error("KDM3044", `the data list makes an element named "${child}", which is already used`, element.nameSpan, `rename the other "${child}"`);
          ok = false;
        }
      }
      instances.push({ ...element, name, kind, properties, children });
    });
    return ok ? instances : [];
  };

  return { ...page, elements: expandList(page.elements, new Map()) };
}

export function usesData(elements: readonly ElementNode[]): boolean {
  return elements.some((element) => element.kind?.repeat !== undefined || usesData(element.children));
}

/** `{the title of post}` inside any quoted text of a page made for each record. */
const RECORD_PLACEHOLDER = /\{the ([a-z][A-Za-z0-9]{0,63}) of ([a-z][A-Za-z0-9]{0,63})\}/g;
const ROUTE_VALUE = /^[A-Za-z0-9._~-]+$/;

export interface GeneratedPage {
  readonly page: PageNode;
  readonly route: string;
}

/** True when any text in the page reads a record field. */
export function readsRecordFields(page: PageNode): boolean {
  let found = false;
  mapStrings(outsideLists(page), (text) => {
    if (!found && new RegExp(RECORD_PLACEHOLDER.source).test(text)) found = true;
    return text;
  });
  return found;
}

/**
 * kadam 0.3 (F5 step 3, D-40): one page per record. Every `{the <field> of
 * <record>}` in the page's text is replaced, and each `:field` route segment
 * takes that record's value. The pages are then checked like hand-written ones.
 */
export function generatePages(
  page: PageNode,
  route: string,
  data: ReadonlyMap<string, DataSet | null>,
  diagnostics: DiagnosticBag,
): GeneratedPage[] {
  const clause = page.repeat!;
  const set = data.get(clause.source);
  if (set === null) return [];
  if (set === undefined) {
    const close = closestMatches(clause.source, [...data.keys()], 3);
    diagnostics.error(
      "KDM3042",
      `unknown data "${clause.source}"`,
      clause.sourceSpan,
      close.length > 0 ? `did you mean: ${close.join(", ")}?` : `declare it in kadam.json: "data": { "${clause.source}": "data/${clause.source}.json" }`,
    );
    return [];
  }

  const segments = route.split("/");
  const routeFields = segments.filter((segment) => segment.startsWith(":")).map((segment) => segment.slice(1));
  let ok = true;
  if (routeFields.length === 0) {
    diagnostics.error("KDM3044", `every page made for each record needs its own route, but "${route}" is the same for all of them`, clause.span, 'add a :field segment to the route in kadam.json, e.g. "/blog/:slug"');
    return [];
  }
  const known = [...set.fields.keys()];
  const checkField = (name: string, span: Span, inRoute: boolean): boolean => {
    const type = set.fields.get(name);
    if (type === undefined && set.records.length > 0) {
      const close = closestMatches(name, known, 3);
      diagnostics.error(
        "KDM3043",
        `the records in "${set.name}" have no field "${name}"${inRoute ? ` (used in the route "${route}")` : ""}`,
        span,
        close.length > 0 ? `did you mean: ${close.join(", ")}?` : `the fields are: ${known.join(", ")}`,
      );
      return false;
    }
    if (type === "yes/no") {
      diagnostics.error("KDM3043", `the field "${name}" is true or false, which cannot be shown as a value`, span, "use a text or number field");
      return false;
    }
    return true;
  };
  for (const name of routeFields) ok = checkField(name, clause.sourceSpan, true) && ok;

  // Check every placeholder once, against the template. Children of a data
  // list read that list's records, and are checked when the list expands.
  const reported = new Set<string>();
  mapStrings(outsideLists(page), (text) => {
    for (const match of text.matchAll(RECORD_PLACEHOLDER)) {
      const [, field, item] = match;
      const key = `${field} ${item}`;
      if (reported.has(key)) continue;
      reported.add(key);
      if (item !== clause.item) {
        diagnostics.error("KDM3043", `"${item}" is not the record name here`, clause.itemSpan, `this page names each record "${clause.item}": {the ${field} of ${clause.item}}`);
        ok = false;
      } else if (!checkField(field!, page.titleSpan, false)) {
        ok = false;
      }
    }
    return text;
  });
  if (!ok) return [];

  const pages: GeneratedPage[] = [];
  const routes = new Map<string, number>();
  set.records.forEach((record, index) => {
    const where = `record ${index + 1} in "${set.name}"`;
    const valueOf = (field: string): string | null => {
      const value = record[field];
      return value === undefined || value === null ? null : String(value);
    };
    const missing = new Set<string>();
    const pageRoute = segments
      .map((segment) => {
        if (!segment.startsWith(":")) return segment;
        const value = valueOf(segment.slice(1));
        if (value === null) {
          missing.add(segment.slice(1));
          return segment;
        }
        if (!ROUTE_VALUE.test(value)) {
          diagnostics.error("KDM3043", `${where} has ${segment.slice(1)} ${JSON.stringify(value)}, which cannot be part of a URL`, clause.sourceSpan, "use letters, digits, '.', '_', '~', and '-', e.g. \"hello-world\"");
          ok = false;
        }
        return value;
      })
      .join("/");
    const generated = mapStrings(page, (text) =>
      text.replace(RECORD_PLACEHOLDER, (placeholder, field: string, item: string) => {
        if (item !== clause.item) return placeholder;
        const value = valueOf(field);
        if (value === null) {
          missing.add(field);
          return placeholder;
        }
        return value;
      }),
    );
    if (missing.size > 0) {
      diagnostics.error("KDM3043", `${where} has no ${[...missing].join(" or ")}, which this page shows`, clause.sourceSpan, "add the field to that record");
      ok = false;
      return;
    }
    const previous = routes.get(pageRoute);
    if (previous !== undefined) {
      diagnostics.error("KDM4005", `records ${previous} and ${index + 1} in "${set.name}" both make the route "${pageRoute}"`, clause.sourceSpan, "give each record a different value for the route field");
      ok = false;
      return;
    }
    routes.set(pageRoute, index + 1);
    const { repeat: _repeat, ...plain } = generated;
    pages.push({ page: plain, route: pageRoute });
  });
  return ok ? pages : [];
}

/** Copy a node tree, mapping every string except source-span file names. */
function mapStrings<T>(value: T, map: (text: string) => string): T {
  if (typeof value === "string") return map(value) as T;
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map)) as T;
  if (typeof value !== "object" || value === null) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = key === "span" || key.endsWith("Span") || key === "type" || key === "name" ? item : mapStrings(item, map);
  }
  return copy as T;
}

/** The page with every data list's children left out. */
function outsideLists(page: PageNode): PageNode {
  const strip = (elements: readonly ElementNode[]): ElementNode[] =>
    elements.map((element) => ({ ...element, children: element.kind?.repeat === undefined ? strip(element.children) : [] }));
  return { ...page, elements: strip(page.elements) };
}

/** `badge` in the third record of `project` becomes `project3Badge`. */
function renameTree(elements: readonly ElementNode[], prefix: string): ElementNode[] {
  return elements.map((element) => ({
    ...element,
    name: `${prefix}${element.name[0]!.toUpperCase()}${element.name.slice(1)}`,
    children: renameTree(element.children, prefix),
  }));
}

function flattenNames(elements: readonly ElementNode[]): string[] {
  return elements.flatMap((element) => [element.name, ...flattenNames(element.children)]);
}

/**
 * kadam 0.3 (D-41): the value a runtime field gets while its list is expanded
 * at build time. It is a valid https URL, so url parameters accept it, and it
 * carries the field's type, so component checks can reject a wrong one. The
 * runtime replaces it in text and attributes; it is never shown.
 */
export const RUNTIME_FIELD = /https:\/\/kadam\.invalid\/field\/(text|number|url)\/([a-z][A-Za-z0-9]{0,63})/g;

export function runtimeFieldPlaceholder(name: string, type: "text" | "number" | "url"): string {
  return `https://kadam.invalid/field/${type}/${name}`;
}

/** The runtime field a bound value stands for, if it is one. */
export function runtimeField(value: string): { readonly name: string; readonly type: "text" | "number" | "url" } | null {
  const match = /^https:\/\/kadam\.invalid\/field\/(text|number|url)\/([a-z][A-Za-z0-9]{0,63})$/.exec(value);
  return match === null ? null : { name: match[2]!, type: match[1] as "text" | "number" | "url" };
}

/**
 * kadam 0.3 (D-41): a loaded URL is same-origin, or its origin is declared in
 * kadam.json `connect`. HTTPS is required except on localhost.
 */
export function checkLoadOrigins(elements: readonly ElementNode[], connect: readonly string[], diagnostics: DiagnosticBag): void {
  for (const element of elements) {
    for (const statement of element.statements) {
      if (statement.type !== "data-load") continue;
      const url = statement.url;
      if (url.startsWith("/") && !url.startsWith("//")) continue;
      let parsed: URL | null = null;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      if (parsed === null) {
        diagnostics.error("KDM3046", `"${url}" is not a URL Kadam can load`, statement.urlSpan, 'use a path on this site, such as "/api/products", or a full https address');
        continue;
      }
      const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
        diagnostics.error("KDM3046", `"${url}" must use https`, statement.urlSpan, "only localhost may use http");
        continue;
      }
      if (parsed.username !== "" || parsed.password !== "") {
        diagnostics.error("KDM3046", "a loaded URL cannot contain a user name or password", statement.urlSpan, "remove the credentials from the URL");
        continue;
      }
      if (!connect.includes(parsed.origin)) {
        diagnostics.error("KDM3046", `the origin ${parsed.origin} is not declared`, statement.urlSpan, `add it to kadam.json: "connect": ["${parsed.origin}"]`);
      }
    }
    checkLoadOrigins(element.children, connect, diagnostics);
  }
}
