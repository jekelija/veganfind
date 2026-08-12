import { eq, sql } from "drizzle-orm";
import { placeScores, places, veganSubmissions, votes } from "./schema";
import { computePlaceScore, type SubmissionTally } from "../scoring";
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
  const tallies: SubmissionTally[] = await tx
    .select({
      status: veganSubmissions.status,
      upvotes:
        sql<number>`count(*) filter (where ${votes.value} = 1)`.mapWith(
          Number,
        ),
      downvotes:
        sql<number>`count(*) filter (where ${votes.value} = -1)`.mapWith(
          Number,
        ),
    })
    .from(veganSubmissions)
    .leftJoin(votes, eq(votes.submissionId, veganSubmissions.id))
    .where(eq(veganSubmissions.placeId, placeId))
    .groupBy(veganSubmissions.id);

  const result = computePlaceScore(tallies);

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
