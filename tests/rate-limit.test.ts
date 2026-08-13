/**
 * DB-backed rate limiter tests: real Postgres at DATABASE_URL (from
 * .env.local), same as tests/api.test.ts. Windows are seeded with bulk
 * inserts instead of 30 sequential checks to keep the suite fast.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { checkWriteRateLimit, rateLimitKey } from "@/lib/rate-limit";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const KEYS = {
  fills: `test:${RUN}:fills`,
  blockedA: `test:${RUN}:blocked-a`,
  freshB: `test:${RUN}:fresh-b`,
  expired: `test:${RUN}:expired`,
};

const HOUR_MS = 60 * 60 * 1000;

async function seedEvents(key: string, n: number, at?: Date) {
  const db = getDb();
  await db
    .insert(schema.rateLimitEvents)
    .values(Array.from({ length: n }, () => ({ key, ...(at ? { at } : {}) })));
}

afterAll(async () => {
  const db = getDb();
  await db
    .delete(schema.rateLimitEvents)
    .where(inArray(schema.rateLimitEvents.key, Object.values(KEYS)));
  const sql = (globalThis as { __veganfindSql?: { end(): Promise<void> } })
    .__veganfindSql;
  await sql?.end();
}, 60_000);

describe("checkWriteRateLimit (Postgres-backed)", () => {
  it("allows the 30th write in the window, blocks the 31st with a retry hint", async () => {
    await seedEvents(KEYS.fills, 29);
    const thirtieth = await checkWriteRateLimit(KEYS.fills);
    expect(thirtieth.ok).toBe(true);

    const blocked = await checkWriteRateLimit(KEYS.fills);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(3600);
  }, 30_000);

  it("keys are independent", async () => {
    await seedEvents(KEYS.blockedA, 30);
    expect((await checkWriteRateLimit(KEYS.blockedA)).ok).toBe(false);
    expect((await checkWriteRateLimit(KEYS.freshB)).ok).toBe(true);
  }, 30_000);

  it("events older than the window don't count and get cleaned up", async () => {
    const stale = new Date(Date.now() - HOUR_MS - 60_000);
    await seedEvents(KEYS.expired, 30, stale);
    const result = await checkWriteRateLimit(KEYS.expired);
    expect(result.ok).toBe(true);

    // The allowed write cleaned up the expired rows; only its own remains.
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.rateLimitEvents)
      .where(inArray(schema.rateLimitEvents.key, [KEYS.expired]));
    expect(rows).toHaveLength(1);
    expect(rows[0].at.getTime()).toBeGreaterThan(stale.getTime());
  }, 30_000);
});

describe("rateLimitKey", () => {
  it("prefers the user id", () => {
    const req = new Request("http://x/", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    expect(rateLimitKey("u1", req)).toBe("user:u1");
  });

  it("falls back to the first x-forwarded-for hop", () => {
    const req = new Request("http://x/", {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    });
    expect(rateLimitKey(null, req)).toBe("ip:1.2.3.4");
    expect(rateLimitKey(null, new Request("http://x/"))).toBe("ip:unknown");
  });
});
