#!/usr/bin/env node
/**
 * Bundle budget gate.
 *
 * Next already writes per-route first-load byte counts to
 * `.next/diagnostics/route-bundle-stats.json`. Nothing asserted on them, so a
 * dependency or a static import could add tens of kilobytes to every visitor
 * and no CI step would notice. This turns that output into a hard gate.
 *
 * Budgets are raw (uncompressed) first-load JS per route. The `/` number moved
 * 743,962 -> 667,307 when `qrcode` became a dynamic import, so the ceiling is
 * set just above the current size: enough headroom for ordinary churn, tight
 * enough to catch a regression that adds a real dependency.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STATS = join(process.cwd(), ".next", "diagnostics", "route-bundle-stats.json");

/** route -> max first-load JS in bytes */
const BUDGETS = {
  "/": 720_000,
  "/settings": 560_000,
  "/s/[code]": 520_000,
};

let stats;
try {
  stats = JSON.parse(readFileSync(STATS, "utf8"));
} catch {
  console.error(`bundle-budget: cannot read ${STATS} — run the build first.`);
  process.exit(1);
}

const byRoute = new Map(stats.map((row) => [row.route, row.firstLoadUncompressedJsBytes]));
let failed = false;

for (const [route, budget] of Object.entries(BUDGETS)) {
  const actual = byRoute.get(route);
  if (typeof actual !== "number") {
    console.warn(`bundle-budget: ${route} not in build output, skipping.`);
    continue;
  }
  const pct = ((actual / budget) * 100).toFixed(1);
  const over = actual > budget;
  if (over) failed = true;
  const verdict = over ? "OVER" : "ok";
  console.log(
    `bundle-budget: ${route.padEnd(12)} ${String(actual).padStart(9)} B / ${String(budget).padStart(9)} B  (${pct}%)  ${verdict}`,
  );
}

if (failed) {
  console.error(
    "\nbundle-budget: a route exceeded its first-load JS budget.\n" +
      "Check for a newly static import (use a dynamic import for\n" +
      "dialog-only or on-demand code) before raising the ceiling.",
  );
  process.exit(1);
}
