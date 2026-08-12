"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  GeoJSONSource,
  setWorkerUrl,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  SymbolLayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Point } from "geojson";
import { LAUNCH_REGION } from "@/lib/region";
import type { PlacesResponse, PlaceSummary } from "@/lib/types";
import {
  STATUS_COLORS,
  UNKNOWN_STROKE,
  type StatusFilter,
} from "@/components/format";

const STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
  "https://demotiles.maplibre.org/style.json";

// Serve the worker from public/ (copied by scripts/copy-maplibre-worker.mjs):
// bundlers hash MapLibre's separate worker file without rewriting its internal
// relative import, which breaks it silently. See that script's header comment.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const SOURCE_ID = "veganfind-places";
const LAYER_CLUSTERS = "veganfind-clusters";
const LAYER_CLUSTER_COUNT = "veganfind-cluster-count";
const LAYER_POINTS = "veganfind-points";
const FETCH_DEBOUNCE_MS = 300;

export interface MapViewProps {
  filter: StatusFilter;
  /** Bump to force a viewport refetch (e.g. after a new place is created). */
  refreshKey: number;
  addMode: boolean;
  /** Pending "add a place" pin, rendered as a draggable-free marker. */
  pendingPin: { lng: number; lat: number } | null;
  onSelectPlace: (id: string) => void;
  onPickLocation: (loc: { lng: number; lat: number }) => void;
  /** Called with the fetched viewport places after every successful fetch. */
  onDataLoaded: (places: PlaceSummary[]) => void;
  onLoadError: (message: string | null) => void;
}

// ---------------------------------------------------------------------------
// Layer paint — status colors, confirmed (solid + white ring) vs
// unverified (faded + thin ring in its own color), unknown (outline only).
// ---------------------------------------------------------------------------

const statusColor: ExpressionSpecification = [
  "match",
  ["get", "status"],
  "fully_vegan",
  STATUS_COLORS.fully_vegan,
  "vegan_friendly",
  STATUS_COLORS.vegan_friendly,
  "not_vegan",
  STATUS_COLORS.not_vegan,
  "closed",
  STATUS_COLORS.closed,
  UNKNOWN_STROKE,
];

const isConfirmed: ExpressionSpecification = [
  "==",
  ["get", "verification"],
  "confirmed",
];
const isUnknown: ExpressionSpecification = ["==", ["get", "status"], "none"];

const clusterLayer: CircleLayerSpecification = {
  id: LAYER_CLUSTERS,
  type: "circle",
  source: SOURCE_ID,
  filter: ["has", "point_count"],
  paint: {
    "circle-color": [
      "step",
      ["get", "point_count"],
      "#16a34a",
      25,
      "#15803d",
      100,
      "#14532d",
    ],
    "circle-radius": ["step", ["get", "point_count"], 15, 25, 20, 100, 26],
    "circle-stroke-width": 2,
    "circle-stroke-color": "rgba(255,255,255,0.9)",
  },
};

const pointsLayer: CircleLayerSpecification = {
  id: LAYER_POINTS,
  type: "circle",
  source: SOURCE_ID,
  filter: ["!", ["has", "point_count"]],
  paint: {
    "circle-color": statusColor,
    "circle-radius": ["case", isConfirmed, 8, 6.5],
    // Unknown status: outline only. Unverified: faded. Confirmed: solid.
    "circle-opacity": ["case", isUnknown, 0, isConfirmed, 1, 0.55],
    "circle-stroke-color": [
      "case",
      isUnknown,
      UNKNOWN_STROKE,
      isConfirmed,
      "#ffffff",
      statusColor,
    ],
    "circle-stroke-width": ["case", isConfirmed, 2.5, 1.25],
    "circle-stroke-opacity": ["case", isConfirmed, 1, 0.85],
  },
};

/**
 * Cluster count labels need glyphs. Reuse a text-font the style already
 * loads so this works with demotiles, MapTiler, Protomaps, … If the style
 * has no glyphs endpoint, we skip the label layer (clusters stay sized).
 */
function pickTextFont(map: MapLibreMap): string[] | null {
  const style = map.getStyle();
  if (!style?.glyphs) return null;
  for (const layer of style.layers ?? []) {
    if (layer.type === "symbol") {
      const font = layer.layout?.["text-font"];
      if (
        Array.isArray(font) &&
        font.length > 0 &&
        font.every((f) => typeof f === "string")
      ) {
        return font as string[];
      }
    }
  }
  return ["Noto Sans Regular"];
}

function toFeatureCollection(
  places: PlaceSummary[],
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: places.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        name: p.name,
        status: p.status ?? "none",
        verification: p.verification,
        score: p.score,
      },
    })),
  };
}

export default function MapView(props: MapViewProps) {
  const t = useTranslations("map");
  const tErrors = useTranslations("errors");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinMarkerRef = useRef<Marker | null>(null);

  // Latest props for stable event handlers (updated before other effects run).
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  // Latest translator via a ref, so fetchPlaces stays referentially stable
  // (its identity drives the map-lifecycle effect).
  const tErrorsRef = useRef(tErrors);
  useEffect(() => {
    tErrorsRef.current = tErrors;
  });

  const fetchPlaces = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
      .map((n) => n.toFixed(6))
      .join(",");
    const params = new URLSearchParams({ bbox });
    if (propsRef.current.filter !== "all") {
      params.set("filter", propsRef.current.filter);
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/places?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PlacesResponse;
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData(toFeatureCollection(data.places));
      propsRef.current.onLoadError(null);
      propsRef.current.onDataLoaded(data.places);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      propsRef.current.onLoadError(tErrorsRef.current("placesLoad"));
    }
  }, []);

  // Map lifecycle (create once).
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      center: [LAUNCH_REGION.center.lng, LAUNCH_REGION.center.lat],
      zoom: LAUNCH_REGION.zoom,
      // Tile/style attribution (deliverable 6) — always visible.
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(
      new NavigationControl({ showCompass: false }),
      "bottom-right",
    );

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 15,
      });
      map.addLayer(clusterLayer);
      map.addLayer(pointsLayer);

      const font = pickTextFont(map);
      if (font) {
        const countLayer: SymbolLayerSpecification = {
          id: LAYER_CLUSTER_COUNT,
          type: "symbol",
          source: SOURCE_ID,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": font,
            "text-size": 12,
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#ffffff" },
        };
        map.addLayer(countLayer);
      }

      // Add-a-place: any map click while in add mode drops the pin.
      map.on("click", (e) => {
        if (propsRef.current.addMode) {
          propsRef.current.onPickLocation({
            lng: e.lngLat.lng,
            lat: e.lngLat.lat,
          });
        }
      });

      map.on("click", LAYER_POINTS, (e: MapLayerMouseEvent) => {
        if (propsRef.current.addMode) return;
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") propsRef.current.onSelectPlace(id);
      });

      map.on("click", LAYER_CLUSTERS, async (e: MapLayerMouseEvent) => {
        if (propsRef.current.addMode) return;
        const feature = e.features?.[0];
        if (!feature) return;
        const clusterId = feature.properties?.cluster_id as number;
        const source = map.getSource(SOURCE_ID) as GeoJSONSource;
        try {
          const zoom = await source.getClusterExpansionZoom(clusterId);
          map.easeTo({
            center: (feature.geometry as Point).coordinates as [
              number,
              number,
            ],
            zoom: zoom + 0.5,
          });
        } catch {
          // cluster may have dissolved after a refetch — ignore
        }
      });

      for (const layerId of [LAYER_POINTS, LAYER_CLUSTERS]) {
        map.on("mouseenter", layerId, () => {
          if (!propsRef.current.addMode)
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          if (!propsRef.current.addMode) map.getCanvas().style.cursor = "";
        });
      }

      loadedRef.current = true;
      void fetchPlaces();
    });

    map.on("moveend", () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void fetchPlaces(), FETCH_DEBOUNCE_MS);
    });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      loadedRef.current = false;
      pinMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [fetchPlaces]);

  // Refetch when the filter changes or a refresh is requested.
  useEffect(() => {
    void fetchPlaces();
  }, [props.filter, props.refreshKey, fetchPlaces]);

  // Crosshair cursor while placing a pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = props.addMode ? "crosshair" : "";
  }, [props.addMode]);

  // Pending pin marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pinMarkerRef.current?.remove();
    pinMarkerRef.current = null;
    if (props.pendingPin) {
      pinMarkerRef.current = new Marker({ color: STATUS_COLORS.fully_vegan })
        .setLngLat([props.pendingPin.lng, props.pendingPin.lat])
        .addTo(map);
    }
  }, [props.pendingPin]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 h-full w-full"
      role="application"
      aria-label={t("ariaLabel")}
    />
  );
}
