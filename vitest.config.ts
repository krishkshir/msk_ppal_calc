import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" mapping — without this,
    // a real (non-type-only) "@/..." import resolves fine under `next
    // dev`/`next build` but fails under Vitest, since Vite doesn't read
    // tsconfig `paths` on its own.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
