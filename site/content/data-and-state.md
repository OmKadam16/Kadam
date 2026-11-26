## State

An element remembers a value with one sentence, and events change it:

```
it remembers clicks, a number that starts as 0
when clicked, add 1 to clicks
the text shows clicks
```

A state can be kept in the page address, so a filter survives a reload and can be shared as a link. A style can follow a state: `when suite is "terminal", has a #FFFFFF background`.

## Data at build time

JSON files in the project become lists and whole pages. A blog post per record is one page file with a route such as `/posts/:slug`. Markdown documents become ordinary elements, so every page rule applies to them.

## Data at run time

A container can load a list from a URL while the page is open. The record shape is declared, the loading, empty and error states are required, and values only ever reach the page as text, never as HTML.
