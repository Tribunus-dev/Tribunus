import { describe, test, expect } from "bun:test"
import type { RouterWorkerState, RouterKvIndexEntry, PrismWorkerCompatibilityEnvelope } from "../router-types"
import { DEFAULT_SELECTION_WEIGHTS } from "../router-types"
import { NoEligibleWorkerError, PrefixAffinityError } from "../router-errors"
import { selectWorker, scoreWorker } from "../worker-selector"
import type { SelectionInput } from "../worker-selector"

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
    workloadClasses: ["chat_completion"],
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

describe("selectWorker", () => {
  test("selects the lower-load worker when no prefix affinity", () => {
    const workers: RouterWorkerState[] = [
      makeWorker({ workerId: "a", activeRequests: 3 }),
      makeWorker({ workerId: "b", activeRequests: 0 }),
    ]
    const envelopes = new Map([
      ["a", makeEnvelope({ workerId: "a" })],
      ["b", makeEnvelope({ workerId: "b" })],
    ])
    const input: SelectionInput = {
      eligibleWorkers: workers,
      prefixDigest: null,
      kvIndex: [],
      envelopes,
    }
    const result = selectWorker(input)
    expect(result.workerId).toBe("b") // lower load
    expect(result.reason).toBe("lowest_load")
  })

  test("selects affine worker when prefix affinity matches", () => {
    const workers: RouterWorkerState[] = [
      makeWorker({ workerId: "a", activeRequests: 0 }),
      makeWorker({ workerId: "b", activeRequests: 0 }),
    ]
    const envelopes = new Map([
      ["a", makeEnvelope({ workerId: "a" })],
      ["b", makeEnvelope({ workerId: "b" })],
    ])
    const kvIndex: RouterKvIndexEntry[] = [
      { workerId: "a", prefixDigest: "p1", sequenceNumber: 1, state: "reused", timestamp: "2026-06-30T12:00:00Z" },
    ]
    const input: SelectionInput = {
      eligibleWorkers: workers,
      prefixDigest: "p1",
      kvIndex,
      envelopes,
    }
    const result = selectWorker(input)
    expect(result.workerId).toBe("a") // has affinity
    expect(result.reason).toBe("affinity_a")
    expect(result.affinity).not.toBeNull()
  })

  test("throws NoEligibleWorkerError when no workers", () => {
    const input: SelectionInput = {
      eligibleWorkers: [],
      prefixDigest: null,
      kvIndex: [],
      envelopes: new Map(),
    }
    expect(() => selectWorker(input)).toThrow(NoEligibleWorkerError)
  })

  test("throws NoEligibleWorkerError when no envelopes", () => {
    const workers: RouterWorkerState[] = [makeWorker({ workerId: "a" })]
    const input: SelectionInput = {
      eligibleWorkers: workers,
      prefixDigest: null,
      kvIndex: [],
      envelopes: new Map(),
    }
    expect(() => selectWorker(input)).toThrow(NoEligibleWorkerError)
  })

  test("prefers affine worker even with slightly higher load", () => {
    const workers: RouterWorkerState[] = [
      makeWorker({ workerId: "a", activeRequests: 1 }),
      makeWorker({ workerId: "b", activeRequests: 0 }),
    ]
    const envelopes = new Map([
      ["a", makeEnvelope({ workerId: "a" })],
      ["b", makeEnvelope({ workerId: "b" })],
    ])
    const kvIndex: RouterKvIndexEntry[] = [
      { workerId: "a", prefixDigest: "p1", sequenceNumber: 1, state: "reused", timestamp: "2026-06-30T12:00:00Z" },
    ]
    const input: SelectionInput = {
      eligibleWorkers: workers,
      prefixDigest: "p1",
      kvIndex,
      envelopes,
    }
    const result = selectWorker(input)
    // Affinity bonus should overcome the slight load penalty
    expect(result.workerId).toBe("a")
  })

  test("selects lowest load when prefix affinity does not match any worker", () => {
    const workers: RouterWorkerState[] = [
      makeWorker({ workerId: "a", activeRequests: 3 }),
      makeWorker({ workerId: "b", activeRequests: 0 }),
    ]
    const envelopes = new Map([
      ["a", makeEnvelope({ workerId: "a" })],
      ["b", makeEnvelope({ workerId: "b" })],
    ])
    // KV index has entries for workers not in the eligible set
    const kvIndex: RouterKvIndexEntry[] = [
      { workerId: "c", prefixDigest: "p1", sequenceNumber: 1, state: "reused", timestamp: "2026-06-30T12:00:00Z" },
    ]
    const input: SelectionInput = {
      eligibleWorkers: workers,
      prefixDigest: "p1",
      kvIndex,
      envelopes,
    }
    const result = selectWorker(input)
    expect(result.workerId).toBe("b") // lowest load
    expect(result.reason).toBe("lowest_load")
  })
})

describe("scoreWorker", () => {
  test("returns zero for fully healthy, idle worker with no affinity", () => {
    const worker = makeWorker()
    const score = scoreWorker(worker, null, DEFAULT_SELECTION_WEIGHTS)
    expect(score).toBe(0)
  })

  test("returns positive when affinity is present", () => {
    const worker = makeWorker()
    const affinity = {
      workerId: "worker-a",
      matchedPrefixTokens: 512,
      matchedPrefixBlocks: 2,
      longestConsecutivePrefixBlocks: 2,
      residencyWeight: 0.8,
      affinityScore: 0.6,
      eventFreshness: "2026-06-30T12:00:00Z",
    }
    const score = scoreWorker(worker, affinity, DEFAULT_SELECTION_WEIGHTS)
    expect(score).toBeGreaterThan(0)
  })

  test("returns negative for unhealthy, loaded worker", () => {
    const worker = makeWorker({
      healthy: false,
      lastError: "OOM crash",
      activeRequests: 4,
      maxConcurrentRequests: 4,
    })
    const score = scoreWorker(worker, null, DEFAULT_SELECTION_WEIGHTS)
    expect(score).toBeLessThan(0)
  })
})
