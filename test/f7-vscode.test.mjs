import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// F7: the VS Code extension, without VS Code: a stand-in `vscode` module
// records what the extension registers, and the real `kadam lsp` answers.

const require = createRequire(import.meta.url);
const Module = require("node:module");

function fakeVscode(folder, documents) {
  const registered = {};
  const published = new Map();
  class Range { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } }
  const listeners = {};
  const api = {
    Range,
    Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    CompletionItem: class { constructor(label, kind) { Object.assign(this, { label, kind }); } },
    CompletionItemKind: { Class: 6, Snippet: 14 },
    TextEdit: { replace: (range, newText) => ({ range, newText }) },
    Hover: class { constructor(contents) { this.contents = contents; } },
    MarkdownString: class { constructor(value) { this.value = value; } },
    Location: class { constructor(uri, range) { Object.assign(this, { uri, range }); } },
    Uri: { parse: (text) => ({ text, toString: () => text }), file: (path) => ({ fsPath: path, toString: () => pathToFileURL(path).href }) },
    window: { createOutputChannel: () => ({ append() {}, appendLine() {}, dispose() {} }), showWarningMessage: (message) => { throw new Error(message); } },
    workspace: {
      getConfiguration: () => ({ get: (key, fallback) => (key === "path" ? process.execPath : fallback) }),
      workspaceFolders: [{ uri: { fsPath: folder } }],
      textDocuments: documents,
      onDidOpenTextDocument: (fn) => (listeners.open = fn, { dispose() {} }),
      onDidChangeTextDocument: (fn) => (listeners.change = fn, { dispose() {} }),
      onDidSaveTextDocument: () => ({ dispose() {} }),
      onDidCloseTextDocument: () => ({ dispose() {} }),
    },
    languages: {
      createDiagnosticCollection: () => ({ set: (uri, list) => published.set(uri.text, list), dispose() {} }),
      registerCompletionItemProvider: (selector, provider) => (registered.completion = provider, {}),
      registerHoverProvider: (selector, provider) => (registered.hover = provider, {}),
      registerDefinitionProvider: (selector, provider) => (registered.definition = provider, {}),
      registerDocumentFormattingEditProvider: (selector, provider) => (registered.formatting = provider, {}),
    },
  };
  return { api, registered, published, listeners };
}

test("the extension drives kadam lsp: errors, completion, definition and formatting", async () => {
  const root = mkdtempSync(join(tmpdir(), "kadam-vscode-"));
  cpSync("test/fixtures/web-components", root, { recursive: true });
  const file = join(root, "pages", "home.kdm");
  const text = readFileSync(file, "utf8").replace("            a paragraph\n", "            a paragraph\n            it flies away\n");
  const document = { languageId: "kadam", uri: { toString: () => pathToFileURL(file).href }, version: 1, getText: () => text };
  const fake = fakeVscode(root, [document]);
  const original = Module._load;
  // The extension runs `<kadam.path> lsp`; here that is node with the built CLI.
  Module._load = function (request, ...rest) {
    if (request === "vscode") return fake.api;
    if (request === "./client.js") {
      const { LspClient } = original.call(this, resolve("editors/vscode/client.js"), ...rest);
      return { LspClient: class extends LspClient { constructor(command, args, options) { super(command, [resolve("dist/cli/main.js"), ...args], options); } } };
    }
    return original.call(this, request, ...rest);
  };
  try {
    delete require.cache[resolve("editors/vscode/extension.js")];
    const extension = require(resolve("editors/vscode/extension.js"));
    extension.activate({ subscriptions: [] });
    for (let i = 0; i < 100 && !fake.published.has(pathToFileURL(file).href); i += 1) await new Promise((r) => setTimeout(r, 50));
    const problems = fake.published.get(pathToFileURL(file).href);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].code, "KDM2001");
    assert.equal(problems[0].severity, 0);
    const lines = text.split("\n");
    const kindLine = lines.findIndex((l) => l.trim() === "a Panel");
    const items = await fake.registered.completion.provideCompletionItems(document, { line: kindLine, character: 11 });
    assert.ok(items.some((item) => item.label === "a Panel"));
    const place = await fake.registered.definition.provideDefinition(document, { line: kindLine, character: 11 });
    assert.equal(place.uri.text, pathToFileURL(join(root, "components", "Panel.kdm")).href);
    const hover = await fake.registered.hover.provideHover(document, { line: lines.findIndex((l) => l.includes("it flies away")), character: 14 });
    assert.match(hover.contents.value, /KDM2001/);
    assert.ok(Array.isArray(await fake.registered.formatting.provideDocumentFormattingEdits(document)));
    await extension.deactivate();
  } finally {
    Module._load = original;
  }
});

test("the grammar, language configuration and manifest are valid", () => {
  const grammar = JSON.parse(readFileSync("editors/vscode/syntaxes/kadam.tmLanguage.json", "utf8"));
  assert.equal(grammar.scopeName, "source.kadam");
  const regexes = [];
  const walk = (node) => {
    if (node && typeof node === "object") for (const [key, value] of Object.entries(node)) {
      if ((key === "match" || key === "begin" || key === "end") && typeof value === "string") regexes.push(value);
      else walk(value);
    }
  };
  walk(grammar.repository);
  for (const source of regexes) assert.doesNotThrow(() => new RegExp(source), source);
  // The element and kind rules recognise real Kadam lines.
  assert.match("    heroTitle {", new RegExp(grammar.repository.element.match));
  assert.match("        a main heading", new RegExp(grammar.repository.kind.match));
  JSON.parse(readFileSync("editors/vscode/language-configuration.json", "utf8"));
  const manifest = JSON.parse(readFileSync("editors/vscode/package.json", "utf8"));
  assert.deepEqual(manifest.contributes.languages[0].extensions, [".kdm"]);
  assert.equal(manifest.main, "./extension.js");
  for (const file of ["extension.js", "client.js"]) assert.equal(spawnSync(process.execPath, ["--check", `editors/vscode/${file}`]).status, 0, file);
});

test("the .vsix package has the manifest, content types and extension files", () => {
  execFileSync(process.execPath, ["scripts/package-vscode.mjs"]);
  const listing = execFileSync("unzip", ["-l", "editors/vscode/kadam-0.3.0.vsix"], { encoding: "utf8" });
  for (const entry of ["[Content_Types].xml", "extension.vsixmanifest", "extension/package.json", "extension/extension.js", "extension/client.js", "extension/syntaxes/kadam.tmLanguage.json", "extension/LICENSE.txt"]) {
    assert.ok(listing.includes(entry), entry);
  }
  const vsixManifest = execFileSync("unzip", ["-p", "editors/vscode/kadam-0.3.0.vsix", "extension.vsixmanifest"], { encoding: "utf8" });
  assert.match(vsixManifest, /<Identity Language="en-US" Id="kadam" Version="0.3.0" Publisher="kadam" \/>/);
  assert.match(vsixManifest, /Microsoft\.VisualStudio\.Code\.Engine" Value="\^1\.85\.0"/);
});
