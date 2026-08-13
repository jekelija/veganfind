"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { CreateFlagBody, FlagReason } from "@/lib/types";
import { apiErrorMessage } from "@/components/format";

const REASON_OPTIONS: FlagReason[] = ["incorrect", "spam", "abuse", "other"];

/**
 * "Report" disclosure (M3): a small toggle that expands into an inline
 * reason + note form and POSTs to the given flag endpoint
 * (/api/places/:id/flags or /api/submissions/:id/flags). The server is
 * idempotent per open (target, user), so re-reports are harmless.
 * Render only for signed-in users.
 */
export default function FlagButton({
  endpoint,
  label,
}: {
  endpoint: string;
  /** Localized toggle text, e.g. t("reportSubmission"). */
  label: string;
}) {
  const t = useTranslations("flags");
  const tErrors = useTranslations("errors");
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FlagReason>("incorrect");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: CreateFlagBody = {
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, tErrors));
        return;
      }
      setDone(true);
      setOpen(false);
    } catch {
      setError(tErrors("network"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p
        role="status"
        className="mt-1 text-[11px] font-medium text-green-700 dark:text-green-400"
      >
        {t("thanks")}
      </p>
    );
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={formId}
        className="text-[11px] font-medium text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-red-700 dark:text-neutral-400 dark:hover:text-red-400"
      >
        {label}
      </button>

      {open && (
        <form
          id={formId}
          onSubmit={handleSubmit}
          className="mt-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-700"
        >
          <label className="block text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">
            {t("reasonLabel")}
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as FlagReason)}
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 focus:border-green-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            >
              {REASON_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {t(`reasons.${r}`)}
                </option>
              ))}
            </select>
          </label>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            aria-label={t("noteLabel")}
            placeholder={t("notePlaceholder")}
            className="mt-2 w-full resize-y rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 placeholder:text-neutral-500 focus:border-green-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-400"
          />

          {error && (
            <p
              role="alert"
              className="mt-1 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-950/60 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-red-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? t("submitting") : t("submit")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:border-neutral-400 dark:border-neutral-600 dark:text-neutral-300"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
