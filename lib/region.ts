/** Launch region config (PLAN.md §1). Expand region by region. */

export interface Region {
  slug: string;
  name: string;
  center: { lat: number; lng: number };
  zoom: number;
  /** [south, west, north, east] — Overpass bbox order. */
  bbox: [number, number, number, number];
}

export const SEATTLE: Region = {
  slug: "seattle",
  name: "Seattle",
  center: { lat: 47.6062, lng: -122.3321 },
  zoom: 12,
  // Seattle metro: Burien/Renton up to Shoreline/Bothell, Puget Sound to Bellevue/Issaquah.
  bbox: [47.42, -122.46, 47.79, -122.02],
};

export const LAUNCH_REGION = SEATTLE;
