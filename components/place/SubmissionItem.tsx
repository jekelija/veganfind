"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { SubmissionView, CreateVoteBody } from "@/lib/types";
import { STATUS_TEXT_CLASSES, apiErrorMessage } from "@/components/format";

function ArrowIcon({ up }: { up: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`size-3 ${up ? "" : "rotate-180"}`}
      aria-hidden
      fill="currentColor"
    >
      <path d="M6 2 L10.5 8.5 L1.5 8.5 Z" />
    </svg>
  );
}

/**
 * One community report: status, note, relative time, vote counts.
 * Signed in: vote buttons (disabled on isMine, myVote highlighted).
 * Signed out (auth configured): counts link to /login.
 * Read-only mode: static counts.
 */
export default function SubmissionItem({
  submission,
  signedIn,
  authConfigured,
  onChanged,
}: {
  submission: SubmissionView;
  signedIn: boolean;
  authConfigured: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("votes");
  const tStatus = useTranslations("status");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function vote(value: 1 | -1) {
    setBusy(true);
    setError(null);
    try {
      const body: CreateVoteBody = { value };
      const res = await fetch(`/api/submissions/${submission.id}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, tErrors));
        return;
      }
      onChanged();
    } catch {
      setError(tErrors("network"));
    } finally {
      setBusy(false);
    }
  }

  const canVote = signedIn && !submission.isMine;

  const createdAt = new Date(submission.createdAt);
  const createdAtLabel = Number.isNaN(createdAt.getTime())
    ? ""
    : format.relativeTime(createdAt);

  const counts = (
    <>
      <span className="inline-flex items-center gap-1">
        <ArrowIcon up />
        <span className="sr-only">{t("upvotesLabel")} </span>
        {format.number(submission.upvotes)}
      </span>
      <span className="inline-flex items-center gap-1">
        <ArrowIcon up={false} />
        <span className="sr-only">{t("downvotesLabel")} </span>
        {format.number(submission.downvotes)}
      </span>
    </>
  );

  return (
    <li className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/60">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span
            className={`text-xs font-bold ${STATUS_TEXT_CLASSES[submission.status]}`}
          >
            {tStatus(submission.status)}
          </span>
          {submission.isMine && (
            <span className="ml-2 rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
              {t("yourReport")}
            </span>
          )}
          {submission.note && (
            <p className="mt-1 break-words text-sm text-neutral-700 dark:text-neutral-300">
              {submission.note}
            </p>
          )}
          <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            {createdAtLabel}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
          {canVote ? (
            <>
              <button
                type="button"
                onClick={() => vote(1)}
                disabled={busy || submission.myVote === 1}
                aria-label={t("agreeWithCount", { count: submission.upvotes })}
                aria-pressed={submission.myVote === 1}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-semibold transition-colors disabled:cursor-not-allowed ${
                  submission.myVote === 1
                    ? "border-green-600 bg-green-600 text-white"
                    : "border-neutral-300 hover:border-green-600 hover:text-green-700 dark:border-neutral-600 dark:hover:text-green-400"
                }`}
              >
                <ArrowIcon up /> {format.number(submission.upvotes)}
              </button>
              <button
                type="button"
                onClick={() => vote(-1)}
                disabled={busy || submission.myVote === -1}
                aria-label={t("disagreeWithCount", {
                  count: submission.downvotes,
                })}
                aria-pressed={submission.myVote === -1}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-semibold transition-colors disabled:cursor-not-allowed ${
                  submission.myVote === -1
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-neutral-300 hover:border-red-600 hover:text-red-700 dark:border-neutral-600 dark:hover:text-red-400"
                }`}
              >
                <ArrowIcon up={false} /> {format.number(submission.downvotes)}
              </button>
            </>
          ) : !signedIn && authConfigured ? (
            <Link
              href="/login"
              title={t("signInToVote")}
              className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-2 py-1 hover:border-green-600 hover:text-green-700 dark:border-neutral-600 dark:hover:text-green-400"
            >
              {counts}
            </Link>
          ) : (
            <span className="inline-flex items-center gap-2 px-2 py-1">
              {counts}
            </span>
          )}
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </li>
  );
}
