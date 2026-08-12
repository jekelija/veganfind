import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Single data-access path (PLAN.md §3): every write goes through a Next.js
 * route handler using this Drizzle client. The browser never talks to the
 * database directly.
 */

const globalForDb = globalThis as unknown as {
  __veganfindSql?: ReturnType<typeof postgres>;
};

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  // Reuse the connection across hot reloads / route handlers.
  const sql =
    globalForDb.__veganfindSql ?? postgres(url, { prepare: false, max: 5 });
  globalForDb.__veganfindSql = sql;
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof getDb>;
export { schema };
