import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  publicDir: false,
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      riiiple: resolve(__dirname, "src/riiiple.ts"),
    },
  },
});
