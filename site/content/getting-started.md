## Install and create a project

Kadam is one command-line tool with no dependencies. Create a project from a template, then start the development server:

```
kadam new my-site --template marketing
cd my-site
kadam dev
```

The page opens in your browser and reloads when you save. The state on the page, such as a counter or an open menu, and the scroll position stay as they were.

## The shape of a page

A page is a list of named elements. Each element starts with one sentence that says what it is, then sentences that say how it looks and behaves. Braces hold its children.

```
kadam 0.3

page "Home" {
    hero {
        a section
        it has 64px padding
        title {
            a main heading
            the text says "Hello"
        }
    }
}
```

## Build

`kadam build` writes plain HTML and CSS, plus a small script only when a page needs one. The same source always builds the same files.

- `kadam check` finds every problem without writing anything.
- `kadam explain KDM3005` says what an error code means.
- `kadam format` lays out your files the canonical way.
