@AGENTS.md

# VeganFind — project context

Community-driven vegan food map (HappyCow alternative), launching Seattle-only. **PLAN.md is the roadmap and the source of truth for architecture decisions — read it before structural changes.** Milestones M1 (read-only map) and M2 (auth/submissions/voting) are built and verified; next up per PLAN.md: M3 (trust & moderation), M4 (launch polish + GDPR package).

## Commands

- `npm run dev` / `npm run build` — predev/prebuild hooks copy MapLibre's worker to `public/maplibre/` (see Gotchas)
- `npm run test` — vitest; `tests/api.test.ts` needs Postgres at `DATABASE_URL` (loads `.env.local`)
- `npm run db:generate` / `db:migrate` — drizzle-kit (schema lives in `lib/db/schema.ts`)
- `npm run seed` — imports the committed Overpass fixture; `npm run seed -- --live` refreshes from the real Overpass API
- `npm run a11y` — axe scan against a running server (default http://localhost:3000); zero serious/critical is the bar
- Verification bar for any change: `npx tsc --noEmit` + `npx eslint .` + `npm run test` + `npm run build` all clean

## Architecture rules (violating these is a bug)

1. **Single data-access path:** every DB read/write goes through a Next.js route handler using Drizzle (`getDb()` from `lib/db`). The browser never touches the DB or Supabase-the-database; Supabase is auth only.
2. **Two data domains, kept separate:** `places`/`osm_raw` are ODbL-derived (OSM) — attribution required wherever shown. `profiles`/`vegan_submissions`/`votes`/`place_scores` are proprietary. Never mix OSM data into the proprietary tables or vice versa.
3. **Canonical keys are our UUIDs.** `osm_id`/`google_place_id` are nullable external refs only.
4. **No job queue.** Scores (Wilson lower bound, `lib/scoring.ts`) recompute synchronously in the same transaction as each write via `recomputePlaceScore` in `lib/db/queries.ts`.
5. **i18n discipline:** no user-visible string is ever hardcoded — everything goes through next-intl `t()` from `messages/en.json` (ICU syntax; dates/numbers via `useFormatter`). This includes aria-labels and error messages. Server API `{error}` strings stay English (developer-facing); the client maps status codes to localized messages.
6. **Accessibility is WCAG 2.1 AA:** jsx-a11y lints at error level; new UI needs keyboard operability, labels, and AA contrast in both light and dark mode. Dialogs use `components/useModalDialog.ts` (focus trap/restore/Escape). The map must never be the only path to data (`PlaceList.tsx` is the accessible alternative).
7. **API contract lives in `lib/types.ts`** — route handlers and UI must both change when it does.

## Gotchas (hard-won, don't rediscover)

- **MapLibre worker:** maplibre-gl v6's separate worker file breaks silently under Turbopack (hashed asset, unrewritten relative import → map renders no data, no console error). Fix = `scripts/copy-maplibre-worker.mjs` (predev/prebuild) + `setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")` in `MapView.tsx`. Don't remove either; `public/maplibre/` is gitignored/generated.
- **`MapView.tsx` stability:** `fetchPlaces` and the map-lifecycle effect must stay referentially stable — props and translators are read via refs (`propsRef`, `tErrorsRef`). Adding reactive deps there remounts the map on every render.
- **Middleware is `proxy.ts`** (Next 16 renamed it). Its matcher excludes `/api`, `/auth`, and dotted paths — the map polls `/api/places` constantly and the magic-link callback is `/auth/callback`; locale-routing either one breaks the app.
- **Read-only mode is a feature:** with Supabase env vars absent, GETs work and write endpoints return 503. Nothing may touch Supabase at import time.
- **Seed fixture is SAMPLE data** (`"_sample": true` marker): Overpass was unreachable from the build sandbox, so `scripts/fixtures/seattle-overpass.json` is hand-written with fabricated OSM ids. Run `npm run seed -- --live` before anything real; a real refresh won't overwrite sample rows (different `osm_id`s) — reset the places tables when switching.
- **No fonts from Google at build time** (system font stack on purpose); `public/map-style-fallback.json` + `NEXT_PUBLIC_MAP_STYLE_URL=/map-style-fallback.json` gives an offline/tile-less map for dev and the a11y scan.
- **Rate limiter is per-instance in-memory** (`lib/rate-limit.ts`) — fine for MVP, replace with Postgres-based limiting before real launch (noted in PLAN.md).

## Environment

`.env.local` (never committed): `DATABASE_URL` (Postgres; migrations + seed + API), `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (optional — enables auth), `NEXT_PUBLIC_MAP_STYLE_URL` (see `.env.example`). Node is pinned by `.nvmrc` (22). Supabase magic links require `<origin>/auth/callback` in the project's auth redirect allowlist.
