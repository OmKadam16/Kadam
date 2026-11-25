import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const studioHost = "http://127.0.0.1:4310";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist/web", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 4311,
    strictPort: true,
    proxy: {
      "/__studio": studioHost,
      "/__preview": studioHost,
      "/__kadam": studioHost,
    },
  },
});
