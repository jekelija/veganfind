"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useUser } from "@/lib/auth/useUser";
import { OSM_ATTRIBUTION, type PlaceSummary } from "@/lib/types";
import type { StatusFilter } from "@/components/format";
import Legend from "@/components/map/Legend";
import SearchBox from "@/components/map/SearchBox";
import type { MapFlyTarget } from "@/components/map/types";
import AddPlaceForm from "@/components/map/AddPlaceForm";
import PlaceList from "@/components/map/PlaceList";
import PlaceDetailPanel from "@/components/place/PlaceDetailPanel";
import LiveAnnouncer from "@/components/LiveAnnouncer";

function MapLoading() {
  const t = useTranslations("map");
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-neutral-100 text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
      {t("loading")}
    </div>
  );
}

// MapLibre needs the browser; skip SSR for the map itself.
const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: MapLoading,
});

/**
 * Client-side shell for the whole map experience: map, legend/filter,
 * add-a-place flow, detail panel, and the OSM attribution notice.
 */
export default function MapApp() {
  const t = useTranslations("map");
  const auth = useUser();

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [pendingPin, setPendingPin] = useState<{
    lng: number;
    lat: number;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hasData, setHasData] = useState(false);
  const [places, setPlaces] = useState<PlaceSummary[]>([]);
  const [view, setView] = useState<"map" | "list">("map");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<MapFlyTarget | null>(null);

  const refetchPlaces = useCallback(() => setRefreshKey((k) => k + 1), []);
  const handleDataLoaded = useCallback((loaded: PlaceSummary[]) => {
    setHasData(true);
    setPlaces(loaded);
  }, []);
  const handleSelectPlace = useCallback((id: string) => {
    setSelectedId(id);
  }, []);
  const handlePickLocation = useCallback(
    (loc: { lng: number; lat: number }) => setPendingPin(loc),
    [],
  );
  const closePanel = useCallback(() => setSelectedId(null), []);
  const handleSearchSelect = useCallback((target: MapFlyTarget) => {
    // Spread into a fresh object: MapView reacts to identity, so picking
    // the same result twice still re-flies the camera.
    setFlyTarget({ ...target });
    setView("map"); // flying somewhere only makes sense on the map
  }, []);

  function startAddMode() {
    setSelectedId(null);
    setAddMode(true);
    setPendingPin(null);
    setView("map"); // dropping a pin needs the map
  }

  function cancelAddMode() {
    setAddMode(false);
    setPendingPin(null);
  }

  function handlePlaceSaved(place: PlaceSummary) {
    setAddMode(false);
    setPendingPin(null);
    refetchPlaces();
    setSelectedId(place.id);
  }

  const signedIn = auth.user !== null;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <MapView
        filter={filter}
        refreshKey={refreshKey}
        addMode={addMode}
        pendingPin={pendingPin}
        flyTarget={flyTarget}
        onSelectPlace={handleSelectPlace}
        onPickLocation={handlePickLocation}
        onDataLoaded={handleDataLoaded}
        onLoadError={setLoadError}
      />

      {/* Address / neighborhood search. Full-width top row on small screens
          (legend/add controls drop to top-16 there); centered on md+. */}
      <div className="absolute inset-x-3 top-3 z-20 md:inset-x-auto md:left-1/2 md:w-96 md:-translate-x-1/2">
        <SearchBox onSelect={handleSearchSelect} />
      </div>

      {/* Screen-reader announcements: places loaded (polite), errors (assertive). */}
      <LiveAnnouncer
        polite={hasData ? t("placesShown", { count: places.length }) : ""}
        assertive={loadError ?? ""}
      />

      {view === "map" && <Legend filter={filter} onFilterChange={setFilter} />}

      {/* Accessible list view of the viewport's places (map is never the only way in). */}
      {view === "list" && (
        <PlaceList places={places} onSelect={handleSelectPlace} />
      )}

      {/* Map/List toggle — rendered after the list so it stays on top of it. */}
      <button
        type="button"
        onClick={() => setView((v) => (v === "map" ? "list" : "map"))}
        className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-neutral-200 bg-white/95 px-4 py-2 text-xs font-semibold text-neutral-800 shadow-md backdrop-blur hover:bg-white dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-100 dark:hover:bg-neutral-900"
      >
        {view === "map" ? t("listToggleShow") : t("listToggleHide")}
      </button>

      {/* Top-right: add-a-place entry point (auth-aware). top-16 under the
          full-width search row on small screens. */}
      <div className="absolute right-3 top-16 z-10 flex flex-col items-end gap-2 md:top-3">
        {auth.loading ? null : !auth.authConfigured ? (
          <span className="rounded-full border border-neutral-200 bg-white/95 px-3 py-1.5 text-xs text-neutral-600 shadow-md backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-300">
            {t("readOnlyBadge")}
          </span>
        ) : !signedIn ? (
          <Link
            href="/login"
            className="rounded-full bg-green-700 px-4 py-2 text-xs font-semibold text-white shadow-md hover:bg-green-800"
          >
            {t("signInToContribute")}
          </Link>
        ) : addMode ? (
          <button
            type="button"
            onClick={cancelAddMode}
            className="rounded-full bg-neutral-800 px-4 py-2 text-xs font-semibold text-white shadow-md hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {t("cancelAdding")}
          </button>
        ) : (
          <button
            type="button"
            onClick={startAddMode}
            className="inline-flex items-center gap-1.5 rounded-full bg-green-700 px-4 py-2 text-xs font-semibold text-white shadow-md hover:bg-green-800"
          >
            <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden>
              <path
                d="M6 1v10M1 6h10"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            {t("addPlace")}
          </button>
        )}
      </div>

      {/* Add-mode hint */}
      {addMode && !pendingPin && (
        <div className="pointer-events-none absolute inset-x-0 top-28 z-10 flex justify-center px-4 md:top-16">
          <p className="rounded-full bg-neutral-900/85 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur dark:bg-white/90 dark:text-neutral-900">
            {t("dropPinHint")}
          </p>
        </div>
      )}

      {/* Viewport fetch errors */}
      {loadError && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-10 flex justify-center px-4">
          <p className="rounded-full bg-red-600/95 px-4 py-2 text-xs font-medium text-white shadow-lg">
            {loadError}
          </p>
        </div>
      )}

      {addMode && pendingPin && (
        <AddPlaceForm
          location={pendingPin}
          onCancel={cancelAddMode}
          onSaved={handlePlaceSaved}
        />
      )}

      {selectedId && (
        <PlaceDetailPanel
          key={selectedId}
          placeId={selectedId}
          auth={auth}
          onClose={closePanel}
          onPlacesChanged={refetchPlaces}
        />
      )}

      {/* ODbL attribution — required wherever place data is shown (PLAN.md §5) */}
      {hasData && (
        <div className="pointer-events-none absolute bottom-0 left-0 z-10 rounded-tr-md bg-white/80 px-1.5 py-0.5 text-[10px] text-neutral-600 backdrop-blur dark:bg-neutral-900/80 dark:text-neutral-400">
          {OSM_ATTRIBUTION}
        </div>
      )}
    </div>
  );
}
