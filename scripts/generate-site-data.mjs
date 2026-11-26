// Regenerates the documentation site's reference data from the compiler, so
// the site can never describe a sentence or an error code that does not exist.
// Run after `npm run build`: node scripts/generate-site-data.mjs
// test/f7-site.test.mjs fails when the files are out of date.
import { writeFileSync } from "node:fs";

const { STATEMENT_TEMPLATES } = await import("../dist/core/parser/registry.js");
const { CODE_EXPLANATIONS } = await import("../dist/core/diagnostics/explanations.js");

const sentences = STATEMENT_TEMPLATES
  .filter((template) => (template.examples ?? []).length > 0)
  .map((template) => ({
    name: template.description,
    version: template.since ?? "0.1",
    examples: template.examples.slice(0, 3).join("   ·   "),
  }))
  .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
const codes = CODE_EXPLANATIONS.map((entry) => ({ code: entry.code, area: entry.area, meaning: entry.meaning }));

writeFileSync("site/data/sentences.json", `${JSON.stringify(sentences, null, 2)}\n`);
writeFileSync("site/data/codes.json", `${JSON.stringify(codes, null, 2)}\n`);
console.log(`wrote ${sentences.length} sentences and ${codes.length} codes`);
