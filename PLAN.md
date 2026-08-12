# VeganFind — Build Plan (v2)

A community-driven map for finding vegan food, launching in **Seattle**. Alternative to HappyCow: seeded from OpenStreetMap, made trustworthy by crowdsourced votes.

This is v2 of the plan. The headline change from v1: **Google Places is out of the MVP entirely.** OSM is the canonical place directory, users add what's missing, and Google can be added later behind an adapter if coverage ever demands it. This removes the Places API bill, the strict caching-compliance data layer, the OSM↔Google entity-resolution pipeline, and most of the legal surface area.

---

## 1. Scope (locked)

- **Region:** Seattle metro at launch. Prove the loop (seed → discover → vote → trust), then expand region by region.
- **Accounts required** for submissions and votes (magic-link auth). No anonymous voting.
- **Web-only PWA.** No native app. Manifest + installability from day one; service worker later.
- **No Google Places at MVP.** OSM + user-added places only.
- **English-only at launch, translation-ready from day one.** All UI copy lives in message files, never hardcoded (see §3a). Adding a language later is a translation task, not a refactor.
- **Accessibility target: WCAG 2.1 AA** (the standard DOJ regulations reference for ADA web compliance). Built in as we go, audited before launch (see §3b).

## 2. Data architecture

Two data domains, kept structurally separate:

### A. Place directory (ODbL-derived, shared-alike, attributed)
Seeded from OSM (names, addresses, coordinates, `diet:*` tags — all storable, unlike Google data) plus user-added places. Because it contains substantial OSM content, treat this whole table as an ODbL derivative: display "© OpenStreetMap contributors" wherever it's shown, and be prepared to share the *place directory* under ODbL. That's a commodity restaurant list — an acceptable price for dropping Google.

### B. Proprietary layer (fully yours — the moat)
User accounts, vegan-status submissions, votes, flags, trust scores, computed confidence scores. Never mixed into the OSM-derived tables.

### Schema principles

- **Canonical key is our own UUID.** `osm_id` and (future) `google_place_id` are nullable, unique, external-reference columns. Never key the database on someone else's identifier.
- **No PostGIS at MVP.** Map queries are viewport bbox queries — `lat BETWEEN … AND lng BETWEEN …` with a composite index is plenty at metro scale, and keeps local dev/testing on plain Postgres. Add PostGIS later only if radius/nearest-neighbor search demands it.
- **Closures are first-class.** Restaurants close constantly. `places.closed` flag + a "report closed" submission type, so dead pins get cleaned up by the crowd.
- **One active submission per (place, user)** enforced by a unique constraint.
- **`osm_raw` snapshot table** preserves exactly what was imported (provenance for ODbL, and re-sync diffing).

### Tables (Drizzle ORM, Postgres)

- `places` — id (uuid pk), osm_id (unique, nullable), google_place_id (unique, nullable, future), name, address, lat, lng, source ('osm' | 'user'), osm_diet_vegan / osm_diet_vegetarian (seed signal), closed, created_at, updated_at. Composite index on (lat, lng).
- `osm_raw` — osm_id pk, raw tags jsonb, imported_at.
- `profiles` — id (uuid pk = Supabase auth user id), email, trust_score, banned, created_at.
- `vegan_submissions` — id, place_id, user_id, status ('fully_vegan' | 'vegan_friendly' | 'not_vegan' | 'closed'), note, created_at. Unique (place_id, user_id).
- `votes` — id, submission_id, user_id, value (-1|1), created_at. Unique (submission_id, user_id).
- `place_scores` — place_id pk, status (winning status), score (Wilson lower bound), submission_count, vote_count, updated_at.

### Scoring — synchronous, no job queue

Wilson lower-bound confidence per place, recomputed **in the same transaction as each submission/vote write**. It's one place's handful of votes — microseconds. No Redis, no BullMQ, no pg_cron. The only scheduled work in the whole system is OSM re-sync, which is a script run manually (or monthly) per region.

Display framing: OSM seed signal renders as **"unverified"**, crowd-confirmed statuses render as **"confirmed"** — visually distinct, which also solves cold start (the map is never empty).

## 3. Stack (one app, one deploy, ~$0/month at MVP)

| Layer | Choice |
|---|---|
| App | Next.js (App Router, TypeScript) — pages **and** API route handlers; no separate backend |
| ORM | Drizzle + drizzle-kit migrations |
| DB + Auth | Supabase (hosted Postgres + magic-link auth). RLS as defense-in-depth backstop; all writes go through server route handlers |
| Map | MapLibre GL + MapTiler free tier (tile URL env-configurable; Protomaps/PMTiles on R2 as the $0 fallback) |
| Search/geocode | Photon (Komoot) — free, OSM-based, same license domain |
| Seed data | OSM Overpass API — one-off ingest script per region, cached fixture committed to repo, never called from the app at request time |
| Hosting | Vercel (free tier) |

**Single data-access path:** every write goes through a Next.js route handler using Drizzle with the service-role connection. The browser never writes to the database directly. This is the rule that keeps the codebase consistent.

**Toolchain pinning:** `.nvmrc` (Node 22) + `engines` in package.json, so every machine runs the same Node (and therefore the same bundled npm). Use `nvm use` before working.

## 3a. Internationalization (cross-cutting, from day one)

- **Library: next-intl** with `app/[locale]/` segment routing — locale in the URL path is the SEO-friendly shape, and moving routes under `[locale]` is cheap now and painful later.
- **The rule that matters:** no user-visible string is ever hardcoded in a component. Everything goes through `t()` from `messages/en.json`. English is the only locale at launch; the discipline is the deliverable.
- Dates, times ("2 days ago"), and numbers via `Intl`/next-intl formatters, never hand-assembled strings.
- **Not translated:** user-generated content (submission notes) and place names. Place names can later use OSM's `name:<lang>` tags where present — another quiet win of the OSM-canonical decision.
- Locale negotiation: default from `Accept-Language`, overridable, persisted in a cookie (strictly necessary — no consent implications).

## 3b. Accessibility / ADA (cross-cutting, target WCAG 2.1 AA)

- **The map cannot be the only way in.** A keyboard- and screen-reader-accessible list view of the places in the current viewport is a first-class UI, not an afterthought — it's also better on mobile and crawlable.
- Keyboard + focus: detail panel and forms are fully keyboard-operable; focus moves into the panel on open, returns on close, Escape closes; visible focus rings throughout.
- ARIA: labeled controls, `aria-live` for async updates (places loaded, errors, submission results), correct roles on the legend/filter/sheet.
- Color is never the sole carrier of meaning: confirmed-vs-unverified and status are always paired with text labels, not just fill/opacity.
- Contrast: all text and status colors checked against AA ratios in both light and dark mode.
- Enforcement: `eslint-plugin-jsx-a11y` in the lint config from now on; an axe automated scan plus a manual keyboard/screen-reader pass is a launch gate in M4.

## 4. Milestones (map first)

**M1 — Read-only map (deployable demo)**
Scaffold, schema + migrations, Seattle Overpass seed script + committed fixture, MapLibre map with clustered/color-coded markers, fully-vegan vs vegan-friendly filter, place detail panel, OSM + tile attribution.

**M2 — Community layer**
Supabase magic-link auth, submission form (status + note, incl. "report closed"), voting UI, synchronous Wilson scoring, confirmed-vs-unverified rendering, user-added places.

**M3 — Trust & moderation (before public launch)**
Rate limits per user/IP, new-account vote-weight dampening, flag button + lightweight admin review queue. In a single small metro, human review of all submissions initially beats clever algorithms.

**M4 — Launch polish**
PWA manifest + service worker, deploy docs, Photon search box, accessibility launch gate (axe scan + manual keyboard/screen-reader pass), and the GDPR package:

- **Privacy policy page** (`/[locale]/privacy`): what we store (email, submissions, votes), why (running the service — legitimate interest/contract), how long, and who processes it (Supabase, hosting provider).
- **Right to erasure:** `DELETE /api/me` — deletes the user's votes and submissions, recomputes affected place scores, deletes the profile row and the Supabase auth user. Hard delete, not anonymization: submission notes can contain personal data, and losing a user's raw votes is an acceptable cost for a clean erasure story.
- **Right to access/portability:** `GET /api/me/export` — the user's profile, submissions, and votes as JSON.
- **Cookie posture:** auth + locale cookies only (strictly necessary — no consent banner required). If analytics are ever added, use a cookieless option or add consent at that point, not before.
- **Processor hygiene:** pick Supabase's EU region if EU users are expected, and accept the Supabase + host DPAs. The rate limiter's IP keys are transient in-memory only — document that they're never persisted.

## 5. Pitfalls carried forward from v1 (still true)

- **Vote manipulation** is the biggest product threat: accounts required, Wilson interval (not raw counts), vote-weight dampening for new accounts, rate limits, flags. M3 is not optional before launch.
- **Overpass usage policy:** it's a shared public resource. Ingest via one-off scripts, cache results as fixtures, never call it per-request.
- **Attribution isn't optional:** "© OpenStreetMap contributors" wherever place data shows; tile-provider attribution on the map. Baked into the map component, not bolted on.
- **GDPR:** you're a data controller for user data. Privacy policy, lawful basis, working deletion + export paths (concrete deliverables in M4).
- **If Google Places is ever added:** own-UUID keys make it a nullable column + adapter, not a migration. Re-read the then-current Places ToS before building it; live-fetch only, never persist beyond what's permitted.
- **Read the current ODbL / Overpass terms** before public launch rather than relying on this summary.
