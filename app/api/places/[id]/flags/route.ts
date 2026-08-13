import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { isUuid, jsonError, readJson } from "../../../_lib/util";
import { parseFlagBody } from "../../../_lib/flags";

const { places, flags } = schema;

/** Flag a whole place for admin review (M3). */
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

  const parsed = parseFlagBody(await readJson(request));
  if ("response" in parsed) return parsed.response;

  const db = getDb();
  const [place] = await db
    .select({ id: places.id })
    .from(places)
    .where(eq(places.id, placeId))
    .limit(1);
  if (!place) return jsonError(404, "Place not found.");

  // Idempotent: one open flag per (place, user) — a second report is a no-op,
  // enforced by the partial unique index, absorbed by onConflictDoNothing.
  await db
    .insert(flags)
    .values({
      placeId,
      submissionId: null,
      userId: auth.user.id,
      reason: parsed.reason,
      note: parsed.note,
    })
    .onConflictDoNothing();

  return Response.json({ ok: true }, { status: 201 });
}
