import { useTranslations } from "next-intl";
import type { VeganStatus, Verification } from "@/lib/types";

// All pairings meet WCAG AA 4.5:1 for the small badge text:
// green-700/white 5.0, teal-700/white 5.5, gray-500/white 4.8, red-600/white
// 4.8; dark mode: green-500/green-950 6.5, teal-500/teal-950 6.1,
// gray-400/gray-950 7.9, red-400/red-950 6.0.
const BADGE_CLASSES: Record<VeganStatus, string> = {
  fully_vegan:
    "bg-green-700 text-white dark:bg-green-500 dark:text-green-950",
  vegan_friendly:
    "bg-teal-700 text-white dark:bg-teal-500 dark:text-teal-950",
  not_vegan:
    "bg-gray-500 text-white dark:bg-gray-400 dark:text-gray-950",
  closed: "bg-red-600 text-white dark:bg-red-400 dark:text-red-950",
};

/**
 * Status pill + verification line ("Confirmed — 87% confidence" /
 * "Unverified — from OpenStreetMap").
 */
export default function StatusBadge({
  status,
  verification,
  score,
}: {
  status: VeganStatus | null;
  verification: Verification;
  score: number;
}) {
  const tStatus = useTranslations("status");
  const tVerification = useTranslations("verification");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status ? (
        <span
          // Verification is conveyed by the text next to the pill; no opacity
          // fade here — it would drop the badge text below AA contrast.
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE_CLASSES[status]}`}
        >
          {tStatus(status)}
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full border border-gray-400 px-2.5 py-0.5 text-xs font-semibold text-gray-500 dark:border-gray-500 dark:text-gray-400">
          {tStatus("unknown")}
        </span>
      )}
      <span
        className={`text-xs ${
          verification === "confirmed"
            ? "font-medium text-green-700 dark:text-green-400"
            : "text-neutral-500 dark:text-neutral-400"
        }`}
      >
        {verification === "confirmed"
          ? tVerification("confirmed", { confidence: score })
          : tVerification(verification)}
      </span>
    </div>
  );
}
