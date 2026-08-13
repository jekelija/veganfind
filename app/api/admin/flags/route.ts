import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/server";
import type { AdminFlagView, AdminFlagsResponse } from "@/lib/types";

const { flags, places, veganSubmissions, profiles } = schema;

/** Admin review queue (M3): open flags with context, oldest first. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const reporter = alias(profiles, "reporter");
  const author = alias(profiles, "author");

  const db = getDb();
  const rows = await db
    .select({
      id: flags.id,
      reason: flags.reason,
      note: flags.note,
      createdAt: flags.createdAt,
      reporterEmail: reporter.email,
      placeId: places.id,
      placeName: places.name,
      placeSource: places.source,
      placeClosed: places.closed,
      submissionId: veganSubmissions.id,
      submissionStatus: veganSubmissions.status,
      submissionNote: veganSubmissions.note,
      authorEmail: author.email,
      authorBanned: author.banned,
    })
    .from(flags)
    .innerJoin(places, eq(places.id, flags.placeId))
    .innerJoin(reporter, eq(reporter.id, flags.userId))
    .leftJoin(veganSubmissions, eq(veganSubmissions.id, flags.submissionId))
    .leftJoin(author, eq(author.id, veganSubmissions.userId))
    .where(eq(flags.status, "open"))
    .orderBy(asc(flags.createdAt));

  const views: AdminFlagView[] = rows.map((r) => ({
    id: r.id,
    reason: r.reason,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    reporterEmail: r.reporterEmail,
    place: {
      id: r.placeId,
      name: r.placeName,
      source: r.placeSource,
      closed: r.placeClosed,
    },
    submission:
      r.submissionId !== null && r.submissionStatus !== null
        ? {
            id: r.submissionId,
            status: r.submissionStatus,
            note: r.submissionNote,
            authorEmail: r.authorEmail,
            authorBanned: r.authorBanned ?? false,
          }
        : null,
  }));

  const body: AdminFlagsResponse = { flags: views };
  return Response.json(body);
}
