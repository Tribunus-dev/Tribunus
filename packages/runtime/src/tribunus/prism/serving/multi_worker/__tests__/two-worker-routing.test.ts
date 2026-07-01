/**
 * Integration Tests — Two-Worker Routing
 *
 * Tests that the multi-worker selection pipeline correctly routes requests
 * when both workers advertise the same artifact, with compatibility
 * filtering, prefix affinity, and load scoring.
 */

import { describe, it, expect } from "bun:test"
import type {
  RouterWorkerState,
  PrismWorkerCompatibilityEnvelope,
  SelectionWeights,
  RouterKvIndexEntry,
} from "../router-types"
import { DEFAULT_SELECTION_WEIGHTS } from "../router-types"
import { selectWorker, type SelectionInput, type SelectionOutput } from "../worker-selector"
import { filterEligibleWorkers } from "../candidate-filter"
import { createKvIndexEntry, addToIndex } from "../kv-index"
import { computePrefixAffinity } from "../prefix-affinity"
import { NoEligibleWorkerError } from "../router-errors"

// ── Helpers ────────────────────────────────────────────────────────────────

const sharedArtifactDigest = "artifact-v1-abc123"
const sharedPrefixDigest = "prefix-xyz789"

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

function makeEnvelope(workerId: string, overrides: Partial<PrismWorkerCompatibilityEnvelope> = {}): PrismWorkerCompatibilityEnvelope {
  return {
    workerId,
    workerInstanceId: `${workerId}-inst-1`,
    modelArtifactDigest: sharedArtifactDigest,
    tokenizerDigest: "tok-v1",
    modelFamily: "llama",
    workloadClasses: ["chat_completion"],
    targetCapabilitySignature: "sig-v1",
    computeImageDigest: "compute-v1",
    precisionMode: "fp16",
    maximumContextLength: 4096,
    maximumOutputTokens: 2048,
    maximumConcurrentRequests: 4,
    kvEventVersion: 1,
    kvLocalityMode: "device_local",
    supportsStreaming: true,
    supportsCancellation: true,
    supportsDrain: true,
    supportsDharmaCorrelation: false,
    lifecycleState: "serving",
    ...overrides,
  }
}

const candidateConfig = {
  requiredArtifactDigest: sharedArtifactDigest,
  requiredWorkloadClass: "chat_completion",
  requiredStreaming: false,
  requiredTokens: 512,
  dharmaLeaseConstraints: null,
}

function buildSelectionInput(
  workers: RouterWorkerState[],
  envelopes: Map<string, PrismWorkerCompatibilityEnvelope>,
  kvIndex: RouterKvIndexEntry[],
  prefixDigest: string | null = null,
): SelectionInput {
  return {
    eligibleWorkers: workers,
    prefixDigest,
    kvIndex,
    envelopes,
    weights: DEFAULT_SELECTION_WEIGHTS,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("two-worker-routing", () => {
  it("both workers advertise same artifact — both eligible", () => {
    const wA = makeWorkerState("worker-a")
    const wB = makeWorkerState("worker-b")
    const workers = [wA, wB]
    const envelopes = new Map([
      ["worker-a", makeEnvelope("worker-a")],
      ["worker-b", makeEnvelope("worker-b")],
    ])

    const eligible = filterEligibleWorkers(workers, candidateConfig, envelopes)
    expect(eligible).toHaveLength(2)
    expect(eligible.map((w) => w.workerId).sort()).toEqual(["worker-a", "worker-b"])
  })

  it("request without prefix routes to lower-load worker", () => {
    // Worker B has lower load (0 active vs A's 3)
    const wA = makeWorkerState("worker-a", { activeRequests: 3 })
    const wB = makeWorkerState("worker-b", { activeRequests: 0 })
    const workers = [wA, wB]
    const envelopes = new Map([
      ["worker-a", makeEnvelope("worker-a")],
      ["worker-b", makeEnvelope("worker-b")],
    ])
    const kvIndex: RouterKvIndexEntry[] = []

    const eligible = filterEligibleWorkers(workers, candidateConfig, envelopes)
    const input = buildSelectionInput(eligible, envelopes, kvIndex)
    const result: SelectionOutput = selectWorker(input)

    // Without prefix affinity, load-based selection should pick B
    expect(result.workerId).toBe("worker-b")
    expect(result.reason).toContain("load")
  })

  it("request with cached prefix routes to affine worker", () => {
    // Worker A has cached prefix, Worker B does not
    const wA = makeWorkerState("worker-a")
    const wB = makeWorkerState("worker-b")
    const workers = [wA, wB]
    const envelopes = new Map([
      ["worker-a", makeEnvelope("worker-a")],
      ["worker-b", makeEnvelope("worker-b")],
    ])

    const e1 = createKvIndexEntry("worker-a", sharedPrefixDigest, "stored")
    const kvIndex = [e1]

    const eligible = filterEligibleWorkers(workers, candidateConfig, envelopes)
    const input = buildSelectionInput(eligible, envelopes, kvIndex, sharedPrefixDigest)
    const result: SelectionOutput = selectWorker(input)

    // Worker A has prefix affinity, B does not → A should be selected
    expect(result.workerId).toBe("worker-a")
    expect(result.affinity).not.toBeNull()
    expect(result.affinity!.workerId).toBe("worker-a")
    expect(result.affinity!.affinityScore).toBeGreaterThan(0)
  })

  it("incompatible worker filtered — only compatible worker selected", () => {
    // Worker A has wrong artifact digest → filtered out
    const wA = makeWorkerState("worker-a")
    const wB = makeWorkerState("worker-b")
    const workers = [wA, wB]
    const envelopes = new Map([
      ["worker-a", makeEnvelope("worker-a", { modelArtifactDigest: "wrong-artifact" })],
      ["worker-b", makeEnvelope("worker-b")],
    ])

    const eligible = filterEligibleWorkers(workers, candidateConfig, envelopes)
    expect(eligible).toHaveLength(1)
    expect(eligible[0]!.workerId).toBe("worker-b")

    const kvIndex: RouterKvIndexEntry[] = []
    const input = buildSelectionInput(eligible, envelopes, kvIndex)
    const result: SelectionOutput = selectWorker(input)
    expect(result.workerId).toBe("worker-b")
  })

  it("capacity-full worker filtered — only available worker selected", () => {
    // Worker A is at max capacity
    const wA = makeWorkerState("worker-a", { activeRequests: 4, maxConcurrentRequests: 4 })
    const wB = makeWorkerState("worker-b", { activeRequests: 2, maxConcurrentRequests: 4 })
    const workers = [wA, wB]
    const envelopes = new Map([
      ["worker-a", makeEnvelope("worker-a")],
      ["worker-b", makeEnvelope("worker-b")],
    ])

    const eligible = filterEligibleWorkers(workers, candidateConfig, envelopes)
    expect(eligible).toHaveLength(1)
    expect(eligible[0]!.workerId).toBe("worker-b")

    const kvIndex: RouterKvIndexEntry[] = []
    const input = buildSelectionInput(eligible, envelopes, kvIndex)
    const result: SelectionOutput = selectWorker(input)
    expect(result.workerId).toBe("worker-b")
  })

  it("throws NoEligibleWorkerError when all workers filtered", () => {
    const wA = makeWorkerState("worker-a", { activeRequests: 4, maxConcurrentRequests: 4 })
    const wB = makeWorkerState("worker-b", { activeRequests: 4, maxConcurrentRequests: 4 })
    const workers = [wA, wB]
    const envelopes = new Map([
      ["worker-a", makeEnvelope("worker-a")],
      ["worker-b", makeEnvelope("worker-b")],
    ])

    const eligible = filterEligibleWorkers(workers, candidateConfig, envelopes)
    expect(eligible).toHaveLength(0)

    const kvIndex: RouterKvIndexEntry[] = []
    const input = buildSelectionInput(eligible, envelopes, kvIndex)
    expect(() => selectWorker(input)).toThrow(NoEligibleWorkerError)
  })
})
