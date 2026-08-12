/**
 * Integration tests for the write flows: real local Postgres (DATABASE_URL
 * from .env.local), real Drizzle + recompute, real rate limiter. Only
 * "@/lib/auth/server" is mocked so we can act as different signed-in users
 * without a Supabase instance.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const authState = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
}));

vi.mock("@/lib/auth/server", () => ({
  isAuthConfigured: () => true,
  getSessionUser: async () => authState.user,
  requireUser: async () => {
    if (!authState.user) {
      return {
        response: Response.json({ error: "unauthed" }, { status: 401 }),
      };
    }
    // Mirror the real requireUser: make sure the profile row exists.
    const { getDb, schema } = await import("@/lib/db");
    await getDb()
      .insert(schema.profiles)
      .values({ id: authState.user.id, email: authState.user.email })
      .onConflictDoNothing();
    return { user: authState.user };
  },
}));

import { getDb, schema } from "@/lib/db";
import * as placesRoute from "@/app/api/places/route";
import * as placeDetailRoute from "@/app/api/places/[id]/route";
import * as submissionsRoute from "@/app/api/places/[id]/submissions/route";
import * as votesRoute from "@/app/api/submissions/[id]/votes/route";

const ALICE = { id: "0a000000-0000-4000-8000-00000000000a", email: "alice@apitest.local" };
const BOB = { id: "0b000000-0000-4000-8000-00000000000b", email: "bob@apitest.local" };
const CAROL = { id: "0c000000-0000-4000-8000-00000000000c", email: "carol@apitest.local" };
const DAVE = { id: "0d000000-0000-4000-8000-00000000000d", email: "dave@apitest.local" };
const TEST_USER_IDS = [ALICE.id, BOB.id, CAROL.id, DAVE.id];

function actAs(user: { id: string; email: string | null } | null) {
  authState.user = user;
}

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// Somewhere in the ocean, far from any seeded Seattle data.
const TEST_LAT = 10.5;
const TEST_LNG = 10.5;
const TEST_BBOX = "10,10,11,11";

async function cleanup() {
  const db = getDb();
  const { inArray } = await import("drizzle-orm");
  const testPlaces = await db
    .select({ id: schema.places.id })
    .from(schema.places)
    .where(eq(schema.places.name, "API Test Cafe"));
  const placeIds = testPlaces.map((p) => p.id);
  if (placeIds.length > 0) {
    const subs = await db
      .select({ id: schema.veganSubmissions.id })
      .from(schema.veganSubmissions)
      .where(inArray(schema.veganSubmissions.placeId, placeIds));
    if (subs.length > 0) {
      await db.delete(schema.votes).where(
        inArray(schema.votes.submissionId, subs.map((s) => s.id)),
      );
    }
    await db
      .delete(schema.veganSubmissions)
      .where(inArray(schema.veganSubmissions.placeId, placeIds));
    await db
      .delete(schema.placeScores)
      .where(inArray(schema.placeScores.placeId, placeIds));
    await db.delete(schema.places).where(inArray(schema.places.id, placeIds));
  }
  await db
    .delete(schema.profiles)
    .where(inArray(schema.profiles.id, TEST_USER_IDS));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  const sql = (globalThis as { __veganfindSql?: { end(): Promise<void> } })
    .__veganfindSql;
  await sql?.end();
});

describe("write flows (auth mocked, real DB)", () => {
  let placeId: string;
  let aliceSubmissionId: string;

  it("rejects writes when signed out (401)", async () => {
    actAs(null);
    const res = await placesRoute.POST(
      post("http://t/api/places", { name: "x", lat: 1, lng: 1 }),
    );
    expect(res.status).toBe(401);
  });

  it("creates a user-added place", async () => {
    actAs(ALICE);
    const res = await placesRoute.POST(
      post("http://t/api/places", {
        name: "  API Test Cafe  ",
        lat: TEST_LAT,
        lng: TEST_LNG,
        address: "1 Test Way",
      }),
    );
    expect(res.status).toBe(201);
    const { place } = await res.json();
    expect(place.name).toBe("API Test Cafe");
    expect(place.source).toBe("user");
    expect(place.status).toBeNull();
    expect(place.verification).toBe("none");
    expect(place.score).toBe(0);
    placeId = place.id;
  });

  it("validates CreatePlaceBody", async () => {
    actAs(ALICE);
    const bad = [
      { name: "", lat: 1, lng: 1 },
      { name: "x".repeat(201), lat: 1, lng: 1 },
      { name: "ok", lat: 91, lng: 1 },
      { name: "ok", lat: 1, lng: 181 },
      { name: "ok", lat: Infinity, lng: 1 },
      { name: "ok", lat: 1, lng: 1, address: "a".repeat(301) },
    ];
    for (const body of bad) {
      const res = await placesRoute.POST(post("http://t/api/places", body));
      expect(res.status).toBe(400);
    }
  });

  it("creates a submission and recomputes the score", async () => {
    actAs(ALICE);
    const res = await submissionsRoute.POST(
      post("http://t/s", { status: "fully_vegan", note: "all plants" }),
      ctx(placeId),
    );
    expect(res.status).toBe(201);
    const { submission } = await res.json();
    expect(submission.status).toBe("fully_vegan");
    expect(submission.note).toBe("all plants");
    expect(submission.isMine).toBe(true);
    expect(submission.upvotes).toBe(0);
    aliceSubmissionId = submission.id;

    const db = getDb();
    const [score] = await db
      .select()
      .from(schema.placeScores)
      .where(eq(schema.placeScores.placeId, placeId));
    expect(score.status).toBe("fully_vegan");
    expect(score.score).toBeGreaterThan(0);
    expect(score.submissionCount).toBe(1);
  });

  it("rejects invalid submission bodies", async () => {
    actAs(ALICE);
    const r1 = await submissionsRoute.POST(
      post("http://t/s", { status: "meaty" }),
      ctx(placeId),
    );
    expect(r1.status).toBe(400);
    const r2 = await submissionsRoute.POST(
      post("http://t/s", { status: "fully_vegan", note: "n".repeat(1001) }),
      ctx(placeId),
    );
    expect(r2.status).toBe(400);
    const r3 = await submissionsRoute.POST(
      post("http://t/s", { status: "fully_vegan" }),
      ctx("00000000-0000-4000-8000-000000000000"),
    );
    expect(r3.status).toBe(404);
    const r4 = await submissionsRoute.POST(
      post("http://t/s", { status: "fully_vegan" }),
      ctx("nope"),
    );
    expect(r4.status).toBe(400);
  });

  it("409s when voting on your own submission", async () => {
    actAs(ALICE);
    const res = await votesRoute.POST(
      post("http://t/v", { value: 1 }),
      ctx(aliceSubmissionId),
    );
    expect(res.status).toBe(409);
  });

  it("accepts votes, upserts on re-vote, and recomputes", async () => {
    actAs(BOB);
    const r1 = await votesRoute.POST(
      post("http://t/v", { value: 1 }),
      ctx(aliceSubmissionId),
    );
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ ok: true });

    const db = getDb();
    const [afterUp] = await db
      .select()
      .from(schema.placeScores)
      .where(eq(schema.placeScores.placeId, placeId));
    const scoreAfterUpvote = afterUp.score;
    expect(afterUp.voteCount).toBe(1);

    // Change the vote: still one row, tally flips.
    const r2 = await votesRoute.POST(
      post("http://t/v", { value: -1 }),
      ctx(aliceSubmissionId),
    );
    expect(r2.status).toBe(200);
    const voteRows = await db
      .select()
      .from(schema.votes)
      .where(eq(schema.votes.submissionId, aliceSubmissionId));
    expect(voteRows).toHaveLength(1);
    expect(voteRows[0].value).toBe(-1);

    const [afterDown] = await db
      .select()
      .from(schema.placeScores)
      .where(eq(schema.placeScores.placeId, placeId));
    expect(afterDown.score).toBeLessThan(scoreAfterUpvote);

    // Validation + 404s.
    const r3 = await votesRoute.POST(
      post("http://t/v", { value: 2 }),
      ctx(aliceSubmissionId),
    );
    expect(r3.status).toBe(400);
    const r4 = await votesRoute.POST(
      post("http://t/v", { value: 1 }),
      ctx("00000000-0000-4000-8000-000000000000"),
    );
    expect(r4.status).toBe(404);
  });

  it("shows myVote and isMine in place detail", async () => {
    actAs(BOB);
    const res = await placeDetailRoute.GET(
      new Request("http://t/p"),
      ctx(placeId),
    );
    expect(res.status).toBe(200);
    const { place } = await res.json();
    expect(place.verification).toBe("confirmed");
    expect(place.status).toBe("fully_vegan");
    const sub = place.submissions.find(
      (s: { id: string }) => s.id === aliceSubmissionId,
    );
    expect(sub.myVote).toBe(-1);
    expect(sub.isMine).toBe(false);
    expect(sub.downvotes).toBe(1);
  });

  it("re-submitting with a new status replaces the old one and drops its votes", async () => {
    actAs(ALICE);
    const res = await submissionsRoute.POST(
      post("http://t/s", { status: "closed", note: "shut down" }),
      ctx(placeId),
    );
    expect(res.status).toBe(201);
    const { submission } = await res.json();
    // Same (place, user) slot — id unchanged, status replaced.
    expect(submission.id).toBe(aliceSubmissionId);
    expect(submission.status).toBe("closed");
    // Bob's old downvote was cast on a different claim — gone.
    expect(submission.upvotes).toBe(0);
    expect(submission.downvotes).toBe(0);

    const db = getDb();
    const subs = await db
      .select()
      .from(schema.veganSubmissions)
      .where(eq(schema.veganSubmissions.placeId, placeId));
    expect(subs).toHaveLength(1);

    // Weakly supported closure: winning status 'closed' but score < 0.5,
    // so the place must NOT be flagged closed.
    const [score] = await db
      .select()
      .from(schema.placeScores)
      .where(eq(schema.placeScores.placeId, placeId));
    expect(score.status).toBe("closed");
    expect(score.score).toBeLessThan(0.5);
    const [place] = await db
      .select()
      .from(schema.places)
      .where(eq(schema.places.id, placeId));
    expect(place.closed).toBe(false);
  });

  it("re-submitting with the same status keeps existing votes", async () => {
    actAs(BOB);
    await votesRoute.POST(post("http://t/v", { value: 1 }), ctx(aliceSubmissionId));
    actAs(ALICE);
    const res = await submissionsRoute.POST(
      post("http://t/s", { status: "closed", note: "still shut" }),
      ctx(placeId),
    );
    const { submission } = await res.json();
    expect(submission.upvotes).toBe(1); // same claim, vote kept
  });

  it("crowd-confirmed closure flips places.closed and drops the pin", async () => {
    // Bob already upvoted; carol + dave push the Wilson bound over 0.5.
    actAs(CAROL);
    await votesRoute.POST(post("http://t/v", { value: 1 }), ctx(aliceSubmissionId));
    actAs(DAVE);
    await votesRoute.POST(post("http://t/v", { value: 1 }), ctx(aliceSubmissionId));

    const db = getDb();
    const [score] = await db
      .select()
      .from(schema.placeScores)
      .where(eq(schema.placeScores.placeId, placeId));
    expect(score.status).toBe("closed");
    expect(score.score).toBeGreaterThanOrEqual(0.5);
    const [place] = await db
      .select()
      .from(schema.places)
      .where(eq(schema.places.id, placeId));
    expect(place.closed).toBe(true);

    // Closed places are excluded from the map feed…
    const listRes = await placesRoute.GET(
      new Request(`http://t/api/places?bbox=${TEST_BBOX}`),
    );
    const { places } = await listRes.json();
    expect(
      places.find((p: { id: string }) => p.id === placeId),
    ).toBeUndefined();

    // …but the detail page still loads and says closed.
    const detailRes = await placeDetailRoute.GET(
      new Request("http://t/p"),
      ctx(placeId),
    );
    const { place: detail } = await detailRes.json();
    expect(detail.closed).toBe(true);
    expect(detail.status).toBe("closed");
  });
});
