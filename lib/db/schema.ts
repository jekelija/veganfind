import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  real,
  smallint,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * VeganFind schema — see PLAN.md §2.
 *
 * Two data domains, kept structurally separate:
 *  A. Place directory (places, osm_raw) — ODbL-derived, attributed, share-alike.
 *  B. Proprietary layer (profiles, vegan_submissions, votes, place_scores) — ours.
 *
 * Canonical key is OUR uuid. osm_id / google_place_id are nullable external refs.
 */

export const VEGAN_STATUSES = [
  "fully_vegan",
  "vegan_friendly",
  "not_vegan",
  "closed",
] as const;
export type VeganStatus = (typeof VEGAN_STATUSES)[number];

export const PLACE_SOURCES = ["osm", "user"] as const;
export type PlaceSource = (typeof PLACE_SOURCES)[number];

// ---------------------------------------------------------------------------
// Domain A — place directory (ODbL-derived)
// ---------------------------------------------------------------------------

export const places = pgTable(
  "places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    osmId: text("osm_id").unique(), // e.g. "node/123456", "way/789"
    googlePlaceId: text("google_place_id").unique(), // future adapter, unused at MVP
    name: text("name").notNull(),
    address: text("address"),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    source: text("source", { enum: PLACE_SOURCES }).notNull(),
    // Seed signal copied from OSM diet:* tags ("yes" | "only" | "no" | null).
    osmDietVegan: text("osm_diet_vegan"),
    osmDietVegetarian: text("osm_diet_vegetarian"),
    cuisine: text("cuisine"),
    closed: boolean("closed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Viewport bbox queries: lat BETWEEN … AND lng BETWEEN …
    index("places_lat_lng_idx").on(t.lat, t.lng),
  ],
);

/** Raw OSM element snapshot — provenance for ODbL + re-sync diffing. */
export const osmRaw = pgTable("osm_raw", {
  osmId: text("osm_id").primaryKey(),
  tags: jsonb("tags").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Domain B — proprietary layer
// ---------------------------------------------------------------------------

/** id mirrors the Supabase auth user id. */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").unique(),
  trustScore: real("trust_score").notNull().default(1.0),
  banned: boolean("banned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const veganSubmissions = pgTable(
  "vegan_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    status: text("status", { enum: VEGAN_STATUSES }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One active submission per (place, user).
    uniqueIndex("submissions_place_user_uq").on(t.placeId, t.userId),
    index("submissions_place_idx").on(t.placeId),
  ],
);

export const votes = pgTable(
  "votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => veganSubmissions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    value: smallint("value").notNull(), // -1 | 1, validated in the API layer
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("votes_submission_user_uq").on(t.submissionId, t.userId),
    index("votes_submission_idx").on(t.submissionId),
  ],
);

/**
 * Derived, recomputed synchronously in the same transaction as every
 * submission/vote write (PLAN.md: no job queue). This is what the API serves.
 */
export const placeScores = pgTable("place_scores", {
  placeId: uuid("place_id")
    .primaryKey()
    .references(() => places.id),
  status: text("status", { enum: VEGAN_STATUSES }).notNull(),
  score: real("score").notNull(), // Wilson lower bound of the winning status
  submissionCount: integer("submission_count").notNull().default(0),
  voteCount: integer("vote_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
