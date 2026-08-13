"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type {
  AdminFlagView,
  AdminFlagsResponse,
  FlagAction,
  ResolveFlagBody,
} from "@/lib/types";
import { STATUS_TEXT_CLASSES, apiErrorMessage } from "@/components/format";

type QueueState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "ready"; flags: AdminFlagView[] };

/**
 * Moderation queue (M3): open flags oldest-first, one card each, with the
 * moderation actions the API offers. All data comes from /api/admin/flags;
 * 401/403 render the not-authorized state instead of the queue.
 */
export default function AdminQueue() {
  const t = useTranslations("admin");
  const tReasons = useTranslations("flags.reasons");
  const tStatus = useTranslations("status");
  const tErrors = useTranslations("errors");
  const format = useFormatter();

  const [state, setState] = useState<QueueState>({ kind: "loading" });
  const [busyFlagId, setBusyFlagId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Bumped (from event handlers) to refetch — same pattern as
  // PlaceDetailPanel; the effect itself only reacts to external data.
  const [fetchNonce, setFetchNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/flags")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setState({ kind: "forbidden" });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as AdminFlagsResponse;
        if (!cancelled) setState({ kind: "ready", flags: data.flags });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [fetchNonce]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setFetchNonce((n) => n + 1);
  }, []);

  async function act(flag: AdminFlagView, action: FlagAction) {
    if (action === "ban_author" && !window.confirm(t("confirmBanAuthor"))) {
      return;
    }
    if (action === "remove_place" && !window.confirm(t("confirmRemovePlace"))) {
      return;
    }
    setBusyFlagId(flag.id);
    setActionError(null);
    try {
      const body: ResolveFlagBody = { action };
      const res = await fetch(`/api/admin/flags/${flag.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setActionError(await apiErrorMessage(res, tErrors));
        return;
      }
      setAnnouncement(t("actionDone"));
      // Silent refetch — keep the current list on screen until data lands.
      setFetchNonce((n) => n + 1);
    } catch {
      setActionError(tErrors("network"));
    } finally {
      setBusyFlagId(null);
    }
  }

  const actionButton = (
    flag: AdminFlagView,
    action: FlagAction,
    label: string,
    destructive: boolean,
  ) => (
    <button
      type="button"
      onClick={() => act(flag, action)}
      disabled={busyFlagId !== null}
      className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        destructive
          ? "border-red-300 text-red-700 hover:border-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
          : "border-neutral-300 text-neutral-700 hover:border-neutral-500 dark:border-neutral-600 dark:text-neutral-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {t("title")}
      </h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
        {t("subtitle")}
      </p>

      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <div className="mt-6">
        {state.kind === "loading" && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {t("loading")}
          </p>
        )}

        {state.kind === "forbidden" && (
          <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
            {t("forbidden")}
          </p>
        )}

        {state.kind === "error" && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300"
          >
            {t("loadError")}{" "}
            <button
              type="button"
              onClick={retry}
              className="font-semibold underline"
            >
              {t("retry")}
            </button>
          </p>
        )}

        {state.kind === "ready" && (
          <>
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              {t("queueCount", { count: state.flags.length })}
            </p>
            {state.flags.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
                {t("empty")}
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {state.flags.map((flag) => {
                  const createdAt = new Date(flag.createdAt);
                  return (
                    <li
                      key={flag.id}
                      className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                          {flag.place.name}
                        </h2>
                        <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                          {Number.isNaN(createdAt.getTime())
                            ? ""
                            : format.relativeTime(createdAt)}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                          {flag.submission
                            ? t("flaggedSubmission")
                            : t("flaggedPlace")}
                        </span>
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                          {flag.place.source === "osm"
                            ? t("sourceOsm")
                            : t("sourceUser")}
                        </span>
                        {flag.place.closed && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
                            {t("closedBadge")}
                          </span>
                        )}
                      </div>

                      <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">
                        <span className="font-semibold">
                          {tReasons(flag.reason)}
                        </span>
                        {flag.note && <> — {flag.note}</>}
                      </p>
                      <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                        {t("reportedBy", {
                          email: flag.reporterEmail ?? t("unknownUser"),
                        })}
                      </p>

                      {flag.submission && (
                        <div className="mt-2 rounded-md bg-neutral-50 p-2.5 dark:bg-neutral-800/60">
                          <p className="text-xs">
                            <span
                              className={`font-bold ${STATUS_TEXT_CLASSES[flag.submission.status]}`}
                            >
                              {tStatus(flag.submission.status)}
                            </span>
                            {flag.submission.note && (
                              <span className="text-neutral-700 dark:text-neutral-300">
                                {" "}
                                — {flag.submission.note}
                              </span>
                            )}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                            {t("authorLabel", {
                              email:
                                flag.submission.authorEmail ??
                                t("unknownUser"),
                            })}
                            {flag.submission.authorBanned && (
                              <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
                                {t("authorBanned")}
                              </span>
                            )}
                          </p>
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {actionButton(flag, "dismiss", t("actionDismiss"), false)}
                        {flag.submission && (
                          <>
                            {actionButton(
                              flag,
                              "remove_submission",
                              t("actionRemoveSubmission"),
                              true,
                            )}
                            {!flag.submission.authorBanned &&
                              actionButton(
                                flag,
                                "ban_author",
                                t("actionBanAuthor"),
                                true,
                              )}
                          </>
                        )}
                        {!flag.submission &&
                          flag.place.source === "user" &&
                          actionButton(
                            flag,
                            "remove_place",
                            t("actionRemovePlace"),
                            true,
                          )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {actionError && (
          <p
            role="alert"
            className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300"
          >
            {actionError}
          </p>
        )}
      </div>

      <Link
        href="/"
        className="mt-8 inline-block text-sm text-emerald-700 underline dark:text-emerald-400"
      >
        {t("backToMap")}
      </Link>
    </div>
  );
}
