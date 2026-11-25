import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { compileText } from "../dist/compiler/compile.js";
import { compileProject } from "../dist/compiler/project.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function compileFixture(relativePath) {
  return compileText(relativePath, read(relativePath));
}

function findElement(page, name) {
  const visit = (elements) => {
    for (const element of elements) {
      if (element.name === name) return element;
      const found = visit(element.children);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(page.elements);
}

function filesByPath(result) {
  return new Map(result.files.map((file) => [file.path, file.contents]));
}

test("hello compiles to the checked-in golden HTML and CSS", () => {
  const result = compileFixture("examples/hello.kdm");
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(
    result.files.map((file) => file.path),
    ["index.html", "assets/kadam.css", "assets/kadam.home.css"],
  );

  const files = filesByPath(result);
  assert.equal(files.get("index.html"), read("test/golden/hello/index.html"));
  assert.equal(
    files.get("assets/kadam.css"),
    read("test/golden/hello/assets/kadam.css"),
  );
  assert.equal(
    files.get("assets/kadam.home.css"),
    read("test/golden/hello/assets/kadam.home.css"),
  );

  assert.ok(result.page);
  assert.equal(result.page.title, "Hello");
  assert.equal(result.page.route, "/");
  assert.equal(result.page.routeSlug, "home");
  assert.equal(result.page.outputPath, "index.html");
  assert.equal(result.page.usesMotion, false);
  assert.deepEqual(result.page.assets, []);
  assert.equal(result.page.sourceMap.length, 6);

  assert.deepEqual(result.page.pageStyle.background, {
    kind: "hex",
    value: "#FFFFFF",
  });
  assert.equal(result.page.pageStyle.font, "sans serif");

  const title = findElement(result.page, "title1");
  assert.ok(title);
  assert.equal(title.kindClass, "kdm-kind-main-heading");
  assert.equal(title.accessibility.role, "heading");
  assert.equal(title.accessibility.headingLevel, 1);
  assert.deepEqual(title.style.typography.fontSize, {
    value: 48,
    unit: "px",
  });
  assert.equal(title.style.typography.fontWeight, 700);
  assert.equal(title.style.typography.lineHeight, 1.1);

  const card = findElement(result.page, "card1");
  assert.ok(card);
  assert.equal(card.style.shadow, "soft");
  assert.equal(card.style.padding.top.value, 24);
});

test("compilation is byte-identical across repeated runs", () => {
  const first = compileFixture("examples/hello.kdm");
  const second = compileFixture("examples/hello.kdm");
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.files, second.files);
  assert.equal(JSON.stringify(first.page), JSON.stringify(second.page));
});

test("text, titles, labels, placeholders, and attributes are escaped", () => {
  const source = `kadam 0.1

page "Escape & <Test>" {
    heading1 {
        a main heading
        the text says "<script> & \\"double\\" 'single' >"
    }

    image1 {
        an image
        it shows "assets/mark.png"
        the description says "A \\"quoted\\" & <tag>"
    }

    field1 {
        a text field
        the label says "Name & <label>"
        the placeholder says "A \\"quoted\\" & <input>"
    }
}
`;
  const result = compileText("escape.kdm", source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const html = filesByPath(result).get("index.html");
  assert.ok(html);
  assert.match(html, /<title>Escape &amp; &lt;Test&gt;<\/title>/);
  assert.match(
    html,
    /&lt;script&gt; &amp; "double" 'single' &gt;/,
  );
  assert.match(
    html,
    /alt="A &quot;quoted&quot; &amp; &lt;tag&gt;"/,
  );
  assert.match(html, /Name &amp; &lt;label&gt;/);
  assert.match(
    html,
    /placeholder="A &quot;quoted&quot; &amp; &lt;input&gt;"/,
  );
  assert.equal(html.includes("<script>"), false);
});

test("semantic analysis requires button, image, field, and link content", () => {
  const source = `kadam 0.1

page "Broken" {
    button1 {
        a button
    }

    image1 {
        an image
        it shows "assets/mark.png"
    }

    field1 {
        a text field
    }

    link1 {
        a link
        the text says "Go"
    }
}
`;
  const result = compileText("broken.kdm", source);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["KDM3009", "KDM3009", "KDM3009", "KDM3009"],
  );
  assert.deepEqual(result.files, []);
});

test("unknown navigation targets fail with KDM3007 and write nothing", () => {
  const source = `kadam 0.1

page "Home" {
    link1 {
        a link
        the text says "About"
        when clicked, go to page "About"
    }
}
`;
  const result = compileText("home.kdm", source);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["KDM3007"],
  );
  assert.deepEqual(result.files, []);
});

test("gradients, responsive overrides, hover transitions, and motion are emitted", () => {
  const source = `kadam 0.1

page "Styles" {
    action1 {
        a button
        has a blue and black gradient
        the gradient goes from left to right
        on phones, the gradient goes from top to bottom
        when hovered, it lifts by 2px over 200ms
        when hovered, it scales to 105%
        it slides in from the bottom over 500ms when the page loads
        the text says "Go"
    }
}
`;
  const result = compileText("styles.kdm", source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const css = filesByPath(result).get("assets/kadam.home.css");
  const base = filesByPath(result).get("assets/kadam.css");
  assert.ok(css);
  assert.ok(base);
  assert.match(css, /linear-gradient\(to right, blue, black\)/);
  assert.match(css, /@media \(max-width: 599px\)/);
  assert.match(css, /linear-gradient\(to bottom, blue, black\)/);
  assert.match(
    css,
    /transition: translate 200ms ease-out, scale 150ms ease-out;/,
  );
  assert.match(css, /translate: 0 -2px;/);
  assert.match(css, /scale: 1\.05;/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /animation: kdm-slide-in-bottom 500ms ease-out both;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation: none;/);
  assert.match(base, /@keyframes kdm-slide-in-bottom/);
  assert.match(base, /outline: 2px solid #2563EB;/);
  assert.match(base, /outline-offset: 2px;/);
});

test("accessibility markup includes native controls, labels, and decorative alt", () => {
  const source = `kadam 0.1

page "Accessible" {
    action1 {
        a button
        the text says "Save"
    }

    image1 {
        an image
        it shows "assets/decoration.png"
        it is decorative
    }

    field1 {
        a text field
        the label says "Email"
        it accepts email addresses
        it is required
    }

    link1 {
        a link
        the text says "Home"
        when clicked, go to page "Accessible"
    }
}
`;
  const result = compileText("accessible.kdm", source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const html = filesByPath(result).get("index.html");
  assert.ok(html);
  assert.match(
    html,
    /<button class="kdm-home-action1 kdm-kind-button" data-kdm-id="home-action1" type="button">Save<\/button>/,
  );
  assert.match(html, /src="\/assets\/decoration\.png" alt=""/);
  assert.match(
    html,
    /<label class="kdm-field-label" for="home-field1-input">Email<\/label>/,
  );
  assert.match(
    html,
    /<input class="kdm-field-input" id="home-field1-input" type="email" required>/,
  );
  assert.match(html, /href="\/">Home<\/a>/);
});

test("external links open safely in a new tab while internal links stay same-tab", () => {
  const source = `kadam 0.1

page "Links" {
    external1 {
        a link
        the link text says "External"
        when clicked, open "https://example.com" in a new tab
    }

    internal1 {
        a link
        the link text says "Home"
        when clicked, go to page "Links"
    }
}
`;
  const result = compileText("links.kdm", source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const html = filesByPath(result).get("index.html");
  assert.ok(html);
  assert.match(
    html,
    /href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">External<\/a>/,
  );
  assert.match(html, /href="\/">Home<\/a>/);
  assert.doesNotMatch(html, /href="\/" target="_blank"/);
});

test("focus-visible rings cover every interactive element", () => {
  const source = `kadam 0.1

page "Focus" {
    action1 {
        a button
        the text says "Save"
    }

    link1 {
        a link
        the text says "Home"
        when clicked, go to page "Focus"
    }

    field1 {
        a text field
        the label says "Email"
    }
}
`;
  const result = compileText("focus.kdm", source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const css = filesByPath(result).get("assets/kadam.css");
  assert.ok(css);
  assert.match(
    css,
    /\.kdm-kind-button:focus-visible,\n\.kdm-kind-link:focus-visible,\n\.kdm-field-input:focus-visible \{\n  outline: 2px solid #2563EB;\n  outline-offset: 2px;\n\}/,
  );
});

test("the canonical specification example builds deterministically", () => {
  const projectRoot = join(root, "examples", "canonical");
  const first = compileProject({ projectRoot });
  const second = compileProject({ projectRoot });

  assert.equal(first.ok, true, JSON.stringify(first.diagnostics, null, 2));
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics, null, 2));
  assert.deepEqual(first.files, second.files);
  assert.equal(JSON.stringify(first.pages), JSON.stringify(second.pages));

  const files = filesByPath(first);
  assert.deepEqual([...files.keys()], [
    "about/index.html",
    "assets/kadam.about.css",
    "assets/kadam.css",
    "assets/kadam.home.css",
    "index.html",
  ]);

  const home = files.get("index.html");
  const homeCss = files.get("assets/kadam.home.css");
  assert.equal(typeof home, "string");
  assert.equal(typeof homeCss, "string");
  assert.match(home, /<nav /);
  assert.match(home, /href="\/about\/"/);
  assert.match(home, /class="kdm-home-button1 kdm-kind-button"/);
  assert.match(homeCss, /linear-gradient\(to bottom, blue, black\)/);
  assert.match(homeCss, /\.kdm-home-button1:hover \{\n    border-color: black;/);
});

test("the broad all-kinds fixture compiles with responsive and interaction CSS", () => {
  const result = compileFixture("test/fixtures/valid/all-kinds.kdm");
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const files = filesByPath(result);
  const html = files.get("index.html");
  const css = files.get("assets/kadam.home.css");
  assert.ok(html);
  assert.ok(css);
  assert.match(html, /width="240" height="240"/);
  assert.match(html, /alt="The Kadam mark"/);
  assert.match(css, /@media \(max-width: 599px\)/);
  assert.match(css, /@media \(min-width: 600px\) and \(max-width: 1023px\)/);
  assert.match(css, /@media \(min-width: 1024px\)/);
  assert.match(css, /border-radius: 9999px;/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
