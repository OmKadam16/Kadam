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
  readonly target: "typescript" | "python";
  readonly module: IrModule;
  readonly source: SourceFile;
  /** The module compiled by its target adapter (D-31). */
  readonly code: string;
}

/** Compile the server module. Returns null (with diagnostics) when it does not compile. */
export function compileServerModule(
  path: string,
  text: string,
  target: "typescript" | "python",
  diagnostics: DiagnosticBag,
): { server: ServerModule | null; source: SourceFile } {
  const result = compileV02Text(path, text, { target });
  diagnostics.addAll(result.diagnostics);
  if (!result.ok || result.module === null) return { server: null, source: result.source };
  if (result.module.main !== null) {
    diagnostics.error("KDM3060", "a server module has no main function", result.module.main.nameSpan, "remove main; pages call the module's other functions");
    return { server: null, source: result.source };
  }
  if (result.module.name === "server") {
    diagnostics.error("KDM3060", "the server module cannot be named server", result.module.span, "rename the module (and its file), for example to app");
    return { server: null, source: result.source };
  }
  const code = String(result.files.find((file) => file.path.endsWith(target === "python" ? ".py" : ".ts"))?.contents ?? "");
  return { server: { path, target, module: result.module, source: result.source, code }, source: result.source };
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
      checkServerForm(element, server, diagnostics);
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

const CONTROLS: ReadonlySet<string> = new Set(["text field", "text area", "dropdown", "checkbox", "radio group"]);

function kindName(element: ElementNode): string | null {
  return element.kind?.reference.type === "builtin-kind" ? element.kind.reference.name : null;
}

function descendants(element: ElementNode): ElementNode[] {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

/**
 * D-44: a form that sends to a server function. The function takes one
 * record and returns nothing; the form's controls are exactly the record's
 * fields, with matching types; the sent and failed states are named.
 */
function checkServerForm(element: ElementNode, server: ServerModule | null, diagnostics: DiagnosticBag): void {
  const action = element.statements.find((statement) => statement.type === "form-action");
  const states = element.statements.filter((statement): statement is Extract<StatementNode, { type: "form-state" }> => statement.type === "form-state");
  if (action?.type !== "form-action" || action.server === undefined) {
    for (const state of states) {
      diagnostics.error("KDM3061", "sent and failed states are for a form that sends to a server function", state.span,
        "write: it sends to the server function <function>");
    }
    return;
  }
  const inside = descendants(element);
  for (const want of ["sent", "failed"] as const) {
    const state = states.find((candidate) => candidate.state === want);
    const sentence = want === "sent" ? "when it is sent, it shows <element name>" : "when sending fails, it shows <element name>";
    if (state === undefined) {
      diagnostics.error("KDM3061", `${element.name} sends to ${action.server} but has no ${want} state`, action.span, `add: ${sentence}`);
    } else if (!inside.some((candidate) => candidate.name === state.target)) {
      diagnostics.error("KDM3012", `"${state.target}" is not an element inside ${element.name}`, state.targetSpan, `name one element inside ${element.name}`);
    }
  }
  if (states.length === 2 && states[0]!.target === states[1]!.target) {
    diagnostics.error("KDM3061", "the sent and failed states need different elements", states[1]!.targetSpan, "use one element for each state");
  }
  const name = action.server;
  const span = action.urlSpan;
  if (server === null) {
    diagnostics.error("KDM3061", `there is no server module to send ${element.name} to`, span,
      'add to kadam.json: "server": { "module": "server/app.kdm", "target": "typescript" }');
    return;
  }
  const fn = server.module.functions.find((candidate) => candidate.name === name);
  if (fn === undefined) {
    diagnostics.error("KDM3061", `the server module has no function named ${name}`, span, `add function ${name} to ${server.path}`);
    return;
  }
  const parameter = fn.parameters[0];
  const record = parameter?.type.kind === "record" ? server.module.records.find((candidate) => candidate.name === (parameter.type as { name: string }).name) : undefined;
  if (fn.parameters.length !== 1 || record === undefined || fn.returnType.kind !== "nothing") {
    diagnostics.error("KDM3061", `a form sends to a function that takes one record and returns nothing; ${name} does not`, span,
      `write: function ${name} takes <value> as <Record> and returns nothing`);
    return;
  }
  const controls = new Map(inside.filter((candidate) => CONTROLS.has(kindName(candidate) ?? "")).map((control) => [control.name, control]));
  for (const field of record.fields) {
    const control = controls.get(field.name);
    if (field.type.kind !== "text" && field.type.kind !== "boolean") {
      diagnostics.error("KDM3061", `${record.name}.${field.name} is ${describeType(field.type)}; a form sends text and boolean fields`, span,
        field.type.kind === "number" ? "use a text field for now; number inputs come later" : `change ${field.name} in ${record.name}`);
      continue;
    }
    if (control === undefined) {
      diagnostics.error("KDM3061", `${record.name} has a field ${field.name}, but ${element.name} has no control named ${field.name}`, span,
        `add a control named ${field.name} to the form`);
      continue;
    }
    const checkbox = kindName(control) === "checkbox";
    if ((field.type.kind === "boolean") !== checkbox) {
      diagnostics.error("KDM3061", `${field.name} is ${field.type.kind} in ${record.name}, so it needs ${field.type.kind === "boolean" ? "a checkbox" : "a text field, text area, dropdown, or radio group"}`,
        control.nameSpan, `change the control, or the type of ${field.name}`);
    }
  }
  for (const [controlName, control] of controls) {
    if (!record.fields.some((field) => field.name === controlName)) {
      diagnostics.error("KDM3061", `${element.name} sends ${controlName}, but ${record.name} has no field ${controlName}`, control.nameSpan,
        `add ${controlName} to ${record.name}, or remove the control`);
    }
  }
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

/** Server functions the pages load from, and those forms send to, in first-use order. */
export function calledFunctions(pages: readonly PageNode[]): { readonly loads: string[]; readonly sends: string[] } {
  const loads: string[] = [];
  const sends: string[] = [];
  const visit = (elements: readonly ElementNode[]): void => {
    for (const element of elements) {
      for (const statement of element.statements) {
        if (statement.type === "data-load" && statement.server !== undefined && !loads.includes(statement.server)) loads.push(statement.server);
        if (statement.type === "form-action" && statement.server !== undefined && !sends.includes(statement.server)) sends.push(statement.server);
      }
      visit(element.children);
    }
  };
  for (const page of pages) visit(page.elements);
  return { loads, sends };
}

/** A form on a built page, for answering a request sent without JavaScript. */
export interface ServerForm {
  readonly form: string;
  readonly html: string;
  readonly sent: string;
  readonly failed: string;
}

/** `server/<module>.ts` (with an export list) and `server/server.ts`. */
export function serverFiles(
  server: ServerModule,
  called: { readonly loads: readonly string[]; readonly sends: readonly string[] },
  forms: readonly ServerForm[],
  connect: readonly string[],
): OutputFile[] {
  if (server.target === "python") return pythonServerFiles(server, called, forms, connect);
  const moduleFile = `${server.module.name}.ts`;
  const all = [...called.loads, ...called.sends.filter((name) => !called.loads.includes(name))];
  const exports = all.length === 0 ? "" : `\n// Functions the pages call (D-44).\nexport { ${all.map((name) => `k_${name} as ${name}`).join(", ")} };\n`;
  const sends = called.sends.map((name) => {
    const fn = server.module.functions.find((candidate) => candidate.name === name)!;
    const type = fn.parameters[0]!.type as { name: string };
    const record = server.module.records.find((candidate) => candidate.name === type.name)!;
    return { name, fields: record.fields.map((field) => [field.name, field.type.kind] as const) };
  });
  return [
    { path: `server/${moduleFile}`, contents: `${server.code.replace(/\n*$/, "\n")}${exports}`, kind: "server" },
    { path: "server/server.ts", contents: serverEntry(moduleFile, called.loads, sends, forms, connect), kind: "server" },
  ];
}

function contentPolicy(connect: readonly string[]): string {
  return ["default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: https:", "font-src 'self'", `connect-src ${["'self'", ...connect].join(" ")}`, "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"].join("; ");
}

function sendTable(server: ServerModule, sends: readonly string[]): { readonly name: string; readonly record: string; readonly fields: readonly (readonly [string, string])[] }[] {
  return sends.map((name) => {
    const fn = server.module.functions.find((candidate) => candidate.name === name)!;
    const type = fn.parameters[0]!.type as { name: string };
    const record = server.module.records.find((candidate) => candidate.name === type.name)!;
    return { name, record: record.name, fields: record.fields.map((field) => [field.name, field.type.kind] as const) };
  });
}

/** D-44 step 4: the same server for Python, using only the standard library (WSGI). */
function pythonServerFiles(
  server: ServerModule,
  called: { readonly loads: readonly string[]; readonly sends: readonly string[] },
  forms: readonly ServerForm[],
  connect: readonly string[],
): OutputFile[] {
  const name = server.module.name;
  const py = (value: unknown): string => JSON.stringify(value);
  const sends = sendTable(server, called.sends);
  const entry = `# Generated by Kadam. Do not edit.
# The server for this site (D-44). It needs only Python 3.10 or newer:
#   python3 server/server.py
# PORT and HOST choose where it listens (default 127.0.0.1:3000). \`application\`
# is a WSGI application, so any WSGI server can run it instead.
from __future__ import annotations

import dataclasses
import json
import os
import re
import sys
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from wsgiref.simple_server import WSGIRequestHandler, make_server

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ${name} as app  # noqa: E402

SITE = Path(__file__).resolve().parent.parent

# Only the functions a page loads from, or a form sends to, are reachable.
LOADS = {
${called.loads.map((load) => `    ${py(load)}: app.k_${load},`).join("\n")}
}
SENDS = {
${sends.map((send) => `    ${py(send.name)}: (app.k_${send.name}, app.KadamRecord_${send.record}, ${pyList(send.fields)}),`).join("\n")}
}
# Each form's page and states, to answer a form posted without JavaScript.
FORMS = {
${forms.map((form) => `    ${py(form.form)}: (${py(form.html)}, ${py(form.sent)}, ${py(form.failed)}),`).join("\n")}
}
LIMIT = 64 * 1024
TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2",
    ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".pdf": "application/pdf",
}
SECURITY = [
    ("Content-Security-Policy", ${py(contentPolicy(connect))}),
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
]


def to_json(value):
    """Kadam record fields are prefixed in generated code; the page sees their own names."""
    if dataclasses.is_dataclass(value):
        return {field.name[2:]: to_json(getattr(value, field.name)) for field in dataclasses.fields(value)}
    if isinstance(value, (list, tuple)):
        return [to_json(item) for item in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def respond(start_response, status, body, content_type, extra=()):
    data = body if isinstance(body, bytes) else body.encode("utf-8")
    headers = [*SECURITY, ("Content-Type", content_type), ("Content-Length", str(len(data))), *extra]
    start_response(status, headers)
    return [data]


def reply(start_response, status, error):
    body = '{"ok":true}' if error is None else json.dumps({"error": error}, separators=(",", ":"))
    return respond(start_response, status, body, "application/json")


def same_origin(environ):
    """Only this site's pages may send forms: a same-site Origin (or Referer) is required."""
    source = environ.get("HTTP_ORIGIN") or environ.get("HTTP_REFERER")
    if not source or source == "null":
        return False
    return urlsplit(source).netloc == environ.get("HTTP_HOST")


def form_record(body, record, fields):
    """The record a form sends, built field by field from its declared types; None when the body does not fit."""
    values = parse_qs(body, keep_blank_values=True)
    arguments = {}
    for name, kind in fields:
        if kind == "boolean":
            arguments["k_" + name] = name in values
        elif name in values:
            arguments["k_" + name] = values[name][0]
        else:
            return None
    return record(**arguments)


def answer_page(form, ok):
    """The page the form is on, with its sent or failed state shown."""
    entry = FORMS.get(form)
    if entry is None:
        return None
    html, sent, failed = entry
    page = (SITE / html).read_text("utf-8")
    shown = sent if ok else failed
    return re.sub('(data-kdm-id="' + shown + '"[^>]*?) data-kdm-hidden(="")?', r"\\1", page, count=1)


def send(environ, start_response, name):
    call, record, fields = SENDS[name]
    if environ["REQUEST_METHOD"] != "POST":
        return respond(start_response, "405 Method Not Allowed", b"", "text/plain", [("Allow", "POST")])
    if not same_origin(environ):
        return reply(start_response, "403 Forbidden", "forms can only be sent from this site")
    if not environ.get("CONTENT_TYPE", "").startswith("application/x-www-form-urlencoded"):
        return reply(start_response, "415 Unsupported Media Type", "send the form as application/x-www-form-urlencoded")
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = LIMIT + 1
    if length > LIMIT:
        return reply(start_response, "413 Content Too Large", "the form is too large")
    body = environ["wsgi.input"].read(length).decode("utf-8", "replace")
    value = form_record(body, record, fields)
    if value is None:
        return reply(start_response, "400 Bad Request", "the form does not match what the server function takes")
    ok = True
    try:
        call(value)
    except Exception:
        ok = False
        print(f"kadam: the server function {name} failed", file=sys.stderr)
        traceback.print_exc()
    if environ.get("HTTP_X_KADAM") == "1":
        return reply(start_response, "200 OK" if ok else "500 Internal Server Error", None if ok else "the server function failed")
    form = parse_qs(environ.get("QUERY_STRING", "")).get("form", [None])[0]
    page = answer_page(form, ok)
    if page is None:
        return reply(start_response, "200 OK" if ok else "500 Internal Server Error", None if ok else "the server function failed")
    return respond(start_response, "200 OK" if ok else "500 Internal Server Error", page, "text/html; charset=utf-8", [("Cache-Control", "no-store")])


def site_file(path):
    target = (SITE / path.lstrip("/")).resolve()
    if target != SITE and SITE not in target.parents:
        return None
    parts = target.relative_to(SITE).parts
    if (parts and parts[0] == "server") or any(part.startswith(".") for part in parts):
        return None
    if target.is_dir():
        target = target / "index.html"
    return target if target.is_file() else None


def application(environ, start_response):
    path = environ.get("PATH_INFO", "/")
    method = environ["REQUEST_METHOD"]
    if path.startswith("/_kadam/"):
        name = path[len("/_kadam/"):]
        if name in SENDS:
            return send(environ, start_response, name)
        load = LOADS.get(name)
        if load is None:
            return respond(start_response, "404 Not Found", '{"error":"not found"}', "application/json")
        if method not in ("GET", "HEAD"):
            return respond(start_response, "405 Method Not Allowed", b"", "text/plain", [("Allow", "GET")])
        try:
            body = json.dumps(to_json(load()), ensure_ascii=False, separators=(",", ":"))
        except Exception:
            print(f"kadam: the server function {name} failed", file=sys.stderr)
            traceback.print_exc()
            return respond(start_response, "500 Internal Server Error", '{"error":"the server function failed"}', "application/json")
        return respond(start_response, "200 OK", body, "application/json", [("Cache-Control", "no-store")])
    if method not in ("GET", "HEAD"):
        return respond(start_response, "405 Method Not Allowed", b"", "text/plain", [("Allow", "GET")])
    found = site_file(path)
    if found is None:
        return respond(start_response, "404 Not Found", "Not found", "text/plain; charset=utf-8")
    return respond(start_response, "200 OK", found.read_bytes(), TYPES.get(found.suffix, "application/octet-stream"))


class QuietHandler(WSGIRequestHandler):
    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "3000"))
    with make_server(host, port, application, handler_class=QuietHandler) as httpd:
        print(f"Kadam server: http://{host}:{httpd.server_port}/", flush=True)
        httpd.serve_forever()
`;
  return [
    { path: `server/${name}.py`, contents: server.code.replace(/\n*$/, "\n"), kind: "server" },
    { path: "server/server.py", contents: entry, kind: "server" },
  ];
}

function pyList(fields: readonly (readonly [string, string])[]): string {
  return `[${fields.map(([field, kind]) => `(${JSON.stringify(field)}, ${JSON.stringify(kind)})`).join(", ")}]`;
}

function serverEntry(
  moduleFile: string,
  called: readonly string[],
  sends: readonly { readonly name: string; readonly fields: readonly (readonly [string, string])[] }[],
  forms: readonly ServerForm[],
  connect: readonly string[],
): string {
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

/** Functions forms send to, with the fields of the record each takes. */
const sends: Readonly<Record<string, { readonly call: (value: never) => void; readonly fields: readonly (readonly [string, string])[] }>> = {
${sends.map((send) => `  ${JSON.stringify(send.name)}: { call: app.${send.name} as (value: never) => void, fields: ${JSON.stringify(send.fields)} },`).join("\n")}
};

/** Each form's page and states, to answer a form posted without JavaScript. */
const forms: Readonly<Record<string, readonly [string, string, string]>> = {
${forms.map((form) => `  ${JSON.stringify(form.form)}: ${JSON.stringify([form.html, form.sent, form.failed])},`).join("\n")}
};
const LIMIT = 64 * 1024;

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

/** Only this site's pages may send forms: a same-site Origin (or Referer) is required. */
function sameOrigin(request: import("node:http").IncomingMessage): boolean {
  const from = request.headers.origin ?? request.headers.referer;
  if (typeof from !== "string" || from === "null") return false;
  try {
    return new URL(from).host === request.headers.host;
  } catch {
    return false;
  }
}

function readBody(request: import("node:http").IncomingMessage): Promise<string | null> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    // Past the limit the rest is read and dropped, so the 413 reaches the client.
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= LIMIT) chunks.push(chunk);
      else if (size > 16 * LIMIT) request.destroy();
    });
    request.on("end", () => resolveBody(size > LIMIT ? null : Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/** The record a form sends, built field by field from its declared types; null when the body does not fit. */
function formRecord(body: string, fields: readonly (readonly [string, string])[]): Record<string, string | boolean> | null {
  const values = new URLSearchParams(body);
  const record: Record<string, string | boolean> = {};
  for (const [name, type] of fields) {
    if (type === "boolean") record["k_" + name] = values.has(name);
    else {
      const value = values.get(name);
      if (value === null) return null;
      record["k_" + name] = value;
    }
  }
  return Object.freeze(record);
}

/** The page the form is on, with its sent or failed state shown. */
async function answerPage(form: string | null, ok: boolean): Promise<string | null> {
  const entry = form !== null && Object.hasOwn(forms, form) ? forms[form] : undefined;
  if (entry === undefined) return null;
  const [html, sent, failed] = entry;
  const page = await readFile(join(site, html), "utf8");
  const shown = ok ? sent : failed;
  return page.replace(new RegExp(\`(data-kdm-id="\${shown}"[^>]*?) data-kdm-hidden(="")?\`), "$1");
}

async function send(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, name: string, form: string | null): Promise<void> {
  const target = sends[name]!;
  const scripted = request.headers["x-kadam"] === "1";
  const reply = (status: number, error: string | null): void => {
    response.writeHead(status, { ...SECURITY, "content-type": "application/json" }).end(error === null ? '{"ok":true}' : JSON.stringify({ error }));
  };
  if (request.method !== "POST") {
    response.writeHead(405, { ...SECURITY, allow: "POST" }).end();
    return;
  }
  if (!sameOrigin(request)) return reply(403, "forms can only be sent from this site");
  if (!String(request.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) return reply(415, "send the form as application/x-www-form-urlencoded");
  const body = await readBody(request);
  if (body === null) return reply(413, "the form is too large");
  const record = formRecord(body, target.fields);
  if (record === null) return reply(400, "the form does not match what the server function takes");
  let ok = true;
  try {
    target.call(record as never);
  } catch (error) {
    ok = false;
    console.error(\`kadam: the server function \${name} failed\`, error);
  }
  if (scripted) return reply(ok ? 200 : 500, ok ? null : "the server function failed");
  const page = await answerPage(form, ok);
  if (page === null) return reply(ok ? 200 : 500, ok ? null : "the server function failed");
  response.writeHead(ok ? 200 : 500, { ...SECURITY, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page);
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
    if (Object.hasOwn(sends, name)) {
      await send(request, response, name, new URL(request.url ?? "/", "http://localhost").searchParams.get("form"));
      return;
    }
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
