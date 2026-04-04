import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/riiiple.ts"),
      name: "Riiiple",
      fileName: "riiiple",
      formats: ["es"],
    },
    emptyOutDir: true,
    outDir: "dist",
  },
});
