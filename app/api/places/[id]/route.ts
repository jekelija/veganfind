import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { statusFromOsmTags } from "@/lib/scoring";
import { getSessionUser } from "@/lib/auth/server";
import {
  OSM_ATTRIBUTION,
  type PlaceDetail,
  type PlaceDetailResponse,
  type SubmissionView,
  type VeganStatus,
  type Verification,
} from "@/lib/types";
import { isUuid, jsonError } from "../../_lib/util";

const { places, placeScores, veganSubmissions, votes } = schema;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) return jsonError(400, "Invalid place id (expected a UUID).");

  const db = getDb();
  const [row] = await db
    .select({
      id: places.id,
      name: places.name,
      address: places.address,
      cuisine: places.cuisine,
      lat: places.lat,
      lng: places.lng,
      source: places.source,
      closed: places.closed,
      osmId: places.osmId,
      osmDietVegan: places.osmDietVegan,
      osmDietVegetarian: places.osmDietVegetarian,
      scoreStatus: placeScores.status,
      score: placeScores.score,
    })
    .from(places)
    .leftJoin(placeScores, eq(placeScores.placeId, places.id))
    .where(eq(places.id, id))
    .limit(1);

  if (!row) return jsonError(404, "Place not found.");

  const user = await getSessionUser();

  const subRows = await db
    .select({
      id: veganSubmissions.id,
      status: veganSubmissions.status,
      note: veganSubmissions.note,
      createdAt: veganSubmissions.createdAt,
      userId: veganSubmissions.userId,
      upvotes:
        sql<number>`count(*) filter (where ${votes.value} = 1)`.mapWith(Number),
      downvotes:
        sql<number>`count(*) filter (where ${votes.value} = -1)`.mapWith(
          Number,
        ),
    })
    .from(veganSubmissions)
    .leftJoin(votes, eq(votes.submissionId, veganSubmissions.id))
    .where(eq(veganSubmissions.placeId, id))
    .groupBy(veganSubmissions.id);

  const myVotes = new Map<string, -1 | 1>();
  if (user && subRows.length > 0) {
    const voteRows = await db
      .select({ submissionId: votes.submissionId, value: votes.value })
      .from(votes)
      .where(
        and(
          eq(votes.userId, user.id),
          inArray(
            votes.submissionId,
            subRows.map((s) => s.id),
          ),
        ),
      );
    for (const v of voteRows) {
      myVotes.set(v.submissionId, v.value === 1 ? 1 : -1);
    }
  }

  const submissions: SubmissionView[] = subRows
    .map((s) => ({
      id: s.id,
      status: s.status,
      note: s.note,
      createdAt: s.createdAt.toISOString(),
      upvotes: s.upvotes,
      downvotes: s.downvotes,
      myVote: myVotes.get(s.id) ?? null,
      isMine: user !== null && s.userId === user.id,
    }))
    .sort((a, b) => {
      const netA = a.upvotes - a.downvotes;
      const netB = b.upvotes - b.downvotes;
      if (netA !== netB) return netB - netA;
      return b.createdAt.localeCompare(a.createdAt);
    });

  let status: VeganStatus | null;
  let verification: Verification;
  let score: number;
  if (row.scoreStatus !== null && row.score !== null) {
    status = row.scoreStatus;
    verification = "confirmed";
    score = row.score;
  } else {
    const osmStatus = statusFromOsmTags(row.osmDietVegan, row.osmDietVegetarian);
    status = osmStatus;
    verification = osmStatus ? "unverified" : "none";
    score = 0;
  }

  const place: PlaceDetail = {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    source: row.source,
    status,
    verification,
    score,
    address: row.address,
    cuisine: row.cuisine,
    closed: row.closed,
    osmId: row.osmId,
    osmDietVegan: row.osmDietVegan,
    osmDietVegetarian: row.osmDietVegetarian,
    submissions,
  };

  const body: PlaceDetailResponse = { place, attribution: OSM_ATTRIBUTION };
  return Response.json(body);
}
