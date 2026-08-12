import { describe, expect, it } from "vitest";
import {
  computePlaceScore,
  statusFromOsmTags,
  wilsonLowerBound,
  type SubmissionTally,
} from "@/lib/scoring";

describe("wilsonLowerBound", () => {
  it("returns 0 for 0 votes", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("gives a higher bound for more votes at the same ratio", () => {
    const small = wilsonLowerBound(4, 5); // 80% of 5
    const large = wilsonLowerBound(80, 100); // 80% of 100
    expect(large).toBeGreaterThan(small);

    const one = wilsonLowerBound(1, 1);
    const many = wilsonLowerBound(50, 50);
    expect(many).toBeGreaterThan(one);
  });

  it("is bounded within 0..1", () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [0, 10],
      [10, 10],
      [1, 2],
      [1000, 1000],
      [1, 1000],
    ];
    for (const [pos, total] of cases) {
      const v = wilsonLowerBound(pos, total);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Even unanimous approval never reaches certainty.
    expect(wilsonLowerBound(1000, 1000)).toBeLessThan(1);
  });
});

describe("computePlaceScore", () => {
  const tally = (
    status: SubmissionTally["status"],
    upvotes = 0,
    downvotes = 0,
  ): SubmissionTally => ({ status, upvotes, downvotes });

  it("returns null for no submissions", () => {
    expect(computePlaceScore([])).toBeNull();
  });

  it("lets a single uncontested submission win with a modest score", () => {
    const result = computePlaceScore([tally("fully_vegan")]);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("fully_vegan");
    expect(result!.score).toBeGreaterThan(0);
    expect(result!.score).toBeLessThan(0.5); // one voice is not confirmation
    expect(result!.submissionCount).toBe(1);
    expect(result!.voteCount).toBe(0);
  });

  it("lets a heavily upvoted status beat one contrarian", () => {
    const result = computePlaceScore([
      tally("fully_vegan", 10, 0),
      tally("not_vegan", 0, 0),
    ]);
    expect(result!.status).toBe("fully_vegan");
    expect(result!.submissionCount).toBe(2);
    expect(result!.voteCount).toBe(10);
    expect(result!.score).toBeGreaterThan(0.5);
  });

  it("does not let a downvoted-to-oblivion submission flip the winner", () => {
    const result = computePlaceScore([
      tally("vegan_friendly", 3, 0),
      tally("not_vegan", 0, 12),
    ]);
    expect(result!.status).toBe("vegan_friendly");
  });

  it("'closed' can win", () => {
    const result = computePlaceScore([
      tally("closed", 5, 0),
      tally("fully_vegan", 0, 2),
    ]);
    expect(result!.status).toBe("closed");
    // Enough support that the closure rule (score >= 0.5) would apply.
    expect(result!.score).toBeGreaterThanOrEqual(0.5);
  });
});

describe("statusFromOsmTags", () => {
  it("maps diet:vegan values", () => {
    expect(statusFromOsmTags("only", null)).toBe("fully_vegan");
    expect(statusFromOsmTags("yes", null)).toBe("vegan_friendly");
    expect(statusFromOsmTags("no", null)).toBe("not_vegan");
  });

  it("falls back to diet:vegetarian", () => {
    expect(statusFromOsmTags(null, "only")).toBe("vegan_friendly");
    expect(statusFromOsmTags(null, "yes")).toBe("vegan_friendly");
  });

  it("diet:vegan wins over diet:vegetarian", () => {
    expect(statusFromOsmTags("no", "yes")).toBe("not_vegan");
    expect(statusFromOsmTags("only", "yes")).toBe("fully_vegan");
  });

  it("returns null when there is no signal", () => {
    expect(statusFromOsmTags(null, null)).toBeNull();
    expect(statusFromOsmTags("unknown", "no")).toBeNull();
  });
});
