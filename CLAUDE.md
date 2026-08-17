@AGENTS.md

# VeganFind — project context

Community-driven vegan food map (HappyCow alternative), launching Seattle-only. **PLAN.md is the roadmap and the source of truth for architecture decisions — read it before structural changes.** Milestones M1 (read-only map), M2 (auth/submissions/voting), and M3 (trust & moderation: vote-weight dampening, flags + admin review queue at `/[locale]/admin`, Postgres-backed rate limiting) are built and verified; next up per PLAN.md: M4 (launch polish + GDPR package).

## Commands

- `npm run dev` / `npm run build` — predev/prebuild hooks copy MapLibre's worker to `public/maplibre/` (see Gotchas)
- `npm run test` — vitest; boots a throwaway embedded Postgres (`tests/global-setup.ts`), migrates it, and points `DATABASE_URL` at it. Tests never read `.env.local` and must never touch the real database — keep it that way when adding suites. `TEST_DATABASE_URL` (db name must contain "test") is the escape hatch for an externally managed test DB.
- `npm run db:generate` / `db:migrate` — drizzle-kit (schema lives in `lib/db/schema.ts`)
- `npm run seed` — imports the committed Overpass fixture; `npm run seed -- --live` refreshes from the real Overpass API
- `npm run a11y` — axe scan against a running server (default http://localhost:3000); zero serious/critical is the bar
- Verification bar for any change: `npx tsc --noEmit` + `npx eslint .` + `npm run test` + `npm run build` all clean — CI (`.github/workflows/ci.yml`) runs exactly this on every push/PR

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
- **Rate limiter is Postgres-backed** (`lib/rate-limit.ts` + `rate_limit_events` table, 30 writes/hour/key): `rateLimitResponse` is async — new write handlers must `await` it, or the truthy Promise 429s every request.
- **Admin is granted manually** (`update profiles set is_admin = true where email = '…'`) — no self-service path on purpose. Admin routes gate on `requireAdmin` in `lib/auth/server.ts`; the queue UI at `/[locale]/admin` handles 401/403 as a "not authorized" state.
- **Moderation deletes have ordering rules**: resolve open flags *before* deleting a flagged submission (the FK sets `flags.submission_id` null, and only resolved rows are exempt from the one-open-flag partial unique indexes); on place removal delete flags explicitly first for the same reason. See `app/api/admin/flags/[id]/route.ts`.

## Environment

`.env.local` (never committed): `DATABASE_URL` (Postgres; migrations + seed + API), `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (optional — enables auth), `NEXT_PUBLIC_MAP_STYLE_URL` (see `.env.example`). Node is pinned by `.nvmrc` (22). Supabase magic links require `<origin>/auth/callback` in the project's auth redirect allowlist.

### Supabase connection architecture

- `DATABASE_URL` is the **Transaction pooler** URI (`aws-…pooler.supabase.com:6543`) — the app is serverless (Vercel), which is what transaction mode is for, and it works over IPv4. Transaction mode does NOT support prepared statements; `lib/db/index.ts` sets `prepare: false` for exactly this reason — don't remove it, and don't switch drivers to one that prepares by default.
- Direct connection (`db.<ref>.supabase.co:5432`) is for persistent servers and is IPv6-only without a paid add-on — not our default. The Session pooler (same pooler host, port 5432) is only the IPv4 stand-in for direct.
- **Wrinkle — migrations/DDL:** Supabase recommends the direct connection for DDL tooling. `drizzle-kit migrate` works through the transaction pooler in practice at this schema size, but if a migration hangs or errors on port 6543, re-run that one command with the Session pooler string (port 5432, prepared statements supported) rather than changing `DATABASE_URL` or buying the IPv4 add-on.
- Dashboard posture (deliberate, matches the single data-access path rule): **Data API (PostgREST) disabled**, auto-expose new tables off, **automatic RLS on** (deny-by-default backstop; our own connection is unaffected because the connecting role owns the tables and owners bypass RLS).
