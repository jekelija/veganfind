import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    // .ts = node integration/unit tests; .tsx = jsdom component tests
    // (each .tsx file declares `// @vitest-environment jsdom`).
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    // Boots an embedded throwaway Postgres and sets DATABASE_URL before any
    // worker spawns — tests never touch the real database.
    globalSetup: ["tests/global-setup.ts"],
  },
});
