/**
 * Integration Tests — Two-Worker Failover
 *
 * Tests that the failover manager correctly detects worker failure,
 * selects replacement workers, and determines retry eligibility
 * based on failover policy and output state.
 */

import { describe, it, expect } from "bun:test"
import type { RouterWorkerState, RouteRecord, FailoverPolicy } from "../router-types"
import {
  detectWorkerFailure,
  selectFailoverWorker,
  canRetryRequest,
  shouldFailVisibly,
} from "../worker-failover"

// ── Helpers ────────────────────────────────────────────────────────────────

function makeWorkerState(id: string, overrides: Partial<RouterWorkerState> = {}): RouterWorkerState {
  return {
    workerId: id,
    instanceId: `${id}-inst-1`,
    compatibility: null,
    healthy: true,
    ready: true,
    draining: false,
    activeRequests: 0,
    maxConcurrentRequests: 4,
    lastHealthCheck: new Date().toISOString(),
    lastError: null,
    lastKvEventSequence: 0,
    kvEventFreshness: null,
    ...overrides,
  }
}

function makeRouteRecord(workerId: string, overrides: Partial<RouteRecord> = {}): RouteRecord {
  return {
    routeId: "route-1",
    requestId: "req-1",
    selectedWorkerId: workerId,
    candidateWorkerIds: [workerId],
    selectionReason: "test",
    prefixAffinitySummary: "none",
    loadSummary: "low",
    retryCount: 0,
    traceContext: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    outcome: "failed",
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("two-worker-failover", () => {
  it("Worker A fails before output — retry on B", () => {
    // Worker A is unhealthy
    const wA = makeWorkerState("worker-a", { healthy: false })
    const wB = makeWorkerState("worker-b")

    const eligible = [wA, wB]

    // Detect failure
    expect(detectWorkerFailure(wA)).toBe(true)
    expect(detectWorkerFailure(wB)).toBe(false)

    // Select failover — should pick B (lowest load among eligible non-failed workers)
    const failover = selectFailoverWorker("worker-a", eligible)
    expect(failover).not.toBeNull()
    expect(failover!.workerId).toBe("worker-b")

    // With retry_before_output policy and no output emitted, retry is allowed
    const record = makeRouteRecord("worker-a")
    expect(canRetryRequest(record, "retry_before_output", false)).toBe(true)

    // Should not fail visibly since no output
    expect(shouldFailVisibly("retry_before_output", false)).toBe(false)
  })

  it("Worker A fails after output — fail visible", () => {
    // Worker A has a lastError
    const wA = makeWorkerState("worker-a", { lastError: "OOM error" })
    const wB = makeWorkerState("worker-b")

    expect(detectWorkerFailure(wA)).toBe(true)

    // With fail_after_first_output policy and output emitted
    const record = makeRouteRecord("worker-a", { retryCount: 1 })
    expect(canRetryRequest(record, "fail_after_first_output", true)).toBe(false)
    expect(shouldFailVisibly("fail_after_first_output", true)).toBe(true)
  })

  it("selectFailoverWorker returns null when no eligible replacement", () => {
    // Both workers are unhealthy
    const wA = makeWorkerState("worker-a", { healthy: false })
    const wB = makeWorkerState("worker-b", { healthy: false })
    const eligible = [wA, wB]

    const failover = selectFailoverWorker("worker-a", eligible)
    expect(failover).toBeNull()
  })

  it("selectFailoverWorker prefers lowest-load replacement", () => {
    // Worker B (load 1/4) should be preferred over C (load 3/4)
    const wA = makeWorkerState("worker-a", { healthy: false })
    const wB = makeWorkerState("worker-b", { activeRequests: 1 })
    const wC = makeWorkerState("worker-c", { activeRequests: 3 })
    const eligible = [wA, wB, wC]

    const failover = selectFailoverWorker("worker-a", eligible)
    expect(failover).not.toBeNull()
    expect(failover!.workerId).toBe("worker-b")
  })

  it("canRetryRequest with retry_idempotent always allows retry", () => {
    const record = makeRouteRecord("worker-a", { retryCount: 2 })

    // Even with output emitted, idempotent policy allows retry
    expect(canRetryRequest(record, "retry_idempotent", true)).toBe(true)
    expect(canRetryRequest(record, "retry_idempotent", false)).toBe(true)
  })

  it("canRetryRequest with fail_after_first_output blocks retry after output", () => {
    const record = makeRouteRecord("worker-a")

    expect(canRetryRequest(record, "fail_after_first_output", true)).toBe(false)
    expect(canRetryRequest(record, "fail_after_first_output", false)).toBe(true)
  })

  it("shouldFailVisibly only true for fail_after_first_output with output", () => {
    expect(shouldFailVisibly("fail_after_first_output", true)).toBe(true)
    expect(shouldFailVisibly("fail_after_first_output", false)).toBe(false)
    expect(shouldFailVisibly("retry_before_output", true)).toBe(false)
    expect(shouldFailVisibly("retry_idempotent", true)).toBe(false)
  })
})
