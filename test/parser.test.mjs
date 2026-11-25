import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { parseText } from "../dist/core/parser/parser.js";
import { createSourceFile } from "../dist/core/source/source-file.js";
import { lex } from "../dist/core/lexer/lexer.js";
import {
  matchLine,
  templateExamples,
} from "../dist/core/parser/registry.js";
import { matchSizeState } from "../dist/core/parser/matchers-appearance.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function parseFixture(relativePath) {
  const path = join(root, "test", "fixtures", relativePath);
  return parseText(relativePath, readFileSync(path, "utf8"));
}

function codes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function tokensFor(line) {
  const created = createSourceFile("inline.kdm", line);
  return lex(created.source).tokens.filter(
    (token) =>
      token.kind !== "newline" &&
      token.kind !== "eof" &&
      token.kind !== "comment",
  );
}

function findElement(result, name) {
  const visit = (elements) => {
    for (const element of elements) {
      if (element.name === name) return element;
      const found = visit(element.children);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(result.document.page?.elements ?? []);
}

function assertSpan(span, file) {
  assert.equal(typeof span.file, "string");
  assert.equal(span.file, file);
  assert.ok(span.start.line >= 1);
  assert.ok(span.start.column >= 1);
  assert.ok(span.end.offset >= span.start.offset);
}

test("valid minimal page parses without diagnostics", () => {
  const result = parseFixture("valid/minimal.kdm");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.document.type, "document");
  assert.equal(result.document.version, "0.1");
  assert.equal(result.document.page?.title, "Minimal");
  assert.equal(result.document.page?.elements.length, 1);

  const title = result.document.page.elements[0];
  assert.equal(title.name, "title1");
  assert.equal(title.kind?.reference.type, "builtin-kind");
  assert.equal(title.kind?.reference.name, "main heading");
  assert.equal(title.statements.length, 1);
  assert.equal(title.statements[0].type, "text");
  assert.equal(title.statements[0].value, "Hello, Kadam.");
});

test("valid nested elements preserve structure and source order", () => {
  const result = parseFixture("valid/nested.kdm");
  assert.deepEqual(result.diagnostics, []);
  const pageContent = findElement(result, "pageContent1");
  const card = findElement(result, "card1");
  assert.ok(pageContent);
  assert.ok(card);
  assert.equal(pageContent.kind.reference.name, "container");
  assert.equal(card.kind.reference.name, "card");
  assert.equal(pageContent.children[0].name, "card1");
  assert.deepEqual(
    card.children.map((child) => child.name),
    ["cardTitle1", "cardBody1"],
  );
});

test("valid multiple elements preserve declaration order", () => {
  const result = parseFixture("valid/multiple.kdm");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.document.page.elements.map((element) => element.name),
    ["intro1", "action1", "action2", "rule1"],
  );
  assert.equal(result.document.page.elements[3].kind.reference.name, "divider");
});

test("valid strings decode escapes and preserve comment-like text", () => {
  const result = parseFixture("valid/strings.kdm");
  assert.deepEqual(result.diagnostics, []);
  const quoted = findElement(result, "quoted1");
  const escaped = findElement(result, "escaped1");
  assert.equal(
    quoted.statements[0].value,
    'Quotes: "Kadam". A path: C:\\docs. // not a comment.',
  );
  assert.equal(escaped.statements[0].value, "Tab:\tLine:\nUnicode:\u00E9");
});

test("valid fixtures cover every built-in kind and interaction form", () => {
  const result = parseFixture("valid/all-kinds.kdm");
  assert.deepEqual(result.diagnostics, []);
  const names = result.document.page.elements.map((element) => element.name);
  assert.equal(
    names.length,
    13,
    "all-kinds fixture should keep one element per built-in kind plus variants",
  );

  const button = findElement(result, "button1");
  assert.equal(button.statements.filter((item) => item.type === "hover").length, 3);
  assert.equal(button.statements.filter((item) => item.type === "motion").length, 1);
  const responsive = button.statements.find((item) => item.type === "responsive");
  assert.equal(responsive.breakpoint, "phones");
  assert.equal(responsive.statement.type, "gradient-direction");

  const image = findElement(result, "image2");
  assert.ok(image.statements.some((item) => item.type === "decorative"));
  const field = findElement(result, "field1");
  assert.ok(field.statements.some((item) => item.type === "required"));
});

test("optional periods and comments do not change the AST", () => {
  const result = parseFixture("valid/punctuation.kdm");
  assert.deepEqual(result.diagnostics, []);
  const card = findElement(result, "card1");
  assert.equal(card.statements.filter((item) => item.type === "spacing").length, 2);
  assert.equal(card.kind.reference.name, "card");
});

test("portfolio examples are valid M1 source files", () => {
  for (const path of [
    "examples/hello.kdm",
    "examples/portfolio/pages/home.kdm",
    "examples/portfolio/pages/about.kdm",
  ]) {
    const result = parseText(path, readFileSync(join(root, path), "utf8"));
    assert.deepEqual(result.diagnostics, [], path);
    assert.equal(result.document.page !== null, true, path);
  }
});

test("every canonical template example matches exactly one template", () => {
  const examples = templateExamples();
  assert.ok(examples.length >= 60);
  for (const example of examples) {
    const result = matchLine(tokensFor(example));
    assert.equal(
      result.matches.length,
      1,
      `${example} matched ${result.matches.map((match) => match.template.id).join(", ")}`,
    );
    assert.ok(result.selected, example);
    assert.deepEqual(result.diagnostics, [], example);
  }
});

test("injected overlapping templates fail with KDM9001 instead of guessing", () => {
  const fixture = parseFixture("invalid/ambiguous-line.kdm");
  assert.deepEqual(fixture.diagnostics, [], "the fixture is valid under official templates");

  const line = readFileSync(
    join(root, "test", "fixtures", "invalid", "ambiguous-line.kdm"),
    "utf8",
  )
    .split("\n")
    .find((candidate) => candidate.trim() === "it is 160px wide");
  assert.ok(line);
  const tokens = tokensFor(line.trim());

  const overlap = [
    {
      id: "probe-size",
      description: "first injected overlapping template",
      examples: ["it is 160px wide"],
      match: (candidate) => matchSizeState(candidate),
    },
    {
      id: "probe-width",
      description: "second injected overlapping template",
      examples: ["it is 160px wide"],
      match: (candidate) => matchSizeState(candidate),
    },
  ];
  const result = matchLine(tokens, { allowResponsive: true }, overlap);
  assert.equal(result.matches.length, 2);
  assert.equal(result.selected, null);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["KDM9001"]);
  assert.match(result.diagnostics[0].message, /probe-size/);
  assert.match(result.diagnostics[0].message, /probe-width/);
});

test("identical input produces identical AST and diagnostics", () => {
  const path = "test/fixtures/valid/all-kinds.kdm";
  const text = readFileSync(join(root, path), "utf8");
  const first = parseText(path, text);
  const second = parseText(path, text);
  assert.equal(
    JSON.stringify(first.document),
    JSON.stringify(second.document),
  );
  assert.equal(
    JSON.stringify(first.diagnostics),
    JSON.stringify(second.diagnostics),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(first.document)),
    first.document,
  );
});

test("every AST node and diagnostic carries file, line, and column", () => {
  const result = parseFixture("valid/all-kinds.kdm");
  assertSpan(result.document.span, "valid/all-kinds.kdm");
  assertSpan(result.document.page.span, "valid/all-kinds.kdm");

  const visit = (element) => {
    assertSpan(element.span, "valid/all-kinds.kdm");
    assertSpan(element.nameSpan, "valid/all-kinds.kdm");
    if (element.kind !== null) assertSpan(element.kind.span, "valid/all-kinds.kdm");
    for (const statement of element.statements) {
      assertSpan(statement.span, "valid/all-kinds.kdm");
      if (statement.type === "responsive") {
        assertSpan(statement.statement.span, "valid/all-kinds.kdm");
      }
      if (statement.type === "text") {
        assertSpan(statement.valueSpan, "valid/all-kinds.kdm");
      }
    }
    for (const child of element.children) visit(child);
  };
  for (const element of result.document.page.elements) visit(element);
});

test("invalid fixtures report their expected code, line, and column", () => {
  const cases = [
    {
      file: "invalid/invalid-page.kdm",
      code: "KDM2002",
      line: 1,
      column: 1,
    },
    {
      file: "invalid/missing-opening-brace.kdm",
      code: "KDM2002",
      line: 1,
      column: 1,
    },
    {
      file: "invalid/missing-closing-brace.kdm",
      code: "KDM2005",
      line: 1,
      column: 1,
    },
    {
      file: "invalid/duplicate-names.kdm",
      code: "KDM3008",
      line: 6,
      column: 5,
    },
    {
      file: "invalid/unknown-kind.kdm",
      code: "KDM3001",
      line: 3,
      column: 11,
    },
    {
      file: "invalid/unknown-statement.kdm",
      code: "KDM2001",
      line: 4,
      column: 9,
    },
    {
      file: "invalid/unsupported-statement.kdm",
      code: "KDM3003",
      line: 4,
      column: 9,
    },
    {
      file: "invalid/incorrect-values.kdm",
      code: "KDM3006",
      line: 4,
      column: 15,
    },
  ];

  for (const expected of cases) {
    const result = parseFixture(expected.file);
    const diagnostic = result.diagnostics.find(
      (item) => item.code === expected.code,
    );
    assert.ok(
      diagnostic,
      `${expected.file}: expected ${expected.code}, got ${codes(result).join(", ")}`,
    );
    assert.equal(diagnostic.span.file, expected.file);
    assert.equal(diagnostic.span.start.line, expected.line);
    assert.equal(diagnostic.span.start.column, expected.column);
    assert.ok(diagnostic.message.length > 0);
  }
});

test("incorrect values report both invalid colors and invalid typed values", () => {
  const result = parseFixture("invalid/incorrect-values.kdm");
  assert.deepEqual(codes(result), ["KDM3006", "KDM3005", "KDM3005"]);
  assert.match(result.diagnostics[0].message, /invalid hex color/);
  assert.match(result.diagnostics[1].message, /bare number/);
  assert.match(result.diagnostics[2].message, /outside 100%–200%/);
});

test("unrecognized statements include deterministic suggestions", () => {
  const result = parseFixture("invalid/unknown-statement.kdm");
  const diagnostic = result.diagnostics.find((item) => item.code === "KDM2001");
  assert.ok(diagnostic);
  assert.ok(diagnostic.hint);
  assert.match(diagnostic.hint, /did you mean/);
});

test("missing element and page closing braces are both reported", () => {
  const result = parseText(
    "inline.kdm",
    'page "T" {\n    card1 {\n        a card\n',
  );
  const missing = result.diagnostics.filter((item) => item.code === "KDM2005");
  assert.equal(missing.length, 2);
  assert.ok(missing.some((item) => /element "card1"/.test(item.message)));
  assert.ok(missing.some((item) => /page "T"/.test(item.message)));
});

test("a kind sentence after another statement is KDM2003", () => {
  const result = parseText(
    "inline.kdm",
    'page "T" {\n    card1 {\n        has a white background\n        a card\n    }\n}\n',
  );
  assert.deepEqual(codes(result), ["KDM2003"]);
  assert.equal(findElement(result, "card1").kind.reference.name, "card");
});

test("missing kind sentences and leaf children are reported", () => {
  const missing = parseText(
    "inline.kdm",
    'page "T" {\n    card1 {\n    }\n}\n',
  );
  assert.deepEqual(codes(missing), ["KDM2004"]);

  const leaf = parseText(
    "inline.kdm",
    'page "T" {\n    button1 {\n        a button\n        the text says "Go"\n        child1 {\n            a card\n        }\n    }\n}\n',
  );
  assert.deepEqual(codes(leaf), ["KDM3010"]);
});

test("duplicate properties use one scope and one diagnostic per statement", () => {
  const result = parseText(
    "inline.kdm",
    [
      'page "T" {',
      "    heading1 {",
      "        a main heading",
      '        the text says "A"',
      '        the text says "B"',
      "        the text is 18px",
      "        the text is 20px",
      "        it has 16px padding",
      "        it has 24px padding on the left",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  const duplicates = result.diagnostics.filter(
    (item) => item.code === "KDM3004",
  );
  assert.equal(duplicates.length, 3);
  assert.ok(duplicates.every((item) => item.related?.length === 1));
});

test("duplicate properties in separate breakpoints are allowed", () => {
  const result = parseText(
    "inline.kdm",
    [
      'page "T" {',
      "    card1 {",
      "        a card",
      "        it is 100px wide",
      "        on phones, it is 80px wide",
      "        on tablets, it is 90px wide",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  assert.deepEqual(result.diagnostics, []);
});

test("responsive scopes reject content and interaction statements", () => {
  const result = parseText(
    "inline.kdm",
    [
      'page "T" {',
      "    card1 {",
      "        a card",
      '        on phones, the text says "No"',
      "        on tablets, when hovered, it lifts by 2px",
      "        on phones, on phones, it is hidden",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  const rejected = result.diagnostics.filter(
    (item) => item.code === "KDM3013",
  );
  assert.equal(rejected.length, 3);
});

test("responsive punctuation and breakpoints are validated", () => {
  const missingComma = parseText(
    "inline.kdm",
    'page "T" {\n    card1 {\n        a card\n        on phones it is hidden\n    }\n}\n',
  );
  assert.ok(codes(missingComma).includes("KDM2010"));

  const unknownBreakpoint = parseText(
    "inline.kdm",
    'page "T" {\n    card1 {\n        a card\n        on watches, it is hidden\n    }\n}\n',
  );
  assert.ok(codes(unknownBreakpoint).includes("KDM3005"));
});

test("hover background is rejected when a responsive scope uses a gradient", () => {
  const result = parseText(
    "inline.kdm",
    [
      'page "T" {',
      "    card1 {",
      "        a card",
      "        has a white background",
      "        on phones, has a blue and black gradient",
      "        when hovered, the background turns red",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  assert.deepEqual(codes(result), ["KDM3015"]);
});

test("hover border honors explicit removal of the text field default border", () => {
  const defaultBorder = parseText(
    "inline.kdm",
    [
      'page "T" {',
      "    field1 {",
      "        a text field",
      '        the label says "Email"',
      "        when hovered, the border turns black",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  assert.deepEqual(defaultBorder.diagnostics, []);

  for (const border of ["has no border", "has a 0px white border"]) {
    const result = parseText(
      "inline.kdm",
      [
        'page "T" {',
        "    field1 {",
        "        a text field",
        '        the label says "Email"',
        `        ${border}`,
        "        when hovered, the border turns black",
        "    }",
        "}",
        "",
      ].join("\n"),
    );
    assert.deepEqual(codes(result), ["KDM3014"], border);
  }
});

test("hover border and gradient constraints are checked", () => {
  const border = parseText(
    "inline.kdm",
    'page "T" {\n    card1 {\n        a card\n        when hovered, the border turns black\n    }\n}\n',
  );
  assert.deepEqual(codes(border), ["KDM3014"]);

  const gradient = parseText(
    "inline.kdm",
    [
      'page "T" {',
      "    card1 {",
      "        a card",
      "        has a blue and black gradient",
      "        when hovered, the background turns red",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  assert.deepEqual(codes(gradient), ["KDM3015"]);
});

test("gradient directions require a gradient", () => {
  const result = parseText(
    "inline.kdm",
    'page "T" {\n    card1 {\n        a card\n        the gradient goes from left to right\n    }\n}\n',
  );
  assert.deepEqual(codes(result), ["KDM3005"]);
});

test("image descriptions and decorative declarations are mutually exclusive", () => {
  const result = parseText(
    "inline.kdm",
    [
      'page "T" {',
      "    image1 {",
      "        an image",
      '        it shows "mark.svg"',
      '        the description says "Mark"',
      "        it is decorative",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  assert.deepEqual(codes(result), ["KDM3005"]);
});

test("page settings are unique and belong to the page body", () => {
  const result = parseText(
    "inline.kdm",
    [
      'page "T" {',
      "    the page background is white",
      "    the page background is black",
      "    card1 {",
      "        a card",
      "        the page text is black",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  assert.deepEqual(codes(result), ["KDM3004", "KDM3003"]);
});

test("text nouns must match the kind family", () => {
  const result = parseText(
    "inline.kdm",
    'page "T" {\n    button1 {\n        a button\n        the link text says "Wrong"\n    }\n}\n',
  );
  assert.deepEqual(codes(result), ["KDM3003"]);
  assert.match(result.diagnostics[0].message, /not supported/);
});

test("version, page count, and top-level placement are checked", () => {
  const version = parseText(
    "inline.kdm",
    'kadam 0.2\npage "T" {\n}\n',
  );
  assert.deepEqual(codes(version), ["KDM4004"]);

  const misplacedVersion = parseText(
    "inline.kdm",
    'page "T" {\n    kadam 0.1\n}\n',
  );
  assert.deepEqual(codes(misplacedVersion), ["KDM4004"]);

  const outside = parseText("inline.kdm", 'card1 {\n    a card\n}\n');
  assert.ok(codes(outside).includes("KDM2006"));

  const missing = parseText("inline.kdm", "// only a comment\n");
  assert.deepEqual(codes(missing), ["KDM2008"]);

  const second = parseText(
    "inline.kdm",
    'page "A" {\n}\npage "B" {\n}\n',
  );
  assert.ok(codes(second).includes("KDM2008"));
});

test("malformed headers and delimiters are reported precisely", () => {
  const delimiter = parseText(
    "inline.kdm",
    'page "T" { card1 {\n}\n',
  );
  assert.ok(codes(delimiter).includes("KDM2009"));

  const identifier = parseText(
    "inline.kdm",
    'page "T" {\n    Button1 {\n        a card\n    }\n}\n',
  );
  assert.ok(codes(identifier).includes("KDM2007"));

  const emptyTitle = parseText("inline.kdm", 'page "" {\n}\n');
  assert.ok(codes(emptyTitle).includes("KDM3005"));

  const longTitle = parseText(
    "inline.kdm",
    `page "${"x".repeat(81)}" {\n}\n`,
  );
  assert.ok(codes(longTitle).includes("KDM3005"));

  const missingElementBrace = parseText(
    "inline.kdm",
    'page "T" {\n    card1\n}\n',
  );
  assert.ok(codes(missingElementBrace).includes("KDM2002"));
});

test("divider capabilities reject shadows in base and responsive scopes", () => {
  const base = parseText(
    "inline.kdm",
    'page "T" {\n    rule1 {\n        a divider\n        has a soft shadow\n    }\n}\n',
  );
  assert.deepEqual(codes(base), ["KDM3003"]);
  assert.match(base.diagnostics[0].message, /shadow/);

  const responsive = parseText(
    "inline.kdm",
    'page "T" {\n    rule1 {\n        a divider\n        on phones, has a soft shadow\n    }\n}\n',
  );
  assert.deepEqual(codes(responsive), ["KDM3003"]);
});

test("divider capabilities allow margins but reject padding and borders", () => {
  const margin = parseText(
    "inline.kdm",
    'page "T" {\n    rule1 {\n        a divider\n        it has 24px margin on top and bottom\n    }\n}\n',
  );
  assert.deepEqual(margin.diagnostics, []);

  const padding = parseText(
    "inline.kdm",
    'page "T" {\n    rule1 {\n        a divider\n        it has 8px padding\n    }\n}\n',
  );
  assert.deepEqual(codes(padding), ["KDM3003"]);
});

test("comments, blank lines, CRLF, and a BOM do not alter parsing", () => {
  const text =
    "\uFEFFkadam 0.1\r\n\r\n// comment\r\npage \"T\" {\r\n    card1 {\r\n        a card\r\n    }\r\n}\r\n";
  const result = parseText("inline.kdm", text);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.document.page.title, "T");
  assert.equal(result.document.page.elements[0].name, "card1");
});

test("element nesting is limited to 64 levels", () => {
  const lines = ['page "Deep" {'];
  for (let depth = 0; depth < 65; depth += 1) {
    lines.push(`    nested${depth} {`, "        a container");
  }
  for (let depth = 0; depth < 65; depth += 1) lines.push("    }");
  lines.push("}", "");

  const result = parseText("inline.kdm", lines.join("\n"));
  assert.deepEqual(codes(result), ["KDM2011"]);
  assert.match(result.diagnostics[0].message, /64-level/);
});

test("diagnostic reporting stops at 100 with a deterministic summary", () => {
  const lines = ['page "Many" {'];
  for (let index = 0; index < 120; index += 1) {
    lines.push(`    this statement is not valid ${index}`);
  }
  lines.push("}", "");

  const result = parseText("inline.kdm", lines.join("\n"));
  assert.equal(result.diagnostics.length, 100);
  assert.equal(result.diagnostics.at(-1).code, "KDM9003");
  assert.match(result.diagnostics.at(-1).message, /100|99/);
});

test("parser never throws on arbitrary deterministic input", () => {
  const alphabet = [
    "a", "z", "A", "1", " ", "\t", "\n", "{", "}", "(", ")", ",", ".",
    ":", ";", '"', "'", "\\", "#", "-", "%", "\u00E9", "\u{1F600}",
  ];
  let state = 0x2f6e2b1;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };

  for (let iteration = 0; iteration < 250; iteration += 1) {
    const length = next() % 160;
    let text = "";
    for (let index = 0; index < length; index += 1) {
      text += alphabet[next() % alphabet.length];
    }
    const result = parseText("fuzz.kdm", text);
    assert.equal(result.document.type, "document");
    for (const diagnostic of result.diagnostics) {
      assert.equal(diagnostic.span.file, "fuzz.kdm");
      assert.ok(diagnostic.span.start.line >= 1);
      assert.ok(diagnostic.span.start.column >= 1);
      assert.ok(diagnostic.code.startsWith("KDM"));
    }
  }
});

test("an invalid element name yields one diagnostic and keeps the block balanced", () => {
  const source = [
    'page "P" {',
    "    signup {",
    "        a card",
    "        email {",
    "            a text field",
    '            the label says "Email"',
    "        }",
    "        red {",
    "            a container",
    "        }",
    "        two words {",
    "            a container",
    "        }",
    "        last1 {",
    "            a button",
    '            the text says "Go"',
    "        }",
    "    }",
    "}",
    "",
  ].join("\n");
  const result = parseText("names.kdm", source);
  assert.deepEqual(codes(result), ["KDM2007", "KDM2007", "KDM2002"]);
  const [email, red] = result.diagnostics;
  assert.match(email.message, /"email" is a reserved word/);
  assert.match(email.hint, /email1/);
  assert.match(red.message, /"red" is a color name/);
  // Siblings after the bad names still nest under signup.
  assert.ok(findElement(result, "last1"));
});
