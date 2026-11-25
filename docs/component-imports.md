# Component imports and namespaces

**Status:** Implemented — manifest namespaces, the `from` qualifier,
namespace-scoped CSS identity, and the library example (Phases 1–4). External
library roots and re-exports remain deferred.
**Depends on:** M6.1 and the content-slot extension in `docs/components.md`.
**Scope:** Let a project reference components from manifest-declared libraries
without flattening every component into one global namespace.

---

## 1. Problem

Today every component listed in `kadam.json` shares one project-wide namespace.
That is sufficient for one application, but it blocks two things:

- **Libraries:** a shared set of components cannot be added without editing its
  files or risking a name collision with the host project.
- **Composition at scale:** two unrelated parts of a project cannot both declare
  a `Button`.

The current manifest already lists component files explicitly, so the missing
piece is a namespace attached to those files, not filesystem discovery.

## 2. Non-goals

- no package registry, version solving, or network fetch;
- no implicit directory walking;
- no aliasing of individual components in this phase;
- no conditional imports or tree shaking;
- no change to expansion, identity, or emission beyond the component name used
  in scoped CSS classes.

## 3. Proposed manifest shape

Namespaces are optional per component entry:

```json
{
  "kadam": "0.1",
  "components": [
    "components/Button.kdm",
    { "source": "libs/ui/Card.kdm", "namespace": "ui" },
    { "source": "libs/ui/Field.kdm", "namespace": "ui" }
  ],
  "pages": [{ "source": "pages/home.kdm", "route": "/" }]
}
```

Rules:

- A string entry keeps today's behaviour: the component joins the project
  namespace and is referenced by its declared name.
- An object entry adds a required `source` and an optional `namespace`.
- A namespace is a lower-camel identifier and is unique per component, not per
  file: `ui.Card` and `ui.Field` share `ui`.
- `source` paths keep every existing containment rule: project-relative, not in
  the output directory, regular file, no symlink escape. Libraries outside the
  project root are out of scope for this phase.
- `(namespace, component name)` must be unique. Two un-namespaced components
  with the same name remain `KDM3020`.

## 4. Referencing a namespaced component

The kind sentence gains one contextual clause:

```kdm
primary1 {
    a Button from ui
    with a label of "Save"
}
```

```kdm
card1 {
    a Card from ui in the featured variant
}
```

Grammar:

```text
a <ComponentName> [from <namespace>] [in the <variantName> variant]
```

Rules:

- `from` is contextual, recognised only after a single PascalCase component
  name. Existing element names such as `from` are unaffected.
- A namespaced component must be referenced with its namespace. An unqualified
  reference resolves only in the project namespace, never by searching
  libraries. There is no fallback chain.
- A qualifier on a project-namespace component is an error, not a silent match.
- Namespaces are not transitive: a component body resolves its own instances
  against the same project catalog, so it must qualify library components the
  same way pages do.
- Suggestions are namespace-aware: an unknown qualified name lists names in
  that namespace; an unknown namespace lists declared namespaces.

## 5. Identity and emission

Component identity currently contributes `ComponentName` and the variant to the
scoped class:

```text
kdm-c-<ComponentName>-<variant>-<localElementName>
```

With namespaces, the class must include the namespace to keep two `Button`
components distinct on one page:

```text
kdm-c-<namespace>-<ComponentName>-<variant>-<localElementName>
kdm-c-default-Button-default-button1        (project namespace)
kdm-c-ui-Button-default-button1             (ui namespace)
```

Everything else is unchanged:

- `data-kdm-id` and form IDs still come from declared instance paths, so two
  instances never collide regardless of namespace.
- A component file remains source, never a route or asset.
- Expansion stays pure and in-place; a namespace is metadata on the catalog
  record, not an AST wrapper.
- Un-namespaced projects emit byte-identical CSS to today.

## 6. Diagnostics (proposed)

| Code | Condition | Primary location |
| --- | --- | --- |
| `KDM3035` | Duplicate `(namespace, component)` pair | second component header |
| `KDM3036` | Unknown namespace, or component not in that namespace | qualifier/name |
| `KDM3037` | Namespace qualifier on a project-namespace component | qualifier |
| `KDM4009` | Malformed library entry: bad namespace, missing source, duplicate path | manifest entry |

`KDM3022` (unknown component) still covers unqualified misses. Existing
`KDM4007`/`KDM4008` path and unit checks apply unchanged to library entries.

## 7. Implementation phases

1. **Manifest and catalog.** Parse string/object component entries, validate
   namespace identifiers and unique pairs, and key catalog records by
   `(namespace, name)`. No grammar change yet.
2. **Grammar.** Parse the optional `from <namespace>` clause into
   `ComponentKindReference`, keep `kindText()` stable for diagnostics, and
   resolve qualified names in validation.
3. **Identity.** Include the namespace in component-scoped classes only when a
   namespace is declared, preserving byte-identical output for existing
   projects.
4. **Example and docs.** Add a small `examples/components/libs/ui/` library with
   one namespaced component used from a page, update the READMEs, and extend the
   acceptance tests for determinism, source maps, and CSS deduplication.

Each phase lands with focused tests before the next depends on it, and
`npm run check` must stay green.

## 8. Open questions

- Should a namespace be declared once in a `libraries` block with a root path,
  rather than repeated per file? Repetition is simpler and keeps every path
  explicit; a root also needs an include rule.
- Should project components be allowed to opt into a namespace, or is the
  project namespace always unqualified?
- Do libraries ever live outside the project root? That requires an explicit
  trust boundary, realpath checks, and dev-server watch rules.
- Should a library be able to re-export another library's component? Deferred
  until there is a concrete need.

## 9. Recommendation

Adopt the optional per-entry `namespace` with the `from <namespace>` qualifier.
It reuses the existing explicit manifest, keeps one catalog and one expansion
pass, and limits the language change to one contextual clause. External library
roots and re-exports should stay out of the first implementation.
