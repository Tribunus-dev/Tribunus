/**
 * Prism Multi-Worker Router — Drain Manager Tests
 */

import { expect, test, describe } from "bun:test"
import {
  requestDrain,
  completeDrain,
  resumeWorker,
  isWorkerDraining,
  getDrainingWorkers,
} from "../worker-drain-manager"
import { DrainError } from "../router-errors"
import type { RouterWorkerState } from "../router-types"

function makeWorker(overrides: Partial<RouterWorkerState> = {}): RouterWorkerState {
  return {
    workerId: "worker-1",
    instanceId: "inst-1",
    compatibility: null,
    healthy: true,
    ready: true,
    draining: false,
    activeRequests: 0,
    maxConcurrentRequests: 4,
    lastHealthCheck: "2026-01-01T00:00:00Z",
    lastError: null,
    lastKvEventSequence: 0,
    kvEventFreshness: "fresh",
    ...overrides,
  }
}

describe("requestDrain", () => {
  test("sets draining flag on a healthy, ready worker", () => {
    const workers = [makeWorker()]
    const updated = requestDrain("worker-1", workers)
    expect(updated[0].draining).toBe(true)
    expect(updated[0].healthy).toBe(true)
  })

  test("throws DrainError if worker is already draining", () => {
    const workers = [makeWorker({ draining: true })]
    expect(() => requestDrain("worker-1", workers)).toThrow(DrainError)
    expect(() => requestDrain("worker-1", workers)).toThrow("already draining")
  })

  test("throws DrainError if worker is unhealthy", () => {
    const workers = [makeWorker({ healthy: false })]
    expect(() => requestDrain("worker-1", workers)).toThrow(DrainError)
    expect(() => requestDrain("worker-1", workers)).toThrow("unhealthy")
  })

  test("throws DrainError if worker is not ready", () => {
    const workers = [makeWorker({ ready: false })]
    expect(() => requestDrain("worker-1", workers)).toThrow(DrainError)
    expect(() => requestDrain("worker-1", workers)).toThrow("not ready")
  })

  test("does not affect other workers", () => {
    const workers = [
      makeWorker({ workerId: "worker-1" }),
      makeWorker({ workerId: "worker-2" }),
    ]
    const updated = requestDrain("worker-1", workers)
    expect(updated[0].draining).toBe(true)
    expect(updated[1].draining).toBe(false)
  })
})

describe("completeDrain", () => {
  test("clears draining flag and marks worker not ready and unhealthy", () => {
    const workers = [makeWorker({ draining: true, ready: true, healthy: true })]
    const updated = completeDrain("worker-1", workers)
    expect(updated[0].draining).toBe(false)
    expect(updated[0].ready).toBe(false)
    expect(updated[0].healthy).toBe(false)
  })

  test("throws DrainError if worker is not draining", () => {
    const workers = [makeWorker({ draining: false })]
    expect(() => completeDrain("worker-1", workers)).toThrow(DrainError)
  })

  test("throws DrainError if worker not found", () => {
    const workers = [makeWorker({ draining: true })]
    expect(() => completeDrain("nonexistent", workers)).toThrow(DrainError)
  })
})

describe("resumeWorker", () => {
  test("clears draining flag and keeps worker healthy and ready", () => {
    const workers = [makeWorker({ draining: true, healthy: true, ready: true })]
    const updated = resumeWorker("worker-1", workers)
    expect(updated[0].draining).toBe(false)
    expect(updated[0].ready).toBe(true)
    expect(updated[0].healthy).toBe(true)
  })

  test("throws DrainError if worker is not draining", () => {
    const workers = [makeWorker({ draining: false })]
    expect(() => resumeWorker("worker-1", workers)).toThrow(DrainError)
  })

  test("throws DrainError if worker not found", () => {
    const workers = [makeWorker({ draining: true })]
    expect(() => resumeWorker("nonexistent", workers)).toThrow(DrainError)
  })
})

describe("isWorkerDraining", () => {
  test("returns true when worker is draining", () => {
    const worker = makeWorker({ draining: true })
    expect(isWorkerDraining(worker)).toBe(true)
  })

  test("returns false when worker is not draining", () => {
    const worker = makeWorker({ draining: false })
    expect(isWorkerDraining(worker)).toBe(false)
  })
})

describe("getDrainingWorkers", () => {
  test("returns only workers with draining flag set", () => {
    const workers = [
      makeWorker({ workerId: "w1", draining: true }),
      makeWorker({ workerId: "w2", draining: false }),
      makeWorker({ workerId: "w3", draining: true }),
    ]
    const draining = getDrainingWorkers(workers)
    expect(draining).toHaveLength(2)
    expect(draining.map((w) => w.workerId).sort()).toEqual(["w1", "w3"])
  })

  test("returns empty array when no workers are draining", () => {
    const workers = [
      makeWorker({ workerId: "w1", draining: false }),
      makeWorker({ workerId: "w2", draining: false }),
    ]
    expect(getDrainingWorkers(workers)).toHaveLength(0)
  })
})
