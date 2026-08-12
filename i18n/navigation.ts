import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Locale-aware drop-ins for Next's navigation APIs. Always link internal
 * pages with these (not next/link), so hrefs pick up the locale prefix
 * automatically once more locales exist.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
