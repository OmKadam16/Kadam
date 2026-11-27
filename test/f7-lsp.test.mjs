import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// F7: kadam lsp, driven the way an editor drives it.

const children = new Set();
process.on("exit", () => { for (const child of children) child.kill(); });

function client() {
  const child = spawn(process.execPath, ["dist/cli/main.js", "lsp"], { stdio: ["pipe", "pipe", "inherit"] });
  children.add(child);
  child.on("exit", () => children.delete(child));
  let buffer = Buffer.alloc(0);
  let id = 0;
  const waiting = new Map();
  const notifications = [];
  const listeners = [];
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, end).toString())[1]);
      if (buffer.length < end + 4 + length) return;
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
      buffer = buffer.subarray(end + 4 + length);
      if (message.id !== undefined && waiting.has(message.id)) {
        waiting.get(message.id)(message);
        waiting.delete(message.id);
      } else {
        notifications.push(message);
        for (const listener of listeners.splice(0)) listener();
      }
    }
  });
  const write = (message) => {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  return {
    request(method, params) {
      id += 1;
      const current = id;
      return new Promise((resolve) => {
        waiting.set(current, resolve);
        write({ id: current, method, params });
      });
    },
    notify(method, params) {
      write({ method, params });
    },
    async diagnosticsFor(uri) {
      for (let tries = 0; tries < 100; tries += 1) {
        const found = notifications.filter((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri).at(-1);
        if (found !== undefined) {
          notifications.length = 0;
          return found.params.diagnostics;
        }
        await new Promise((resolve) => listeners.push(resolve));
      }
      throw new Error("no diagnostics");
    },
    kill() {
      child.kill();
    },
    async close() {
      const exited = new Promise((resolve) => child.on("exit", resolve));
      await this.request("shutdown", null);
      this.notify("exit", null);
      await exited;
    },
  };
}

function project() {
  const root = mkdtempSync(join(tmpdir(), "kadam-lsp-"));
  cpSync("test/fixtures/web-components", root, { recursive: true });
  return root;
}

test("the server reports the same problems as kadam check, as you type", async (t) => {
  const root = project();
  const lsp = client();
  t.after(() => lsp.kill());
  const init = await lsp.request("initialize", { capabilities: {} });
  assert.deepEqual(Object.keys(init.result.capabilities).sort(), ["codeActionProvider", "completionProvider", "definitionProvider", "documentFormattingProvider", "hoverProvider", "textDocumentSync"]);
  lsp.notify("initialized", {});
  const file = join(root, "pages", "home.kdm");
  const uri = pathToFileURL(file).href;
  const text = readFileSync(file, "utf8");
  lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId: "kadam", version: 1, text } });
  assert.deepEqual(await lsp.diagnosticsFor(uri), []);
  const broken = text.replace("            a paragraph\n", "            a paragraph\n            it flies away\n");
  lsp.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: broken }] });
  const problems = await lsp.diagnosticsFor(uri);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, "KDM2001");
  assert.equal(problems[0].severity, 1);
  assert.match(problems[0].message, /unrecognized statement "it flies away"/);
  const line = broken.split("\n").findIndex((l) => l.includes("it flies away"));
  assert.deepEqual(problems[0].range.start, { line, character: 12 });
  // Hover on that line explains the code.
  const explained = await lsp.request("textDocument/hover", { textDocument: { uri }, position: { line, character: 14 } });
  assert.match(explained.result.contents.value, /\*\*KDM2001\*\*/);
  // Fixing it clears the problem.
  lsp.notify("textDocument/didChange", { textDocument: { uri, version: 3 }, contentChanges: [{ text }] });
  assert.deepEqual(await lsp.diagnosticsFor(uri), []);
  await lsp.close();
});

test("completion offers canonical sentences and the project's components", async (t) => {
  const root = project();
  const lsp = client();
  t.after(() => lsp.kill());
  await lsp.request("initialize", { capabilities: {} });
  const file = join(root, "pages", "home.kdm");
  const uri = pathToFileURL(file).href;
  const text = 'kadam 0.3\n\npage "Home" {\n    box1 {\n        a container\n        it arranges its chi\n    }\n    p2 {\n        a Pa\n    }\n}\n';
  lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId: "kadam", version: 1, text } });
  const sentences = await lsp.request("textDocument/completion", { textDocument: { uri }, position: { line: 5, character: 27 } });
  const labels = sentences.result.items.map((item) => item.label);
  assert.ok(labels.includes("it arranges its children in a row"), labels.join(" | "));
  assert.ok(labels.every((label) => label.startsWith("it arranges its chi")));
  assert.deepEqual(sentences.result.items[0].textEdit.range, { start: { line: 5, character: 8 }, end: { line: 5, character: 27 } });
  const components = await lsp.request("textDocument/completion", { textDocument: { uri }, position: { line: 8, character: 12 } });
  const offered = components.result.items.map((item) => item.label);
  assert.ok(offered.includes("a Panel") && offered.includes("a paragraph"), offered.join(" | "));
  assert.equal(components.result.items.find((item) => item.label === "a Panel").detail, `Component from ${join(root, "components", "Panel.kdm")}`);
  await lsp.close();
});

test("hover describes the sentence, and go to definition finds components, elements and states", async (t) => {
  const root = project();
  const lsp = client();
  t.after(() => lsp.kill());
  await lsp.request("initialize", { capabilities: {} });
  const file = join(root, "pages", "home.kdm");
  const uri = pathToFileURL(file).href;
  const text = readFileSync(file, "utf8").replace("        a Panel\n", '        a Panel\n        it remembers count, a number that starts as 0\n');
  lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId: "kadam", version: 1, text } });
  const lines = text.split("\n");
  const kindLine = lines.findIndex((l) => l.trim() === "a Panel");
  const about = await lsp.request("textDocument/hover", { textDocument: { uri }, position: { line: lines.findIndex((l) => l.includes("a paragraph")), character: 14 } });
  assert.match(about.result.contents.value, /Kind sentence|kind/i);
  const panel = await lsp.request("textDocument/definition", { textDocument: { uri }, position: { line: kindLine, character: 11 } });
  assert.equal(panel.result.uri, pathToFileURL(join(root, "components", "Panel.kdm")).href);
  assert.deepEqual(panel.result.range.start, { line: 2, character: 10 });
  const stateLine = lines.findIndex((l) => l.includes("it remembers count"));
  const state = await lsp.request("textDocument/definition", { textDocument: { uri }, position: { line: stateLine, character: 22 } });
  assert.deepEqual(state.result.range.start, { line: stateLine, character: 21 });
  await lsp.close();
});

test("formatting through the server matches kadam format", async (t) => {
  const lsp = client();
  t.after(() => lsp.kill());
  await lsp.request("initialize", { capabilities: {} });
  const uri = pathToFileURL(join(mkdtempSync(join(tmpdir(), "kadam-lsp-")), "a.kdm")).href;
  lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId: "kadam", version: 1, text: 'kadam 0.3\npage "A" {\n  t1 {\n      a paragraph\n  the text says "x"\n  }\n}' } });
  const edits = await lsp.request("textDocument/formatting", { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } });
  assert.equal(edits.result[0].newText, 'kadam 0.3\npage "A" {\n    t1 {\n        a paragraph\n        the text says "x"\n    }\n}\n');
  await lsp.close();
});

test("D-50: the fixes the checker offers are quick fixes in the editor", async (t) => {
  const lsp = client();
  t.after(() => lsp.kill());
  await lsp.request("initialize", { capabilities: {} });
  const dir = mkdtempSync(join(tmpdir(), "kadam-lsp-fix-"));
  const uri = pathToFileURL(join(dir, "home.kdm")).href;
  lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId: "kadam", version: 1, text: 'kadam 0.4\n\nA big blck button says "Go".\n' } });
  const diagnostics = await lsp.diagnosticsFor(uri);
  assert.equal(diagnostics.length, 1);
  const actions = (await lsp.request("textDocument/codeAction", { textDocument: { uri }, range: diagnostics[0].range, context: { diagnostics } })).result;
  assert.deepEqual(actions.map((action) => action.title), ['Fix: A big black button says "Go"']);
  assert.equal(actions[0].isPreferred, true);
  assert.deepEqual(actions[0].edit.changes[uri], [{ range: { start: { line: 2, character: 6 }, end: { line: 2, character: 10 } }, newText: "black" }]);
  await lsp.close();
});
