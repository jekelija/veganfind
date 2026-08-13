"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { PlaceDetail, PlaceDetailResponse } from "@/lib/types";
import type { UseUserResult } from "@/lib/auth/useUser";
import { useModalDialog } from "@/components/useModalDialog";
import StatusBadge from "@/components/place/StatusBadge";
import SubmissionItem from "@/components/place/SubmissionItem";
import SubmissionForm from "@/components/place/SubmissionForm";
import FlagButton from "@/components/place/FlagButton";

const TITLE_ID = "place-detail-title";

/**
 * Place detail — right-side panel on desktop, bottom sheet on mobile.
 * Fetches GET /api/places/:id on open and after every community action.
 */
export default function PlaceDetailPanel({
  placeId,
  auth,
  onClose,
  onPlacesChanged,
}: {
  placeId: string;
  auth: UseUserResult;
  onClose: () => void;
  onPlacesChanged: () => void;
}) {
  const t = useTranslations("placeDetail");
  const tFlags = useTranslations("flags");
  const format = useFormatter();
  const [place, setPlace] = useState<PlaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // Bumped (from event handlers) to refetch; the panel itself is keyed by
  // placeId in MapApp, so all state resets when another place is opened.
  const [fetchNonce, setFetchNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/places/${placeId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<PlaceDetailResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setPlace(data.place);
        setLoadFailed(false);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [placeId, fetchNonce]);

  // Dialog focus behavior: focus moves in on open (close button first),
  // Tab cycles inside, Escape closes, focus returns to the opener on close.
  const dialogRef = useModalDialog<HTMLElement>(onClose);

  // Refresh detail (votes/submissions changed) and viewport pins (scores changed).
  const handleChanged = useCallback(() => {
    setFetchNonce((n) => n + 1);
    onPlacesChanged();
  }, [onPlacesChanged]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    setFetchNonce((n) => n + 1);
  }, []);

  const signedIn = auth.user !== null;
  const mySubmission = place?.submissions.find((s) => s.isMine) ?? null;

  return (
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      tabIndex={-1}
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[70dvh] flex-col rounded-t-2xl border border-b-0 border-neutral-200 bg-white shadow-2xl md:inset-x-auto md:bottom-3 md:right-3 md:top-3 md:max-h-none md:w-96 md:rounded-2xl md:border-b dark:border-neutral-700 dark:bg-neutral-900"
    >
      {/* Mobile drag-handle look */}
      <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-600" />

      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0">
          <h2
            id={TITLE_ID}
            className="truncate text-lg font-bold text-neutral-900 dark:text-neutral-100"
          >
            {loading && !place
              ? t("loading")
              : (place?.name ?? t("fallbackName"))}
          </h2>
          {place?.address && (
            <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
              {place.address}
            </p>
          )}
          {place?.cuisine && (
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {t("cuisine", {
                cuisines: format.list(
                  place.cuisine.split(";").map((c) => c.trim()),
                  { type: "conjunction", style: "narrow" },
                ),
              })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="shrink-0 rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
            <path
              d="M4 4 L12 12 M12 4 L4 12"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {loadFailed && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300"
          >
            {t("loadError")}{" "}
            <button
              type="button"
              onClick={handleRetry}
              className="font-semibold underline"
            >
              {t("retry")}
            </button>
          </p>
        )}

        {place && (
          <>
            <StatusBadge
              status={place.status}
              verification={place.verification}
              score={place.score}
            />

            {place.closed && (
              <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300">
                {t("closedNotice")}
              </p>
            )}

            {(place.osmDietVegan || place.osmDietVegetarian) && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {t("osmTagsLabel")}
                </span>
                {place.osmDietVegan && (
                  <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                    diet:vegan={place.osmDietVegan}
                  </code>
                )}
                {place.osmDietVegetarian && (
                  <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                    diet:vegetarian={place.osmDietVegetarian}
                  </code>
                )}
              </div>
            )}

            <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
              {place.source === "osm" ? t("sourceOsm") : t("sourceCommunity")}
            </p>

            <div className="mt-4 space-y-3">
              {!auth.loading && !auth.authConfigured && (
                <p className="rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  {t("readOnlyNotice")}
                </p>
              )}

              {!auth.loading && auth.authConfigured && !signedIn && (
                <Link
                  href="/login"
                  className="block rounded-md border border-green-600 px-3 py-2 text-center text-xs font-semibold text-green-700 hover:bg-green-50 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-950/40"
                >
                  {t("signInToContribute")}
                </Link>
              )}

              {!auth.loading && auth.authConfigured && signedIn && (
                <SubmissionForm
                  key={`${place.id}:${mySubmission?.id ?? "new"}`}
                  placeId={place.id}
                  initialStatus={mySubmission?.status ?? null}
                  initialNote={mySubmission?.note ?? null}
                  onSubmitted={handleChanged}
                />
              )}

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {t("reportsHeading", { count: place.submissions.length })}
                </h3>
                {place.submissions.length === 0 ? (
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    {t("noReports")}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {place.submissions.map((s) => (
                      <SubmissionItem
                        key={s.id}
                        submission={s}
                        signedIn={signedIn}
                        authConfigured={auth.authConfigured}
                        onChanged={handleChanged}
                      />
                    ))}
                  </ul>
                )}
              </div>

              {!auth.loading && signedIn && (
                <FlagButton
                  endpoint={`/api/places/${place.id}/flags`}
                  label={tFlags("reportPlace")}
                />
              )}
            </div>
          </>
        )}

        {loading && !place && !loadFailed && (
          <div className="space-y-2 py-2" aria-hidden>
            <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-20 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
        )}
      </div>
    </section>
  );
}
