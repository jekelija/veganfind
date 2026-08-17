/**
 * Integration tests for the write flows: real Postgres (the embedded
 * instance from tests/global-setup.ts — never the app database), real
 * Drizzle + recompute, real rate limiter. Only "@/lib/auth/server" is
 * mocked so we can act as different signed-in users without Supabase.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const authState = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  admin: false,
}));

vi.mock("@/lib/auth/server", () => {
  // Mirror the real requireUser: make sure the profile row exists.
  const requireUser = async () => {
    if (!authState.user) {
      return {
        response: Response.json({ error: "unauthed" }, { status: 401 }),
      };
    }
    const { getDb, schema } = await import("@/lib/db");
    await getDb()
      .insert(schema.profiles)
      .values({ id: authState.user.id, email: authState.user.email })
      .onConflictDoNothing();
    return { user: authState.user, isAdmin: authState.admin };
  };
  return {
    isAuthConfigured: () => true,
    getSessionUser: async () => authState.user,
    requireUser,
    requireAdmin: async () => {
      const auth = await requireUser();
      if (auth.response) return auth;
      if (!authState.admin) {
        return {
          response: Response.json(
            { error: "Admin access required." },
            { status: 403 },
          ),
        };
      }
      return auth;
    },
  };
});

import { getDb, schema } from "@/lib/db";
import * as placesRoute from "@/app/api/places/route";
import * as placeDetailRoute from "@/app/api/places/[id]/route";
import * as submissionsRoute from "@/app/api/places/[id]/submissions/route";
import * as votesRoute from "@/app/api/submissions/[id]/votes/route";
import * as placeFlagsRoute from "@/app/api/places/[id]/flags/route";
import * as submissionFlagsRoute from "@/app/api/submissions/[id]/flags/route";
import * as adminFlagsRoute from "@/app/api/admin/flags/route";
import * as adminFlagResolveRoute from "@/app/api/admin/flags/[id]/route";

const ALICE = { id: "0a000000-0000-4000-8000-00000000000a", email: "alice@apitest.local" };
const BOB = { id: "0b000000-0000-4000-8000-00000000000b", email: "bob@apitest.local" };
const CAROL = { id: "0c000000-0000-4000-8000-00000000000c", email: "carol@apitest.local" };
const DAVE = { id: "0d000000-0000-4000-8000-00000000000d", email: "dave@apitest.local" };
// EVE is deliberately NOT pre-seeded: her profile is created on first write
// with created_at = now, so she exercises new-account vote dampening.
const EVE = { id: "0e000000-0000-4000-8000-00000000000e", email: "eve@apitest.local" };
const TEST_USER_IDS = [ALICE.id, BOB.id, CAROL.id, DAVE.id, EVE.id];
const ESTABLISHED_USERS = [ALICE, BOB, CAROL, DAVE];

function actAs(
  user: { id: string; email: string | null } | null,
  { admin = false } = {},
) {
  authState.user = user;
  authState.admin = admin;
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
  // The limiter counts writes in Postgres now — purge the fixture users'
  // windows so back-to-back local runs don't start seeing 429s.
  await db.delete(schema.rateLimitEvents).where(
    inArray(
      schema.rateLimitEvents.key,
      TEST_USER_IDS.map((id) => `user:${id}`),
    ),
  );
}

// Generous hook timeouts: cleanup is many round trips to a possibly-remote
// Postgres (Supabase pooler), and 10s is not always enough.
const HOOK_TIMEOUT_MS = 60_000;

beforeAll(async () => {
  await cleanup();
  // Vote-weight dampening (M3) halves votes from accounts younger than 7
  // days. The fixture users are meant to be ordinary trusted voters, so
  // pre-seed their profiles with an old created_at (the requireUser mock's
  // onConflictDoNothing keeps it).
  const db = getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db
    .insert(schema.profiles)
    .values(
      ESTABLISHED_USERS.map((u) => ({
        id: u.id,
        email: u.email,
        createdAt: thirtyDaysAgo,
      })),
    )
    .onConflictDoNothing();
}, HOOK_TIMEOUT_MS);
afterAll(async () => {
  await cleanup();
  const sql = (globalThis as { __veganfindSql?: { end(): Promise<void> } })
    .__veganfindSql;
  await sql?.end();
}, HOOK_TIMEOUT_MS);

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

  it("dampens submissions and votes from brand-new accounts", async () => {
    // Two identical solo submissions — one from a 30-day-old account, one
    // from an account created seconds ago. The new account's implicit
    // upvote is half weight, so its place scores strictly lower.
    actAs(ALICE);
    const r1 = await placesRoute.POST(
      post("http://t/api/places", { name: "API Test Cafe", lat: TEST_LAT, lng: TEST_LNG }),
    );
    const establishedPlaceId = (await r1.json()).place.id;
    await submissionsRoute.POST(
      post("http://t/s", { status: "fully_vegan" }),
      ctx(establishedPlaceId),
    );

    actAs(EVE);
    const r2 = await placesRoute.POST(
      post("http://t/api/places", { name: "API Test Cafe", lat: TEST_LAT, lng: TEST_LNG }),
    );
    const newAccountPlaceId = (await r2.json()).place.id;
    await submissionsRoute.POST(
      post("http://t/s", { status: "fully_vegan" }),
      ctx(newAccountPlaceId),
    );

    const db = getDb();
    const [established] = await db
      .select()
      .from(schema.placeScores)
      .where(eq(schema.placeScores.placeId, establishedPlaceId));
    const [fresh] = await db
      .select()
      .from(schema.placeScores)
      .where(eq(schema.placeScores.placeId, newAccountPlaceId));
    expect(fresh.score).toBeGreaterThan(0);
    expect(fresh.score).toBeLessThan(established.score);

    // A new account's vote also moves the score less than an old account's.
    // Identical bases (a submission by CAROL each); EVE (new) upvotes one,
    // DAVE (established) upvotes the other.
    const makeCarolPlace = async () => {
      actAs(CAROL);
      const pr = await placesRoute.POST(
        post("http://t/api/places", { name: "API Test Cafe", lat: TEST_LAT, lng: TEST_LNG }),
      );
      const pid = (await pr.json()).place.id;
      const sr = await submissionsRoute.POST(
        post("http://t/s", { status: "fully_vegan" }),
        ctx(pid),
      );
      return { placeId: pid, submissionId: (await sr.json()).submission.id };
    };
    const evesTarget = await makeCarolPlace();
    const davesTarget = await makeCarolPlace();

    actAs(EVE);
    await votesRoute.POST(post("http://t/v", { value: 1 }), ctx(evesTarget.submissionId));
    actAs(DAVE);
    await votesRoute.POST(post("http://t/v", { value: 1 }), ctx(davesTarget.submissionId));

    const [eveVoted] = await db
      .select()
      .from(schema.placeScores)
      .where(eq(schema.placeScores.placeId, evesTarget.placeId));
    const [daveVoted] = await db
      .select()
      .from(schema.placeScores)
      .where(eq(schema.placeScores.placeId, davesTarget.placeId));
    expect(eveVoted.score).toBeGreaterThan(established.score); // still helps
    expect(daveVoted.score).toBeGreaterThan(eveVoted.score); // but counts less
    expect(eveVoted.voteCount).toBe(1); // raw display count is undampened
    expect(daveVoted.voteCount).toBe(1);
  });

  it("flags a submission (idempotently) and a place", async () => {
    const { and } = await import("drizzle-orm");
    actAs(BOB);
    const r1 = await submissionFlagsRoute.POST(
      post("http://t/f", { reason: "incorrect", note: "it reopened" }),
      ctx(aliceSubmissionId),
    );
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ ok: true });

    // Second report from the same user on the same target is a no-op.
    const r2 = await submissionFlagsRoute.POST(
      post("http://t/f", { reason: "spam" }),
      ctx(aliceSubmissionId),
    );
    expect(r2.status).toBe(201);

    const db = getDb();
    const open = await db
      .select()
      .from(schema.flags)
      .where(
        and(
          eq(schema.flags.submissionId, aliceSubmissionId),
          eq(schema.flags.userId, BOB.id),
        ),
      );
    expect(open).toHaveLength(1);
    expect(open[0].reason).toBe("incorrect"); // the first report stuck
    expect(open[0].placeId).toBe(placeId); // denormalized for the queue
    expect(open[0].status).toBe("open");

    // A different user CAN flag the same submission.
    actAs(CAROL);
    const r3 = await submissionFlagsRoute.POST(
      post("http://t/f", { reason: "abuse" }),
      ctx(aliceSubmissionId),
    );
    expect(r3.status).toBe(201);

    // Whole-place flag goes through the places endpoint.
    actAs(BOB);
    const r4 = await placeFlagsRoute.POST(
      post("http://t/f", { reason: "other", note: "duplicate entry" }),
      ctx(placeId),
    );
    expect(r4.status).toBe(201);
    const placeFlags = await db
      .select()
      .from(schema.flags)
      .where(eq(schema.flags.placeId, placeId));
    expect(placeFlags).toHaveLength(3); // 2 submission flags + 1 place flag
  });

  it("validates flag bodies and auth", async () => {
    actAs(null);
    const r1 = await placeFlagsRoute.POST(
      post("http://t/f", { reason: "spam" }),
      ctx(placeId),
    );
    expect(r1.status).toBe(401);

    actAs(BOB);
    const bad = await placeFlagsRoute.POST(
      post("http://t/f", { reason: "not-a-reason" }),
      ctx(placeId),
    );
    expect(bad.status).toBe(400);
    const longNote = await placeFlagsRoute.POST(
      post("http://t/f", { reason: "spam", note: "n".repeat(501) }),
      ctx(placeId),
    );
    expect(longNote.status).toBe(400);
    const missingSub = await submissionFlagsRoute.POST(
      post("http://t/f", { reason: "spam" }),
      ctx("00000000-0000-4000-8000-000000000000"),
    );
    expect(missingSub.status).toBe(404);
    const badId = await submissionFlagsRoute.POST(
      post("http://t/f", { reason: "spam" }),
      ctx("nope"),
    );
    expect(badId.status).toBe(400);
  });

  it("admin routes reject non-admins", async () => {
    actAs(null);
    expect((await adminFlagsRoute.GET()).status).toBe(401);
    actAs(BOB); // signed in, not admin
    expect((await adminFlagsRoute.GET()).status).toBe(403);
    const res = await adminFlagResolveRoute.POST(
      post("http://t/a", { action: "dismiss" }),
      ctx("00000000-0000-4000-8000-000000000000"),
    );
    expect(res.status).toBe(403);
  });

  it("lists open flags with context, oldest first", async () => {
    actAs(DAVE, { admin: true });
    const res = await adminFlagsRoute.GET();
    expect(res.status).toBe(200);
    const { flags } = await res.json();
    const mine = flags.filter(
      (f: { place: { id: string } }) => f.place.id === placeId,
    );
    expect(mine).toHaveLength(3);
    // Global order is oldest-first; the filtered subset must be too.
    const times = mine.map((f: { createdAt: string }) => f.createdAt);
    expect([...times].sort()).toEqual(times);

    const subFlag = mine.find(
      (f: { reason: string }) => f.reason === "incorrect",
    );
    expect(subFlag.submission.id).toBe(aliceSubmissionId);
    expect(subFlag.submission.status).toBe("closed");
    expect(subFlag.submission.authorEmail).toBe(ALICE.email);
    expect(subFlag.reporterEmail).toBe(BOB.email);
    expect(subFlag.note).toBe("it reopened");
    expect(subFlag.place.name).toBe("API Test Cafe");
    expect(subFlag.place.source).toBe("user");

    const placeFlag = mine.find(
      (f: { submission: unknown }) => f.submission === null,
    );
    expect(placeFlag.reason).toBe("other");
  });

  it("dismiss closes a flag and records the reviewer", async () => {
    actAs(DAVE, { admin: true });
    const { flags } = await (await adminFlagsRoute.GET()).json();
    const abuse = flags.find(
      (f: { place: { id: string }; reason: string }) =>
        f.place.id === placeId && f.reason === "abuse",
    );
    const res = await adminFlagResolveRoute.POST(
      post("http://t/a", { action: "dismiss" }),
      ctx(abuse.id),
    );
    expect(res.status).toBe(200);

    // Already reviewed → 409; garbage action → 400.
    const again = await adminFlagResolveRoute.POST(
      post("http://t/a", { action: "dismiss" }),
      ctx(abuse.id),
    );
    expect(again.status).toBe(409);
    const bad = await adminFlagResolveRoute.POST(
      post("http://t/a", { action: "explode" }),
      ctx(abuse.id),
    );
    expect(bad.status).toBe(400);

    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.flags)
      .where(eq(schema.flags.id, abuse.id));
    expect(row.status).toBe("dismissed");
    expect(row.resolvedBy).toBe(DAVE.id);
    expect(row.resolvedAt).not.toBeNull();
  });

  it("remove_submission deletes it, resolves its flags, and recomputes", async () => {
    actAs(DAVE, { admin: true });
    const { flags } = await (await adminFlagsRoute.GET()).json();
    const f = flags.find(
      (x: { submission: { id: string } | null }) =>
        x.submission?.id === aliceSubmissionId,
    );
    const res = await adminFlagResolveRoute.POST(
      post("http://t/a", { action: "remove_submission" }),
      ctx(f.id),
    );
    expect(res.status).toBe(200);

    const db = getDb();
    const subs = await db
      .select()
      .from(schema.veganSubmissions)
      .where(eq(schema.veganSubmissions.id, aliceSubmissionId));
    expect(subs).toHaveLength(0);
    // It was the place's only submission: score row gone, closure reverted.
    const scores = await db
      .select()
      .from(schema.placeScores)
      .where(eq(schema.placeScores.placeId, placeId));
    expect(scores).toHaveLength(0);
    const [pl] = await db
      .select()
      .from(schema.places)
      .where(eq(schema.places.id, placeId));
    expect(pl.closed).toBe(false);
    // Audit trail survives the delete: resolved, submission_id nulled.
    const [audit] = await db
      .select()
      .from(schema.flags)
      .where(eq(schema.flags.id, f.id));
    expect(audit.status).toBe("resolved");
    expect(audit.submissionId).toBeNull();
    expect(audit.resolvedBy).toBe(DAVE.id);
  });

  it("ban_author bans the submitter and removes the submission", async () => {
    actAs(EVE);
    const pr = await placesRoute.POST(
      post("http://t/api/places", { name: "API Test Cafe", lat: TEST_LAT, lng: TEST_LNG }),
    );
    const pid = (await pr.json()).place.id;
    const sr = await submissionsRoute.POST(
      post("http://t/s", { status: "fully_vegan", note: "spammy" }),
      ctx(pid),
    );
    const sid = (await sr.json()).submission.id;

    actAs(DAVE);
    await submissionFlagsRoute.POST(post("http://t/f", { reason: "spam" }), ctx(sid));

    actAs(DAVE, { admin: true });
    const { flags } = await (await adminFlagsRoute.GET()).json();
    const f = flags.find(
      (x: { submission: { id: string } | null }) => x.submission?.id === sid,
    );
    expect(f.submission.authorEmail).toBe(EVE.email);
    const res = await adminFlagResolveRoute.POST(
      post("http://t/a", { action: "ban_author" }),
      ctx(f.id),
    );
    expect(res.status).toBe(200);

    const db = getDb();
    const [eve] = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, EVE.id));
    expect(eve.banned).toBe(true);
    const subs = await db
      .select()
      .from(schema.veganSubmissions)
      .where(eq(schema.veganSubmissions.id, sid));
    expect(subs).toHaveLength(0);
  });

  it("remove_place deletes a user-added place (and only fits place flags)", async () => {
    actAs(DAVE, { admin: true });
    const { flags } = await (await adminFlagsRoute.GET()).json();
    const placeFlag = flags.find(
      (x: { place: { id: string }; submission: unknown }) =>
        x.place.id === placeId && x.submission === null,
    );
    // Submission-only actions don't apply to a place flag.
    const wrong = await adminFlagResolveRoute.POST(
      post("http://t/a", { action: "remove_submission" }),
      ctx(placeFlag.id),
    );
    expect(wrong.status).toBe(409);

    const res = await adminFlagResolveRoute.POST(
      post("http://t/a", { action: "remove_place" }),
      ctx(placeFlag.id),
    );
    expect(res.status).toBe(200);

    const db = getDb();
    expect(
      await db.select().from(schema.places).where(eq(schema.places.id, placeId)),
    ).toHaveLength(0);
    // Unknown flag id with a valid action → 404.
    const missing = await adminFlagResolveRoute.POST(
      post("http://t/a", { action: "dismiss" }),
      ctx("00000000-0000-4000-8000-000000000000"),
    );
    expect(missing.status).toBe(404);
  });
});
