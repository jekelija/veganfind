import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { isUuid, jsonError, readJson } from "../../../_lib/util";
import { parseFlagBody } from "../../../_lib/flags";

const { veganSubmissions, flags } = schema;

/** Flag one submission for admin review (M3). */
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

  const parsed = parseFlagBody(await readJson(request));
  if ("response" in parsed) return parsed.response;

  const db = getDb();
  const [submission] = await db
    .select({ placeId: veganSubmissions.placeId })
    .from(veganSubmissions)
    .where(eq(veganSubmissions.id, submissionId))
    .limit(1);
  if (!submission) return jsonError(404, "Submission not found.");

  // Idempotent: one open flag per (submission, user) — a second report is a
  // no-op, enforced by the partial unique index, absorbed by
  // onConflictDoNothing.
  await db
    .insert(flags)
    .values({
      placeId: submission.placeId,
      submissionId,
      userId: auth.user.id,
      reason: parsed.reason,
      note: parsed.note,
    })
    .onConflictDoNothing();

  return Response.json({ ok: true }, { status: 201 });
}
