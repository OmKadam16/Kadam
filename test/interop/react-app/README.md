# React interop app (F6 exit test)

A minimal Vite + React 19 TypeScript app that uses Kadam components as custom
elements. It is a test fixture with its own packages, not a dependency of the
Kadam package (D-15).

```bash
cd test/interop/react-app
npm install
npm run build   # builds the Kadam elements, runs tsc --strict, then vite build
```

`test/browser/interop-react.spec.mjs` runs the same build and drives the app
in a browser. It is skipped when this folder's packages are not installed.
