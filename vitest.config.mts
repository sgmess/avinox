import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The API route tests (tests/api). The library tests in src/lib run with
// node --test instead: see package.json.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The real one throws outside a Next server build.
      "server-only": fileURLToPath(new URL("./tests/api/empty.ts", import.meta.url)),
    },
  },
});
