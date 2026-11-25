import { escapeAttribute } from "./emit-html.js";
import type { PageIR } from "./ir.js";

/**
 * kadam 0.3: sitemap.xml, emitted only when kadam.json declares a siteUrl.
 * One entry per page, sorted by URL. There are no lastmod dates: they would
 * depend on the clock or file times and break byte-identical builds.
 */
export function emitSitemap(pages: readonly PageIR[]): string {
  const urls = pages
    .map((page) => page.meta?.canonicalUrl ?? null)
    .filter((url): url is string => url !== null)
    .sort();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escapeAttribute(url)}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
}
