# scripts/

## seed-osm.ts — OSM Overpass seed for the launch region

Seeds the ODbL-derived place directory (`places` + `osm_raw`) for the launch
region defined in `lib/region.ts` (currently Seattle). It selects
food-related amenities (`restaurant|cafe|fast_food|ice_cream|bar|pub|food_court`)
that carry a `diet:vegan` or `diet:vegetarian` tag inside the region bbox.

```bash
npm run seed              # import the committed fixture (default; no network)
npm run seed -- --live    # query Overpass, overwrite the fixture, then import
```

- **Idempotent** — upserts keyed on `osm_id`; re-running never duplicates rows.
- Only touches `places` and `osm_raw`. Never overwrites `places.closed` (that
  belongs to the crowd) and never touches submissions/votes/scores.
- Elements without a name or coordinates are skipped from `places` (still
  snapshotted in `osm_raw`) and counted in the summary.

### Fixture

`fixtures/seattle-overpass.json` is the raw Overpass JSON response, committed
so a fresh database can be seeded without any network access. **The current
committed fixture is a hand-written sample** (`"_sample": true` — the script
prints a warning when importing it); replace it with real data by running
`npm run seed -- --live` from a machine with Overpass access.

### Overpass usage policy

Overpass (`overpass-api.de`, fallback `overpass.kumi.systems`) is a shared
public resource. Per PLAN.md, the app **never** calls it at request time —
only this script does, occasionally (one-off per region, or a monthly
re-sync), with a descriptive `User-Agent`. Don't loop it, don't parallelize
it, and back off if it rate-limits you.

### Attribution (ODbL)

The seeded data is © OpenStreetMap contributors, licensed under the
[ODbL](https://www.openstreetmap.org/copyright). Anywhere place data is
displayed must show "© OpenStreetMap contributors", and the place directory
tables (`places`, `osm_raw`) are treated as an ODbL derivative (see PLAN.md
§2A). `osm_raw` preserves the exact imported tags for provenance.

### Refreshing

Run `npm run seed -- --live` (monthly, or when expanding a region), review the
fixture diff, commit it, and re-run plain `npm run seed` in each environment.
