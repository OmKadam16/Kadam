import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildOutline,
  outlineNodeAt,
  outlinePathAt,
} from "../dist/editor/index.js";

test("a page outline preserves nesting, kinds, and source spans", () => {
  const result = buildOutline(
    "pages/home.kdm",
    `page "Home" {
    hero1 {
        a card
        headline1 {
            a main heading
            the text says "Welcome"
        }
    }
    action1 {
        a Button from ui in the outline variant
    }
}
`,
    "page",
  );

  assert.deepEqual(result.diagnostics, []);
  const page = result.outline;
  assert.ok(page);
  assert.equal(page.id, "page");
  assert.equal(page.type, "page");
  assert.equal(page.name, "Home");
  assert.equal(page.span.start.line, 1);
  assert.equal(page.nameSpan.file, "pages/home.kdm");

  const hero = page.children[0];
  assert.ok(hero);
  assert.equal(hero.id, "element:hero1");
  assert.equal(hero.kind, "card");
  assert.equal(hero.nameSpan.start.line, 2);

  const headline = hero.children[0];
  assert.ok(headline);
  assert.equal(headline.id, "element:hero1/headline1");    assert.equal(headline.kind, "main heading");
  assert.equal(headline.name, "headline1");

  const action = page.children[1];
  assert.ok(action);
  assert.equal(action.kind, "Button from ui in the outline variant");
});

test("a component outline separates the default body from variants", () => {
  const result = buildOutline(
    "components/PriceCard.kdm",
    `component PriceCard takes a title as text {
    card1 {
        a card
        title1 {
            a main heading
            the text says "{$title}"
        }
    }

    variant featured {
        card1 {
            a card
        }
    }
}
`,
    "component",
  );

  assert.deepEqual(result.diagnostics, []);
  const component = result.outline;
  assert.ok(component);
  assert.equal(component.id, "component");
  assert.equal(component.type, "component");
  assert.equal(component.name, "PriceCard");
  assert.equal(component.children.length, 2);
  assert.equal(component.children[0].id, "element:PriceCard/card1");
  assert.equal(component.children[1].type, "variant");
  assert.equal(component.children[1].id, "variant:featured");
  assert.equal(
    component.children[1].children[0].id,
    "element:PriceCard/variant/featured/card1",
  );
});

test("an incomplete page still returns a partial outline with diagnostics", () => {
  const result = buildOutline(
    "pages/home.kdm",
    `page "Home" {
    hero1 {
        a card
`,
    "page",
  );

  assert.ok(result.diagnostics.length > 0);
  assert.equal(result.outline?.name, "Home");
  assert.equal(result.outline?.children[0].name, "hero1");
});

test("cursor offsets resolve the deepest node and its ancestor path", () => {
  const text = `page "Home" {
    hero1 {
        a card
        headline1 {
            a main heading
            the text says "Welcome"
        }
    }
}
`;
  const outline = buildOutline("pages/home.kdm", text, "page").outline;
  assert.ok(outline);

  const offset = text.indexOf("the text says");
  const path = outlinePathAt(outline, offset);
  assert.deepEqual(
    path.map((node) => node.name),
    ["Home", "hero1", "headline1"],
  );
  assert.equal(outlineNodeAt(outline, offset)?.id, "element:hero1/headline1");
  assert.deepEqual(outlinePathAt(outline, text.length), []);
  assert.equal(outlineNodeAt(outline, text.length), null);
});

test("component variant offsets include the variant in the path", () => {
  const text = `component PriceCard takes a title as text {
    card1 {
        a card
    }

    variant featured {
        card1 {
            a card
        }
    }
}
`;
  const outline = buildOutline("components/PriceCard.kdm", text, "component").outline;
  assert.ok(outline);

  const offset = text.indexOf("a card", text.indexOf("variant featured"));
  const path = outlinePathAt(outline, offset);
  assert.deepEqual(
    path.map((node) => node.id),
    ["component", "variant:featured", "element:PriceCard/variant/featured/card1"],
  );
  assert.equal(outlineNodeAt(outline, offset)?.kind, "card");
  assert.deepEqual(outlinePathAt(null, offset), []);
});
