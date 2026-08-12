import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

/**
 * next-intl locale negotiation for UI routes only (Next 16 proxy — the
 * successor of middleware.ts).
 *
 * The matcher deliberately excludes everything that must never be
 * locale-routed or rewritten:
 * - /api/**           — JSON route handlers (the map polls /api/places)
 * - /auth/**          — magic-link callback (/auth/callback)
 * - /_next, /_vercel  — framework internals
 * - any path with a dot — static files (favicon.ico, /maplibre/*.mjs, …)
 */
export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
