/**
 * Shared map-UI types that must NOT live in MapView.tsx: importing that
 * module pulls in maplibre-gl, which is deliberately loaded only through
 * MapApp's dynamic() boundary. Anything the search box (or other light
 * components) share with the map goes here instead.
 */

/** A camera move requested by UI outside the map (e.g. search). */
export type MapFlyTarget =
  | { kind: "point"; lng: number; lat: number; zoom: number }
  | {
      kind: "bounds";
      /** [west, south, east, north] */
      bounds: [number, number, number, number];
    };
