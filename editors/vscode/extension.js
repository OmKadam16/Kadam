// Kadam for VS Code: highlighting, and errors, completion, hover, go to
// definition and formatting from `kadam lsp`.
"use strict";

const vscode = require("vscode");
const { LspClient } = require("./client.js");

let client = null;

function toRange(range) {
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}

function activate(context) {
  const config = vscode.workspace.getConfiguration("kadam");
  const command = config.get("path", "kadam");
  const output = vscode.window.createOutputChannel("Kadam");
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  client = new LspClient(command, ["lsp"], { cwd: folder, onError: (text) => output.append(text) });
  const diagnostics = vscode.languages.createDiagnosticCollection("kadam");
  context.subscriptions.push(diagnostics, output);

  client.on("textDocument/publishDiagnostics", (params) => {
    const uri = vscode.Uri.parse(params.uri);
    diagnostics.set(uri, params.diagnostics.map((item) => {
      const severity = item.severity === 1 ? vscode.DiagnosticSeverity.Error : item.severity === 2 ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
      const diagnostic = new vscode.Diagnostic(toRange(item.range), item.message, severity);
      diagnostic.code = item.code;
      diagnostic.source = "kadam";
      return diagnostic;
    }));
  });
  client.on("window/logMessage", (params) => output.appendLine(params.message));

  const ready = client.request("initialize", { processId: process.pid, rootUri: folder ? vscode.Uri.file(folder).toString() : null, capabilities: {} })
    .then(() => client.notify("initialized", {}))
    .catch((error) => {
      vscode.window.showWarningMessage(`Kadam: could not start "${command} lsp" (${error.message}). Set kadam.path to the kadam command.`);
    });

  const isKadam = (document) => document.languageId === "kadam";
  const opened = (document) => {
    if (!isKadam(document)) return;
    ready.then(() => client.notify("textDocument/didOpen", { textDocument: { uri: document.uri.toString(), languageId: "kadam", version: document.version, text: document.getText() } }));
  };
  vscode.workspace.textDocuments.forEach(opened);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(opened),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!isKadam(event.document)) return;
      ready.then(() => client.notify("textDocument/didChange", { textDocument: { uri: event.document.uri.toString(), version: event.document.version }, contentChanges: [{ text: event.document.getText() }] }));
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isKadam(document)) ready.then(() => client.notify("textDocument/didSave", { textDocument: { uri: document.uri.toString() } }));
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (isKadam(document)) ready.then(() => client.notify("textDocument/didClose", { textDocument: { uri: document.uri.toString() } }));
    }),
  );

  const where = (document, position) => ({ textDocument: { uri: document.uri.toString() }, position: { line: position.line, character: position.character } });
  const selector = { language: "kadam" };
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, {
      async provideCompletionItems(document, position) {
        await ready;
        const result = await client.request("textDocument/completion", where(document, position));
        return (result?.items ?? []).map((item) => {
          const completion = new vscode.CompletionItem(item.label, item.kind === 7 ? vscode.CompletionItemKind.Class : vscode.CompletionItemKind.Snippet);
          completion.detail = item.detail;
          completion.filterText = item.filterText;
          if (item.textEdit) completion.textEdit = vscode.TextEdit.replace(toRange(item.textEdit.range), item.textEdit.newText);
          return completion;
        });
      },
    }, " "),
    vscode.languages.registerHoverProvider(selector, {
      async provideHover(document, position) {
        await ready;
        const result = await client.request("textDocument/hover", where(document, position));
        return result ? new vscode.Hover(new vscode.MarkdownString(result.contents.value)) : null;
      },
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(document, position) {
        await ready;
        const result = await client.request("textDocument/definition", where(document, position));
        return result ? new vscode.Location(vscode.Uri.parse(result.uri), toRange(result.range)) : null;
      },
    }),
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      async provideDocumentFormattingEdits(document) {
        await ready;
        const edits = await client.request("textDocument/formatting", { textDocument: { uri: document.uri.toString() }, options: { tabSize: 4, insertSpaces: true } });
        return (edits ?? []).map((edit) => vscode.TextEdit.replace(toRange(edit.range), edit.newText));
      },
    }),
  );
}

async function deactivate() {
  if (client !== null) await client.stop();
}

module.exports = { activate, deactivate };
