"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { CreatePlaceBody, PlaceSummary } from "@/lib/types";
import { apiErrorMessage } from "@/components/format";
import { useModalDialog } from "@/components/useModalDialog";

const TITLE_ID = "add-place-title";

/**
 * Small card shown after the user drops a pin in add mode.
 * POST /api/places {name, lat, lng, address?} per the contract.
 */
export default function AddPlaceForm({
  location,
  onCancel,
  onSaved,
}: {
  location: { lng: number; lat: number };
  onCancel: () => void;
  onSaved: (place: PlaceSummary) => void;
}) {
  const t = useTranslations("addPlace");
  const tErrors = useTranslations("errors");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dialog focus behavior: focus moves to the name field on open, Tab cycles
  // inside, Escape cancels, focus returns to the opener on close.
  const dialogRef = useModalDialog<HTMLFormElement>(onCancel);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("nameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const body: CreatePlaceBody = {
      name: trimmedName,
      lat: location.lat,
      lng: location.lng,
      ...(address.trim() ? { address: address.trim() } : {}),
    };
    try {
      const res = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, tErrors));
        return;
      }
      const data = (await res.json()) as { place: PlaceSummary };
      onSaved(data.place);
    } catch {
      setError(tErrors("network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      ref={dialogRef}
      onSubmit={handleSubmit}
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      tabIndex={-1}
      className="pointer-events-auto absolute inset-x-3 bottom-3 z-20 rounded-xl border border-neutral-200 bg-white/95 p-4 shadow-xl backdrop-blur md:inset-x-auto md:bottom-auto md:right-3 md:top-16 md:w-80 dark:border-neutral-700 dark:bg-neutral-900/95"
    >
      <h2
        id={TITLE_ID}
        className="text-sm font-bold text-neutral-900 dark:text-neutral-100"
      >
        {t("title")}
      </h2>
      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
        {t("pinAt", { lat: location.lat, lng: location.lng })}
      </p>

      <label className="mt-3 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
        {t("nameLabel")}
        <span className="text-red-500"> {t("requiredMark")}</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          placeholder={t("namePlaceholder")}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-green-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-400"
        />
      </label>

      <label className="mt-2 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
        {t("addressLabel")}{" "}
        <span className="font-normal text-neutral-500 dark:text-neutral-400">
          {t("optionalMark")}
        </span>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={300}
          placeholder={t("addressPlaceholder")}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-green-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-400"
        />
      </label>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {t("cancel")}
        </button>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
