import { and, count, eq, gt, lte, min } from "drizzle-orm";
import { getDb, schema } from "./db";

/**
 * Postgres-backed sliding-window rate limiter for write endpoints (M3):
 * 30 writes per hour, keyed by user id (falling back to client IP from
 * x-forwarded-for). One rate_limit_events row per counted write, so the
 * limit is global across serverless instances — this replaced the
 * per-instance in-memory window from the MVP.
 *
 * Expired rows for a key are deleted opportunistically on that key's next
 * allowed write; a rejected write does not insert (retrying while blocked
 * never extends the block).
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_WRITES_PER_WINDOW = 30;

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the oldest counted write falls out of the window. */
  retryAfterSeconds: number;
}

/** Record + check one write against the key's sliding window. */
export async function checkWriteRateLimit(
  key: string,
): Promise<RateLimitResult> {
  const db = getDb();
  const now = Date.now();
  const cutoff = new Date(now - WINDOW_MS);
  const { rateLimitEvents } = schema;

  const [window] = await db
    .select({ hits: count(), oldest: min(rateLimitEvents.at) })
    .from(rateLimitEvents)
    .where(and(eq(rateLimitEvents.key, key), gt(rateLimitEvents.at, cutoff)));

  if ((window?.hits ?? 0) >= MAX_WRITES_PER_WINDOW) {
    const oldestMs = window?.oldest
      ? new Date(window.oldest).getTime()
      : now;
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldestMs + WINDOW_MS - now) / 1000),
      ),
    };
  }

  await db.insert(rateLimitEvents).values({ key });
  // Opportunistic cleanup: expired rows for this key only (index-friendly).
  await db
    .delete(rateLimitEvents)
    .where(and(eq(rateLimitEvents.key, key), lte(rateLimitEvents.at, cutoff)));

  return { ok: true, retryAfterSeconds: 0 };
}

/** Prefer the authed user id; fall back to the client IP. */
export function rateLimitKey(
  userId: string | null,
  request: Request,
): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `ip:${ip}`;
}

/**
 * Convenience gate for write handlers: returns a 429 Response when the
 * caller is over the limit, else null.
 */
export async function rateLimitResponse(
  userId: string | null,
  request: Request,
): Promise<Response | null> {
  const { ok, retryAfterSeconds } = await checkWriteRateLimit(
    rateLimitKey(userId, request),
  );
  if (ok) return null;
  return Response.json(
    { error: "Rate limit exceeded: max 30 writes per hour. Try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
