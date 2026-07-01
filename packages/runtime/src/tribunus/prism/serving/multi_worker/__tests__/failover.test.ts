/**
 * Prism Multi-Worker Router — Failover Management Tests
 */

import { expect, test, describe } from "bun:test"
import {
  detectWorkerFailure,
  selectFailoverWorker,
  canRetryRequest,
  shouldFailVisibly,
} from "../worker-failover"
import type { RouterWorkerState, RouteRecord, FailoverPolicy } from "../router-types"

function makeWorker(overrides: Partial<RouterWorkerState> = {}): RouterWorkerState {
  return {
    workerId: "worker-1",
    instanceId: "inst-1",
    compatibility: null,
    healthy: true,
    ready: true,
    draining: false,
    activeRequests: 1,
    maxConcurrentRequests: 4,
    lastHealthCheck: "2026-01-01T00:00:00Z",
    lastError: null,
    lastKvEventSequence: 0,
    kvEventFreshness: "fresh",
    ...overrides,
  }
}

function makeRouteRecord(overrides: Partial<RouteRecord> = {}): RouteRecord {
  return {
    routeId: "route-1",
    requestId: "req-1",
    selectedWorkerId: "worker-1",
    candidateWorkerIds: ["worker-1", "worker-2"],
    selectionReason: "load",
    prefixAffinitySummary: "none",
    loadSummary: "low",
    retryCount: 0,
    traceContext: null,
    createdAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    outcome: "failed",
    ...overrides,
  }
}

describe("detectWorkerFailure", () => {
  test("detects failure when unhealthy", () => {
    expect(detectWorkerFailure(makeWorker({ healthy: false }))).toBe(true)
  })

  test("detects failure when not ready", () => {
    expect(detectWorkerFailure(makeWorker({ ready: false }))).toBe(true)
  })

  test("detects failure when lastError is set", () => {
    expect(detectWorkerFailure(makeWorker({ lastError: "OOM" }))).toBe(true)
  })

  test("returns false for a healthy, ready worker without errors", () => {
    expect(
      detectWorkerFailure(makeWorker({ healthy: true, ready: true, lastError: null })),
    ).toBe(false)
  })
})

describe("selectFailoverWorker", () => {
  test("selects the least-loaded eligible worker", () => {
    const workers = [
      makeWorker({ workerId: "w1", activeRequests: 3, maxConcurrentRequests: 4 }),
      makeWorker({ workerId: "w2", activeRequests: 1, maxConcurrentRequests: 4 }),
      makeWorker({ workerId: "w3", activeRequests: 2, maxConcurrentRequests: 4 }),
    ]
    const selected = selectFailoverWorker("failed-worker", workers)
    expect(selected).not.toBeNull()
    expect(selected!.workerId).toBe("w2")
  })

  test("excludes the failed worker", () => {
    const workers = [
      makeWorker({ workerId: "failed-w", activeRequests: 1, maxConcurrentRequests: 4 }),
      makeWorker({ workerId: "w2", activeRequests: 2, maxConcurrentRequests: 4 }),
    ]
    const selected = selectFailoverWorker("failed-w", workers)
    expect(selected).not.toBeNull()
    expect(selected!.workerId).toBe("w2")
  })

  test("excludes draining workers", () => {
    const workers = [
      makeWorker({ workerId: "w1", draining: true, activeRequests: 1, maxConcurrentRequests: 4 }),
      makeWorker({ workerId: "w2", draining: false, activeRequests: 2, maxConcurrentRequests: 4 }),
    ]
    const selected = selectFailoverWorker("failed-w", workers)
    expect(selected).not.toBeNull()
    expect(selected!.workerId).toBe("w2")
  })

  test("excludes unhealthy workers", () => {
    const workers = [
      makeWorker({ workerId: "w1", healthy: false }),
      makeWorker({ workerId: "w2", healthy: true }),
    ]
    const selected = selectFailoverWorker("failed-w", workers)
    expect(selected).not.toBeNull()
    expect(selected!.workerId).toBe("w2")
  })

  test("excludes workers at capacity", () => {
    const workers = [
      makeWorker({ workerId: "w1", activeRequests: 4, maxConcurrentRequests: 4 }),
      makeWorker({ workerId: "w2", activeRequests: 4, maxConcurrentRequests: 4 }),
    ]
    expect(selectFailoverWorker("failed-w", workers)).toBeNull()
  })

  test("returns null when no eligible workers exist", () => {
    expect(selectFailoverWorker("failed-w", [])).toBeNull()
  })
})

describe("canRetryRequest", () => {
  const record = makeRouteRecord()

  test("fail_after_first_output: retry only when no output emitted", () => {
    expect(canRetryRequest(record, "fail_after_first_output", false)).toBe(true)
    expect(canRetryRequest(record, "fail_after_first_output", true)).toBe(false)
  })

  test("retry_before_output: retry only when no output emitted", () => {
    expect(canRetryRequest(record, "retry_before_output", false)).toBe(true)
    expect(canRetryRequest(record, "retry_before_output", true)).toBe(false)
  })

  test("retry_idempotent: retry regardless of output state", () => {
    expect(canRetryRequest(record, "retry_idempotent", false)).toBe(true)
    expect(canRetryRequest(record, "retry_idempotent", true)).toBe(true)
  })
})

describe("shouldFailVisibly", () => {
  test("fail_after_first_output: fails visibly when output emitted", () => {
    expect(shouldFailVisibly("fail_after_first_output", true)).toBe(true)
    expect(shouldFailVisibly("fail_after_first_output", false)).toBe(false)
  })

  test("retry_before_output: never fails visibly", () => {
    expect(shouldFailVisibly("retry_before_output", true)).toBe(false)
    expect(shouldFailVisibly("retry_before_output", false)).toBe(false)
  })

  test("retry_idempotent: never fails visibly", () => {
    expect(shouldFailVisibly("retry_idempotent", true)).toBe(false)
    expect(shouldFailVisibly("retry_idempotent", false)).toBe(false)
  })
})
