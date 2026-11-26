# The Kadam documentation site

Written in Kadam. Pages are in `pages/`, guide text is Markdown in `content/`,
and `data/guides.json` lists the guides. `data/sentences.json` and
`data/codes.json` are generated from the compiler:

```bash
npm run build && node scripts/generate-site-data.mjs
kadam dev site
```
