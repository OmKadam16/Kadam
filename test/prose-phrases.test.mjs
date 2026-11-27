import { test } from "node:test";
import assert from "node:assert/strict";

import { parseText } from "../dist/core/parser/parser.js";
import { rephrase } from "../dist/core/prose/translate.js";

// D-50 phrase table: other ways of saying sentences the language has.

const blocks = (text) => parseText("home.kdm", `kadam 0.4\n\n${text}\n`, { validate: false }).prose.text;

test("each row of the phrase table says one block sentence", () => {
  const table = [
    ["the background is a gradient with blue on the left and white on the right", ["has a blue and white gradient", "the gradient goes from left to right"]],
    ["the background is blue on the left fading to white on the right", ["has a blue and white gradient", "the gradient goes from left to right"]],
    ['it has a background image "assets/a.jpg"', ['has a "assets/a.jpg" background image']],
    ["its children are centered", ["it centers its children"]],
    ["everything in it is centered", ["it centers its children"]],
    ["its children sit side by side", ["it arranges its children in a row"]],
    ["its children are stacked", ["it arranges its children in a column"]],
    ["its children are in 3 columns", ["it arranges its children in 3 columns"]],
    ["it takes the full width", ["it is full width"]],
    ["it has a border", ["has a 1px #6B728040 border"]],
    ["it has a shadow", ["has a soft shadow"]],
    ["it has big rounded corners", ["has 16px rounded corners"]],
    ["it is hidden on phones", ["on phones, it is hidden"]],
    ["on phones, its children are stacked", ["on phones, it arranges its children in a column"]],
    ["when hovered, it gets bigger", ["when hovered, it scales to 105%"]],
    ["when hovered, it shrinks a little", ["when hovered, it scales to 95%"]],
    ["when hovered, its background turns black", ["when hovered, the background turns black"]],
    ["when clicked, it goes to the pricing page", ['when clicked, go to page "Pricing"']],
    ['it goes to page "Docs"', ['when clicked, go to page "Docs"']],
    ['it opens "https://example.com" in a new tab when clicked', ['when clicked, open "https://example.com" in a new tab']],
    ["it slides in from the left", ["it slides in from the left when the page loads"]],
    ["it fades in", ["it fades in when the page loads"]],
  ];
  for (const [said, lines] of table) assert.deepEqual(rephrase(said), lines, said);
  assert.equal(rephrase("it wobbles"), null);
});

test("phrasings inside a sentence that names a thing", () => {
  assert.match(blocks('A link says "Plans" that goes to the pricing page.'), /a link\n {8}when clicked, go to page "Pricing"\n {8}the text says "Plans"/);
  assert.match(blocks('A button says "Go" and opens "https://example.com".'), /when clicked, open "https:\/\/example\.com" in a new tab/);
  assert.match(blocks('A text field called emailField labelled "Email".'), /a text field\n {8}the label says "Email"/);
  assert.match(blocks('An input says "Email".'), /the label says "Email"/, "a field says its label");
  assert.match(blocks('Gray text in 14px says "x".'), /the text is 14px\n {8}the text is #6B7280/);
  assert.match(blocks('A full-width photo of a hill shows "assets/h.jpg".'), /it is full width\n {8}it shows "assets\/h\.jpg"\n {8}the description says "Photo of a hill"/);
  assert.match(blocks("A row with 16px gap."), /it arranges its children in a row\n {8}it has 16px gap between children/);
  assert.match(blocks('A big heading says "Hi".\nWhen the cursor moves over it, grain surrounds the cursor with a radius of 10px.'), /when the cursor moves over it, grain surrounds the cursor with a radius of 10px/);
});

import { normalizeMotion } from "../dist/core/prose/translate.js";
import { compileText } from "../dist/compiler/compile.js";

test("layout headers and plural headers are boxes around their lines", () => {
  const out = blocks('A big heading says "Hi".\n\nPlans, side by side with 24px gap:\n    A card.\n    A card.\n\nIn 3 columns:\n    Text says "a".\n\nCentered:\n    Text says "b".\n\nCards:\n    A card.');
  assert.match(out, /plans1 \{\n {8}a container\n {8}it arranges its children in a row\n {8}it wraps its children\n {8}it stretches its children\n {8}it has 24px gap between children/);
  assert.match(out, /group1 \{\n {8}a container\n {8}it arranges its children in 3 columns\n {8}on tablets, it arranges its children in 2 columns\n {8}on phones, it arranges its children in 1 column\n {8}it has 16px gap between children/);
  assert.match(out, /group2 \{\n {8}a container\n {8}it centers its children/);
  assert.match(out, /cards1 \{\n {8}a container\n {8}it is full width\n {8}card3 \{/);
  // A header that names no kind and no layout is still a section.
  assert.match(blocks('Pricing:\n    A heading says "x".'), /pricing1 \{\n {8}a section/);
});

test("a word of the language cannot be a name; the fixes rename it", () => {
  const result = compileText("home.kdm", 'kadam 0.4\n\nA big heading says "Hi".\nAn input called email says "Email".\n');
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /the name email is a word of the language/);
  assert.deepEqual(errors[0].fixes.map((fix) => fix.label), ["called email1", "called emailField"]);
  assert.equal(errors[0].fixes[0].text, 'An input called email1 says "Email"');
});

test("the word \"Lumen\" is short text, and dark gray is one color", () => {
  assert.match(blocks('Nav bar:\n    The word "Lumen" in bold on the left.'), /text1 \{\n {12}a paragraph\n {12}the text is bold\n {12}the text says "Lumen"/);
  assert.match(blocks('A big heading says "Hi". The words "Hi" are bold.'), /the words "Hi" are bold/, "a span sentence is unchanged");
  assert.match(blocks('Dark gray text says "b". Light blue text says "c".'), /the text is darkgray[\s\S]*the text is lightblue/);
  assert.match(blocks('A big heading says "Hi".\nWhen the cursor moves over it, white pixels pop out around the cursor.'), /white pixels pop out/, "pixels alone is a word");
});

test("the everyday ways to say an effect", () => {
  const table = [
    ["when the cursor goes over it, white pixels pop out around the cursor", "when the cursor moves over it, white pixels pop out around the cursor"],
    ["when the mouse moves over that section, a glow follows the cursor", "when the cursor moves over it, a glow follows the cursor"],
    ["a glow follows the mouse", "a glow follows the cursor"],
    ["a white fill slides in from the left on hover", "when hovered, a white fill slides in from the left"],
    ["on hover, a shine sweeps across it", "when hovered, a shine sweeps across it"],
    ["it lifts by 4px on hover", "when hovered, it lifts by 4px"],
    ["it lifts on hover", "when hovered, it lifts by 4px"],
    ["it has a sliding animation on hover", "when hovered, a fill slides in from the left"],
    ["its border draws itself on hover", "when hovered, its border draws itself"],
    ["it ripples when you click it", "it ripples when pressed"],
    ["it tilts when you scroll", "it tilts as you scroll"],
    ["it appears when you scroll to it", "it appears as you scroll"],
    ["it fades in as you scroll", "it appears as you scroll"],
    ["it slides in from the left as you scroll", "it slides in from the left when it scrolls into view"],
    ["it types itself out", "it types itself"],
    ["its words appear one by one", "it appears word by word"],
    ["it is magnetic", "it pulls toward the cursor"],
  ];
  for (const [said, canonical] of table) assert.equal(normalizeMotion(said), canonical, said);
  assert.equal(normalizeMotion("it types itself"), null, "already canonical");
  assert.equal(normalizeMotion("when hovered, it lifts by 2px"), null);
});

import { hover } from "../dist/lsp/analysis.js";

test("gap words, spacing words and background phrasings", () => {
  const gap = (sentence) => blocks(`Text says "a".\n${sentence}\nText says "b".`).match(/it has (\S+) margin on the top/)?.[1];
  assert.equal(gap("Then a huge gap."), "120px");
  assert.equal(gap("Below it, a medium gap."), "32px");
  assert.equal(gap("There is a small space."), "16px");
  assert.equal(gap("Leave 40px of space."), "40px");
  assert.equal(gap("Add a 30px gap."), "30px");
  assert.equal(gap("After that, a 50 pixel gap."), "50px");
  const hero = blocks('Hero section:\n    Add "assets/hero.jpg" as the background.\n    It has plenty of padding.\n    A big heading says "a".');
  assert.match(hero, /has a "assets\/hero\.jpg" background image\n {8}it has 48px padding/);
  assert.deepEqual(rephrase('the background is the image "assets/a.jpg"'), ['has a "assets/a.jpg" background image']);
  assert.deepEqual(rephrase("it has a little padding"), ["it has 8px padding"]);
  assert.deepEqual(rephrase("it has some padding"), ["it has 16px padding"]);
});

test("hovering a paragraph sentence shows the block sentences it means", () => {
  const text = 'kadam 0.4\n\nHero section:\n    A big black button called download says "Go". It has rounded corners.\n';
  const first = hover(text, { line: 3, character: 10 }, []);
  assert.match(first, /^\*\*Means\*\*/);
  assert.match(first, /\/\/ named download\na button\n[\s\S]*has a black background\nthe text says "Go"\n```$/);
  assert.doesNotMatch(first, /rounded corners/, "only the sentence under the cursor");
  assert.match(hover(text, { line: 3, character: 60 }, []), /```kdm\nhas rounded corners\n```/);
});

import { normalizeImperative, numbersToDigits } from "../dist/core/prose/translate.js";

test("instructions say the same as descriptions", () => {
  const table = [
    ['add a big heading that says "Hi"', 'a big heading that says "Hi"'],
    ['put a black button that says "Go" on the right', 'a black button that says "Go" on the right'],
    ['show gray text saying "Lead"', 'gray text saying "Lead"'],
    ["place a divider", "a divider"],
    ['there is a link that says "Docs"', 'a link that says "Docs"'],
    ["make sure it tilts as you scroll", "it tilts as you scroll"],
    ["make it bold", "it is bold"],
    ["make it 300px wide", "it is 300px wide"],
    ["make the text bold", "the text is bold"],
    ["make the background black", "the background is black"],
    ["give it rounded corners", "it has rounded corners"],
    ["center it", "it is centered"],
    ["center the text", "the text is centered"],
    ["center everything in it", "it centers its children"],
    ["hide it on phones", "it is hidden on phones"],
    ["hide it", "it is hidden"],
  ];
  for (const [said, meant] of table) assert.equal(normalizeImperative(said), meant, said);
  assert.equal(normalizeImperative('add "assets/hero.jpg" as the background'), null, "a background sentence stays");
  assert.equal(normalizeImperative("it is bold"), null);
  assert.match(blocks('Add an image of a desk from "assets/desk.jpg".'), /it shows "assets\/desk\.jpg"\n {8}the description says "Image of a desk"/);
});

test("number words that measure something become digits", () => {
  assert.equal(numbersToDigits("After that, a fifty pixel gap."), "After that, a 50 pixel gap.");
  assert.equal(numbersToDigits("a twenty-four pixel gap"), "a 24 pixel gap");
  assert.equal(numbersToDigits("In three columns:"), "In 3 columns:");
  assert.equal(numbersToDigits("a two hundred pixel gap"), "a 200 pixel gap");
  assert.equal(numbersToDigits('Text says "fifty pixels"'), 'Text says "fifty pixels"', "quoted words stay");
  assert.equal(numbersToDigits("Its children appear one after another"), "Its children appear one after another");
  assert.match(blocks('Text says "a".\nAfter that, a fifty pixel gap.\nText says "b".'), /it has 50px margin on the top/);
});

test("an unknown sentence suggests paragraph sentences that share its words", () => {
  const result = compileText("home.kdm", 'kadam 0.4\n\nA big heading says "Hi".\nA button says "Go". It has a glowing border.\n');
  const [error] = result.diagnostics.filter((d) => d.severity === "error");
  assert.equal(error.message, "I don't know the sentence: It has a glowing border");
  assert.match(error.hint, /^sentences like it: It has no border \| It has a white border/);
});

test("defaults that keep a loose page readable", () => {
  assert.match(blocks('Small gray text says "x".'), /the text is #6B7280/, "gray text is the readable gray");
  assert.match(blocks('Text says "x". The text is grey.'), /the text is #6B7280/);
  assert.match(blocks('Text in #808080 says "x".'), /the text is #808080/, "CSS gray is still there by its hex");
  assert.match(blocks('An outlined button says "Ghost".'), /has a white background\n {8}has a 1px #D1D5DB border\n {8}the text is #111827/);
  const nav = blocks('Nav bar:\n    The word "Orbit" on the left.\n    A link says "Pricing" on the right that goes to the pricing page.\n    A button says "Sign up" on the right.');
  assert.equal(nav.match(/it sits at the end/g).length, 1, "only the first thing on the right pushes");
  assert.match(blocks('Hero section, centered:\n    A big heading says "Hi".\n    Text says "x". The text is left aligned.'), /a main heading\n {12}the text says "Hi"\n {12}the text is centered[\s\S]*the text is left aligned\n {8}\}/);
});

test("component definitions read instructions too", () => {
  const result = compileText("components.kdm", "kadam 0.4\n\nA Feature is a card with a ___ title.\nGive it 24px padding. It has a border.\n");
  assert.ok(result !== undefined);
});

test("clauses split only where a new one starts; pictures fit; dark pages lighten gray", () => {
  assert.match(blocks('Hero section:\n    Give it 96px padding on the top and bottom and 24px padding on the left and right.\n    A big heading says "x".'),
    /it has 96px padding on the top and bottom\n {8}it has 24px padding on the left and right/);
  assert.match(blocks('A card says "x".\nIt has rounded corners, a soft shadow and 24px padding.'), /has rounded corners\n {8}has a soft shadow\n {8}it has 24px padding/);
  assert.match(blocks('A photo of a hill shows "assets/h.jpg".'), /it is at most 100% wide/);
  assert.doesNotMatch(blocks('A photo of a hill shows "assets/h.jpg". It is full width.'), /at most 100% wide/);
  assert.match(blocks('A photo of me shows "assets/me.jpg". It is 320px wide. It is shaped like a circle.'), /it is shaped like a circle\n {8}it is at most 100% wide\n {8}it keeps a square shape\n {8}it fills its box/);
  assert.match(blocks('The page is dark when the system is dark.\nGray text says "x".'), /the text is #6B7280\n {8}in dark mode, the text is #9CA3AF/);
  assert.doesNotMatch(blocks('Gray text says "x".'), /in dark mode/, "only on pages that turn dark");
});

test("tables, badges, rows that fill, and blanks of any name", () => {
  const table = blocks('A table of recent orders:\n    A header row says "Order", "Status".\n    A row says "#1042", "Paid".\n    A row:\n        A cell says "#1043".\n        A cell says "Pending".');
  assert.match(table, /a table\n {8}the caption says "Recent orders"\n {8}it is full width\n {8}headerRow1 \{\n {12}a header row\n {12}cell1 \{\n {16}a cell\n {16}the text says "Order"/);
  assert.match(table, /tableRow1 \{\n {12}a row\n {12}cell3 \{\n {16}a cell\n {16}the text says "#1042"/);
  assert.match(table, /tableRow2 \{\n {12}a row\n {12}cell5 \{/, "a row group inside a table is a table row");
  assert.doesNotMatch(table, /it arranges its children in a row/);
  assert.match(blocks('A green badge says "Live".'), /has a #DCFCE7 background\n {8}the text is #166534/);
  const row = blocks('Side by side:\n    A sidebar says "x". It is 220px wide.\n    Main section:\n        It takes the full width.\n        A heading says "y".');
  assert.match(row, /it arranges its children in a row\n {8}it wraps its children\n {8}it stretches its children/);
  assert.match(row, /it grows to fill the space/);
  assert.doesNotMatch(row.slice(row.indexOf("main1 {")), /it is full width/, "in a row, full width means growing");
  assert.doesNotMatch(blocks('Hero section, side by side, centered:\n    A heading says "x".'), /it stretches its children/, "centered rows are not stretched");
  assert.match(blocks('Docs section:\n    A heading says "x".\n    Note:\n        Text says "y".'), /note1 \{\n {12}a container/, "a nested header is a plain box");
  const result = compileText("components.kdm", "kadam 0.4\n\nA Stat is a card with a ___ label and a ___ value and a ___ trend.\n");
  assert.ok(result !== undefined);
});

test("things are referred to by their words; questions and quote lines", () => {
  const out = blocks([
    'A button says "Menu". When clicked, it toggles the menu.',
    'A button says "Join". It opens the waitlist dialog.',
    'A button says "Focus". It moves focus to the menu.',
    "Menu:",
    '    "Inside the menu."',
    "Waitlist dialog:",
    '    A heading says "Join".',
    '    A button says "Close". It closes the dialog.',
    "The menu starts hidden.",
    "Is it free?",
    '    "Yes."',
  ].join("\n"));
  assert.match(out, /when clicked, flip "menu1"/);
  assert.match(out, /when clicked, open dialog "waitlist1"/, "a dialog is opened as a dialog");
  assert.match(out, /when clicked, focus "menu1"/);
  assert.match(out, /when clicked, close the dialog/);
  assert.match(out, /menu1 \{\n {8}a container\n {8}it starts hidden/, "a sentence about a thing named elsewhere goes on it");
  assert.match(out, /a paragraph\n {12}the text says "Inside the menu\."/);
  assert.match(out, /question1 \{\n {8}an expandable section\n {8}the title says "Is it free\?"\n {8}text\d+ \{\n {12}a paragraph\n {12}the text says "Yes\."/);
  const missing = compileText("home.kdm", 'kadam 0.4\n\nA big heading says "Hi".\nMenu:\n    "x"\nA button says "Go". It opens the menuu.\n').diagnostics.filter((d) => d.severity === "error");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].message, 'nothing on this page is called "menuu"');
  assert.match(missing[0].hint, /the things named on this page: menu/);
  assert.equal(missing[0].fixes[0].text, "It opens the menu");
  assert.match(blocks('Text says "x". It is hidden at first.'), /it starts hidden/);
});

test("a sentence the language has is never read as a reference", () => {
  assert.match(blocks('A photo of a hill shows "assets/h.jpg". It opens larger when clicked.'), /it opens larger when clicked/);
});

test("theme colors are describing words; text that mentions an effect is just text", () => {
  const themed = parseText("home.kdm", 'kadam 0.4\n\nMuted text says "x". The background is tint.\n', { validate: false, colorTokens: new Set(["muted", "tint"]) });
  assert.deepEqual(themed.diagnostics, []);
  assert.match(themed.prose.text, /the text is muted\n {8}the text says "x"\n {8}has a tint background/);
  const quoted = compileText("a.kdm", 'kadam 0.3\npage "A" {\n    t1 {\n        a paragraph\n        the text says "a glow follows the cursor"\n    }\n}\n');
  assert.deepEqual(quoted.diagnostics.filter((d) => d.severity === "error"), [], "block pages too");
  assert.deepEqual(compileText("home.kdm", 'kadam 0.4\n\nA code block says "When the cursor moves over it, white pixels pop out around the cursor."\n').diagnostics.filter((d) => d.severity === "error"), []);
});

test("boxes in a stacked parent take the full width; a gap in a row is space to the left", () => {
  const out = blocks('A big heading says "Hi".\nPicture:\n    It is 200px tall. It has a mesh background of blue and white.\nNav bar:\n    The word "A".\n    After that, a 28px gap.\n    A link says "B". It goes to page "Home".');
  assert.match(out, /image1 \{\n {8}a container\n {8}it is 200px tall\n[\s\S]*?it is full width/, "an empty box does not collapse");
  assert.match(out, /it has 28px margin on the left/);
  assert.doesNotMatch(blocks('Hero section, centered:\n    A big heading says "Hi".\n    Side by side:\n        A button says "Go".'), /group1 \{\n[^}]*it is full width/, "not inside a centered group");
  assert.match(blocks('The page background is black.\nA card:\n    Text says "x".'), /has no background\n {8}has no shadow/, "a card on a dark page is see-through");
  assert.match(blocks('A big heading says "Hi".\nThe Northwind mark shows "assets/mark.svg". It is decorative.'), /an image\n {8}it shows "assets\/mark\.svg"\n {8}it is decorative/);
  assert.match(blocks('A big heading says "Hi". The letter spacing is -1.9px.'), /a main heading\n {8}the text says "Hi"\n {8}the letter spacing is -1\.9px/);
});
