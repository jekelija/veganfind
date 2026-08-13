import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { recomputePlaceScore } from "@/lib/db/queries";
import { requireAdmin } from "@/lib/auth/server";
import type { FlagAction, ResolveFlagBody } from "@/lib/types";
import { isUuid, jsonError, readJson } from "../../../_lib/util";

const { flags, places, veganSubmissions, profiles, placeScores } = schema;

const FLAG_ACTIONS: FlagAction[] = [
  "dismiss",
  "remove_submission",
  "ban_author",
  "remove_place",
];

/** Resolve one open flag with a moderation action (M3). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id: flagId } = await params;
  if (!isUuid(flagId)) {
    return jsonError(400, "Invalid flag id (expected a UUID).");
  }

  const raw = await readJson(request);
  if (raw === null || typeof raw !== "object") {
    return jsonError(400, "Invalid JSON body.");
  }
  const body = raw as Partial<ResolveFlagBody>;
  if (
    typeof body.action !== "string" ||
    !(FLAG_ACTIONS as readonly string[]).includes(body.action)
  ) {
    return jsonError(400, `action must be one of: ${FLAG_ACTIONS.join(", ")}.`);
  }
  const action = body.action as FlagAction;

  const db = getDb();
  const [flag] = await db
    .select({
      id: flags.id,
      placeId: flags.placeId,
      submissionId: flags.submissionId,
      status: flags.status,
    })
    .from(flags)
    .where(eq(flags.id, flagId))
    .limit(1);
  if (!flag) return jsonError(404, "Flag not found.");
  if (flag.status !== "open") {
    return jsonError(409, "This flag has already been reviewed.");
  }

  const resolvedFields = {
    resolvedAt: new Date(),
    resolvedBy: auth.user.id,
  };

  if (action === "dismiss") {
    await db
      .update(flags)
      .set({ status: "dismissed", ...resolvedFields })
      .where(eq(flags.id, flagId));
    return Response.json({ ok: true });
  }

  if (action === "remove_submission" || action === "ban_author") {
    const submissionId = flag.submissionId;
    if (!submissionId) {
      return jsonError(
        409,
        "This flag targets a whole place, not a submission.",
      );
    }
    await db.transaction(async (tx) => {
      if (action === "ban_author") {
        const [sub] = await tx
          .select({ userId: veganSubmissions.userId })
          .from(veganSubmissions)
          .where(eq(veganSubmissions.id, submissionId))
          .limit(1);
        if (sub) {
          await tx
            .update(profiles)
            .set({ banned: true })
            .where(eq(profiles.id, sub.userId));
        }
      }
      // Resolve every open flag on this submission BEFORE deleting it: the
      // delete sets their submission_id to null, and only resolved rows are
      // exempt from the one-open-place-flag-per-user unique index.
      await tx
        .update(flags)
        .set({ status: "resolved", ...resolvedFields })
        .where(
          and(eq(flags.submissionId, submissionId), eq(flags.status, "open")),
        );
      await tx
        .delete(veganSubmissions)
        .where(eq(veganSubmissions.id, submissionId)); // votes cascade
      await recomputePlaceScore(tx, flag.placeId);
    });
    return Response.json({ ok: true });
  }

  // action === "remove_place"
  if (flag.submissionId) {
    return jsonError(409, "This flag targets a submission, not a place.");
  }
  const [place] = await db
    .select({ source: places.source })
    .from(places)
    .where(eq(places.id, flag.placeId))
    .limit(1);
  if (!place) return jsonError(404, "Place not found.");
  if (place.source !== "user") {
    return jsonError(
      409,
      "Only user-added places can be removed; OSM-seeded places cannot.",
    );
  }
  await db.transaction(async (tx) => {
    // The place and everything under it goes away, flag history included.
    // Flags first (explicitly, not via cascades) so the submission deletes
    // can't trip the open-flag unique indexes with set-null rewrites.
    await tx.delete(flags).where(eq(flags.placeId, flag.placeId));
    await tx
      .delete(veganSubmissions)
      .where(eq(veganSubmissions.placeId, flag.placeId)); // votes cascade
    await tx.delete(placeScores).where(eq(placeScores.placeId, flag.placeId));
    await tx.delete(places).where(eq(places.id, flag.placeId));
  });
  return Response.json({ ok: true });
}
