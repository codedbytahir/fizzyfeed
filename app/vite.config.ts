import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

export default defineConfig({
  root: path.resolve(here, "src/client"),
  publicDir: path.resolve(here, "public"),
  plugins: [react()],
  build: {
    outDir: path.resolve(here, "dist/client"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(here, "src/shared"),
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});
