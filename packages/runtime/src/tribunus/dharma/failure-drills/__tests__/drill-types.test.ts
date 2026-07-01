/**
 * Track G — Failure Drills: Type System Tests
 *
 * Verifies the drill taxonomy, governance controls, and type invariants.
 */

import { describe, test, expect } from "bun:test"
import {
  ALL_DRILLS,
  GOVERNANCE_CONTROLS,
  type DrillDefinition,
  type DrillKind,
  type GovernanceAction,
  type DrillResult,
  type GovernanceControl,
} from "../drill-types"

// ── Drill Definition Coverage -----------------------------------------------

describe("ALL_DRILLS", () => {
  const KINDS: DrillKind[] = ALL_DRILLS.map((d) => d.kind)

  test("has exactly 19 drill definitions", () => {
    expect(ALL_DRILLS.length).toBe(19)
  })

  test("every definition has a name, description, and category", () => {
    for (const d of ALL_DRILLS) {
      expect(d.name).toBeTruthy()
      expect(d.description).toBeTruthy()
      expect(typeof d.name).toBe("string")
      expect(typeof d.description).toBe("string")
      expect(typeof d.kind).toBe("string")
    }
  })

  test("every definition has a valid category", () => {
    const validCategories = new Set(["crash", "network", "authority", "data_integrity", "resource"])
    for (const d of ALL_DRILLS) {
      expect(validCategories.has(d.category)).toBe(true)
    }
  })

  test("all 19 DrillKind values are present", () => {
    const expected: DrillKind[] = [
      "worker_crash_prefill",
      "worker_crash_decode",
      "worker_crash_handoff",
      "dGPU_reset_active",
      "kv_event_replay_gap",
      "stale_capability_ad",
      "artifact_revocation_active_lease",
      "session_membership_revocation",
      "provider_trust_revocation",
      "transport_disconnect_streaming",
      "federation_partition",
      "pglite_restart",
      "valkey_loss",
      "malformed_receipt",
      "duplicate_receipt",
      "result_conflict",
      "corrupted_source_package",
      "containment_backend_unavailable",
      "failed_source_cleanup",
    ]
    const sortedActual = [...KINDS].sort()
    const sortedExpected = [...expected].sort()
    expect(sortedActual).toEqual(sortedExpected)
  })

  test("no duplicate drill kinds", () => {
    const seen = new Set<DrillKind>()
    for (const d of ALL_DRILLS) {
      expect(seen.has(d.kind)).toBe(false)
      seen.add(d.kind)
    }
  })
})

// ── DrillResult Invariants --------------------------------------------------

describe("DrillResult", () => {
  test("has all required fields", () => {
    const result: DrillResult = {
      drill: "worker_crash_prefill",
      startedAt: "2026-07-01T12:00:00.000Z",
      completedAt: null,
      passed: null,
      whatRemainsAuthoritative: [],
      whatIsCancelled: [],
      whatIsRetried: [],
      whatIsPreserved: [],
      whatIsRevoked: [],
      userNextAction: "",
      recoveryProof: "",
      failureMode: null,
    }
    // Structural check — all fields compile and are accessible
    expect(result.drill).toBe("worker_crash_prefill")
    expect(Array.isArray(result.whatRemainsAuthoritative)).toBe(true)
    expect(Array.isArray(result.whatIsCancelled)).toBe(true)
    expect(Array.isArray(result.whatIsRetried)).toBe(true)
    expect(Array.isArray(result.whatIsPreserved)).toBe(true)
    expect(Array.isArray(result.whatIsRevoked)).toBe(true)
    expect(typeof result.userNextAction).toBe("string")
    expect(typeof result.recoveryProof).toBe("string")
  })

  test("all fields can be populated", () => {
    const result: DrillResult = {
      drill: "result_conflict",
      startedAt: "2026-07-01T12:00:00.000Z",
      completedAt: "2026-07-01T12:05:00.000Z",
      passed: false,
      whatRemainsAuthoritative: ["prior outcomes"],
      whatIsCancelled: ["none"],
      whatIsRetried: ["third-party execution"],
      whatIsPreserved: ["conflicting results"],
      whatIsRevoked: ["none"],
      userNextAction: "Compare conflicting results",
      recoveryProof: "Conflict detected. Merge rule applied.",
      failureMode: "Outcome conflict",
    }
    expect(result.passed).toBe(false)
    expect(result.completedAt).toBeTruthy()
    expect(result.failureMode).toBeTruthy()
  })
})

// ── Governance Controls Coverage --------------------------------------------

describe("GOVERNANCE_CONTROLS", () => {
  const ACTIONS: GovernanceAction[] = [
    "pause_session",
    "revoke_member",
    "revoke_grant",
    "revoke_provider",
    "cancel_lease",
    "invalidate_artifact",
    "drain_worker",
    "quarantine_result",
    "freeze_canonical_outcome",
    "export_incident_evidence",
  ]

  test("has exactly 10 governance controls", () => {
    expect(Object.keys(GOVERNANCE_CONTROLS).length).toBe(10)
  })

  test("every GovernanceAction has a corresponding control", () => {
    for (const action of ACTIONS) {
      expect(GOVERNANCE_CONTROLS[action]).toBeDefined()
      expect(GOVERNANCE_CONTROLS[action].action).toBe(action)
    }
  })

  test("every control has description, appliesTo, and isReversible", () => {
    for (const [key, control] of Object.entries(GOVERNANCE_CONTROLS)) {
      expect(control.description).toBeTruthy()
      expect(typeof control.description).toBe("string")
      expect(Array.isArray(control.appliesTo)).toBe(true)
      expect(control.appliesTo.length).toBeGreaterThan(0)
      expect(typeof control.isReversible).toBe("boolean")
    }
  })

  test("revocation controls are irreversible", () => {
    const irreversible: GovernanceAction[] = [
      "revoke_member",
      "revoke_grant",
      "revoke_provider",
      "cancel_lease",
      "drain_worker",
    ]
    for (const action of irreversible) {
      expect(GOVERNANCE_CONTROLS[action].isReversible).toBe(false)
    }
  })

  test("investigative controls are reversible", () => {
    const reversible: GovernanceAction[] = [
      "pause_session",
      "invalidate_artifact",
      "quarantine_result",
      "freeze_canonical_outcome",
      "export_incident_evidence",
    ]
    for (const action of reversible) {
      expect(GOVERNANCE_CONTROLS[action].isReversible).toBe(true)
    }
  })

  test("GOVERNANCE_CONTROLS has keys matching every action in the union", () => {
    const keys = new Set(Object.keys(GOVERNANCE_CONTROLS))
    const missing = ACTIONS.filter((a) => !keys.has(a))
    expect(missing).toEqual([])
  })
})
