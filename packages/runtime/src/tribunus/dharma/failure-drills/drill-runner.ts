/**
 * Track G — Failure Drills: Drill Runner
 *
 * Registry and executor for failure-drill scenarios.  Producers register
 * scenario functions by DrillKind; the runner invokes them in sequence
 * or individually and collects results.
 *
 * All functions are pure — no side effects, no I/O.
 */

import type { DrillKind, DrillResult } from "./drill-types"

// ── Drill Runner ------------------------------------------------------------

export interface DrillRunner {
  drills: Map<DrillKind, { run: () => DrillResult }>
}

// ── Factory -----------------------------------------------------------------

export function createDrillRunner(): DrillRunner {
  return { drills: new Map() }
}

// ── Registration ------------------------------------------------------------

export function registerDrill(
  runner: DrillRunner,
  kind: DrillKind,
  runFn: () => DrillResult,
): DrillRunner {
  runner.drills.set(kind, { run: runFn })
  return runner
}

// ── Execution ---------------------------------------------------------------

export function runDrill(
  runner: DrillRunner,
  kind: DrillKind,
): DrillResult | null {
  const entry = runner.drills.get(kind)
  if (entry === undefined) return null
  return entry.run()
}

export function runAllDrills(runner: DrillRunner): DrillResult[] {
  const results: DrillResult[] = []
  for (const [_kind, entry] of runner.drills) {
    results.push(entry.run())
  }
  return results
}

// ── Summary -----------------------------------------------------------------

export function getDrillSummary(results: DrillResult[]): {
  passed: number
  failed: number
  total: number
} {
  let passed = 0
  let failed = 0
  for (const r of results) {
    if (r.passed === true) passed++
    else if (r.passed === false) failed++
  }
  return { passed, failed, total: results.length }
}
