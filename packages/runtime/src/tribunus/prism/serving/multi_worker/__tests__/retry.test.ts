/**
 * Prism Multi-Worker Router — Retry Logic Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createRetryRecord,
  isRetryAllowed,
  getRetryDecision,
} from "../route-retry"
import type { RouteRecord } from "../router-types"

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

describe("createRetryRecord", () => {
  test("increments retryCount and updates routeId", () => {
    const original = makeRouteRecord({ retryCount: 0 })
    const retry = createRetryRecord(original, "worker-2")

    expect(retry.retryCount).toBe(1)
    expect(retry.selectedWorkerId).toBe("worker-2")
    expect(retry.routeId).toBe("route-1-retry-1")
    expect(retry.outcome).toBe("retried")
    expect(retry.completedAt).toBeNull()
  })

  test("inherits requestId, candidateWorkerIds, and traceContext", () => {
    const original = makeRouteRecord({
      requestId: "req-42",
      candidateWorkerIds: ["w1", "w2", "w3"],
      traceContext: "trace-abc",
    })
    const retry = createRetryRecord(original, "w2")

    expect(retry.requestId).toBe("req-42")
    expect(retry.candidateWorkerIds).toEqual(["w1", "w2", "w3"])
    expect(retry.traceContext).toBe("trace-abc")
  })

  test("retained selectionReason and prefixAffinitySummary", () => {
    const original = makeRouteRecord({
      selectionReason: "affinity",
      prefixAffinitySummary: "high",
    })
    const retry = createRetryRecord(original, "w2")

    expect(retry.selectionReason).toBe("affinity")
    expect(retry.prefixAffinitySummary).toBe("high")
  })

  test("multiple retries produce unique routeIds", () => {
    const original = makeRouteRecord({ retryCount: 2 })
    const retry = createRetryRecord(original, "w2")

    expect(retry.retryCount).toBe(3)
    expect(retry.routeId).toBe("route-1-retry-3")
  })
})

describe("isRetryAllowed", () => {
  test("allows retry when retryCount < maxRetries", () => {
    expect(isRetryAllowed(makeRouteRecord({ retryCount: 0 }), 3)).toBe(true)
    expect(isRetryAllowed(makeRouteRecord({ retryCount: 2 }), 3)).toBe(true)
  })

  test("rejects retry when retryCount >= maxRetries", () => {
    expect(isRetryAllowed(makeRouteRecord({ retryCount: 3 }), 3)).toBe(false)
    expect(isRetryAllowed(makeRouteRecord({ retryCount: 5 }), 3)).toBe(false)
  })

  test("zero max retries means no retry allowed", () => {
    expect(isRetryAllowed(makeRouteRecord({ retryCount: 0 }), 0)).toBe(false)
  })
})

describe("getRetryDecision", () => {
  test("fails when retry budget is exhausted", () => {
    const record = makeRouteRecord({ retryCount: 3 })
    const decision = getRetryDecision(record, 3, false, true)
    expect(decision.action).toBe("fail")
    expect(decision.reason).toContain("Retry budget exhausted")
  })

  test("fails when output emitted and request is non-idempotent", () => {
    const record = makeRouteRecord({ retryCount: 0 })
    const decision = getRetryDecision(record, 3, true, false)
    expect(decision.action).toBe("fail")
    expect(decision.reason).toContain("non-idempotent")
  })

  test("retries when output emitted but request is idempotent", () => {
    const record = makeRouteRecord({ retryCount: 0 })
    const decision = getRetryDecision(record, 3, true, true)
    expect(decision.action).toBe("retry")
    expect(decision.reason).toContain("idempotent")
  })

  test("redirects on first attempt failure before output", () => {
    const record = makeRouteRecord({ retryCount: 0 })
    const decision = getRetryDecision(record, 3, false, false)
    expect(decision.action).toBe("redirect")
    expect(decision.reason).toContain("redirect")
  })

  test("retries on subsequent failure within budget and no output", () => {
    const record = makeRouteRecord({ retryCount: 1 })
    const decision = getRetryDecision(record, 3, false, true)
    expect(decision.action).toBe("retry")
  })

  test("budget exhausted before output triggers fail even for idempotent", () => {
    const record = makeRouteRecord({ retryCount: 3 })
    const decision = getRetryDecision(record, 3, false, true)
    expect(decision.action).toBe("fail")
    expect(decision.reason).toContain("budget exhausted")
  })
})
