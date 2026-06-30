/**
 * Integration Tests — Two-Worker KV Affinity
 *
 * Tests that the KV index correctly tracks prefix state per worker,
 * that prefix affinity prefers cached workers, and that load-based
 * selection falls through when no affinity exists.
 * Also tests invalidation on worker restart.
 */

import { describe, it, expect } from "bun:test"
import type {
  RouterWorkerState,
  PrismWorkerCompatibilityEnvelope,
  RouterKvIndexEntry,
} from "../router-types"
import { DEFAULT_SELECTION_WEIGHTS } from "../router-types"
import { selectWorker, type SelectionInput, type SelectionOutput } from "../worker-selector"
import { filterEligibleWorkers } from "../candidate-filter"
import {
  createKvIndexEntry,
  addToIndex,
  getEntriesForWorker,
  getLatestEntryForWorker,
  invalidateWorkerEntries,
} from "../kv-index"
import { computePrefixAffinity } from "../prefix-affinity"
import { NoEligibleWorkerError } from "../router-errors"

// ── Helpers ────────────────────────────────────────────────────────────────

const sharedArtifactDigest = "artifact-v1"
const prefixDigestA = "prefix-aaa"
const prefixDigestB = "prefix-bbb"

function makeWorkerState(id: string, overrides: Partial<RouterWorkerState> = {}): RouterWorkerState {
  return {
    workerId: id,
    instanceId: `${id}-inst-1`,
    compatibility: null,
    healthy: true,
    ready: true,
    draining: false,
    activeRequests: 2,
    maxConcurrentRequests: 4,
    lastHealthCheck: new Date().toISOString(),
    lastError: null,
    lastKvEventSequence: 0,
    kvEventFreshness: null,
    ...overrides,
  }
}

function makeEnvelope(workerId: string): PrismWorkerCompatibilityEnvelope {
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

describe("two-worker-kv-affinity", () => {
  it("KV index stores events per worker", () => {
    const entryA = createKvIndexEntry("worker-a", prefixDigestA, "stored")
    const entryB = createKvIndexEntry("worker-b", prefixDigestB, "stored")

    const index = [entryA, entryB]

    const aEntries = getEntriesForWorker(index, "worker-a")
    expect(aEntries).toHaveLength(1)
    expect(aEntries[0]!.workerId).toBe("worker-a")
    expect(aEntries[0]!.prefixDigest).toBe(prefixDigestA)

    const bEntries = getEntriesForWorker(index, "worker-b")
    expect(bEntries).toHaveLength(1)
    expect(bEntries[0]!.workerId).toBe("worker-b")
    expect(bEntries[0]!.prefixDigest).toBe(prefixDigestB)
  })

  it("prefix affinity prefers worker with cached prefix", () => {
    // Worker A has prefixDigestA in its KV index, Worker B does not
    const wA = makeWorkerState("worker-a")
    const wB = makeWorkerState("worker-b")
    const workers = [wA, wB]
    const envelopes = new Map([
      ["worker-a", makeEnvelope("worker-a")],
      ["worker-b", makeEnvelope("worker-b")],
    ])

    const entry = createKvIndexEntry("worker-a", prefixDigestA, "stored")
    const kvIndex = [entry]

    const eligible = filterEligibleWorkers(workers, candidateConfig, envelopes)
    const input = buildSelectionInput(eligible, envelopes, kvIndex, prefixDigestA)
    const result: SelectionOutput = selectWorker(input)

    // Worker A has affinity for prefixDigestA → selected
    expect(result.workerId).toBe("worker-a")
    expect(result.affinity).not.toBeNull()
    expect(result.affinity!.workerId).toBe("worker-a")
  })

  it("both workers have affinity — prefers stronger affinity", () => {
    // Both workers have entries for the prefix, A has more (stronger)
    const wA = makeWorkerState("worker-a")
    const wB = makeWorkerState("worker-b")
    const workers = [wA, wB]
    const envelopes = new Map([
      ["worker-a", makeEnvelope("worker-a")],
      ["worker-b", makeEnvelope("worker-b")],
    ])

    // Worker A has more blocks → stronger affinity
    const eA1 = createKvIndexEntry("worker-a", prefixDigestA, "stored")
    const eA2 = createKvIndexEntry("worker-a", prefixDigestA, "touched")
    const eB1 = createKvIndexEntry("worker-b", prefixDigestA, "stored")
    const kvIndex = [eA1, eA2, eB1]

    const eligible = filterEligibleWorkers(workers, candidateConfig, envelopes)
    const input = buildSelectionInput(eligible, envelopes, kvIndex, prefixDigestA)
    const result: SelectionOutput = selectWorker(input)

    // Worker A has stronger affinity (more entries)
    expect(result.workerId).toBe("worker-a")
  })

  it("no match — load-based selection", () => {
    // Neither worker has prefix affinity for prefixDigestB
    const wA = makeWorkerState("worker-a", { activeRequests: 3 })
    const wB = makeWorkerState("worker-b", { activeRequests: 1 })
    const workers = [wA, wB]
    const envelopes = new Map([
      ["worker-a", makeEnvelope("worker-a")],
      ["worker-b", makeEnvelope("worker-b")],
    ])

    // Both have entries but for different prefixes
    const e1 = createKvIndexEntry("worker-a", prefixDigestA, "stored")
    const e2 = createKvIndexEntry("worker-b", prefixDigestA, "stored")
    const kvIndex = [e1, e2]

    // Request is for prefixDigestB — no cached affinity
    const eligible = filterEligibleWorkers(workers, candidateConfig, envelopes)
    const input = buildSelectionInput(eligible, envelopes, kvIndex, prefixDigestB)
    const result: SelectionOutput = selectWorker(input)

    // Neither has affinity for B, so load-based → B has lower load
    expect(result.workerId).toBe("worker-b")
    expect(result.affinity).toBeNull()
  })

  it("worker restart — old events invalidated", () => {
    // Simulate pre-restart entries
    const e1 = createKvIndexEntry("worker-a", prefixDigestA, "stored")
    const e2 = createKvIndexEntry("worker-a", prefixDigestA, "touched")
    const e3 = createKvIndexEntry("worker-b", prefixDigestA, "stored")
    const index = [e1, e2, e3]

    // Worker A restarts → invalidate its entries
    const updated = invalidateWorkerEntries(index, "worker-a")

    // Worker A entries should be marked evicted
    const aEntries = getEntriesForWorker(updated, "worker-a")
    expect(aEntries).toHaveLength(2)
    for (const entry of aEntries) {
      expect(entry.state).toBe("evicted")
    }

    // Worker B entries unaffected
    const bEntries = getEntriesForWorker(updated, "worker-b")
    expect(bEntries).toHaveLength(1)
    expect(bEntries[0]!.state).toBe("stored")

    // After invalidation, affinity score for worker A should be lower
    const wA = makeWorkerState("worker-a")
    const wB = makeWorkerState("worker-b")
    const workers = [wA, wB]
    const envelopes = new Map([
      ["worker-a", makeEnvelope("worker-a")],
      ["worker-b", makeEnvelope("worker-b")],
    ])

    const affinityA = computePrefixAffinity("worker-a", prefixDigestA, updated, DEFAULT_SELECTION_WEIGHTS)
    const affinityB = computePrefixAffinity("worker-b", prefixDigestA, updated, DEFAULT_SELECTION_WEIGHTS)

    // Worker A has evicted entries (low residency) vs B's stored entries
    expect(affinityA.residencyWeight).toBeLessThan(affinityB.residencyWeight)
  })

  it("getLatestEntryForWorker returns most recent entry", () => {
    const e1 = createKvIndexEntry("worker-a", prefixDigestA, "stored")
    const e2 = createKvIndexEntry("worker-a", prefixDigestB, "touched")
    const index = [e1, e2]

    // Set sequence numbers to control ordering
    e1.sequenceNumber = 10
    e2.sequenceNumber = 20

    const latest = getLatestEntryForWorker(index, "worker-a")
    expect(latest).toBe(e2)
    expect(latest!.state).toBe("touched")
  })
})
