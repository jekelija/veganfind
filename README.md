# VeganFind

A community-driven map for finding vegan food. Seeded from OpenStreetMap, made trustworthy by crowdsourced votes. Launch region: **Seattle**. See [PLAN.md](./PLAN.md) for the architecture and roadmap.

## Stack

Next.js (App Router, TypeScript) · Drizzle ORM · Postgres (Supabase) · Supabase magic-link auth · MapLibre GL. No separate backend, no job queue — scoring is computed synchronously on write.

## Getting started

```bash
nvm use                       # Node 22, per .nvmrc
npm install
cp .env.example .env.local   # fill in DATABASE_URL (Supabase or local Postgres)
npm run db:migrate            # apply migrations
npm run seed                  # seed Seattle places from the committed OSM fixture
npm run dev
```

Open http://localhost:3000.

- **Read-only mode:** without `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, the map and place details work but sign-in, submissions, and voting are disabled.
- **Fresh OSM data:** `npm run seed -- --live` queries the Overpass API instead of the committed fixture (be considerate — Overpass is a shared resource).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run test` | Unit tests (vitest) |
| `npm run db:generate` | Generate SQL migrations from `lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run seed` | Import Seattle OSM seed data |
| `npm run a11y` | Axe accessibility scan against a running server |

## Data licensing

The place directory (`places`, `osm_raw`) contains data © OpenStreetMap contributors, available under the [ODbL](https://opendatacommons.org/licenses/odbl/). Attribution is rendered wherever place data is shown. User accounts, submissions, votes, and scores are VeganFind's own data and are kept in separate tables (see PLAN.md §2).
