#!/usr/bin/env node
/**
 * Automated axe-core accessibility scan (PLAN.md §3b launch gate).
 *
 * Scans four UI states against a running server (BASE_URL, default
 * http://localhost:3000):
 *   1. `/` — the map view (waits for the map UI + first places load)
 *   2. the list view (after clicking the Map/List toggle)
 *   3. the place detail panel (after activating a list item, if any)
 *   4. `/login`
 *
 * Prints all violations and exits non-zero if any `serious` or `critical`
 * violation is found. Run with: npm run a11y
 *
 * Not wired into the build on purpose — it needs a live server and a
 * seeded database.
 */

import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const FAIL_IMPACTS = new Set(["serious", "critical"]);
const NAV_TIMEOUT = 60_000;

function launchOptions() {
  const options = { args: ["--no-sandbox"] };
  // Prefer the preinstalled chromium when available — the browsers under
  // PLAYWRIGHT_BROWSERS_PATH may not match the installed playwright version.
  // Elsewhere (no such path), plain chromium.launch() uses Playwright's own
  // managed browser.
  if (existsSync("/opt/pw-browsers/chromium")) {
    options.executablePath = "/opt/pw-browsers/chromium";
  }
  return options;
}

/** Run axe on the page's current state and stash the violations. */
async function scan(page, label, results) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  results.push({ label, violations });
  const gating = violations.filter((v) => FAIL_IMPACTS.has(v.impact));
  console.log(
    `\n=== ${label}: ${violations.length} violation type(s), ${gating.length} serious/critical ===`,
  );
  for (const v of violations) {
    console.log(`\n  [${v.impact}] ${v.id}: ${v.help}`);
    console.log(`    ${v.helpUrl}`);
    for (const node of v.nodes.slice(0, 5)) {
      console.log(`    - ${node.target.join(" ")}`);
      console.log(`      ${node.html.slice(0, 160)}`);
    }
    if (v.nodes.length > 5) console.log(`    … and ${v.nodes.length - 5} more`);
  }
}

async function main() {
  const browser = await chromium.launch(launchOptions());
  // @axe-core/playwright requires a page from an explicit browser context.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  const results = [];

  try {
    // --- 1. Map view -------------------------------------------------------
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="application"]');
    // The Map/List toggle appears with the map shell; the OSM attribution
    // notice only renders after the first successful places fetch.
    const listToggle = page.getByRole("button", { name: "Show list view" });
    await listToggle.waitFor();
    await page
      .getByText("© OpenStreetMap contributors")
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => {
        console.warn("warn: places never loaded — scanning the map shell anyway");
      });
    await scan(page, "map view (/)", results);

    // --- 2. List view ------------------------------------------------------
    await listToggle.click();
    await page.getByRole("region", { name: "Places in view" }).waitFor();
    await scan(page, "list view open", results);

    // --- 3. Detail panel (if the viewport has places) -----------------------
    const firstItem = page
      .getByRole("region", { name: "Places in view" })
      .locator("ul li button")
      .first();
    if ((await firstItem.count()) > 0) {
      await firstItem.click();
      await page.getByRole("dialog").waitFor();
      await scan(page, "place detail panel open", results);
    } else {
      console.warn("warn: no places in the list — skipping detail panel scan");
    }

    // --- 4. Login page ------------------------------------------------------
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1 }).waitFor();
    await scan(page, "login page (/login)", results);
  } finally {
    await browser.close();
  }

  const gating = results.flatMap(({ label, violations }) =>
    violations
      .filter((v) => FAIL_IMPACTS.has(v.impact))
      .map((v) => `${label}: [${v.impact}] ${v.id}`),
  );

  console.log("\n----------------------------------------");
  if (gating.length > 0) {
    console.error(`FAIL — ${gating.length} serious/critical violation(s):`);
    for (const g of gating) console.error(`  ${g}`);
    process.exit(1);
  }
  console.log("PASS — no serious/critical violations in any scanned state.");
}

main().catch((err) => {
  console.error("a11y scan failed to run:", err);
  process.exit(1);
});
