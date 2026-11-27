import { fileURLToPath, pathToFileURL } from "node:url";

import { formatKadam } from "../cli/format.js";
import { complete, definition, diagnose, hover, type LspDiagnostic } from "./analysis.js";

/**
 * F7: `kadam lsp`, a Language Server Protocol server over stdio with no
 * dependencies. It offers diagnostics (the same as `kadam check`), completion
 * of canonical sentences, hover documentation, go to definition, and
 * formatting (the same as `kadam format`).
 */

type Message = { readonly jsonrpc: "2.0"; readonly id?: number | string; readonly method?: string; readonly params?: unknown };

export function startLanguageServer(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): void {
  const open = new Map<string, string>();
  const published = new Map<string, readonly LspDiagnostic[]>();
  let buffer = Buffer.alloc(0);
  let shutdown = false;

  const send = (message: object): void => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
    output.write(`Content-Length: ${body.length}\r\n\r\n`);
    output.write(body);
  };
  const reply = (id: number | string, result: unknown): void => send({ id, result });

  const refresh = (path: string): void => {
    let results;
    try {
      results = diagnose(path, open);
    } catch (error) {
      send({ method: "window/logMessage", params: { type: 1, message: `kadam: could not check ${path}: ${error instanceof Error ? error.message : String(error)}` } });
      return;
    }
    const seen = new Set<string>();
    for (const { path: file, diagnostics } of results) {
      seen.add(file);
      published.set(file, diagnostics);
      send({ method: "textDocument/publishDiagnostics", params: { uri: pathToFileURL(file).href, diagnostics } });
    }
    // Clear files in the same check that no longer have problems.
    for (const [file, list] of published) {
      if (!seen.has(file) && list.length > 0 && (open.has(file) || file === path)) {
        published.set(file, []);
        send({ method: "textDocument/publishDiagnostics", params: { uri: pathToFileURL(file).href, diagnostics: [] } });
      }
    }
  };

  const handle = (message: Message): void => {
    const params = (message.params ?? {}) as Record<string, any>;
    const pathOf = (uri: string): string => fileURLToPath(uri);
    switch (message.method) {
      case "initialize":
        reply(message.id!, {
          capabilities: {
            textDocumentSync: 1,
            completionProvider: { triggerCharacters: [" "] },
            hoverProvider: true,
            definitionProvider: true,
            documentFormattingProvider: true,
            codeActionProvider: { codeActionKinds: ["quickfix"] },
          },
          serverInfo: { name: "kadam" },
        });
        return;
      case "initialized":
        return;
      case "shutdown":
        shutdown = true;
        reply(message.id!, null);
        return;
      case "exit":
        process.exit(shutdown ? 0 : 1);
        return;
      case "textDocument/didOpen": {
        const path = pathOf(params.textDocument.uri);
        open.set(path, params.textDocument.text);
        refresh(path);
        return;
      }
      case "textDocument/didChange": {
        const path = pathOf(params.textDocument.uri);
        const change = params.contentChanges?.at(-1);
        if (typeof change?.text === "string") open.set(path, change.text);
        refresh(path);
        return;
      }
      case "textDocument/didSave":
        refresh(pathOf(params.textDocument.uri));
        return;
      case "textDocument/didClose": {
        const path = pathOf(params.textDocument.uri);
        open.delete(path);
        return;
      }
      case "textDocument/completion": {
        const path = pathOf(params.textDocument.uri);
        reply(message.id!, { isIncomplete: false, items: complete(path, open.get(path) ?? "", params.position) });
        return;
      }
      case "textDocument/hover": {
        const path = pathOf(params.textDocument.uri);
        const value = hover(open.get(path) ?? "", params.position, published.get(path) ?? []);
        reply(message.id!, value === null ? null : { contents: { kind: "markdown", value } });
        return;
      }
      case "textDocument/definition": {
        const path = pathOf(params.textDocument.uri);
        const found = definition(path, open.get(path) ?? "", params.position);
        reply(message.id!, found === null ? null : { uri: pathToFileURL(found.path).href, range: found.range });
        return;
      }
      case "textDocument/codeAction": {
        // D-50: the fixes the checker offers, as quick fixes.
        const uri = params.textDocument.uri as string;
        const path = pathOf(uri);
        const line = params.range?.start?.line ?? 0;
        const actions = (published.get(path) ?? [])
          .filter((diagnostic) => diagnostic.range.start.line <= line && diagnostic.range.end.line >= line)
          .flatMap((diagnostic) => (diagnostic.data?.fixes ?? []).map((fix, index) => ({
            title: fix.title,
            kind: "quickfix",
            diagnostics: [diagnostic],
            isPreferred: index === 0,
            edit: { changes: { [uri]: [{ range: fix.range, newText: fix.newText }] } },
          })));
        reply(message.id!, actions);
        return;
      }
      case "textDocument/formatting": {
        const path = pathOf(params.textDocument.uri);
        const text = open.get(path) ?? "";
        const result = formatKadam(text);
        if (!result.ok || !result.changed) {
          reply(message.id!, []);
          return;
        }
        const lines = text.split("\n");
        reply(message.id!, [{ range: { start: { line: 0, character: 0 }, end: { line: lines.length, character: 0 } }, newText: result.text }]);
        return;
      }
      default:
        if (message.id !== undefined && message.method !== undefined) send({ id: message.id, error: { code: -32601, message: `kadam lsp does not handle ${message.method}` } });
    }
  };

  input.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.subarray(0, headerEnd).toString("ascii");
      const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1] ?? NaN);
      if (!Number.isFinite(length)) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      if (buffer.length < headerEnd + 4 + length) return;
      const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8");
      buffer = buffer.subarray(headerEnd + 4 + length);
      let message: Message;
      try {
        message = JSON.parse(body) as Message;
      } catch {
        continue;
      }
      try {
        handle(message);
      } catch (error) {
        if (message.id !== undefined) send({ id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
      }
    }
  });
}
