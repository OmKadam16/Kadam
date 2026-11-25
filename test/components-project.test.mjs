import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compileProject } from "../dist/compiler/project.js";

const EXAMPLE_ROOT = fileURLToPath(
  new URL("../examples/components", import.meta.url),
);

const CARD = `component PriceCard takes a title as text {
    card1 {
        a card
        has a white background
        it has 24px padding
        title1 {
            a section heading
            the heading text says "{$title}"
            the text is 20px
        }
    }
}
`;

const HOME_WITH_CARD = `kadam 0.1

page "Home" {
    pricing1 {
        a PriceCard
        with a title of "Starter"
    }
}
`;

const HOME_WITHOUT_CARD = `kadam 0.1

page "Home" {
    headline1 {
        a main heading
        the text says "Hello"
    }
}
`;

function codes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function fileText(result, path) {
  const file = result.files.find((candidate) => candidate.path === path);
  assert.ok(file, `expected ${path}`);
  return typeof file.contents === "string"
    ? file.contents
    : Buffer.from(file.contents).toString("utf8");
}

function ruleCount(css, className) {
  const escaped = className.replaceAll(".", "\\.");
  return (css.match(new RegExp(`${escaped}\\s*\\{`, "g")) ?? []).length;
}

function createProject(
  files,
  components = [],
  pages = [{ source: "pages/home.kdm", route: "/" }],
) {
  const projectRoot = mkdtempSync(join(tmpdir(), "kadam-components-project-"));
  writeFileSync(
    join(projectRoot, "kadam.json"),
    JSON.stringify(
      {
        kadam: "0.1",
        name: "Components",
        pages,
        components,
      },
      null,
      2,
    ),
    "utf8",
  );
  for (const [path, contents] of Object.entries(files)) {
    const target = join(projectRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return projectRoot;
}

test("unused component declarations are loaded and validated without changing page output", () => {
  const projectRoot = createProject({
    "pages/home.kdm": HOME_WITHOUT_CARD,
    "components/PriceCard.kdm": CARD,
  }, ["components/PriceCard.kdm"]);

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.ok(result.files.length > 0);
  assert.ok(
    result.sources.some((source) => source.path === "components/PriceCard.kdm"),
  );
  assert.match(
    result.files.find((file) => file.path === "index.html").contents,
    /Hello/,
  );
});

test("component instances expand and emit stable identities", () => {
  const projectRoot = createProject({
    "pages/home.kdm": HOME_WITH_CARD,
    "components/PriceCard.kdm": CARD,
  }, ["components/PriceCard.kdm"]);

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const page = result.pages[0];
  assert.ok(page);
  const root = page.elements[0];
  assert.equal(root.nodeId, "home-pricing1-card1");
  assert.equal(root.className, "kdm-c-PriceCard-default-card1");
  assert.equal(root.kind, "card");

  const mapping = page.sourceMap.find((entry) => entry.nodeId === root.nodeId);
  assert.ok(mapping);
  assert.equal(mapping.span.file, "components/PriceCard.kdm");
  assert.equal(mapping.name, "card1");
  assert.ok(mapping.componentOrigin);
  assert.equal(mapping.componentOrigin.component, "PriceCard");
  assert.equal(mapping.componentOrigin.variant, null);
  assert.deepEqual(mapping.componentOrigin.instancePath, ["pricing1"]);
  assert.deepEqual(
    mapping.componentOrigin.instances.map((instance) => instance.component),
    ["PriceCard"],
  );
  assert.equal(mapping.componentOrigin.instances[0].instanceName, "pricing1");
  assert.equal(
    mapping.componentOrigin.instances[0].instanceSpan.file,
    "pages/home.kdm",
  );

  const html = fileText(result, "index.html");
  assert.match(html, /data-kdm-id="home-pricing1-card1"/);
  assert.match(html, /Starter/);
  // The component kind itself is gone; only generated class names mention it.
  assert.equal(html.includes("a PriceCard"), false);
  assert.equal(html.includes("<script"), false);

  const css = fileText(result, "assets/kadam.home.css");
  assert.equal(ruleCount(css, ".kdm-c-PriceCard-default-card1"), 1);
});

test("two component instances get distinct IDs and share one CSS rule", () => {
  const page = HOME_WITH_CARD.replace(
    "    pricing1 {",
    "    pricing1 {\n        a PriceCard\n        with a title of \"Starter\"\n    }\n    pricing2 {",
  );
  const projectRoot = createProject(
    {
      "pages/home.kdm": page,
      "components/PriceCard.kdm": CARD,
    },
    ["components/PriceCard.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const pageIr = result.pages[0];
  assert.ok(pageIr);
  const roots = pageIr.elements;
  assert.deepEqual(
    roots.map((element) => element.nodeId),
    ["home-pricing1-card1", "home-pricing2-card1"],
  );
  // Both instances share styling, so they share a class name but never a node ID.
  assert.deepEqual(
    roots.map((element) => element.className),
    ["kdm-c-PriceCard-default-card1", "kdm-c-PriceCard-default-card1"],
  );
  assert.deepEqual(
    roots.map((element) => element.componentOrigin.instancePath),
    [["pricing1"], ["pricing2"]],
  );

  const html = fileText(result, "index.html");
  assert.match(html, /data-kdm-id="home-pricing1-card1"/);
  assert.match(html, /data-kdm-id="home-pricing2-card1"/);
  assert.equal((html.match(/Starter/g) ?? []).length, 2);

  const css = fileText(result, "assets/kadam.home.css");
  assert.equal(ruleCount(css, ".kdm-c-PriceCard-default-card1"), 1);
  assert.equal(ruleCount(css, ".kdm-c-PriceCard-default-title1"), 1);
});

test("nested components record the outer-to-inner instance chain", () => {
  const navLink = `component NavLink takes a label as text, a target as page {
    link1 {
        a link
        the link text says "{$label}"
        when clicked, go to page "{$target}"
    }
}
`;
  const navigation = `component Navigation takes a homeTarget as page, an aboutTarget as page {
    nav1 {
        a navigation bar
        homeLink1 {
            a NavLink
            with a label of "Home"
            with a target of "{$homeTarget}"
        }
        aboutLink1 {
            a NavLink
            with a label of "About"
            with a target of "{$aboutTarget}"
        }
    }
}
`;
  const projectRoot = createProject(
    {
      "pages/home.kdm": `kadam 0.1

page "Home" {
    navigation1 {
        a Navigation
        with a homeTarget of "Home"
        with an aboutTarget of "About"
    }
}
`,
      "pages/about.kdm": `kadam 0.1

page "About" {
    headline1 {
        a main heading
        the text says "About"
    }
}
`,
      "components/NavLink.kdm": navLink,
      "components/Navigation.kdm": navigation,
    },
    ["components/NavLink.kdm", "components/Navigation.kdm"],
    [
      { source: "pages/home.kdm", route: "/" },
      { source: "pages/about.kdm", route: "/about" },
    ],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const home = result.pages.find((page) => page.routeSlug === "home");
  assert.ok(home);

  const nav = home.elements[0];
  assert.equal(nav.nodeId, "home-navigation1-nav1");
  assert.equal(nav.className, "kdm-c-Navigation-default-nav1");
  assert.deepEqual(nav.componentOrigin.instancePath, ["navigation1"]);

  const link = nav.children[0];
  assert.equal(link.nodeId, "home-navigation1-homeLink1-link1");
  assert.equal(link.className, "kdm-c-NavLink-default-link1");
  assert.equal(link.action.route, "/");
  assert.equal(nav.children[1].nodeId, "home-navigation1-aboutLink1-link1");
  assert.equal(nav.children[1].action.route, "/about/");
  // The nested root keeps its own scope, not the outer component's scope.
  assert.equal(link.componentOrigin.component, "NavLink");
  assert.deepEqual(link.componentOrigin.instancePath, [
    "navigation1",
    "homeLink1",
  ]);
  assert.deepEqual(
    link.componentOrigin.instances.map((instance) => instance.component),
    ["Navigation", "NavLink"],
  );
  assert.deepEqual(
    link.componentOrigin.instances.map((instance) => instance.instanceName),
    ["navigation1", "homeLink1"],
  );

  const mapping = home.sourceMap.find((entry) => entry.nodeId === link.nodeId);
  assert.ok(mapping);
  assert.equal(mapping.span.file, "components/NavLink.kdm");
  assert.deepEqual(mapping.componentOrigin.instancePath, [
    "navigation1",
    "homeLink1",
  ]);

  const html = fileText(result, "index.html");
  assert.match(html, /data-kdm-id="home-navigation1-homeLink1-link1"/);
  assert.match(html, /data-kdm-id="home-navigation1-aboutLink1-link1"/);
  assert.match(html, /href="\/about\/"/);
});

test("variants change component identity and CSS class names", () => {
  const button = `component Button takes a label as text {
    button1 {
        a button
        the button text says "{$label}"
    }

    variant outline {
        button1 {
            a button
            has a white background
            the button text says "Outline {$label}"
        }
    }
}
`;
  const projectRoot = createProject(
    {
      "pages/home.kdm": `kadam 0.1

page "Home" {
    action1 {
        a Button in the outline variant
        with a label of "Save"
    }
}
`,
      "components/Button.kdm": button,
    },
    ["components/Button.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const page = result.pages[0];
  const root = page.elements[0];
  assert.equal(root.nodeId, "home-action1-button1");
  assert.equal(root.className, "kdm-c-Button-outline-button1");
  assert.equal(root.text.text, "Outline Save");

  const mapping = page.sourceMap.find((entry) => entry.nodeId === root.nodeId);
  assert.ok(mapping);
  assert.equal(mapping.componentOrigin.variant, "outline");

  const css = fileText(result, "assets/kadam.home.css");
  assert.equal(ruleCount(css, ".kdm-c-Button-outline-button1"), 1);
  assert.equal(ruleCount(css, ".kdm-c-Button-default-button1"), 0);
});

test("component images are collected and copied once", () => {
  const avatar = `component Avatar {
    photo1 {
        an image
        it shows "assets/avatar.png"
        it is decorative
    }
}
`;
  const projectRoot = createProject(
    {
      "pages/home.kdm": `kadam 0.1

page "Home" {
    avatar1 {
        an Avatar
    }
    avatar2 {
        an Avatar
    }
}
`,
      "components/Avatar.kdm": avatar,
      "assets/avatar.png": "png-bytes",
    },
    ["components/Avatar.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const html = fileText(result, "index.html");
  assert.equal((html.match(/src="\/assets\/avatar.png"/g) ?? []).length, 2);

  const copies = result.files.filter((file) => file.path === "assets/avatar.png");
  assert.equal(copies.length, 1);
  assert.equal(fileText(result, "assets/avatar.png"), "png-bytes");
});

test("form IDs derive from the expanded instance node ID", () => {
  const field = `component FormField {
    field1 {
        a text field
        the label says "Email"
    }
}
`;
  const page = `kadam 0.1

page "Home" {
    email1 {
        a FormField
    }
    email2 {
        a FormField
    }
}
`;
  const projectRoot = createProject(
    {
      "pages/home.kdm": page,
      "components/FormField.kdm": field,
    },
    ["components/FormField.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const html = fileText(result, "index.html");
  assert.match(html, /id="home-email1-field1-input"/);
  assert.match(html, /id="home-email2-field1-input"/);
  assert.match(html, /for="home-email1-field1-input"/);
  assert.match(html, /for="home-email2-field1-input"/);
});

test("missing component files fail with KDM4007 and write no files", () => {
  const projectRoot = createProject(
    { "pages/home.kdm": HOME_WITHOUT_CARD },
    ["components/Missing.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("KDM4007"), codes(result).join(", "));
  assert.deepEqual(result.files, []);
});

test("component files without a component declaration fail with KDM4008", () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": HOME_WITHOUT_CARD,
      "components/Bad.kdm": HOME_WITHOUT_CARD,
    },
    ["components/Bad.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("KDM4008"), codes(result).join(", "));
  assert.deepEqual(result.files, []);
});

test("duplicate component names are reported before output", () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": HOME_WITHOUT_CARD,
      "components/One.kdm": `component Same {\n    one { a paragraph\n        the text says "One"\n    }\n}\n`,
      "components/Two.kdm": `component Same {\n    two { a paragraph\n        the text says "Two"\n    }\n}\n`,
    },
    ["components/One.kdm", "components/Two.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("KDM3020"), codes(result).join(", "));
  assert.deepEqual(result.files, []);
});

test("page instance property errors are reported before expansion", () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": `kadam 0.1

page "Home" {
    pricing1 {
        a PriceCard
        with a nope of "Starter"
    }
}
`,
      "components/PriceCard.kdm": CARD,
    },
    ["components/PriceCard.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  const resultCodes = codes(result);
  assert.ok(resultCodes.includes("KDM3023"), resultCodes.join(", "));
  assert.ok(resultCodes.includes("KDM3024"), resultCodes.join(", "));
  assert.equal(resultCodes.includes("KDM9002"), false);
  assert.deepEqual(result.files, []);
});

test("unknown components are reported as KDM3022", () => {
  const projectRoot = createProject({
    "pages/home.kdm": HOME_WITH_CARD,
  });

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("KDM3022"), codes(result).join(", "));
  assert.deepEqual(result.files, []);
});

test("component interpolation diagnostics are surfaced from the catalog", () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": HOME_WITHOUT_CARD,
      "components/Bad.kdm": `component Bad {
    card1 {
        a card
        title1 {
            a section heading
            the heading text says "{$missing}"
        }
    }
}
`,
    },
    ["components/Bad.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("KDM3027"), codes(result).join(", "));
  assert.deepEqual(result.files, []);
});

test("page/component path collisions are rejected by the manifest", () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": HOME_WITHOUT_CARD,
    },
    ["pages/home.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("KDM4008"), codes(result).join(", "));
  assert.deepEqual(result.files, []);
});

function walkElements(elements) {
  const result = [];
  const visit = (element) => {
    result.push(element);
    for (const child of element.children) visit(child);
  };
  for (const element of elements) visit(element);
  return result;
}

test("the component example builds with complete source maps and no script", () => {
  const result = compileProject({ projectRoot: EXAMPLE_ROOT });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.pages.map((page) => page.route),
    ["/", "/about/", "/services/"],
  );

  const home = result.pages.find((page) => page.route === "/");
  assert.ok(home);
  const elements = walkElements(home.elements);
  const expanded = elements.filter((element) =>
    element.className.startsWith("kdm-c-"),
  );
  assert.ok(expanded.length > 0);
  for (const element of expanded) {
    assert.ok(element.componentOrigin, element.nodeId);
    assert.match(element.componentOrigin.component, /^[A-Z]/);
    assert.ok(element.span.file.startsWith("components/"), element.span.file);
    assert.ok(element.componentOrigin.instancePath.length > 0);
    assert.ok(element.componentOrigin.instances.length > 0);
  }
  for (const element of elements.filter(
    (candidate) => !candidate.className.startsWith("kdm-c-"),
  )) {
    assert.equal(element.componentOrigin, undefined, element.nodeId);
  }

  const nested = home.sourceMap.find(
    (entry) => entry.nodeId === "home-navigation1-aboutLink1-link1",
  );
  assert.ok(nested);
  assert.equal(nested.span.file, "components/NavLink.kdm");
  assert.deepEqual(nested.componentOrigin.instancePath, [
    "navigation1",
    "aboutLink1",
  ]);
  assert.deepEqual(
    nested.componentOrigin.instances.map((instance) => instance.component),
    ["Navigation", "NavLink"],
  );
  assert.deepEqual(
    nested.componentOrigin.instances.map((instance) => instance.instanceSpan.file),
    ["pages/home.kdm", "components/Navigation.kdm"],
  );

  for (const page of result.pages) {
    const css = fileText(result, `assets/kadam.${page.routeSlug}.css`);
    const componentRules = css.match(/^\.kdm-c-[A-Za-z0-9-]+ \{/gm) ?? [];
    assert.equal(
      new Set(componentRules).size,
      componentRules.length,
      `duplicate component CSS in ${page.routeSlug}`,
    );
  }

  const assetCopies = result.files.filter(
    (file) => file.path === "assets/kadam-mark.svg",
  );
  assert.equal(assetCopies.length, 1);

  for (const file of result.files) {
    if (file.kind !== "html") continue;
    const html = fileText(result, file.path);
    assert.equal(html.includes("<script"), false, file.path);
  }
});

test("manifest component order does not change the component example output", () => {
  const baseline = compileProject({ projectRoot: EXAMPLE_ROOT });
  assert.equal(baseline.ok, true, JSON.stringify(baseline.diagnostics, null, 2));

  const manifest = JSON.parse(
    readFileSync(join(EXAMPLE_ROOT, "kadam.json"), "utf8"),
  );
  const reordered = compileProject({
    projectRoot: EXAMPLE_ROOT,
    manifestText: JSON.stringify(
      { ...manifest, components: [...manifest.components].reverse() },
      null,
      2,
    ),
  });
  assert.equal(reordered.ok, true, JSON.stringify(reordered.diagnostics, null, 2));

  const bytes = (result) =>
    result.files.map((file) => [
      file.path,
      typeof file.contents === "string"
        ? file.contents
        : Buffer.from(file.contents).toString("base64"),
    ]);
  assert.deepEqual(bytes(reordered), bytes(baseline));
  assert.deepEqual(reordered.pages, baseline.pages);
});

const PANEL = `component Panel takes a title as text {
    frame1 {
        a container
        has a white background
        heading1 {
            a minor heading
            the heading text says "{$title}"
            the text is 22px
        }
        content1 {
            a slot
            empty1 {
                a paragraph
                the text says "Nothing yet"
            }
        }
    }
}
`;

const HOME_WITH_PANEL = `kadam 0.1

page "Home" {
    panel1 {
        a Panel
        with a title of "Notes"
        note1 {
            a paragraph
            the text says "Page content"
            the text is 18px
        }
    }

    panel2 {
        a Panel
        with a title of "Contact"
        field1 {
            a text field
            the label says "Email"
        }
    }

    panel3 {
        a Panel
        with a title of "Empty"
    }
}
`;

test("slot content compiles with page-owned identity, IDs, and CSS", () => {
  const projectRoot = createProject(
    {
      "pages/home.kdm": HOME_WITH_PANEL,
      "components/Panel.kdm": PANEL,
    },
    ["components/Panel.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const page = result.pages[0];
  assert.ok(page);
  const html = fileText(result, "index.html");
  assert.match(html, /data-kdm-id="home-panel1-frame1"/);
  assert.match(html, /data-kdm-id="home-note1"/);
  assert.match(html, /data-kdm-id="home-field1"/);
  assert.match(html, /Page content/);
  // The slot itself never emits markup.
  assert.equal(html.includes("data-kdm-id=\"home-panel1-content1\""), false);
  assert.equal(html.includes("a slot"), false);
  assert.equal(html.includes("<script"), false);

  // Page-supplied field IDs stay page-owned inside the component frame.
  assert.match(html, /id="home-field1-input"/);
  assert.match(html, /for="home-field1-input"/);

  const note = page.sourceMap.find((entry) => entry.nodeId === "home-note1");
  assert.ok(note);
  assert.equal(note.span.file, "pages/home.kdm");
  assert.equal(note.componentOrigin, undefined);

  const frame = page.sourceMap.find((entry) => entry.nodeId === "home-panel1-frame1");
  assert.ok(frame);
  assert.equal(frame.span.file, "components/Panel.kdm");
  assert.equal(frame.componentOrigin.component, "Panel");

  // The third instance supplies nothing, so the slot fallback renders.
  assert.match(html, /data-kdm-id="home-panel3-empty1"/);
  assert.match(html, /Nothing yet/);
  assert.equal(html.includes("home-panel1-empty1"), false);
  const fallback = page.sourceMap.find(
    (entry) => entry.nodeId === "home-panel3-empty1",
  );
  assert.ok(fallback);
  assert.equal(fallback.span.file, "components/Panel.kdm");
  assert.equal(fallback.componentOrigin.component, "Panel");
  assert.deepEqual(fallback.componentOrigin.instancePath, ["panel3"]);

  const css = fileText(result, "assets/kadam.home.css");
  assert.equal(ruleCount(css, ".kdm-home-note1"), 1);
  assert.equal(ruleCount(css, ".kdm-c-Panel-default-frame1"), 1);
  assert.equal(ruleCount(css, ".kdm-c-Panel-default-heading1"), 1);
});

test("named slot groups compile without emitting their own element", () => {
  const panel = `component Panel {
    frame1 {
        a container
        head1 {
            a header slot
            fallback1 {
                a minor heading
                the heading text says "No header"
            }
        }
    }
}
`;
  const home = `kadam 0.1

page "Home" {
    panel1 {
        a Panel
        head1 {
            a header slot
            title1 {
                a minor heading
                the heading text says "Custom"
                the text is 24px
            }
        }
    }
}
`;
  const projectRoot = createProject(
    { "pages/home.kdm": home, "components/Panel.kdm": panel },
    ["components/Panel.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const page = result.pages[0];
  assert.ok(page);
  const html = fileText(result, "index.html");
  // The slot placeholder and the fill group both disappear; only content remains.
  assert.match(html, /data-kdm-id="home-title1"/);
  assert.equal(html.includes("home-panel1-head1"), false);
  assert.equal(html.includes("home-panel1-fallback1"), false);
  assert.equal(html.includes("header slot"), false);

  const title = page.sourceMap.find((entry) => entry.nodeId === "home-title1");
  assert.ok(title);
  assert.equal(title.span.file, "pages/home.kdm");
  assert.equal(title.componentOrigin, undefined);

  const css = fileText(result, "assets/kadam.home.css");
  assert.equal(ruleCount(css, ".kdm-home-title1"), 1);
});

test("library components emit namespace-scoped classes", () => {
  const button = (text) => `component Button {
    button1 {
        a button
        the button text says "${text}"
        when clicked, go to page "Home"
    }
}
`;
  const home = `kadam 0.1

page "Home" {
    first1 {
        a Button
    }

    second1 {
        a Button from ui
    }
}
`;
  const projectRoot = createProject(
    {
      "pages/home.kdm": home,
      "components/Button.kdm": button("Project"),
      "libs/ui/Button.kdm": button("Library"),
    },
    [
      "components/Button.kdm",
      { source: "libs/ui/Button.kdm", namespace: "ui" },
    ],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const page = result.pages[0];
  assert.ok(page);
  assert.equal(page.elements[0].className, "kdm-c-Button-default-button1");
  assert.equal(page.elements[1].className, "kdm-c-ui-Button-default-button1");

  const html = fileText(result, "index.html");
  assert.match(html, /Project/);
  assert.match(html, /Library/);
  assert.match(html, /data-kdm-id="home-second1-button1"/);

  const mapping = page.sourceMap.find(
    (entry) => entry.nodeId === "home-second1-button1",
  );
  assert.ok(mapping);
  assert.equal(mapping.span.file, "libs/ui/Button.kdm");
  assert.equal(mapping.componentOrigin.namespace, "ui");

});

test("url component parameters emit external links", () => {
  const externalLink = `component ExternalLink takes a label as text, a url as url {
    link1 {
        a link
        the link text says "{$label}"
        when clicked, open "{$url}" in a new tab
    }
}
`;
  const home = `kadam 0.1

page "Home" {
    docs1 {
        a ExternalLink
        with a label of "Read the docs"
        with a url of "https://example.com/docs"
    }
}
`;
  const projectRoot = createProject(
    {
      "pages/home.kdm": home,
      "components/ExternalLink.kdm": externalLink,
    },
    ["components/ExternalLink.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const html = fileText(result, "index.html");
  assert.match(html, /href="https:\/\/example\.com\/docs"/);
  assert.match(html, /Read the docs/);
  assert.doesNotMatch(html, /<script/);
});

test("image component parameters copy and emit the bound asset", () => {
  const photo = `component Photo takes a caption as text, a picture as image {
    photo1 {
        an image
        it shows "{$picture}"
        the description says "{$caption}"
    }
}
`;
  const home = `kadam 0.1

page "Home" {
    photo1 {
        a Photo
        with a caption of "Chart"
        with a picture of "assets/chart.svg"
    }
}
`;
  const projectRoot = createProject(
    {
      "pages/home.kdm": home,
      "components/Photo.kdm": photo,
      "assets/chart.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    },
    ["components/Photo.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const html = fileText(result, "index.html");
  assert.match(html, /src="\/assets\/chart\.svg"/);
  assert.match(html, /alt="Chart"/);
  assert.doesNotMatch(html, /\{\$/);
  assert.doesNotMatch(html, /<script/);
  assert.match(fileText(result, "assets/chart.svg"), /<svg/);
});

test("length parameters get per-binding component classes", () => {
  const badge = `component Badge takes a size as length defaulting to "14px" {
    text1 {
        a paragraph
        the text says "New"
        the text is "{$size}"
    }
}
`;
  const home = `kadam 0.1

page "Home" {
    first1 {
        a Badge
    }
    second1 {
        a Badge
        with a size of "18px"
    }
}
`;
  const projectRoot = createProject(
    {
      "pages/home.kdm": home,
      "components/Badge.kdm": badge,
    },
    ["components/Badge.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const page = result.pages[0];
  assert.ok(page);
  assert.notEqual(page.elements[0].className, page.elements[1].className);
  assert.match(page.elements[0].className, /^kdm-c-Badge-default-text1-/);

  const css = fileText(result, "assets/kadam.home.css");
  assert.match(css, /font-size:\s*14px/);
  assert.match(css, /font-size:\s*18px/);
});

test("only referenced style bindings split component CSS classes", () => {
  const badge = `component Badge takes a label as text, an accent as color defaulting to "blue" {
    text1 {
        a paragraph
        the text says "{$label}"
        the text is "{$accent}"
    }
}
`;
  const home = `kadam 0.1

page "Home" {
    first1 {
        a Badge
        with a label of "First"
    }
    second1 {
        a Badge
        with a label of "Second"
    }
    third1 {
        a Badge
        with a label of "Third"
        with an accent of "green"
    }
}
`;
  const projectRoot = createProject(
    {
      "pages/home.kdm": home,
      "components/Badge.kdm": badge,
    },
    ["components/Badge.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const page = result.pages[0];
  assert.ok(page);
  assert.equal(page.elements[0].className, page.elements[1].className);
  assert.notEqual(page.elements[0].className, page.elements[2].className);

  const css = fileText(result, "assets/kadam.home.css");
  const rules = css.match(/^\.kdm-c-Badge-default-text1-[a-z0-9]+ \{/gm) ?? [];
  assert.equal(rules.length, 2, rules.join("\n"));
  assert.match(css, /color:\s*blue/);
  assert.match(css, /color:\s*green/);
});

test("color parameters get per-binding component classes", () => {
  const badge = `component Badge takes an accent as color defaulting to "blue" {
    text1 {
        a paragraph
        the text says "New"
        the text is "{$accent}"
    }
}
`;
  const home = `kadam 0.1

page "Home" {
    first1 {
        a Badge
    }
    second1 {
        a Badge
        with an accent of "#15803D"
    }
}
`;
  const projectRoot = createProject(
    {
      "pages/home.kdm": home,
      "components/Badge.kdm": badge,
    },
    ["components/Badge.kdm"],
  );

  const result = compileProject({ projectRoot });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const page = result.pages[0];
  assert.ok(page);
  assert.notEqual(page.elements[0].className, page.elements[1].className);

  const css = fileText(result, "assets/kadam.home.css");
  assert.match(css, /color:\s*blue/);
  assert.match(css, /color:\s*#15803d/);
});
