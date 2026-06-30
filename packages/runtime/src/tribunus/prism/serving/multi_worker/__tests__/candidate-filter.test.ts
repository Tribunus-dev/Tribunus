import { describe, test, expect } from "bun:test"
import type { RouterWorkerState, PrismWorkerCompatibilityEnvelope } from "../router-types"
import { filterEligibleWorkers, checkWorkerHealth, checkWorkerCapacity, checkWorkerDrain } from "../candidate-filter"
import type { CandidateFilterConfig } from "../candidate-filter"

function makeWorker(overrides: Partial<RouterWorkerState> = {}): RouterWorkerState {
  return {
    workerId: "worker-a",
    instanceId: "inst-a",
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

function makeEnvelope(overrides: Partial<PrismWorkerCompatibilityEnvelope> = {}): PrismWorkerCompatibilityEnvelope {
  return {
    workerId: "worker-a",
    workerInstanceId: "inst-a",
    modelArtifactDigest: "abc123",
    tokenizerDigest: "tok123",
    modelFamily: "llama-3",
    workloadClasses: ["chat_completion", "completion"],
    targetCapabilitySignature: "sig-v1",
    computeImageDigest: "img456",
    precisionMode: "fp16",
    maximumContextLength: 8192,
    maximumOutputTokens: 2048,
    maximumConcurrentRequests: 4,
    kvEventVersion: 1,
    kvLocalityMode: "prefix",
    supportsStreaming: true,
    supportsCancellation: true,
    supportsDrain: true,
    supportsDharmaCorrelation: false,
    lifecycleState: "serving",
    ...overrides,
  }
}

const defaultConfig: CandidateFilterConfig = {
  requiredArtifactDigest: "abc123",
  requiredWorkloadClass: "chat_completion",
  requiredStreaming: true,
  requiredTokens: 1024,
  dharmaLeaseConstraints: null,
}

describe("checkWorkerHealth", () => {
  test("healthy and ready returns true", () => {
    expect(checkWorkerHealth(makeWorker())).toBe(true)
  })

  test("unhealthy returns false", () => {
    expect(checkWorkerHealth(makeWorker({ healthy: false }))).toBe(false)
  })

  test("not ready returns false", () => {
    expect(checkWorkerHealth(makeWorker({ ready: false }))).toBe(false)
  })

  test("both unhealthy and not ready returns false", () => {
    expect(checkWorkerHealth(makeWorker({ healthy: false, ready: false }))).toBe(false)
  })
})

describe("checkWorkerCapacity", () => {
  test("idle returns true", () => {
    expect(checkWorkerCapacity(makeWorker({ activeRequests: 0, maxConcurrentRequests: 4 }))).toBe(true)
  })

  test("under capacity returns true", () => {
    expect(checkWorkerCapacity(makeWorker({ activeRequests: 3, maxConcurrentRequests: 4 }))).toBe(true)
  })

  test("at capacity returns false", () => {
    expect(checkWorkerCapacity(makeWorker({ activeRequests: 4, maxConcurrentRequests: 4 }))).toBe(false)
  })

  test("over capacity returns false", () => {
    expect(checkWorkerCapacity(makeWorker({ activeRequests: 5, maxConcurrentRequests: 4 }))).toBe(false)
  })
})

describe("checkWorkerDrain", () => {
  test("not draining returns true", () => {
    expect(checkWorkerDrain(makeWorker({ draining: false }))).toBe(true)
  })

  test("draining returns false", () => {
    expect(checkWorkerDrain(makeWorker({ draining: true }))).toBe(false)
  })
})

describe("filterEligibleWorkers", () => {
  test("passes a fully eligible worker", () => {
    const workers = [makeWorker()]
    const envelopes = new Map([["worker-a", makeEnvelope()]])
    const result = filterEligibleWorkers(workers, defaultConfig, envelopes)
    expect(result).toHaveLength(1)
    expect(result[0].workerId).toBe("worker-a")
  })

  test("rejects worker missing envelope", () => {
    const workers = [makeWorker()]
    const envelopes = new Map<string, PrismWorkerCompatibilityEnvelope>()
    const result = filterEligibleWorkers(workers, defaultConfig, envelopes)
    expect(result).toHaveLength(0)
  })

  test("rejects worker with wrong artifact digest", () => {
    const workers = [makeWorker()]
    const envelopes = new Map([["worker-a", makeEnvelope({ modelArtifactDigest: "wrong" })]])
    const result = filterEligibleWorkers(workers, defaultConfig, envelopes)
    expect(result).toHaveLength(0)
  })

  test("rejects worker missing workload class", () => {
    const workers = [makeWorker()]
    const envelopes = new Map([["worker-a", makeEnvelope({ workloadClasses: ["embedding"] })]])
    const result = filterEligibleWorkers(workers, defaultConfig, envelopes)
    expect(result).toHaveLength(0)
  })

  test("rejects worker that cannot stream when required", () => {
    const workers = [makeWorker()]
    const envelopes = new Map([["worker-a", makeEnvelope({ supportsStreaming: false })]])
    const result = filterEligibleWorkers(workers, defaultConfig, envelopes)
    expect(result).toHaveLength(0)
  })

  test("rejects worker with insufficient output tokens", () => {
    const workers = [makeWorker()]
    const envelopes = new Map([["worker-a", makeEnvelope({ maximumOutputTokens: 512 })]])
    const result = filterEligibleWorkers(workers, defaultConfig, envelopes)
    expect(result).toHaveLength(0)
  })

  test("rejects worker missing dharma correlation when constraints exist", () => {
    const config: CandidateFilterConfig = {
      ...defaultConfig,
      dharmaLeaseConstraints: { sessionId: "sess-1" },
    }
    const workers = [makeWorker()]
    const envelopes = new Map([["worker-a", makeEnvelope({ supportsDharmaCorrelation: false })]])
    const result = filterEligibleWorkers(workers, config, envelopes)
    expect(result).toHaveLength(0)
  })

  test("passes worker with dharma correlation when constraints exist and supported", () => {
    const config: CandidateFilterConfig = {
      ...defaultConfig,
      dharmaLeaseConstraints: { sessionId: "sess-1" },
    }
    const workers = [makeWorker()]
    const envelopes = new Map([["worker-a", makeEnvelope({ supportsDharmaCorrelation: true })]])
    const result = filterEligibleWorkers(workers, config, envelopes)
    expect(result).toHaveLength(1)
  })

  test("filters out unhealthy, at-capacity, draining workers", () => {
    const workers = [
      makeWorker({ workerId: "a" }),
      makeWorker({ workerId: "b", healthy: false }),
      makeWorker({ workerId: "c", activeRequests: 4, maxConcurrentRequests: 4 }),
      makeWorker({ workerId: "d", draining: true }),
    ]
    const envelopes = new Map([
      ["a", makeEnvelope({ workerId: "a" })],
      ["b", makeEnvelope({ workerId: "b" })],
      ["c", makeEnvelope({ workerId: "c" })],
      ["d", makeEnvelope({ workerId: "d" })],
    ])
    const result = filterEligibleWorkers(workers, defaultConfig, envelopes)
    expect(result).toHaveLength(1)
    expect(result[0].workerId).toBe("a")
  })
})
