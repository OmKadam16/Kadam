// F7: live reloads in kadam dev keep the page's state and scroll position.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

import { createDevServer } from "../../dist/server/dev-server.js";

function project() {
  const root = mkdtempSync(join(tmpdir(), "kadam-dev-reload-"));
  mkdirSync(join(root, "pages"));
  const filler = Array.from({ length: 12 }, (_, i) => `    filler${i} {\n        a paragraph\n        the text says "Line ${i}"\n        it has 80px padding\n    }`).join("\n");
  writeFileSync(join(root, "pages", "home.kdm"), [
    "kadam 0.3", "", 'page "Home" {', "    counter {", "        a container",
    "        it remembers clicks, a number that starts as 0",
    "        total {", "            a paragraph", "            the text shows clicks", "        }",
    "        bump {", "            a button", '            the text says "Add one"', "            when clicked, add 1 to clicks", "        }",
    "        note {", "            a paragraph", '            the text says "Version one"', "        }",
    "    }", filler, "}", "",
  ].join("\n"));
  writeFileSync(join(root, "kadam.json"), JSON.stringify({ kadam: "0.3", name: "reload", pages: [{ source: "pages/home.kdm", route: "/" }] }));
  return root;
}

test("an edit reloads the page with its state and scroll position kept", async ({ page }) => {
  const root = project();
  const server = await createDevServer({ projectRoot: root, host: "127.0.0.1", port: 0, openBrowser: false, watch: true, logger: () => {} });
  try {
    await page.goto(server.url);
    await page.getByRole("button", { name: "Add one" }).click();
    await page.getByRole("button", { name: "Add one" }).click();
    await expect(page.locator("[data-kdm-id='home-total']")).toHaveText("2");
    await page.evaluate(() => window.scrollTo(0, 600));
    const file = join(root, "pages", "home.kdm");
    const reloaded = page.waitForEvent("load");
    writeFileSync(file, readFileSync(file, "utf8").replace("Version one", "Version two"));
    await reloaded;
    await expect(page.getByText("Version two")).toBeVisible();
    await expect(page.locator("[data-kdm-id='home-total']")).toHaveText("2");
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    // A normal visit starts fresh.
    await page.goto(server.url);
    await expect(page.locator("[data-kdm-id='home-total']")).toHaveText("0");
  } finally {
    await server.close();
  }
});
