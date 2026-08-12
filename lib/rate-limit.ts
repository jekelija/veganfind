/**
 * In-memory sliding-window rate limiter for write endpoints: 30 writes per
 * hour, keyed by user id (falling back to client IP from x-forwarded-for).
 *
 * SERVERLESS CAVEAT: this state lives in the memory of a single server
 * instance. On Vercel/serverless each instance (and each cold start) gets its
 * own empty window, so the effective limit is per-instance, not global.
 * Replace with Postgres-based limiting (a rate_limit_events table or a
 * counter with a window column) before real launch — see PLAN.md M3.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_WRITES_PER_WINDOW = 30;

const globalForRl = globalThis as unknown as {
  __veganfindRateWindows?: Map<string, number[]>;
};
// Survive Next.js dev hot reloads, same trick as the db client.
const windows: Map<string, number[]> = (globalForRl.__veganfindRateWindows ??=
  new Map());

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the oldest counted write falls out of the window. */
  retryAfterSeconds: number;
}

/** Record + check one write against the key's sliding window. */
export function checkWriteRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const hits = (windows.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= MAX_WRITES_PER_WINDOW) {
    windows.set(key, hits);
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((hits[0] + WINDOW_MS - now) / 1000)),
    };
  }
  hits.push(now);
  windows.set(key, hits);
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
export function rateLimitResponse(
  userId: string | null,
  request: Request,
): Response | null {
  const { ok, retryAfterSeconds } = checkWriteRateLimit(
    rateLimitKey(userId, request),
  );
  if (ok) return null;
  return Response.json(
    { error: "Rate limit exceeded: max 30 writes per hour. Try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
