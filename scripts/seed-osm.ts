/**
 * VeganFind — OSM Overpass seed pipeline for the launch region (PLAN.md M1).
 *
 * Usage:
 *   npm run seed              # import the committed fixture (default; no network)
 *   npm run seed -- --live    # query Overpass, OVERWRITE the fixture, then import
 *
 * Per PLAN.md §3/§5 the app NEVER calls Overpass at request time: this script
 * is the only thing that talks to the API, and the raw response is committed
 * as a fixture so re-seeding a fresh database needs no network at all.
 *
 * Idempotent: upserts keyed on osm_id; safe to re-run any number of times.
 * Touches ONLY the ODbL-derived place directory (places, osm_raw) — never the
 * proprietary layer (submissions/votes/scores), and never the `closed` flag,
 * which is owned by the crowd once a place exists.
 */
import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { LAUNCH_REGION } from "../lib/region";
import { getDb, schema } from "../lib/db";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");

// Load env before getDb() is called (getDb reads DATABASE_URL lazily).
loadEnv({ path: join(ROOT, ".env.local") });
loadEnv({ path: join(ROOT, ".env") });

const FIXTURE_PATH = join(SCRIPT_DIR, "fixtures", "seattle-overpass.json");

/** Overpass usage policy: identify yourself. https://dev.overpass-api.de/overpass-doc/en/preface/commons.html */
const USER_AGENT =
  "VeganFind-Seed/0.1 (one-off OSM seed script; contact: jon@3dcloud.com)";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const AMENITY_REGEX =
  "restaurant|cafe|fast_food|ice_cream|bar|pub|food_court";

// ---------------------------------------------------------------------------
// Overpass types (the subset we consume)
// ---------------------------------------------------------------------------

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  /** Present on nodes. */
  lat?: number;
  lon?: number;
  /** Present on ways/relations thanks to `out center`. */
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  version?: number;
  generator?: string;
  elements: OverpassElement[];
  /** Set only on the hand-written placeholder fixture. */
  _sample?: boolean;
  _comment?: string;
}

// ---------------------------------------------------------------------------
// Query + fetch
// ---------------------------------------------------------------------------

function buildQuery(): string {
  const [south, west, north, east] = LAUNCH_REGION.bbox;
  const bbox = `${south},${west},${north},${east}`;
  // `out center;` prints full element bodies (ids, tags, node coordinates)
  // plus a computed center coordinate for ways/relations — i.e. "center+tags".
  // (Plain `out tags;` verbosity would drop node lat/lon, so don't use it.)
  return [
    "[out:json][timeout:90];",
    "(",
    `  nwr["amenity"~"^(${AMENITY_REGEX})$"]["diet:vegan"](${bbox});`,
    `  nwr["amenity"~"^(${AMENITY_REGEX})$"]["diet:vegetarian"](${bbox});`,
    ");",
    "out center;",
  ].join("\n");
}

async function fetchLive(): Promise<OverpassResponse> {
  const query = buildQuery();
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Querying Overpass: ${endpoint} …`);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as OverpassResponse;
      if (!Array.isArray(json.elements)) {
        throw new Error("Response has no `elements` array — not Overpass JSON?");
      }
      return json;
    } catch (err) {
      lastError = err;
      console.warn(`  failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new Error(
    `All Overpass endpoints failed (last: ${
      lastError instanceof Error ? lastError.message : lastError
    }). Try again later — it is a shared public resource and rate-limits.`,
  );
}

function loadFixture(): OverpassResponse {
  let raw: string;
  try {
    raw = readFileSync(FIXTURE_PATH, "utf8");
  } catch {
    throw new Error(
      `Fixture not found at ${FIXTURE_PATH}. Run \`npm run seed -- --live\` once to create it.`,
    );
  }
  return JSON.parse(raw) as OverpassResponse;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function elementCoords(
  el: OverpassElement,
): { lat: number; lng: number } | null {
  if (el.type === "node" && el.lat != null && el.lon != null) {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center && el.center.lat != null && el.center.lon != null) {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

/** "1429 12th Avenue, Seattle" from addr:* tags; null when nothing usable. */
function assembleAddress(tags: Record<string, string>): string | null {
  const streetPart = [tags["addr:housenumber"], tags["addr:street"]]
    .filter(Boolean)
    .join(" ");
  const parts = [streetPart, tags["addr:city"]].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const live = process.argv.includes("--live");

  let data: OverpassResponse;
  if (live) {
    data = await fetchLive();
    // Overwrite the committed fixture so the fresh response stays cached in
    // the repo (PLAN.md: never hit Overpass at request time; scripts only).
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    writeFileSync(FIXTURE_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(
      `Wrote ${data.elements.length} elements to ${FIXTURE_PATH} (fixture refreshed).`,
    );
  } else {
    data = loadFixture();
    console.log(
      `Loaded ${data.elements.length} elements from fixture ${FIXTURE_PATH}.`,
    );
  }

  if (data._sample) {
    console.warn(
      "\n" +
        "  WARNING: this fixture is a hand-written SAMPLE, not real Overpass data.\n" +
        "  Replace it with a real snapshot before launch:  npm run seed -- --live\n",
    );
  }

  const db = getDb();

  let imported = 0;
  let skippedNoName = 0;
  let skippedNoCoords = 0;

  for (const el of data.elements) {
    const osmId = `${el.type}/${el.id}`;
    const tags = el.tags ?? {};

    // Raw snapshot first — provenance for ODbL + future re-sync diffing.
    await db
      .insert(schema.osmRaw)
      .values({ osmId, tags })
      .onConflictDoUpdate({
        target: schema.osmRaw.osmId,
        set: { tags, importedAt: sql`now()` },
      });

    const coords = elementCoords(el);
    if (!coords) {
      skippedNoCoords++;
      continue;
    }
    const name = tags.name;
    if (!name) {
      skippedNoName++;
      continue;
    }

    // Upsert the place. On conflict we refresh the OSM-derived columns only:
    // never `closed` (crowd-owned), never `source`/`created_at`.
    await db
      .insert(schema.places)
      .values({
        osmId,
        name,
        address: assembleAddress(tags),
        lat: coords.lat,
        lng: coords.lng,
        source: "osm",
        osmDietVegan: tags["diet:vegan"] ?? null,
        osmDietVegetarian: tags["diet:vegetarian"] ?? null,
        cuisine: tags.cuisine ?? null,
      })
      .onConflictDoUpdate({
        target: schema.places.osmId,
        set: {
          name,
          address: assembleAddress(tags),
          lat: coords.lat,
          lng: coords.lng,
          osmDietVegan: tags["diet:vegan"] ?? null,
          osmDietVegetarian: tags["diet:vegetarian"] ?? null,
          cuisine: tags.cuisine ?? null,
          updatedAt: sql`now()`,
        },
      });
    imported++;
  }

  console.log("\nSeed summary");
  console.log(`  region:              ${LAUNCH_REGION.name} (${LAUNCH_REGION.slug})`);
  console.log(`  mode:                ${live ? "live Overpass" : "fixture"}${data._sample ? " [SAMPLE DATA]" : ""}`);
  console.log(`  elements fetched:    ${data.elements.length}`);
  console.log(`  places imported:     ${imported}`);
  console.log(`  skipped (no name):   ${skippedNoName}`);
  console.log(`  skipped (no coords): ${skippedNoCoords}`);

  // postgres.js keeps the event loop alive; close the pool so the script exits.
  await db.$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
