import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { compileText } from "../dist/compiler/compile.js";
import { compileProject } from "../dist/compiler/project.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function filesByPath(result) {
  return new Map(result.files.map((file) => [file.path, file.contents]));
}

function homeCss(result) {
  const css = filesByPath(result).get("assets/kadam.home.css");
  assert.equal(typeof css, "string");
  return css;
}

test("hover effects live behind the hover media query and never change layout", () => {
  const source = `kadam 0.1

page "Hover" {
    action1 {
        a button
        the text says "Go"
        when hovered, the background turns black
        when hovered, it lifts by 2px over 200ms
        when hovered, it scales to 105%
    }
}
`;
  const result = compileText("hover.kdm", source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const css = homeCss(result);

  assert.match(
    css,
    /transition: background-color 150ms ease-out, translate 200ms ease-out, scale 150ms ease-out;/,
  );
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /\.kdm-home-action1:hover/);
  assert.match(css, /translate: 0 -2px;/);
  assert.match(css, /scale: 1\.05;/);

  const hoverStart = css.indexOf("@media (hover: hover)");
  const reducedStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(hoverStart !== -1 && reducedStart > hoverStart);
  const hoverBlock = css.slice(hoverStart, reducedStart);
  assert.doesNotMatch(
    hoverBlock,
    /\b(width|height|padding|margin|font-size|line-height|gap):/,
  );

  const reducedBlock = css.slice(reducedStart);
  assert.match(reducedBlock, /transition: none;/);
  assert.doesNotMatch(reducedBlock, /animation:/);
});

test("entrance animations run once and reduced motion renders the final state", () => {
  const source = `kadam 0.1

page "Motion" {
    fade1 {
        a paragraph
        the text says "Fade"
        it fades in when the page loads
    }

    slide1 {
        a paragraph
        the text says "Slide"
        it slides in from the left over 600ms when the page loads
    }
}
`;
  const result = compileText("motion.kdm", source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const files = filesByPath(result);
  const css = homeCss(result);
  const base = files.get("assets/kadam.css");
  assert.equal(typeof base, "string");

  assert.match(css, /animation: kdm-fade-in 400ms ease-out both;/);
  assert.match(css, /animation: kdm-slide-in-left 600ms ease-out both;/);
  assert.match(base, /@keyframes kdm-fade-in/);
  assert.match(
    base,
    /@keyframes kdm-slide-in-left \{\n  from \{\n    transform: translate3d\(-24px, 0, 0\);/,
  );

  const reducedStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(reducedStart !== -1);
  const reducedBlock = css.slice(reducedStart);
  assert.match(
    reducedBlock,
    /\.kdm-home-fade1 \{\n    animation: none;\n  \}/,
  );
  assert.match(
    reducedBlock,
    /\.kdm-home-slide1 \{\n    animation: none;\n  \}/,
  );
});

test("links with transform motion become transformable and keep instant reduced motion", () => {
  const source = `kadam 0.1

page "Links" {
    colorLink1 {
        a link
        the text says "Color"
        when hovered, the text turns black
        when clicked, go to page "Links"
    }

    movingLink1 {
        a link
        the text says "Move"
        when hovered, it lifts by 2px
        it slides in from the left when the page loads
        when clicked, go to page "Links"
    }
}
`;
  const result = compileText("links.kdm", source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const css = homeCss(result);

  assert.doesNotMatch(
    css,
    /\.kdm-home-colorLink1 \{\n  display: inline-block;/,
  );
  assert.match(
    css,
    /\.kdm-home-movingLink1 \{\n  display: inline-block;/,
  );
  assert.match(css, /\.kdm-home-movingLink1:hover/);
  assert.match(css, /animation: kdm-slide-in-left 400ms ease-out both;/);

  const reducedStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(reducedStart !== -1);
  const reducedBlock = css.slice(reducedStart);
  assert.match(
    reducedBlock,
    /\.kdm-home-movingLink1 \{\n    animation: none;\n    transition: none;\n  \}/,
  );
});

test("hover is available across every supported kind and stays out of layout", () => {
  const source = `kadam 0.1

page "HoverKinds" {
    button1 {
        a button
        the text says "Button"
        has a white border
        when hovered, the background turns black
        when hovered, the border turns white
        when hovered, it lifts by 2px
        when hovered, it scales to 105%
    }

    link1 {
        a link
        the text says "Link"
        when clicked, go to page "HoverKinds"
        when hovered, the text turns black
    }

    mainHeading1 {
        a main heading
        the text says "Heading"
        when hovered, the text turns black
    }

    paragraph1 {
        a paragraph
        the text says "Paragraph"
        when hovered, the background turns black
    }

    field1 {
        a text field
        the label says "Email"
        when hovered, the border turns black
    }

    image1 {
        an image
        it shows "assets/mark.svg"
        the description says "Mark"
        when hovered, it scales to 105%
    }

    card1 {
        a card
        when hovered, it lifts by 2px
    }

    container1 {
        a container
        when hovered, the background turns black
    }

    nav1 {
        a navigation bar
        when hovered, it lifts by 2px
    }
}
`;
  const result = compileText("hover-kinds.kdm", source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const css = homeCss(result);

  const hoverStart = css.indexOf("@media (hover: hover)");
  const reducedStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(hoverStart !== -1 && reducedStart > hoverStart);
  const hoverBlock = css.slice(hoverStart, reducedStart);

  for (const selector of [
    ".kdm-home-button1:hover",
    ".kdm-home-link1:hover",
    ".kdm-home-mainHeading1:hover",
    ".kdm-home-paragraph1:hover",
    ".kdm-home-field1:hover .kdm-field-input",
    ".kdm-home-image1:hover",
    ".kdm-home-card1:hover",
    ".kdm-home-container1:hover",
    ".kdm-home-nav1:hover",
  ]) {
    assert.ok(hoverBlock.includes(selector), selector);
  }
  assert.doesNotMatch(
    hoverBlock,
    /\b(width|height|padding|margin|font-size|line-height|gap):/,
  );
});

test("text field hover transitions target the input and are removed for reduced motion", () => {
  const source = `kadam 0.1

page "Field" {
    field1 {
        a text field
        the label says "Email"
        when hovered, the border turns black over 200ms
    }
}
`;
  const result = compileText("field.kdm", source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const css = homeCss(result);

  assert.match(
    css,
    /\.kdm-home-field1 \.kdm-field-input \{\n  transition: border-color 200ms ease-out;/,
  );
  assert.match(
    css,
    /\.kdm-home-field1:hover \.kdm-field-input \{\n    border-color: black;/,
  );

  const reducedStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(reducedStart !== -1);
  assert.match(
    css.slice(reducedStart),
    /\.kdm-home-field1 \.kdm-field-input \{\n    transition: none;\n  \}/,
  );
});

test("the portfolio builds with hover, entrance motion, and reduced-motion rules", () => {
  const result = compileProject({
    projectRoot: join(root, "examples", "portfolio"),
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const files = filesByPath(result);
  const css = files.get("assets/kadam.home.css");
  const base = files.get("assets/kadam.css");
  assert.equal(typeof css, "string");
  assert.equal(typeof base, "string");

  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /\.kdm-home-cta1:hover/);
  assert.match(css, /translate: 0 -5px;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation: none;/);
  assert.match(css, /transition: none;/);
  assert.match(base, /@keyframes kdm-slide-in-bottom/);
});
