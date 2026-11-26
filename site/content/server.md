## One module, typed end to end

A project can name one Kadam server module. Pages load from its functions and forms send to them by name:

```
it loads products from the server function listProducts
it sends to the server function signUp
```

The page takes its data shape from the record the function returns, and a form's controls must be exactly the fields of the record the function takes. A renamed field is a compile error, not a broken page.

## The generated server

`kadam build` writes the module compiled to TypeScript or Python and a small server that uses only that language's standard library. It serves the site, answers only the functions pages call, accepts forms only from the same site, and checks every value's type before calling your code.

## Without JavaScript

A form still works with JavaScript off: it posts normally, and the server answers with the page and the sent or failed note shown.
