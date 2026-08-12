import type { VeganStatus } from "@/lib/types";

/** Map filter — "all" sends no &filter= param; the others map 1:1 to the API. */
export type StatusFilter = "all" | "fully_vegan" | "vegan_friendly";

export const STATUS_COLORS: Record<VeganStatus, string> = {
  fully_vegan: "#16a34a",
  vegan_friendly: "#0d9488",
  not_vegan: "#6b7280",
  closed: "#dc2626",
};

/** Fill used for places with no status at all (outline-only markers). */
export const UNKNOWN_STROKE = "#9ca3af";

/**
 * AA-contrast text colors for status labels rendered on light card
 * backgrounds (light mode) / dark cards (dark mode). The raw marker colors
 * in {@link STATUS_COLORS} are tuned for map fills, not small text — e.g.
 * #16a34a on white is ~3.3:1, below the 4.5:1 AA minimum.
 */
export const STATUS_TEXT_CLASSES: Record<VeganStatus, string> = {
  fully_vegan: "text-green-700 dark:text-green-400",
  vegan_friendly: "text-teal-700 dark:text-teal-400",
  not_vegan: "text-gray-600 dark:text-gray-300",
  closed: "text-red-700 dark:text-red-400",
};

/**
 * Message keys in the `errors` namespace used by {@link apiErrorMessage}.
 * A `useTranslations("errors")` translator satisfies this shape.
 */
export type ErrorsTranslator = (
  key: "unauthenticated" | "rateLimited" | "readOnly" | "generic",
) => string;

/**
 * Turn a non-2xx response into a friendly inline message.
 * Contract: errors carry { error: string }; 401 unauthenticated,
 * 429 rate-limited, 503 read-only (auth not configured).
 *
 * Server `{ error }` strings are developer-facing English by contract and
 * are only shown as a last resort; the status-mapped messages are localized
 * via the passed-in `errors` translator.
 */
export async function apiErrorMessage(
  res: Response,
  t: ErrorsTranslator,
): Promise<string> {
  let serverMessage = "";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") serverMessage = body.error;
  } catch {
    // body wasn't JSON — fall through to status-based messages
  }
  switch (res.status) {
    case 401:
      return t("unauthenticated");
    case 429:
      return t("rateLimited");
    case 503:
      return t("readOnly");
    default:
      return serverMessage || t("generic");
  }
}
