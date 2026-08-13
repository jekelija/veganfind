import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { VEGAN_STATUSES } from "@/lib/db/schema";
import { recomputePlaceScore } from "@/lib/db/queries";
import { requireUser } from "@/lib/auth/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import type { CreateSubmissionBody, SubmissionView, VeganStatus } from "@/lib/types";
import { isUuid, jsonError, readJson } from "../../../_lib/util";

const { places, veganSubmissions, votes } = schema;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const limited = await rateLimitResponse(auth.user.id, request);
  if (limited) return limited;

  const { id: placeId } = await params;
  if (!isUuid(placeId)) {
    return jsonError(400, "Invalid place id (expected a UUID).");
  }

  const raw = await readJson(request);
  if (raw === null || typeof raw !== "object") {
    return jsonError(400, "Invalid JSON body.");
  }
  const body = raw as Partial<CreateSubmissionBody>;

  if (
    typeof body.status !== "string" ||
    !(VEGAN_STATUSES as readonly string[]).includes(body.status)
  ) {
    return jsonError(
      400,
      `status must be one of: ${VEGAN_STATUSES.join(", ")}.`,
    );
  }
  const status = body.status as VeganStatus;

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string" || body.note.length > 1000) {
      return jsonError(400, "note must be a string of at most 1000 characters.");
    }
    note = body.note.trim() || null;
  }

  const db = getDb();
  const [place] = await db
    .select({ id: places.id })
    .from(places)
    .where(eq(places.id, placeId))
    .limit(1);
  if (!place) return jsonError(404, "Place not found.");

  const userId = auth.user.id;

  const submission = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: veganSubmissions.id, status: veganSubmissions.status })
      .from(veganSubmissions)
      .where(
        and(
          eq(veganSubmissions.placeId, placeId),
          eq(veganSubmissions.userId, userId),
        ),
      )
      .limit(1);

    let submissionId: string;
    if (existing) {
      // A user's new submission replaces their old one. If the claimed
      // status changed, existing votes were cast on a different claim —
      // drop them.
      if (existing.status !== status) {
        await tx.delete(votes).where(eq(votes.submissionId, existing.id));
      }
      const [updated] = await tx
        .update(veganSubmissions)
        .set({ status, note, createdAt: new Date() })
        .where(eq(veganSubmissions.id, existing.id))
        .returning({ id: veganSubmissions.id });
      submissionId = updated.id;
    } else {
      const [inserted] = await tx
        .insert(veganSubmissions)
        .values({ placeId, userId, status, note })
        .returning({ id: veganSubmissions.id });
      submissionId = inserted.id;
    }

    await recomputePlaceScore(tx, placeId);

    const [view] = await tx
      .select({
        id: veganSubmissions.id,
        status: veganSubmissions.status,
        note: veganSubmissions.note,
        createdAt: veganSubmissions.createdAt,
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
      .where(eq(veganSubmissions.id, submissionId))
      .groupBy(veganSubmissions.id);
    return view;
  });

  const view: SubmissionView = {
    id: submission.id,
    status: submission.status,
    note: submission.note,
    createdAt: submission.createdAt.toISOString(),
    upvotes: submission.upvotes,
    downvotes: submission.downvotes,
    myVote: null, // callers cannot vote on their own submission
    isMine: true,
  };
  return Response.json({ submission: view }, { status: 201 });
}
