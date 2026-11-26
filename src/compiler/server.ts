import type { ElementNode, PageNode, ShapeField, StatementNode } from "../core/ast/nodes.js";
import type { Span } from "../core/source/source-file.js";
import type { DiagnosticBag } from "../core/diagnostics/diagnostic.js";
import type { SourceFile } from "../core/source/source-file.js";
import { compileV02Text } from "../v02/compile.js";
import { describeType, type CoreType, type IrModule, type IrRecord } from "../v02/ir.js";
import type { OutputFile } from "./compile.js";

/**
 * D-44: the server boundary. A project names one kadam 0.2 module; pages load
 * data from its functions by name. The compiler checks every call against the
 * function's types, takes each load's shape from the record the function
 * returns, and generates a small server that only uses the target's standard
 * library. The compiler never runs the module.
 */

export interface ServerModule {
  readonly path: string;
  readonly module: IrModule;
  readonly source: SourceFile;
  /** The module compiled by its target adapter (D-31). */
  readonly code: string;
}

/** Compile the server module. Returns null (with diagnostics) when it does not compile. */
export function compileServerModule(path: string, text: string, diagnostics: DiagnosticBag): { server: ServerModule | null; source: SourceFile } {
  const result = compileV02Text(path, text, { target: "typescript" });
  diagnostics.addAll(result.diagnostics);
  if (!result.ok || result.module === null) return { server: null, source: result.source };
  if (result.module.main !== null) {
    diagnostics.error("KDM3060", "a server module has no main function", result.module.main.nameSpan, "remove main; pages call the module's other functions");
    return { server: null, source: result.source };
  }
  const code = String(result.files.find((file) => file.path.endsWith(".ts"))?.contents ?? "");
  return { server: { path, module: result.module, source: result.source, code }, source: result.source };
}

const FIELD_TYPES: Readonly<Record<string, ShapeField["type"]>> = { text: "text", number: "number", boolean: "yes/no" };

/**
 * Give every server load the shape of the record its function returns, so
 * the D-41 checks (lists, filters, bindings) run against the server's types.
 */
export function bindServerLoads(page: PageNode, server: ServerModule | null, diagnostics: DiagnosticBag): PageNode {
  const bind = (elements: readonly ElementNode[]): ElementNode[] =>
    elements.map((element) => {
      const children = bind(element.children);
      const load = element.statements.find((statement) => statement.type === "data-load");
      if (load?.type !== "data-load" || load.server === undefined) return { ...element, children };
      const shape = serverShape(load.server, load.urlSpan, server, diagnostics);
      const written = element.statements.find((statement) => statement.type === "data-shape");
      if (written !== undefined) {
        diagnostics.error("KDM3060", `the shape of ${load.name} comes from the server function ${load.server}`, written.span, "remove this line");
      }
      if (shape === null) return { ...element, children };
      const item = repeatItem(children, load.name) ?? load.name;
      const statements: StatementNode[] = [];
      for (const statement of element.statements) {
        if (statement.type === "data-shape") continue;
        statements.push(statement);
        if (statement === load) statements.push({ type: "data-shape", item, itemSpan: load.nameSpan, fields: shape, span: load.span });
      }
      return { ...element, statements, children };
    });
  return { ...page, elements: bind(page.elements) };
}

function serverShape(name: string, span: Span, server: ServerModule | null, diagnostics: DiagnosticBag): ShapeField[] | null {
  if (server === null) {
    diagnostics.error("KDM3060", `there is no server module to call ${name} in`, span,
      'add to kadam.json: "server": { "module": "server/app.kdm", "target": "typescript" }');
    return null;
  }
  const fn = server.module.functions.find((candidate) => candidate.name === name);
  if (fn === undefined) {
    const names = server.module.functions.map((candidate) => candidate.name);
    diagnostics.error("KDM3060", `the server module has no function named ${name}`, span,
      names.length === 0 ? `add function ${name} to ${server.path}` : `functions: ${names.join(", ")}`);
    return null;
  }
  if (fn.parameters.length > 0) {
    diagnostics.error("KDM3060", `${name} takes ${fn.parameters.length} value${fn.parameters.length === 1 ? "" : "s"}; a function a page loads from takes nothing`, span,
      `write: function ${name} takes nothing and returns list of <Record>`);
    return null;
  }
  const record = listRecord(fn.returnType, server.module);
  if (record === null) {
    diagnostics.error("KDM3060", `${name} returns ${describeType(fn.returnType)}; a page loads a list of records`, span,
      `write: function ${name} takes nothing and returns list of <Record>`);
    return null;
  }
  const fields: ShapeField[] = [];
  for (const field of record.fields) {
    const type = FIELD_TYPES[field.type.kind];
    if (type === undefined) {
      diagnostics.error("KDM3060", `${record.name}.${field.name} is ${describeType(field.type)}; loaded records have text, number and boolean fields`, span,
        `change ${field.name} in ${record.name}, or return a simpler record`);
      return null;
    }
    fields.push({ name: field.name, type, span });
  }
  return fields;
}

function listRecord(type: CoreType, module: IrModule): IrRecord | null {
  if (type.kind !== "list" || type.element.kind !== "record") return null;
  const name = type.element.name;
  return module.records.find((record) => record.name === name) ?? null;
}

/** The item name a list of this data uses (`for each product in products`). */
function repeatItem(elements: readonly ElementNode[], source: string): string | null {
  for (const element of elements) {
    if (element.kind?.repeat?.source === source) return element.kind.repeat.item;
    const inner = repeatItem(element.children, source);
    if (inner !== null) return inner;
  }
  return null;
}

/** Server functions the pages load from, in first-use order. */
export function calledFunctions(pages: readonly PageNode[]): string[] {
  const names: string[] = [];
  const visit = (elements: readonly ElementNode[]): void => {
    for (const element of elements) {
      for (const statement of element.statements) {
        if (statement.type === "data-load" && statement.server !== undefined && !names.includes(statement.server)) names.push(statement.server);
      }
      visit(element.children);
    }
  };
  for (const page of pages) visit(page.elements);
  return names;
}

/** `server/<module>.ts` (with an export list) and `server/server.ts`. */
export function serverFiles(server: ServerModule, called: readonly string[], connect: readonly string[]): OutputFile[] {
  const moduleFile = `${server.module.name}.ts`;
  const exports = called.length === 0 ? "" : `\n// Functions the pages call (D-44).\nexport { ${called.map((name) => `k_${name} as ${name}`).join(", ")} };\n`;
  return [
    { path: `server/${moduleFile}`, contents: `${server.code.replace(/\n*$/, "\n")}${exports}`, kind: "asset" },
    { path: "server/server.ts", contents: serverEntry(moduleFile, called, connect), kind: "asset" },
  ];
}

function serverEntry(moduleFile: string, called: readonly string[], connect: readonly string[]): string {
  const policy = ["default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: https:", "font-src 'self'", `connect-src ${["'self'", ...connect].join(" ")}`, "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"].join("; ");
  return `// Generated by Kadam. Do not edit.
// The server for this site (D-44). It needs only Node.js:
//   node --experimental-strip-types server/server.ts
// PORT and HOST choose where it listens (default 127.0.0.1:3000).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as app from "./${moduleFile}";

const site = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

/** Only the functions a page loads from are reachable. */
const loads: Readonly<Record<string, () => unknown>> = {
${called.map((name) => `  ${JSON.stringify(name)}: app.${name},`).join("\n")}
};

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".pdf": "application/pdf",
};
const SECURITY = {
  "content-security-policy": ${JSON.stringify(policy)},
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

/** Kadam record fields are prefixed in generated code; the page sees their own names. */
function toJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key.replace(/^k_/, ""), toJson(inner)]));
  }
  return value;
}

async function file(path: string): Promise<string | null> {
  const target = resolve(site, "." + path);
  if (target !== site && !target.startsWith(site + sep)) return null;
  const relative = target.slice(site.length + 1);
  if (relative === "server" || relative.startsWith("server" + sep) || relative.split(sep).some((part) => part.startsWith("."))) return null;
  try {
    const info = await stat(target);
    if (info.isDirectory()) return file(path.replace(/\\/?$/, "/index.html"));
    return info.isFile() ? target : null;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  let path: string;
  try {
    path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400, SECURITY).end();
    return;
  }
  if (path.startsWith("/_kadam/")) {
    const name = path.slice("/_kadam/".length);
    const load = Object.hasOwn(loads, name) ? loads[name] : undefined;
    if (load === undefined) {
      response.writeHead(404, { ...SECURITY, "content-type": "application/json" }).end('{"error":"not found"}');
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { ...SECURITY, allow: "GET" }).end();
      return;
    }
    try {
      const body = JSON.stringify(toJson(load()));
      response.writeHead(200, { ...SECURITY, "content-type": "application/json", "cache-control": "no-store" }).end(body);
    } catch (error) {
      console.error(\`kadam: the server function \${name} failed\`, error);
      response.writeHead(500, { ...SECURITY, "content-type": "application/json" }).end('{"error":"the server function failed"}');
    }
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { ...SECURITY, allow: "GET" }).end();
    return;
  }
  const found = await file(path);
  if (found === null) {
    response.writeHead(404, { ...SECURITY, "content-type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  const body = await readFile(found);
  response.writeHead(200, { ...SECURITY, "content-type": TYPES[extname(found)] ?? "application/octet-stream" }).end(request.method === "HEAD" ? undefined : body);
});

server.listen(port, host, () => {
  const address = server.address();
  console.log(\`Kadam server: http://\${host}:\${typeof address === "object" && address !== null ? address.port : port}/\`);
});
`;
}
