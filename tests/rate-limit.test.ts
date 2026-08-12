import { describe, expect, it } from "vitest";
import { checkWriteRateLimit, rateLimitKey } from "@/lib/rate-limit";

describe("checkWriteRateLimit", () => {
  it("allows 30 writes per hour, then blocks with a retry hint", () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 30; i++) {
      expect(checkWriteRateLimit(key).ok).toBe(true);
    }
    const blocked = checkWriteRateLimit(key);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keys are independent", () => {
    const a = `test-a-${Date.now()}`;
    const b = `test-b-${Date.now()}`;
    for (let i = 0; i < 30; i++) checkWriteRateLimit(a);
    expect(checkWriteRateLimit(a).ok).toBe(false);
    expect(checkWriteRateLimit(b).ok).toBe(true);
  });
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
