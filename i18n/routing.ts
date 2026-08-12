import { defineRouting } from "next-intl/routing";

/**
 * Locale-segment routing (PLAN.md §3a). English-only at launch; adding a
 * locale later means adding it here + a messages/<locale>.json file.
 * `as-needed` keeps the default locale unprefixed, so `/` and `/login`
 * continue to work exactly as before.
 */
export const routing = defineRouting({
  locales: ["en"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});
