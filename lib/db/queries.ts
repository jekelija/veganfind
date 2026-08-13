import { eq, inArray } from "drizzle-orm";
import { placeScores, places, profiles, veganSubmissions, votes } from "./schema";
import {
  computePlaceScore,
  voteWeight,
  type SubmissionTally,
} from "../scoring";
import type { getDb } from "./index";

type Db = ReturnType<typeof getDb>;
/** A Drizzle db or transaction — recompute runs inside the write's tx. */
export type DbLike = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Recompute a place's crowd score from its submissions + votes and upsert
 * place_scores (deleting the row when there are no submissions). Called in
 * the SAME transaction as every submission/vote write (PLAN.md §2 — no job
 * queue).
 *
 * CLOSURE RULE: places.closed = (winning status is 'closed' AND score ≥ 0.5),
 * so crowd-confirmed closures drop off the map while contested ones don't.
 */
export async function recomputePlaceScore(
  tx: DbLike,
  placeId: string,
): Promise<void> {
  // Trust weighting (M3) needs each voter's profile, so tallies are built in
  // TS from two keyed reads instead of one aggregate — a place has a handful
  // of votes, and the weighting logic stays in lib/scoring.ts.
  const now = new Date();

  const subs = await tx
    .select({
      id: veganSubmissions.id,
      status: veganSubmissions.status,
      trustScore: profiles.trustScore,
      accountCreatedAt: profiles.createdAt,
    })
    .from(veganSubmissions)
    .innerJoin(profiles, eq(profiles.id, veganSubmissions.userId))
    .where(eq(veganSubmissions.placeId, placeId));

  const voteRows =
    subs.length === 0
      ? []
      : await tx
          .select({
            submissionId: votes.submissionId,
            value: votes.value,
            trustScore: profiles.trustScore,
            accountCreatedAt: profiles.createdAt,
          })
          .from(votes)
          .innerJoin(profiles, eq(profiles.id, votes.userId))
          .where(
            inArray(
              votes.submissionId,
              subs.map((s) => s.id),
            ),
          );

  const tallyBySubmission = new Map<string, SubmissionTally>(
    subs.map((s) => [
      s.id,
      {
        status: s.status,
        upvoteWeight: 0,
        downvoteWeight: 0,
        submitterWeight: voteWeight(s.trustScore, s.accountCreatedAt, now),
        voteCount: 0,
      },
    ]),
  );
  for (const v of voteRows) {
    const tally = tallyBySubmission.get(v.submissionId);
    if (!tally) continue;
    const weight = voteWeight(v.trustScore, v.accountCreatedAt, now);
    if (v.value === 1) tally.upvoteWeight += weight;
    else tally.downvoteWeight += weight;
    tally.voteCount += 1;
  }

  const result = computePlaceScore([...tallyBySubmission.values()]);

  if (result === null) {
    await tx.delete(placeScores).where(eq(placeScores.placeId, placeId));
  } else {
    await tx
      .insert(placeScores)
      .values({
        placeId,
        status: result.status,
        score: result.score,
        submissionCount: result.submissionCount,
        voteCount: result.voteCount,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: placeScores.placeId,
        set: {
          status: result.status,
          score: result.score,
          submissionCount: result.submissionCount,
          voteCount: result.voteCount,
          updatedAt: new Date(),
        },
      });
  }

  const closed =
    result !== null && result.status === "closed" && result.score >= 0.5;
  await tx
    .update(places)
    .set({ closed, updatedAt: new Date() })
    .where(eq(places.id, placeId));
}
