import { test } from "node:test";
import assert from "node:assert/strict";

import { createSourceFile } from "../dist/core/source/source-file.js";
import { lex } from "../dist/core/lexer/lexer.js";

function lexText(text) {
  const created = createSourceFile("inline.kdm", text);
  const result = lex(created.source);
  return {
    ...result,
    diagnostics: [...created.diagnostics, ...result.diagnostics],
    source: created.source,
  };
}

test("lexer recognizes every v0.1 token category", () => {
  const result = lexText(
    [
      "kadam 0.1 // version",
      'page "Hi\\n" {',
      "    button1 {",
      "        a button 160px 1.5rem 150ms 0.3s 105% #ABC blue",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  assert.deepEqual(result.diagnostics, []);
  const kinds = new Set(result.tokens.map((token) => token.kind));
  for (const kind of [
    "keyword",
    "number",
    "comment",
    "newline",
    "string",
    "lbrace",
    "rbrace",
    "identifier",
    "length",
    "duration",
    "percentage",
    "hex-color",
    "color",
    "eof",
  ]) {
    assert.ok(kinds.has(kind), `missing token kind: ${kind}`);
  }

  const string = result.tokens.find((token) => token.kind === "string");
  assert.equal(string.value, "Hi\n");
  const lengths = result.tokens
    .filter((token) => token.kind === "length")
    .map((token) => [token.value, token.unit]);
  assert.deepEqual(lengths, [
    [160, "px"],
    [1.5, "rem"],
  ]);
  const durations = result.tokens
    .filter((token) => token.kind === "duration")
    .map((token) => [token.value, token.unit]);
  assert.deepEqual(durations, [
    [150, "ms"],
    [0.3, "s"],
  ]);
});

test("lexer preserves 1-based line and code-point column spans", () => {
  const result = lexText('page "Home" {\n    title1 {\n}\n');
  const page = result.tokens[0];
  assert.equal(page.text, "page");
  assert.deepEqual(
    [page.span.start.line, page.span.start.column],
    [1, 1],
  );
  const title = result.tokens.find((token) => token.text === "title1");
  assert.deepEqual(
    [title.span.start.line, title.span.start.column],
    [2, 5],
  );

  const source = createSourceFile("unicode.kdm", "\u{1F600}x").source;
  assert.deepEqual(source.positionAt(2), { offset: 2, line: 1, column: 2 });
});

test("lexer reports invalid strings and characters with stable codes", () => {
  const unterminated = lexText('page "Home {\n');
  assert.ok(unterminated.diagnostics.some((item) => item.code === "KDM1002"));

  const escape = lexText('page "bad \\q" {\n}\n');
  assert.ok(escape.diagnostics.some((item) => item.code === "KDM1003"));

  const quote = lexText("page 'Home' {\n}\n");
  assert.ok(quote.diagnostics.some((item) => item.code === "KDM1001"));

  const semicolon = lexText('page "Home" {\n    a card;\n}\n');
  assert.ok(semicolon.diagnostics.some((item) => item.code === "KDM1001"));
});

test("lexer folds numbers and units and rejects malformed units", () => {
  const spaced = lexText("it is 160 px wide\n");
  const length = spaced.tokens.find((token) => token.kind === "length");
  assert.equal(length.value, 160);
  assert.equal(length.unit, "px");
  assert.deepEqual(spaced.diagnostics, []);

  const malformed = lexText("it is 160pix wide\n");
  assert.ok(malformed.diagnostics.some((item) => item.code === "KDM1004"));

  const keywordAfterNumber = lexText("it is 160 wide\n");
  assert.deepEqual(keywordAfterNumber.diagnostics, []);
  assert.equal(
    keywordAfterNumber.tokens.find((token) => token.kind === "length"),
    undefined,
  );
});

test("source limits produce KDM1005 diagnostics", () => {
  const created = createSourceFile("long.kdm", "123456\n", {
    maxBytes: 1024,
    maxLineLength: 5,
  });
  assert.deepEqual(created.diagnostics.map((item) => item.code), ["KDM1005"]);
  assert.equal(created.diagnostics[0].span.start.line, 1);
});

test("comments are preserved in the side channel and after statements", () => {
  const result = lexText(
    'page "Home" { // header\n    // own line\n    a card // trailing\n}\n',
  );
  assert.equal(result.comments.length, 3);
  assert.deepEqual(
    result.comments.map((comment) => comment.text),
    ["// header", "// own line", "// trailing"],
  );
  assert.equal(result.diagnostics.length, 0);
});
