import { and, between, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { statusFromOsmTags } from "@/lib/scoring";
import { requireUser } from "@/lib/auth/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import {
  OSM_ATTRIBUTION,
  type CreatePlaceBody,
  type PlaceSummary,
  type PlacesResponse,
  type VeganStatus,
  type Verification,
} from "@/lib/types";
import { jsonError, readJson } from "../_lib/util";

const { places, placeScores } = schema;

const FILTERABLE_STATUSES = ["fully_vegan", "vegan_friendly"] as const;
const MAX_ROWS = 500;

/**
 * The EFFECTIVE status in SQL, mirroring lib/scoring.statusFromOsmTags:
 * crowd score wins, else the OSM diet:* seed signal, else NULL. Used only
 * for filtering so the 500-row cap applies to matching places.
 */
const effectiveStatusSql = sql<string | null>`coalesce(
  ${placeScores.status},
  case
    when ${places.osmDietVegan} = 'only' then 'fully_vegan'
    when ${places.osmDietVegan} = 'yes' then 'vegan_friendly'
    when ${places.osmDietVegan} = 'no' then 'not_vegan'
    when ${places.osmDietVegetarian} in ('only', 'yes') then 'vegan_friendly'
  end
)`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const bboxParam = searchParams.get("bbox");
  if (!bboxParam) {
    return jsonError(400, "Missing bbox parameter (minLng,minLat,maxLng,maxLat).");
  }
  const parts = bboxParam.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return jsonError(400, "Malformed bbox: expected minLng,minLat,maxLng,maxLat.");
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (
    minLng > maxLng ||
    minLat > maxLat ||
    Math.abs(minLat) > 90 ||
    Math.abs(maxLat) > 90 ||
    Math.abs(minLng) > 180 ||
    Math.abs(maxLng) > 180
  ) {
    return jsonError(400, "Malformed bbox: out of range or min > max.");
  }

  const filterParam = searchParams.get("filter");
  let filter: (typeof FILTERABLE_STATUSES)[number] | null = null;
  if (filterParam !== null) {
    if (!(FILTERABLE_STATUSES as readonly string[]).includes(filterParam)) {
      return jsonError(400, "Invalid filter: expected fully_vegan or vegan_friendly.");
    }
    filter = filterParam as (typeof FILTERABLE_STATUSES)[number];
  }

  const db = getDb();
  const conditions = [
    eq(places.closed, false),
    between(places.lat, minLat, maxLat),
    between(places.lng, minLng, maxLng),
  ];
  if (filter) conditions.push(eq(effectiveStatusSql, filter));

  const rows = await db
    .select({
      id: places.id,
      name: places.name,
      lat: places.lat,
      lng: places.lng,
      source: places.source,
      osmDietVegan: places.osmDietVegan,
      osmDietVegetarian: places.osmDietVegetarian,
      scoreStatus: placeScores.status,
      score: placeScores.score,
    })
    .from(places)
    .leftJoin(placeScores, eq(placeScores.placeId, places.id))
    .where(and(...conditions))
    .limit(MAX_ROWS);

  const summaries: PlaceSummary[] = rows.map((row) => {
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
    return {
      id: row.id,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      source: row.source,
      status,
      verification,
      score,
    };
  });

  const body: PlacesResponse = { places: summaries, attribution: OSM_ATTRIBUTION };
  return Response.json(body);
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const limited = rateLimitResponse(auth.user.id, request);
  if (limited) return limited;

  const raw = await readJson(request);
  if (raw === null || typeof raw !== "object") {
    return jsonError(400, "Invalid JSON body.");
  }
  const body = raw as Partial<CreatePlaceBody>;

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return jsonError(400, "name is required.");
  }
  const name = body.name.trim();
  if (name.length > 200) {
    return jsonError(400, "name must be at most 200 characters.");
  }
  if (
    typeof body.lat !== "number" ||
    typeof body.lng !== "number" ||
    !Number.isFinite(body.lat) ||
    !Number.isFinite(body.lng) ||
    Math.abs(body.lat) > 90 ||
    Math.abs(body.lng) > 180
  ) {
    return jsonError(400, "lat/lng must be finite coordinates (|lat| <= 90, |lng| <= 180).");
  }
  let address: string | null = null;
  if (body.address !== undefined) {
    if (typeof body.address !== "string" || body.address.length > 300) {
      return jsonError(400, "address must be a string of at most 300 characters.");
    }
    address = body.address.trim() || null;
  }

  const db = getDb();
  const [inserted] = await db
    .insert(schema.places)
    .values({
      name,
      address,
      lat: body.lat,
      lng: body.lng,
      source: "user",
    })
    .returning({
      id: schema.places.id,
      name: schema.places.name,
      lat: schema.places.lat,
      lng: schema.places.lng,
      source: schema.places.source,
    });

  const place: PlaceSummary = {
    ...inserted,
    status: null,
    verification: "none",
    score: 0,
  };
  return Response.json({ place }, { status: 201 });
}
