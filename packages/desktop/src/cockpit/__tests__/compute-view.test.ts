/**
 * ComputeView — Unit Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createComputeSnapshot,
  addDevice,
  addLease,
  getActiveDeviceCount,
  type ComputeViewDevice,
  type ComputeViewLease,
} from "../compute-view"

/* ── Helpers ────────────────────────────────────────────── */

function sampleDevice(id = "d1"): ComputeViewDevice {
  return {
    deviceId: id,
    deviceClass: "metal-ultra",
    availableMemoryBytes: 64_000_000_000,
    activeLeases: 2,
    healthState: "healthy",
  }
}

function activeLease(id = "l1", deviceId = "d1"): ComputeViewLease {
  return {
    leaseId: id,
    sessionId: "s1",
    deviceId,
    status: "running",
    admittedAt: "2025-01-01T00:00:00Z",
    completedAt: null,
    receiptDigest: null,
  }
}

function completedLease(id = "l2", deviceId = "d1"): ComputeViewLease {
  return {
    leaseId: id,
    sessionId: "s1",
    deviceId,
    status: "completed",
    admittedAt: "2025-01-01T00:00:00Z",
    completedAt: "2025-01-01T01:00:00Z",
    receiptDigest: "abc123",
  }
}

/* ── createComputeSnapshot ──────────────────────────────── */

describe("createComputeSnapshot", () => {
  test("creates empty snapshot", () => {
    const snap = createComputeSnapshot("s1")
    expect(snap.sessionId).toBe("s1")
    expect(snap.devices).toEqual([])
    expect(snap.activeLeases).toEqual([])
    expect(snap.completedLeases).toEqual([])
    expect(snap.totalComputeDurationMs).toBe(0)
    expect(snap.totalTokensProcessed).toBe(0)
  })
})

/* ── addDevice ──────────────────────────────────────────── */

describe("addDevice", () => {
  test("adds a device to the snapshot", () => {
    let snap = createComputeSnapshot("s1")
    snap = addDevice(snap, sampleDevice("d1"))
    expect(snap.devices).toHaveLength(1)
    expect(snap.devices[0].deviceId).toBe("d1")
  })

  test("adds multiple devices", () => {
    let snap = createComputeSnapshot("s1")
    snap = addDevice(snap, sampleDevice("d1"))
    snap = addDevice(snap, sampleDevice("d2"))
    expect(snap.devices).toHaveLength(2)
  })

  test("doesn't mutate original snapshot", () => {
    const snap = createComputeSnapshot("s1")
    addDevice(snap, sampleDevice("d1"))
    expect(snap.devices).toHaveLength(0)
  })
})

/* ── addLease ───────────────────────────────────────────── */

describe("addLease", () => {
  test("adds an active lease to activeLeases", () => {
    let snap = createComputeSnapshot("s1")
    snap = addLease(snap, activeLease("l1", "d1"))
    expect(snap.activeLeases).toHaveLength(1)
    expect(snap.completedLeases).toHaveLength(0)
  })

  test("adds a completed lease to completedLeases", () => {
    let snap = createComputeSnapshot("s1")
    snap = addLease(snap, completedLease("l2", "d1"))
    expect(snap.activeLeases).toHaveLength(0)
    expect(snap.completedLeases).toHaveLength(1)
  })

  test("immutable - original snapshot unchanged", () => {
    const snap = createComputeSnapshot("s1")
    addLease(snap, activeLease("l1", "d1"))
    expect(snap.activeLeases).toHaveLength(0)
  })
})

/* ── getActiveDeviceCount ───────────────────────────────── */

describe("getActiveDeviceCount", () => {
  test("returns count of non-offline devices", () => {
    let snap = createComputeSnapshot("s1")
    snap = addDevice(snap, { ...sampleDevice("d1"), healthState: "healthy" })
    snap = addDevice(snap, { ...sampleDevice("d2"), healthState: "offline" })
    snap = addDevice(snap, { ...sampleDevice("d3"), healthState: "degraded" })
    expect(getActiveDeviceCount(snap)).toBe(2)
  })

  test("returns 0 when all devices offline", () => {
    let snap = createComputeSnapshot("s1")
    snap = addDevice(snap, { ...sampleDevice("d1"), healthState: "offline" })
    expect(getActiveDeviceCount(snap)).toBe(0)
  })

  test("returns 0 when no devices", () => {
    const snap = createComputeSnapshot("s1")
    expect(getActiveDeviceCount(snap)).toBe(0)
  })
})
