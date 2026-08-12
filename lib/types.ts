import type { PlaceSource, VeganStatus } from "./db/schema";

export type { PlaceSource, VeganStatus };

/**
 * API CONTRACT — shared between the map UI and the route handlers.
 * If you change anything here, both sides must change together.
 *
 * Routes:
 *   GET  /api/places?bbox=minLng,minLat,maxLng,maxLat[&filter=fully_vegan|vegan_friendly]
 *        -> PlacesResponse            (closed places excluded)
 *   GET  /api/places/:id             -> PlaceDetailResponse
 *   POST /api/places                 -> { place: PlaceSummary }         (auth; user-added place)
 *        body: CreatePlaceBody
 *   POST /api/places/:id/submissions -> { submission: SubmissionView }  (auth; upserts the
 *        body: CreateSubmissionBody      caller's single submission for the place)
 *   POST /api/submissions/:id/votes  -> { ok: true }                    (auth)
 *        body: CreateVoteBody
 *   GET  /api/me                     -> MeResponse (200 with user: null when signed out)
 *
 * Errors: non-2xx responses carry { error: string }. Write endpoints return
 * 401 when unauthenticated, 429 when rate-limited, and 503 when the server
 * is not configured for auth (Supabase env vars absent — read-only mode).
 */

/** How confident we are in the displayed status. */
export type Verification = "confirmed" | "unverified" | "none";

export interface PlaceSummary {
  id: string;
  name: string;
  lat: number;
  lng: number;
  source: PlaceSource;
  /** Winning crowd status if any, else derived from OSM diet tags, else null. */
  status: VeganStatus | null;
  /** "confirmed" = crowd-scored, "unverified" = OSM seed signal only. */
  verification: Verification;
  /** Wilson lower bound for the winning status (0..1); 0 when unverified. */
  score: number;
}

export interface PlacesResponse {
  places: PlaceSummary[];
  /** Wherever this data is shown: "© OpenStreetMap contributors". */
  attribution: string;
}

export interface SubmissionView {
  id: string;
  status: VeganStatus;
  note: string | null;
  createdAt: string; // ISO
  upvotes: number;
  downvotes: number;
  /** The signed-in caller's vote on this submission, if any. */
  myVote: -1 | 1 | null;
  isMine: boolean;
}

export interface PlaceDetail extends PlaceSummary {
  address: string | null;
  cuisine: string | null;
  closed: boolean;
  osmId: string | null;
  osmDietVegan: string | null;
  osmDietVegetarian: string | null;
  submissions: SubmissionView[];
}

export interface PlaceDetailResponse {
  place: PlaceDetail;
  attribution: string;
}

export interface CreatePlaceBody {
  name: string;
  lat: number;
  lng: number;
  address?: string;
}

export interface CreateSubmissionBody {
  status: VeganStatus;
  note?: string;
}

export interface CreateVoteBody {
  value: -1 | 1;
}

export interface MeResponse {
  user: { id: string; email: string | null } | null;
  /** False when Supabase env vars are absent — UI should hide auth affordances. */
  authConfigured: boolean;
}

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
