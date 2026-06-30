/**
 * Prism Phase Role Separation — Phase Capacity Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createPhaseCapacitySnapshot,
  getPrefillHeadroom,
  getDecodeHeadroom,
  getCombinedHeadroom,
  canAdmitPrefill,
  canAdmitDecode,
  isWorkerEligibleByCapacity,
} from "../phase-capacity"
import {
  assessPhaseReadiness,
  isWorkerPhaseReady,
} from "../phase-readiness"
import type { PrismPhaseCapacitySnapshot, PrismWorkerReadiness } from "../phase-role-types"

// ── createPhaseCapacitySnapshot ────────────────────────────────────────────

describe("createPhaseCapacitySnapshot", () => {
  test("creates a snapshot with given values", () => {
    const snap = createPhaseCapacitySnapshot("w1", 2, 8, 3, 16, 10, 64)
    expect(snap.workerId).toBe("w1")
    expect(snap.prefillActiveOperations).toBe(2)
    expect(snap.prefillMaximumOperations).toBe(8)
    expect(snap.decodeActiveOperations).toBe(3)
    expect(snap.decodeMaximumOperations).toBe(16)
    expect(snap.decodeActiveKvNamespaces).toBe(10)
    expect(snap.decodeMaximumKvNamespaces).toBe(64)
    expect(snap.observedAt).toBeDefined()
    expect(typeof snap.observedAt).toBe("string")
  })

  test("sets pending and memory fields to zero", () => {
    const snap = createPhaseCapacitySnapshot("w2", 0, 4, 0, 8, 0, 32)
    expect(snap.prefillPendingOperations).toBe(0)
    expect(snap.prefillMemoryBytesInUse).toBe(0)
    expect(snap.prefillMemoryBytesLimit).toBe(0)
    expect(snap.decodePendingOperations).toBe(0)
    expect(snap.decodeMemoryBytesInUse).toBe(0)
    expect(snap.decodeMemoryBytesLimit).toBe(0)
  })
})

// ── getPrefillHeadroom ─────────────────────────────────────────────────────

describe("getPrefillHeadroom", () => {
  test("returns positive headroom when under capacity", () => {
    const snap = createPhaseCapacitySnapshot("w1", 3, 8, 0, 0, 0, 0)
    expect(getPrefillHeadroom(snap)).toBe(5)
  })

  test("returns zero when at capacity", () => {
    const snap = createPhaseCapacitySnapshot("w1", 8, 8, 0, 0, 0, 0)
    expect(getPrefillHeadroom(snap)).toBe(0)
  })

  test("returns negative when over capacity", () => {
    const snap = createPhaseCapacitySnapshot("w1", 10, 8, 0, 0, 0, 0)
    expect(getPrefillHeadroom(snap)).toBe(-2)
  })
})

// ── getDecodeHeadroom ──────────────────────────────────────────────────────

describe("getDecodeHeadroom", () => {
  test("returns positive headroom when under capacity", () => {
    const snap = createPhaseCapacitySnapshot("w1", 0, 0, 5, 16, 0, 0)
    expect(getDecodeHeadroom(snap)).toBe(11)
  })

  test("returns zero when at capacity", () => {
    const snap = createPhaseCapacitySnapshot("w1", 0, 0, 16, 16, 16, 16)
    expect(getDecodeHeadroom(snap)).toBe(0)
  })

  test("returns negative when over capacity", () => {
    const snap = createPhaseCapacitySnapshot("w1", 0, 0, 20, 16, 0, 0)
    expect(getDecodeHeadroom(snap)).toBe(-4)
  })
})

// ── getCombinedHeadroom ────────────────────────────────────────────────────

describe("getCombinedHeadroom", () => {
  test("returns minimum of prefill and decode headroom", () => {
    const snap = createPhaseCapacitySnapshot("w1", 2, 8, 10, 16, 0, 0)
    expect(getCombinedHeadroom(snap)).toBe(6)
  })

  test("returns decode headroom when it is lower", () => {
    const snap = createPhaseCapacitySnapshot("w1", 1, 8, 14, 16, 0, 0)
    expect(getCombinedHeadroom(snap)).toBe(2) // prefill=7, decode=2 → 2
  })

  test("returns prefill headroom when it is lower", () => {
    const snap = createPhaseCapacitySnapshot("w1", 7, 8, 2, 16, 0, 0)
    expect(getCombinedHeadroom(snap)).toBe(1) // prefill=1, decode=14 → 1
  })

  test("returns negative when one phase is over capacity", () => {
    const snap = createPhaseCapacitySnapshot("w1", 10, 8, 5, 16, 0, 0)
    expect(getCombinedHeadroom(snap)).toBe(-2)
  })
})

// ── canAdmitPrefill ────────────────────────────────────────────────────────

describe("canAdmitPrefill", () => {
  test("admits when headroom meets required operations", () => {
    const snap = createPhaseCapacitySnapshot("w1", 3, 8, 0, 0, 0, 0)
    expect(canAdmitPrefill(snap, 1)).toBe(true)
    expect(canAdmitPrefill(snap, 5)).toBe(true)
  })

  test("rejects when headroom is insufficient", () => {
    const snap = createPhaseCapacitySnapshot("w1", 7, 8, 0, 0, 0, 0)
    expect(canAdmitPrefill(snap, 2)).toBe(false)
  })

  test("rejects when at capacity", () => {
    const snap = createPhaseCapacitySnapshot("w1", 8, 8, 0, 0, 0, 0)
    expect(canAdmitPrefill(snap)).toBe(false)
  })

  test("defaults to 1 required operation", () => {
    const snap = createPhaseCapacitySnapshot("w1", 7, 8, 0, 0, 0, 0)
    expect(canAdmitPrefill(snap)).toBe(true)
  })
})

// ── canAdmitDecode ─────────────────────────────────────────────────────────

describe("canAdmitDecode", () => {
  test("admits when headroom meets required namespaces", () => {
    const snap = createPhaseCapacitySnapshot("w1", 0, 0, 10, 16, 0, 0)
    expect(canAdmitDecode(snap, 1)).toBe(true)
    expect(canAdmitDecode(snap, 6)).toBe(true)
  })

  test("rejects when headroom is insufficient", () => {
    const snap = createPhaseCapacitySnapshot("w1", 0, 0, 15, 16, 0, 0)
    expect(canAdmitDecode(snap, 2)).toBe(false)
  })

  test("rejects when at capacity", () => {
    const snap = createPhaseCapacitySnapshot("w1", 0, 0, 16, 16, 16, 16)
    expect(canAdmitDecode(snap)).toBe(false)
  })

  test("defaults to 1 required namespace", () => {
    const snap = createPhaseCapacitySnapshot("w1", 0, 0, 15, 16, 0, 0)
    expect(canAdmitDecode(snap)).toBe(true)
  })
})

// ── isWorkerEligibleByCapacity ─────────────────────────────────────────────

describe("isWorkerEligibleByCapacity", () => {
  test("eligible when both phases have headroom", () => {
    const snap = createPhaseCapacitySnapshot("w1", 2, 8, 4, 16, 0, 0)
    const result = isWorkerEligibleByCapacity(snap, true, true)
    expect(result.eligible).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("eligible when only prefill is needed", () => {
    const snap = createPhaseCapacitySnapshot("w1", 2, 8, 16, 16, 64, 64)
    const result = isWorkerEligibleByCapacity(snap, true, false)
    expect(result.eligible).toBe(true)
  })

  test("eligible when only decode is needed", () => {
    const snap = createPhaseCapacitySnapshot("w1", 8, 8, 4, 16, 0, 0)
    const result = isWorkerEligibleByCapacity(snap, false, true)
    expect(result.eligible).toBe(true)
  })

  test("rejects with reason when prefill capacity exhausted", () => {
    const snap = createPhaseCapacitySnapshot("w1", 8, 8, 4, 16, 0, 0)
    const result = isWorkerEligibleByCapacity(snap, true, true)
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain("Prefill capacity exhausted")
    expect(result.reason).toContain("8/8")
  })

  test("rejects with reason when decode capacity exhausted", () => {
    const snap = createPhaseCapacitySnapshot("w1", 2, 8, 16, 16, 64, 64)
    const result = isWorkerEligibleByCapacity(snap, true, true)
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain("Decode capacity exhausted")
    expect(result.reason).toContain("16/16")
  })
})

// ── Phase Readiness ────────────────────────────────────────────────────────

describe("assessPhaseReadiness", () => {
  test("full readiness when both phases have capacity", () => {
    const r = assessPhaseReadiness(true, true, true, true)
    expect(r.overallReady).toBe(true)
    expect(r.prefillReady).toBe(true)
    expect(r.decodeReady).toBe(true)
    expect(r.prefillCapacityAvailable).toBe(true)
    expect(r.decodeCapacityAvailable).toBe(true)
  })

  test("not ready when prefill subsystem is down", () => {
    const r = assessPhaseReadiness(false, true, true, true)
    expect(r.overallReady).toBe(false)
    expect(r.prefillReady).toBe(false)
    expect(r.decodeReady).toBe(true)
  })

  test("not ready when decode subsystem is down", () => {
    const r = assessPhaseReadiness(true, false, true, true)
    expect(r.overallReady).toBe(false)
    expect(r.prefillReady).toBe(true)
    expect(r.decodeReady).toBe(false)
  })

  test("not ready when prefill capacity is saturated", () => {
    const r = assessPhaseReadiness(true, true, false, true)
    expect(r.overallReady).toBe(false)
    expect(r.prefillReady).toBe(false)
    expect(r.decodeReady).toBe(true)
  })

  test("not ready when decode capacity is saturated", () => {
    const r = assessPhaseReadiness(true, true, true, false)
    expect(r.overallReady).toBe(false)
    expect(r.prefillReady).toBe(true)
    expect(r.decodeReady).toBe(false)
  })

  test("not ready when both subsystems are down", () => {
    const r = assessPhaseReadiness(false, false, true, true)
    expect(r.overallReady).toBe(false)
    expect(r.prefillReady).toBe(false)
    expect(r.decodeReady).toBe(false)
  })

  test("sets default fields", () => {
    const r = assessPhaseReadiness(true, true, true, true)
    expect(r.workerId).toBe("")
    expect(r.admittedModelCount).toBe(0)
    expect(r.drainState).toBe("none")
    expect(r.observedAt).toBeDefined()
  })

  test("not ready when both subsystems healthy but no capacity", () => {
    const r = assessPhaseReadiness(true, true, false, false)
    expect(r.overallReady).toBe(false)
    expect(r.prefillReady).toBe(false)
    expect(r.decodeReady).toBe(false)
  })
})

describe("isWorkerPhaseReady", () => {
  test("ready when worker is fully ready for both phases", () => {
    const readiness: PrismWorkerReadiness = {
      workerId: "w1",
      overallReady: true,
      prefillReady: true,
      decodeReady: true,
      admittedModelCount: 1,
      prefillCapacityAvailable: true,
      decodeCapacityAvailable: true,
      drainState: "none",
      observedAt: new Date().toISOString(),
    }
    expect(isWorkerPhaseReady(readiness, true, true)).toBe(true)
  })

  test("prefill-only degradation — decode not needed", () => {
    const readiness: PrismWorkerReadiness = {
      workerId: "w1",
      overallReady: false,
      prefillReady: true,
      decodeReady: false,
      admittedModelCount: 1,
      prefillCapacityAvailable: true,
      decodeCapacityAvailable: false,
      drainState: "none",
      observedAt: new Date().toISOString(),
    }
    expect(isWorkerPhaseReady(readiness, true, false)).toBe(true)
    expect(isWorkerPhaseReady(readiness, true, true)).toBe(false)
  })

  test("decode-only saturation — prefill not needed", () => {
    const readiness: PrismWorkerReadiness = {
      workerId: "w1",
      overallReady: false,
      prefillReady: false,
      decodeReady: true,
      admittedModelCount: 1,
      prefillCapacityAvailable: false,
      decodeCapacityAvailable: true,
      drainState: "none",
      observedAt: new Date().toISOString(),
    }
    expect(isWorkerPhaseReady(readiness, false, true)).toBe(true)
    expect(isWorkerPhaseReady(readiness, true, true)).toBe(false)
  })

  test("not ready when required prefill is unavailable", () => {
    const readiness: PrismWorkerReadiness = {
      workerId: "w1",
      overallReady: false,
      prefillReady: false,
      decodeReady: true,
      admittedModelCount: 0,
      prefillCapacityAvailable: false,
      decodeCapacityAvailable: true,
      drainState: "none",
      observedAt: new Date().toISOString(),
    }
    expect(isWorkerPhaseReady(readiness, true, false)).toBe(false)
  })

  test("not ready when required decode is unavailable", () => {
    const readiness: PrismWorkerReadiness = {
      workerId: "w1",
      overallReady: false,
      prefillReady: true,
      decodeReady: false,
      admittedModelCount: 0,
      prefillCapacityAvailable: true,
      decodeCapacityAvailable: false,
      drainState: "none",
      observedAt: new Date().toISOString(),
    }
    expect(isWorkerPhaseReady(readiness, false, true)).toBe(false)
  })
})
