/**
 * Prism KV Handoff — Rollback Logic Tests
 *
 * Pure function tests for handoff-rollback.ts
 */

import { expect, test, describe } from "bun:test"
import {
  getRollbackState,
  shouldRollback,
  classifyRollbackReason,
} from "../handoff-rollback"
import type { HandoffState } from "../handoff-types"

// ── getRollbackState ────────────────────────────────────────────────────────

describe("getRollbackState", () => {
  test("always returns rolled_back", () => {
    // Every input maps to "rolled_back"
    const states: HandoffState[] = [
      "draft", "requested", "source_validating", "destination_validating",
      "export_preparing", "exported", "transferring", "importing",
      "destination_validated", "committed", "source_disposition_pending",
      "completed", "rejected", "cancelled", "timeout", "failed",
      "rolled_back", "degraded_completed",
    ]

    for (const state of states) {
      expect(getRollbackState(state)).toBe("rolled_back")
    }
  })
})

// ── shouldRollback ──────────────────────────────────────────────────────────

describe("shouldRollback", () => {
  test("returns true for terminal failure states", () => {
    expect(shouldRollback("failed")).toBe(true)
    expect(shouldRollback("rejected")).toBe(true)
    expect(shouldRollback("cancelled")).toBe(true)
    expect(shouldRollback("timeout")).toBe(true)
  })

  test("returns true for mid-flight states", () => {
    expect(shouldRollback("export_preparing")).toBe(true)
    expect(shouldRollback("exported")).toBe(true)
    expect(shouldRollback("transferring")).toBe(true)
    expect(shouldRollback("importing")).toBe(true)
    expect(shouldRollback("source_disposition_pending")).toBe(true)
  })

  test("returns false for already-terminated states", () => {
    expect(shouldRollback("rolled_back")).toBe(false)
    expect(shouldRollback("completed")).toBe(false)
    expect(shouldRollback("degraded_completed")).toBe(false)
  })

  test("returns false for happy-path active states", () => {
    expect(shouldRollback("draft")).toBe(false)
    expect(shouldRollback("requested")).toBe(false)
    expect(shouldRollback("committed")).toBe(false)
    expect(shouldRollback("destination_validated")).toBe(false)
  })
})

// ── classifyRollbackReason ──────────────────────────────────────────────────

describe("classifyRollbackReason", () => {
  test("describes failure states", () => {
    expect(classifyRollbackReason("failed")).toBe(
      "handoff failed — unrecoverable error during processing",
    )
    expect(classifyRollbackReason("rejected")).toBe(
      "handoff rejected — eligibility or compatibility check failed",
    )
    expect(classifyRollbackReason("cancelled")).toBe(
      "handoff cancelled — request withdrawn or lease revoked",
    )
    expect(classifyRollbackReason("timeout")).toBe(
      "handoff timed out — deadline exceeded before completion",
    )
  })

  test("describes mid-flight states", () => {
    expect(classifyRollbackReason("export_preparing")).toBe(
      "source export failed — rolling back export preparation",
    )
    expect(classifyRollbackReason("transferring")).toBe(
      "transfer interrupted — payload not fully delivered",
    )
    expect(classifyRollbackReason("importing")).toBe(
      "destination import failed — rolling back partial import",
    )
  })

  test("describes already-terminated states", () => {
    expect(classifyRollbackReason("rolled_back")).toBe(
      "no rollback needed — handoff already terminated",
    )
    expect(classifyRollbackReason("completed")).toBe(
      "no rollback needed — handoff already terminated",
    )
  })

  test("falls back for unknown states", () => {
    const reason = classifyRollbackReason("source_validating")
    expect(reason).toContain("unknown state")
    expect(reason).toContain("source_validating")
  })
})
