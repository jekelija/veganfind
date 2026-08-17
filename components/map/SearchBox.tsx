"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import { LAUNCH_REGION } from "@/lib/region";
import type { MapFlyTarget } from "@/components/map/types";

/**
 * Address / neighborhood search (PLAN.md M4, pulled forward): an accessible
 * combobox over the Photon geocoder (photon.komoot.io — free, OSM-based,
 * same license domain as our data, CORS-open so the browser calls it
 * directly). Picking a result asks the map to fly there via onSelect; the
 * viewport change then refetches places, so "search an address" becomes
 * "see what's vegan near it" with no extra wiring.
 *
 * Results are biased toward the launch region's center so "capitol hill"
 * finds Seattle's, not Denver's.
 */

const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 6;
const POINT_ZOOM = 15;

interface PhotonFeature {
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    city?: string;
    state?: string;
    country?: string;
    /** [west, north, east, south] — Photon's order, NOT MapLibre's. */
    extent?: [number, number, number, number];
  };
}

export interface SearchResult {
  id: string;
  primary: string;
  secondary: string;
  target: MapFlyTarget;
}

function toResult(feature: PhotonFeature, index: number): SearchResult | null {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  const primary =
    p.name ??
    (p.street ? [p.housenumber, p.street].filter(Boolean).join(" ") : null);
  if (!primary) return null;
  const secondary = [p.district, p.city, p.state, p.country]
    .filter((part): part is string => Boolean(part) && part !== primary)
    .slice(0, 3)
    .join(", ");
  const target: MapFlyTarget = p.extent
    ? {
        kind: "bounds",
        // Photon extent is [w, n, e, s]; MapLibre wants [w, s, e, n].
        bounds: [p.extent[0], p.extent[3], p.extent[2], p.extent[1]],
      }
    : { kind: "point", lng, lat, zoom: POINT_ZOOM };
  return { id: `${index}-${lng}-${lat}`, primary, secondary, target };
}

type ListState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "results"; results: SearchResult[]; query: string };

export default function SearchBox({
  onSelect,
}: {
  onSelect: (target: MapFlyTarget) => void;
}) {
  const t = useTranslations("search");
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListState>({ kind: "idle" });
  const [activeIndex, setActiveIndex] = useState(-1);

  // Debounced geocoding as the user types. Too-short queries are reset to
  // idle in handleChange (an event handler), so this effect only talks to
  // the network.
  useEffect(() => {
    abortRef.current?.abort();
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      setList({ kind: "loading" });
      try {
        const params = new URLSearchParams({
          q,
          limit: String(RESULT_LIMIT),
          lat: String(LAUNCH_REGION.center.lat),
          lon: String(LAUNCH_REGION.center.lng),
        });
        const res = await fetch(`${PHOTON_ENDPOINT}?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { features?: PhotonFeature[] };
        // Photon often returns several OSM elements with identical labels
        // (node + relation for the same neighborhood) — keep the first.
        const seen = new Set<string>();
        const results = (data.features ?? [])
          .map(toResult)
          .filter((r): r is SearchResult => {
            if (r === null) return false;
            const key = `${r.primary}|${r.secondary}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        setList({ kind: "results", results, query: q });
        setActiveIndex(-1);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setList({ kind: "error" });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const results = list.kind === "results" ? list.results : [];
  const expanded = open && list.kind !== "idle";

  function handleChange(value: string) {
    setQuery(value);
    setOpen(true);
    if (value.trim().length < MIN_QUERY_LENGTH) {
      setList({ kind: "idle" });
      setActiveIndex(-1);
    }
  }

  function choose(result: SearchResult) {
    onSelect(result.target);
    setQuery(result.primary);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + delta + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[activeIndex] ?? results[0];
      if (picked) choose(picked);
    }
  }

  const optionId = (i: number) => `${listboxId}-option-${i}`;

  return (
    <div className="pointer-events-auto w-full">
      <label htmlFor={`${listboxId}-input`} className="sr-only">
        {t("label")}
      </label>
      <input
        ref={inputRef}
        id={`${listboxId}-input`}
        type="text"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        autoComplete="off"
        value={query}
        placeholder={t("placeholder")}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        className="w-full rounded-full border border-neutral-200 bg-white/95 px-4 py-2 text-sm text-neutral-900 shadow-md backdrop-blur placeholder:text-neutral-500 focus:border-green-700 focus:outline-none focus:ring-2 focus:ring-green-700/30 dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-100 dark:placeholder:text-neutral-400"
      />

      {/* Politely announce how the search is going without moving focus. */}
      <p role="status" className="sr-only">
        {list.kind === "results"
          ? t("resultsCount", { count: results.length })
          : ""}
      </p>

      {expanded && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t("label")}
          className="mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-neutral-200 bg-white/95 py-1 shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95"
        >
          {list.kind === "loading" && (
            <li className="px-4 py-2 text-xs text-neutral-500 dark:text-neutral-400">
              {t("searching")}
            </li>
          )}
          {list.kind === "error" && (
            <li className="px-4 py-2 text-xs text-red-700 dark:text-red-400">
              {t("error")}
            </li>
          )}
          {list.kind === "results" && results.length === 0 && (
            <li className="px-4 py-2 text-xs text-neutral-500 dark:text-neutral-400">
              {t("noResults", { query: list.query })}
            </li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              // mousedown (not click) so the input's blur doesn't close the
              // list before the selection lands.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`cursor-pointer px-4 py-2 text-sm ${
                i === activeIndex
                  ? "bg-green-50 text-green-900 dark:bg-green-950/50 dark:text-green-200"
                  : "text-neutral-800 dark:text-neutral-200"
              }`}
            >
              <span className="font-medium">{r.primary}</span>
              {r.secondary && (
                <span className="ml-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  {r.secondary}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
