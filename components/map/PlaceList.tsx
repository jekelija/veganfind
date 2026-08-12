"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { PlaceSummary } from "@/lib/types";
import { STATUS_COLORS, UNKNOWN_STROKE } from "@/components/format";

/**
 * Accessible list view of the places in the current map viewport
 * (PLAN.md §3b — the map must never be the only way in). Full-screen
 * overlay on mobile, left-side panel on desktop. Every status is conveyed
 * as text; the colored dot is decoration only.
 */
export default function PlaceList({
  places,
  onSelect,
}: {
  places: PlaceSummary[];
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("placeList");
  const tStatus = useTranslations("status");
  const tVerification = useTranslations("verification");
  const locale = useLocale();

  const sorted = useMemo(
    () => [...places].sort((a, b) => a.name.localeCompare(b.name, locale)),
    [places, locale],
  );

  return (
    <section
      aria-label={t("title")}
      className="absolute inset-0 z-10 flex flex-col bg-white md:inset-y-0 md:left-0 md:right-auto md:w-96 md:border-r md:border-neutral-200 dark:bg-neutral-900 md:dark:border-neutral-700"
    >
      <h2 className="shrink-0 border-b border-neutral-200 px-4 py-3 text-sm font-bold text-neutral-900 dark:border-neutral-700 dark:text-neutral-100">
        {t("title")}
      </h2>

      {sorted.length === 0 ? (
        <p className="px-4 py-6 text-sm text-neutral-600 dark:text-neutral-300">
          {t("empty")}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-neutral-100 overflow-y-auto pb-20 dark:divide-neutral-800">
          {sorted.map((place) => {
            const dotColor = place.status
              ? STATUS_COLORS[place.status]
              : UNKNOWN_STROKE;
            const statusLabel = place.status
              ? tStatus(place.status)
              : tStatus("unknown");
            const verificationLabel =
              place.verification === "confirmed"
                ? tVerification("confirmed", { confidence: place.score })
                : tVerification(place.verification);
            return (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => onSelect(place.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  {/* Decorative status dot — meaning is carried by the text below. */}
                  <span
                    aria-hidden
                    className="mt-1 inline-block size-3 shrink-0 rounded-full"
                    style={
                      place.status
                        ? {
                            backgroundColor: dotColor,
                            opacity:
                              place.verification === "confirmed" ? 1 : 0.55,
                          }
                        : { border: `2px solid ${dotColor}` }
                    }
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {place.name}
                    </span>
                    <span className="block text-xs text-neutral-600 dark:text-neutral-300">
                      {statusLabel} · {verificationLabel}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
