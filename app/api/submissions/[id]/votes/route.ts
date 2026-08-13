import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { recomputePlaceScore } from "@/lib/db/queries";
import { requireUser } from "@/lib/auth/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import type { CreateVoteBody } from "@/lib/types";
import { isUuid, jsonError, readJson } from "../../../_lib/util";

const { veganSubmissions, votes } = schema;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const limited = await rateLimitResponse(auth.user.id, request);
  if (limited) return limited;

  const { id: submissionId } = await params;
  if (!isUuid(submissionId)) {
    return jsonError(400, "Invalid submission id (expected a UUID).");
  }

  const raw = await readJson(request);
  if (raw === null || typeof raw !== "object") {
    return jsonError(400, "Invalid JSON body.");
  }
  const body = raw as Partial<CreateVoteBody>;
  if (body.value !== 1 && body.value !== -1) {
    return jsonError(400, "value must be 1 or -1.");
  }
  const value = body.value;

  const db = getDb();
  const [submission] = await db
    .select({
      id: veganSubmissions.id,
      placeId: veganSubmissions.placeId,
      userId: veganSubmissions.userId,
    })
    .from(veganSubmissions)
    .where(eq(veganSubmissions.id, submissionId))
    .limit(1);
  if (!submission) return jsonError(404, "Submission not found.");
  if (submission.userId === auth.user.id) {
    return jsonError(409, "You cannot vote on your own submission.");
  }

  await db.transaction(async (tx) => {
    // Upsert so a user can change their vote.
    await tx
      .insert(votes)
      .values({ submissionId, userId: auth.user.id, value })
      .onConflictDoUpdate({
        target: [votes.submissionId, votes.userId],
        set: { value, createdAt: new Date() },
      });
    await recomputePlaceScore(tx, submission.placeId);
  });

  return Response.json({ ok: true });
}
