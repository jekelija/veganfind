"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  STATUS_COLORS,
  UNKNOWN_STROKE,
  type StatusFilter,
} from "@/components/format";

const FILTER_VALUES: StatusFilter[] = ["all", "fully_vegan", "vegan_friendly"];

function Dot({
  color,
  variant,
}: {
  color: string;
  variant: "confirmed" | "unverified" | "outline";
}) {
  if (variant === "outline") {
    return (
      <span
        className="inline-block size-3.5 shrink-0 rounded-full border-2 bg-transparent"
        style={{ borderColor: color }}
        aria-hidden
      />
    );
  }
  if (variant === "unverified") {
    return (
      <span
        className="inline-block size-3.5 shrink-0 rounded-full border"
        style={{ backgroundColor: color, borderColor: color, opacity: 0.55 }}
        aria-hidden
      />
    );
  }
  return (
    <span
      className="inline-block size-3.5 shrink-0 rounded-full shadow-[0_0_0_2px_#ffffff] dark:shadow-[0_0_0_2px_#e5e5e5]"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

/**
 * Filter control + legend. Always expanded on md+; collapsible behind a
 * pill button on mobile.
 */
export default function Legend({
  filter,
  onFilterChange,
}: {
  filter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
}) {
  const t = useTranslations("legend");
  const tStatus = useTranslations("status");
  const tVerification = useTranslations("verification");
  const [open, setOpen] = useState(false);

  const filterLabel = (value: StatusFilter) =>
    value === "all" ? t("filterAll") : tStatus(value);

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="legend-panel"
        className="pointer-events-auto rounded-full border border-neutral-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-md backdrop-blur md:hidden dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-200"
      >
        {open ? t("hide") : t("show")}
      </button>

      <section
        id="legend-panel"
        aria-label={t("regionLabel")}
        className={`${open ? "block" : "hidden"} pointer-events-auto w-60 rounded-xl border border-neutral-200 bg-white/95 p-3 text-sm shadow-lg backdrop-blur md:block dark:border-neutral-700 dark:bg-neutral-900/95`}
      >
        <div
          className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800"
          role="group"
          aria-label={t("filterLabel")}
        >
          {FILTER_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => onFilterChange(value)}
              className={`rounded-md px-1 py-1 text-[11px] font-semibold transition-colors ${
                filter === value
                  ? "bg-white text-green-700 shadow-sm dark:bg-neutral-700 dark:text-green-400"
                  : "text-neutral-600 hover:text-neutral-800 dark:text-neutral-300 dark:hover:text-neutral-100"
              }`}
            >
              {filterLabel(value)}
            </button>
          ))}
        </div>

        <ul className="space-y-1.5 text-xs text-neutral-700 dark:text-neutral-300">
          <li className="flex items-center gap-2">
            <Dot color={STATUS_COLORS.fully_vegan} variant="confirmed" />
            {tStatus("fully_vegan")}
          </li>
          <li className="flex items-center gap-2">
            <Dot color={STATUS_COLORS.vegan_friendly} variant="confirmed" />
            {tStatus("vegan_friendly")}
          </li>
          <li className="flex items-center gap-2">
            <Dot color={STATUS_COLORS.not_vegan} variant="confirmed" />
            {tStatus("not_vegan")}
          </li>
          <li className="flex items-center gap-2">
            <Dot color={UNKNOWN_STROKE} variant="outline" />
            {tVerification("none")}
          </li>
        </ul>

        <div className="mt-3 space-y-1.5 border-t border-neutral-200 pt-2 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
          <p className="flex items-center gap-2">
            <Dot color={STATUS_COLORS.fully_vegan} variant="confirmed" />
            <span>
              <strong className="font-semibold text-neutral-800 dark:text-neutral-200">
                {t("markerConfirmedLabel")}
              </strong>{" "}
              {t("markerConfirmedDescription")}
            </span>
          </p>
          <p className="flex items-center gap-2">
            <Dot color={STATUS_COLORS.fully_vegan} variant="unverified" />
            <span>
              <strong className="font-semibold text-neutral-800 dark:text-neutral-200">
                {t("markerUnverifiedLabel")}
              </strong>{" "}
              {t("markerUnverifiedDescription")}
            </span>
          </p>
        </div>
      </section>
    </div>
  );
}
