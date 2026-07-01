/**
 * Prism Multi-Worker Router — Dharma Lease-Aware Routing Tests
 */

import { expect, test, describe } from "bun:test"
import {
  getLeaseConstrainedWorkers,
  isLeaseCompatible,
  getLeaseRouteSummary,
} from "../dharma-route-correlation"
import type { RouterWorkerState, RouteRecord, PrismWorkerCompatibilityEnvelope } from "../router-types"

function makeWorker(overrides: Partial<RouterWorkerState> = {}): RouterWorkerState {
  return {
    workerId: "w1",
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

function makeEnvelope(overrides: Partial<PrismWorkerCompatibilityEnvelope> = {}): PrismWorkerCompatibilityEnvelope {
  return {
    workerId: "w1",
    workerInstanceId: "inst-1",
    modelArtifactDigest: "abc123",
    tokenizerDigest: "tok456",
    modelFamily: "llama",
    workloadClasses: ["chat"],
    targetCapabilitySignature: "sig-1",
    computeImageDigest: "img-1",
    precisionMode: "fp16",
    maximumContextLength: 8192,
    maximumOutputTokens: 2048,
    maximumConcurrentRequests: 4,
    kvEventVersion: 1,
    kvLocalityMode: "local",
    supportsStreaming: true,
    supportsCancellation: true,
    supportsDrain: true,
    supportsDharmaCorrelation: true,
    lifecycleState: "serving",
    ...overrides,
  }
}

function makeRouteRecord(overrides: Partial<RouteRecord> = {}): RouteRecord {
  return {
    routeId: "route-1",
    requestId: "req-1",
    selectedWorkerId: "w1",
    candidateWorkerIds: ["w1", "w2"],
    selectionReason: "load",
    prefixAffinitySummary: "none",
    loadSummary: "low",
    retryCount: 0,
    traceContext: null,
    createdAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    outcome: "completed",
    ...overrides,
  }
}

describe("getLeaseConstrainedWorkers", () => {
  test("returns workers with dharma correlation envelope", () => {
    const workers = [
      makeWorker({ workerId: "w1" }),
      makeWorker({ workerId: "w2" }),
      makeWorker({ workerId: "w3" }),
    ]
    const envelopes = new Map<string, PrismWorkerCompatibilityEnvelope>([
      ["w1", makeEnvelope({ workerId: "w1", supportsDharmaCorrelation: true })],
      ["w3", makeEnvelope({ workerId: "w3", supportsDharmaCorrelation: true })],
    ])

    const constrained = getLeaseConstrainedWorkers("lease-1", workers, envelopes)
    expect(constrained).toHaveLength(2)
    expect(constrained.map((w) => w.workerId).sort()).toEqual(["w1", "w3"])
  })

  test("excludes workers without envelope", () => {
    const workers = [
      makeWorker({ workerId: "w1" }),
      makeWorker({ workerId: "w2" }),
    ]
    const envelopes = new Map<string, PrismWorkerCompatibilityEnvelope>([
      ["w1", makeEnvelope({ workerId: "w1", supportsDharmaCorrelation: true })],
    ])

    const constrained = getLeaseConstrainedWorkers("lease-1", workers, envelopes)
    expect(constrained).toHaveLength(1)
    expect(constrained[0].workerId).toBe("w1")
  })

  test("excludes workers without dharma correlation support", () => {
    const workers = [
      makeWorker({ workerId: "w1" }),
      makeWorker({ workerId: "w2" }),
    ]
    const envelopes = new Map<string, PrismWorkerCompatibilityEnvelope>([
      ["w1", makeEnvelope({ workerId: "w1", supportsDharmaCorrelation: false })],
      ["w2", makeEnvelope({ workerId: "w2", supportsDharmaCorrelation: true })],
    ])

    const constrained = getLeaseConstrainedWorkers("lease-1", workers, envelopes)
    expect(constrained).toHaveLength(1)
    expect(constrained[0].workerId).toBe("w2")
  })

  test("returns empty array when no workers match", () => {
    const workers = [makeWorker({ workerId: "w1" })]
    const envelopes = new Map<string, PrismWorkerCompatibilityEnvelope>([
      ["w1", makeEnvelope({ workerId: "w1", supportsDharmaCorrelation: false })],
    ])

    expect(getLeaseConstrainedWorkers("lease-1", workers, envelopes)).toHaveLength(0)
  })

  test("returns empty array when no envelopes map", () => {
    const workers = [makeWorker({ workerId: "w1" })]
    expect(getLeaseConstrainedWorkers("lease-1", workers, new Map())).toHaveLength(0)
  })
})

describe("isLeaseCompatible", () => {
  test("returns compatible when all constraints satisfied", () => {
    const env = makeEnvelope({
      modelArtifactDigest: "abc123",
      maximumOutputTokens: 4096,
      maximumContextLength: 8192,
    })
    const result = isLeaseCompatible(env, {
      artifactDigest: "abc123",
      maxTokens: 2048,
      maxRuntime: 300,
    })
    expect(result.compatible).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("incompatible on artifact digest mismatch", () => {
    const env = makeEnvelope({ modelArtifactDigest: "abc123" })
    const result = isLeaseCompatible(env, {
      artifactDigest: "def456",
      maxTokens: 1024,
      maxRuntime: 300,
    })
    expect(result.compatible).toBe(false)
    expect(result.reason).toContain("Artifact digest mismatch")
  })

  test("incompatible on insufficient max output tokens", () => {
    const env = makeEnvelope({ maximumOutputTokens: 512, maximumContextLength: 8192 })
    const result = isLeaseCompatible(env, {
      artifactDigest: "abc123",
      maxTokens: 2048,
      maxRuntime: 300,
    })
    expect(result.compatible).toBe(false)
    expect(result.reason).toContain("Insufficient max output tokens")
  })

  test("incompatible on insufficient context length", () => {
    const env = makeEnvelope({ maximumOutputTokens: 4096, maximumContextLength: 1024 })
    const result = isLeaseCompatible(env, {
      artifactDigest: "abc123",
      maxTokens: 2048,
      maxRuntime: 300,
    })
    expect(result.compatible).toBe(false)
    expect(result.reason).toContain("Insufficient context length")
  })
})

describe("getLeaseRouteSummary", () => {
  test("returns summary with route outcomes and worker count", () => {
    const records = [
      makeRouteRecord({ routeId: "r1", selectedWorkerId: "w1", outcome: "completed" }),
      makeRouteRecord({ routeId: "r2", selectedWorkerId: "w1", outcome: "completed" }),
      makeRouteRecord({ routeId: "r3", selectedWorkerId: "w2", outcome: "failed" }),
      makeRouteRecord({ routeId: "r4", selectedWorkerId: "w2", outcome: "retried" }),
    ]
    const summary = getLeaseRouteSummary(records, "lease-42")
    expect(summary).toContain("Lease lease-42")
    expect(summary).toContain("4 routes")
    expect(summary).toContain("2 workers")
    expect(summary).toContain("completed=2")
    expect(summary).toContain("failed=1")
    expect(summary).toContain("retried=1")
  })

  test("returns empty message for no records", () => {
    const summary = getLeaseRouteSummary([], "lease-empty")
    expect(summary).toBe("Lease lease-empty: no route records")
  })
})
