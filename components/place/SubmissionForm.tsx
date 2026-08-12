"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { CreateSubmissionBody, VeganStatus } from "@/lib/types";
import { apiErrorMessage } from "@/components/format";

const STATUS_OPTIONS: VeganStatus[] = [
  "fully_vegan",
  "vegan_friendly",
  "not_vegan",
  "closed",
];

/**
 * "Update vegan status" — POST /api/places/:id/submissions.
 * The API upserts the caller's single submission for the place, so this
 * both creates and edits (prefilled from the caller's existing report).
 */
export default function SubmissionForm({
  placeId,
  initialStatus,
  initialNote,
  onSubmitted,
}: {
  placeId: string;
  initialStatus: VeganStatus | null;
  initialNote: string | null;
  onSubmitted: () => void;
}) {
  const t = useTranslations("submissionForm");
  const tStatus = useTranslations("status");
  const tErrors = useTranslations("errors");
  const [status, setStatus] = useState<VeganStatus | null>(initialStatus);
  const [note, setNote] = useState(initialNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!status) {
      setError(t("pickStatus"));
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body: CreateSubmissionBody = {
        status,
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      const res = await fetch(`/api/places/${placeId}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, tErrors));
        return;
      }
      setSaved(true);
      onSubmitted();
    } catch {
      setError(tErrors("network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700"
    >
      <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {initialStatus ? t("titleUpdate") : t("titleNew")}
      </h3>
      <fieldset className="mt-2 grid grid-cols-2 gap-1.5">
        <legend className="sr-only">{t("statusLegend")}</legend>
        {STATUS_OPTIONS.map((opt) => (
          <label
            key={opt}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
              status === opt
                ? "border-green-600 bg-green-50 text-green-800 dark:border-green-500 dark:bg-green-950/50 dark:text-green-300"
                : "border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-600 dark:text-neutral-300"
            }`}
          >
            <input
              type="radio"
              name={`status-${placeId}`}
              value={opt}
              checked={status === opt}
              onChange={() => setStatus(opt)}
              className="size-3 accent-green-600"
            />
            {tStatus(opt)}
          </label>
        ))}
      </fieldset>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        rows={2}
        aria-label={t("noteLabel")}
        placeholder={t("notePlaceholder")}
        className="mt-2 w-full resize-y rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-green-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-400"
      />

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {error}
        </p>
      )}
      {saved && !error && (
        <p
          role="status"
          aria-live="assertive"
          className="mt-2 text-xs font-medium text-green-700 dark:text-green-400"
        >
          {t("saved")}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !status}
        className="mt-2 w-full rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
