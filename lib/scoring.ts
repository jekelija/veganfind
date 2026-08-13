import type { VeganStatus } from "./db/schema";

/**
 * Scoring (PLAN.md §2): pure functions, recomputed synchronously in the same
 * transaction as every submission/vote write. No job queue.
 *
 * Model: each submission asserts a status for a place. A submission's weight
 * is the Wilson lower bound of its approval (submitter counts as one implicit
 * upvote). The place's winning status is the one with the highest summed
 * weight; the place score is that status's share-weighted confidence.
 *
 * TRUST WEIGHTING (M3): every vote — including the submitter's implicit
 * upvote — is weighted by {@link voteWeight}: the voter's trust score,
 * dampened for brand-new accounts. Wilson works fine on fractional counts.
 */

const Z = 1.96; // 95% confidence

/** Accounts younger than this get their votes dampened… */
export const NEW_ACCOUNT_WINDOW_DAYS = 7;
/** …to this fraction of their normal weight. */
export const NEW_ACCOUNT_DAMPING = 0.5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Weight of one vote: the voter's trust score (floored at 0), halved while
 * the account is younger than {@link NEW_ACCOUNT_WINDOW_DAYS}. Makes
 * fresh-account vote brigades half as loud without silencing anyone.
 */
export function voteWeight(
  trustScore: number,
  accountCreatedAt: Date,
  now: Date = new Date(),
): number {
  const ageMs = now.getTime() - accountCreatedAt.getTime();
  const isNew = ageMs < NEW_ACCOUNT_WINDOW_DAYS * DAY_MS;
  return Math.max(0, trustScore) * (isNew ? NEW_ACCOUNT_DAMPING : 1);
}

/** Wilson score interval lower bound for a Bernoulli proportion. */
export function wilsonLowerBound(positive: number, total: number): number {
  if (total <= 0) return 0;
  const phat = positive / total;
  const z2 = Z * Z;
  const denom = 1 + z2 / total;
  const center = phat + z2 / (2 * total);
  const margin = Z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  return Math.max(0, (center - margin) / denom);
}

export interface SubmissionTally {
  status: VeganStatus;
  /** Trust-weighted sum of explicit upvotes, NOT counting the submitter. */
  upvoteWeight: number;
  /** Trust-weighted sum of explicit downvotes. */
  downvoteWeight: number;
  /** The submitter's own vote weight — their implicit upvote. */
  submitterWeight: number;
  /** Raw number of explicit votes (for display counts, not scoring). */
  voteCount: number;
}

export interface PlaceScoreResult {
  status: VeganStatus;
  score: number; // 0..1
  submissionCount: number;
  voteCount: number;
}

/**
 * Compute the winning status + confidence for a place from its submissions.
 * Returns null when there are no submissions (place falls back to the OSM
 * seed signal, rendered as "unverified").
 */
export function computePlaceScore(
  submissions: SubmissionTally[],
): PlaceScoreResult | null {
  if (submissions.length === 0) return null;

  const weightByStatus = new Map<VeganStatus, number>();
  let voteCount = 0;

  for (const s of submissions) {
    // Submitter counts as one implicit (trust-weighted) upvote on their own
    // submission.
    const positive = s.upvoteWeight + s.submitterWeight;
    const total = positive + s.downvoteWeight;
    const weight = wilsonLowerBound(positive, total);
    weightByStatus.set(s.status, (weightByStatus.get(s.status) ?? 0) + weight);
    voteCount += s.voteCount;
  }

  let winner: VeganStatus | null = null;
  let winnerWeight = -1;
  let totalWeight = 0;
  for (const [status, weight] of weightByStatus) {
    totalWeight += weight;
    if (weight > winnerWeight) {
      winner = status;
      winnerWeight = weight;
    }
  }

  if (winner === null || totalWeight <= 0) return null;

  // Confidence = the winner's share of total weight, scaled by how solid the
  // winner's own evidence is (its summed Wilson bound, capped at 1).
  const share = winnerWeight / totalWeight;
  const solidity = Math.min(1, winnerWeight);
  return {
    status: winner,
    score: share * solidity,
    submissionCount: submissions.length,
    voteCount,
  };
}

/** Map OSM diet:* seed tags to a display status ("unverified"). */
export function statusFromOsmTags(
  dietVegan: string | null,
  dietVegetarian: string | null,
): VeganStatus | null {
  if (dietVegan === "only") return "fully_vegan";
  if (dietVegan === "yes") return "vegan_friendly";
  if (dietVegan === "no") return "not_vegan";
  if (dietVegetarian === "only" || dietVegetarian === "yes")
    return "vegan_friendly";
  return null;
}
