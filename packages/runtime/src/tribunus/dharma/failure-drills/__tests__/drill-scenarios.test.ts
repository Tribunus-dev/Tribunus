/**
 * Track G — Failure Drills: Scenario Simulation Tests
 *
 * Verifies that every drill kind has a defined scenario function and
 * that each returned DrillResult has all required fields populated.
 */

import { describe, test, expect } from "bun:test"
import type { DrillKind, DrillResult } from "../drill-types"
import { ALL_DRILLS } from "../drill-types"
import {
  createDrillRunner,
  registerDrill,
  runDrill,
  runAllDrills,
  getDrillSummary,
} from "../drill-runner"
import {
  simulateWorkerCrashPrefill,
  simulateWorkerCrashDecode,
  simulateWorkerCrashHandoff,
  simulateDGPUResetActive,
  simulateKVEventReplayGap,
  simulateStaleCapabilityAd,
  simulateArtifactRevocation,
  simulateMembershipRevocation,
  simulateProviderTrustRevocation,
  simulateTransportDisconnectStreaming,
  simulateFederationPartition,
  simulatePgliteRestart,
  simulateValkeyLoss,
  simulateMalformedReceipt,
  simulateDuplicateReceipt,
  simulateResultConflict,
  simulateCorruptedSourcePackage,
  simulateContainmentBackendUnavailable,
  simulateFailedSourceCleanup,
} from "../drill-scenarios"

// ── Scenario Registry -------------------------------------------------------

/** Map of DrillKind → scenario function. Every kind MUST have an entry. */
const SCENARIO_BY_KIND: Record<DrillKind, () => DrillResult> = {
  worker_crash_prefill: simulateWorkerCrashPrefill,
  worker_crash_decode: simulateWorkerCrashDecode,
  worker_crash_handoff: simulateWorkerCrashHandoff,
  dGPU_reset_active: simulateDGPUResetActive,
  kv_event_replay_gap: simulateKVEventReplayGap,
  stale_capability_ad: simulateStaleCapabilityAd,
  artifact_revocation_active_lease: simulateArtifactRevocation,
  session_membership_revocation: simulateMembershipRevocation,
  provider_trust_revocation: simulateProviderTrustRevocation,
  transport_disconnect_streaming: simulateTransportDisconnectStreaming,
  federation_partition: simulateFederationPartition,
  pglite_restart: simulatePgliteRestart,
  valkey_loss: simulateValkeyLoss,
  malformed_receipt: simulateMalformedReceipt,
  duplicate_receipt: simulateDuplicateReceipt,
  result_conflict: simulateResultConflict,
  corrupted_source_package: simulateCorruptedSourcePackage,
  containment_backend_unavailable: simulateContainmentBackendUnavailable,
  failed_source_cleanup: simulateFailedSourceCleanup,
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Drill Scenarios", () => {
  test("every DrillKind has a scenario function", () => {
    const definedKinds = Object.keys(SCENARIO_BY_KIND) as DrillKind[]
    const expectedKinds = ALL_DRILLS.map((d) => d.kind)
    const sortedDefined = [...definedKinds].sort()
    const sortedExpected = [...expectedKinds].sort()
    expect(sortedDefined).toEqual(sortedExpected)
  })

  test("each scenario returns a valid DrillResult with the matching drill kind", () => {
    for (const [kind, fn] of Object.entries(SCENARIO_BY_KIND)) {
      const result = fn()
      expect(result.drill).toBe(kind as DrillKind)
    }
  })

  test("each result has startedAt as a valid ISO-8601 string", () => {
    for (const fn of Object.values(SCENARIO_BY_KIND)) {
      const result = fn()
      expect(() => new Date(result.startedAt)).not.toThrow()
      expect(new Date(result.startedAt).toISOString()).toBeTruthy()
    }
  })

  test("each result has all required array fields populated (non-null)", () => {
    for (const fn of Object.values(SCENARIO_BY_KIND)) {
      const result = fn()
      expect(Array.isArray(result.whatRemainsAuthoritative)).toBe(true)
      expect(Array.isArray(result.whatIsCancelled)).toBe(true)
      expect(Array.isArray(result.whatIsRetried)).toBe(true)
      expect(Array.isArray(result.whatIsPreserved)).toBe(true)
      expect(Array.isArray(result.whatIsRevoked)).toBe(true)
    }
  })

  test("each result has a non-empty userNextAction", () => {
    for (const fn of Object.values(SCENARIO_BY_KIND)) {
      const result = fn()
      expect(result.userNextAction.length).toBeGreaterThan(0)
    }
  })

  test("each result has a non-empty recoveryProof", () => {
    for (const fn of Object.values(SCENARIO_BY_KIND)) {
      const result = fn()
      expect(result.recoveryProof.length).toBeGreaterThan(0)
    }
  })

  test("each drill assigns sensible array contents", () => {
    for (const fn of Object.values(SCENARIO_BY_KIND)) {
      const result = fn()
      // At least one of the semantic arrays should have content
      const total = result.whatRemainsAuthoritative.length
        + result.whatIsCancelled.length
        + result.whatIsRetried.length
        + result.whatIsPreserved.length
        + result.whatIsRevoked.length
      expect(total).toBeGreaterThan(0)
    }
  })
})

// ── Drill Runner Integration -------------------------------------------------

describe("Drill Runner Integration", () => {
  test("runner lifecycle: create, register, run, summarize", () => {
    const runner = createDrillRunner()

    // Register a subset of drills
    const entries = Object.entries(SCENARIO_BY_KIND).slice(0, 5)
    for (const [kind, fn] of entries) {
      registerDrill(runner, kind as DrillKind, fn)
    }

    const kind = Object.keys(SCENARIO_BY_KIND)[0] as DrillKind
    const singleResult = runDrill(runner, kind)
    expect(singleResult).not.toBeNull()
    expect(singleResult!.drill).toBe(kind)

    const allResults = runAllDrills(runner)
    expect(allResults.length).toBe(5)

    // Running a drill not in the map returns null
    const missingKind = ALL_DRILLS[ALL_DRILLS.length - 1].kind
    expect(runDrill(runner, missingKind)).toBeNull()
  })

  test("getDrillSummary counts correctly", () => {
    const runner = createDrillRunner()

    // Register all drills
    for (const [kind, fn] of Object.entries(SCENARIO_BY_KIND)) {
      registerDrill(runner, kind as DrillKind, fn)
    }

    const results = runAllDrills(runner)
    const summary = getDrillSummary(results)

    expect(summary.total).toBe(19)
    expect(summary.passed + summary.failed).toBeLessThanOrEqual(summary.total)
  })
})
