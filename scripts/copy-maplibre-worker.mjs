/**
 * Copies MapLibre GL's web-worker module (and the shared chunk it imports)
 * into public/maplibre/ so it can be served unhashed.
 *
 * Why: maplibre-gl v6 ships its worker as a separate ESM file that imports
 * "./maplibre-gl-shared.mjs" relatively. Turbopack emits both files under
 * hashed names but does not rewrite the worker's relative import, so the
 * import 404s and the worker never boots — the map silently renders no data.
 * We sidestep the bundler entirely: these copies are served verbatim and
 * MapView points MapLibre at them via setWorkerUrl().
 *
 * Runs automatically via the predev/prebuild npm scripts, so the copies
 * stay in sync with the installed maplibre-gl version. public/maplibre/ is
 * gitignored (generated).
 */
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)); // scripts/
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const out = join(root, "..", "public", "maplibre");

mkdirSync(out, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  cpSync(join(dist, f), join(out, f));
}
console.log(`[copy-maplibre-worker] copied worker files to public/maplibre/`);
