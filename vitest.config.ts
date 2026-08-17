import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Boots an embedded throwaway Postgres and sets DATABASE_URL before any
    // worker spawns — tests never touch the real database.
    globalSetup: ["tests/global-setup.ts"],
  },
});
