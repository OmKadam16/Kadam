// D-51 maintainers' script: refresh library/fonts/ (the catalog and the
// built-in families). Needs the network and `npm run build` first.
//   node scripts/bundle-fonts.mjs [--catalog-only]

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadCatalog, downloadFont } from "../dist/fonts/fetch.js";

const root = fileURLToPath(new URL("../library/fonts/", import.meta.url));
writeFileSync(join(root, "catalog.json"), await downloadCatalog());
console.log("catalog written");
if (process.argv.includes("--catalog-only")) process.exit(0);

const ids = readFileSync(join(root, "built-in.txt"), "utf8").split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
for (const id of ids) {
  const directory = join(root, id);
  if (existsSync(join(directory, "font.json")) && !process.argv.includes("--refresh")) continue;
  rmSync(directory, { recursive: true, force: true });
  try {
    const font = await downloadFont(id, directory);
    console.log(`${font.family}: ${font.files.length} files`);
  } catch (error) {
    console.error(`${id}: ${error.message}`);
  }
}
