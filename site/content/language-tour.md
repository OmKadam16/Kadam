## Sentences, not properties

Every line is one sentence from a closed list, and each sentence means exactly one thing. If a line matches no sentence, or two, the compiler stops and says so, with a suggestion.

```
it arranges its children in a row
it has 24px gap between children
has 12px rounded corners
the text is between 2rem and 2.75rem
the letter spacing is -1.3px
```

## Layout

Containers arrange their children in a column by default. A row, a grid of columns, wrapping, spreading and stretching are each one sentence. Sizes take pixels, rem, em, percentages and screen units.

## Colors and themes

Name your colors once in a theme file and use the names everywhere. Dark mode is one more line per color. The compiler checks text contrast against WCAG AA and warns when it is too low.

## Components

A component is a reusable element with typed parameters, variants and slots for child content. Pages pass values with sentences such as `with a title of "Pricing"`, and the compiler checks every value against its type.

## When the grammar is not enough

Three escape hatches are allowed and always visible: one raw CSS declaration, a class from an existing stylesheet, and typed external functions. `kadam check` lists every use, and strict mode bans them.
