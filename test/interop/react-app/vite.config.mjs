import { defineConfig } from "vite";

// No React plugin: esbuild compiles TSX with React's automatic runtime.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  build: { outDir: "dist", emptyOutDir: true },
});
