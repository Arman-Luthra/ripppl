import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/ripppl.ts"),
      name: "Ripyl",
      fileName: "ripppl",
      formats: ["es"],
    },
    emptyOutDir: true,
    outDir: "dist",
  },
});
