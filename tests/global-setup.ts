/**
 * Vitest global setup: boot a throwaway embedded Postgres, migrate it, and
 * point DATABASE_URL at it BEFORE any test worker spawns.
 *
 * This is the wall between tests and real data: test files never read
 * .env.local, so destructive suites (writes today, the M4 erasure endpoint
 * tomorrow) physically cannot reach the Supabase database.
 *
 * Escape hatch: set TEST_DATABASE_URL to use an externally managed Postgres
 * (it still must contain "test" in its database name — a typo that points
 * tests at a real database should fail loudly, not wipe rows).
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const PORT = 54329;
const DB_NAME = "veganfind_test";
const DATA_DIR = path.resolve(__dirname, "..", ".test-db");

let embedded: EmbeddedPostgres | null = null;

async function migrateTestDb(url: string) {
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  } finally {
    await sql.end();
  }
}

export async function setup() {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    if (!/test/i.test(new URL(external).pathname)) {
      throw new Error(
        `TEST_DATABASE_URL database name must contain "test" (got "${new URL(external).pathname}") — refusing to run destructive tests against it.`,
      );
    }
    await migrateTestDb(external);
    process.env.DATABASE_URL = external;
    return;
  }

  // Fresh cluster every run: cheap (~1s on an empty data dir) and immune to
  // schema drift from older runs.
  await rm(DATA_DIR, { recursive: true, force: true });

  embedded = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
    // Quiet the per-run initdb/server chatter in test output.
    onLog: () => {},
  });
  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase(DB_NAME);

  const url = `postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`;
  await migrateTestDb(url);
  // Workers inherit this env — lib/db's getDb() connects to the embedded
  // instance without any test file having to think about configuration.
  process.env.DATABASE_URL = url;
}

export async function teardown() {
  await embedded?.stop();
  await rm(DATA_DIR, { recursive: true, force: true });
}
