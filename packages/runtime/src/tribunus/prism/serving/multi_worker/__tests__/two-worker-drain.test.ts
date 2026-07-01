/**
 * Integration Tests — Two-Worker Drain
 *
 * Tests that the drain manager correctly excludes draining workers from
 * selection and re-admits them when they resume.
 */

import { describe, it, expect } from "bun:test"
import type {
  RouterWorkerState,
  PrismWorkerCompatibilityEnvelope,
  RouterKvIndexEntry,
} from "../router-types"
import { requestDrain, completeDrain, resumeWorker, isWorkerDraining } from "../worker-drain-manager"
import { filterEligibleWorkers } from "../candidate-filter"
import { checkWorkerDrain } from "../candidate-filter"

// ── Helpers ────────────────────────────────────────────────────────────────

const sharedArtifactDigest = "artifact-v1"

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

// ── Tests ──────────────────────────────────────────────────────────────────

describe("two-worker-drain", () => {
  it("Worker A draining — request routes to B", () => {
    // Start both workers, then drain A
    let workers = [
      makeWorkerState("worker-a"),
      makeWorkerState("worker-b"),
    ]
    const envelopes = new Map([
      ["worker-a", makeEnvelope("worker-a")],
      ["worker-b", makeEnvelope("worker-b")],
    ])

    // Drain worker A
    workers = requestDrain("worker-a", workers)

    // A should be marked draining
    expect(isWorkerDraining(workers.find((w) => w.workerId === "worker-a")!)).toBe(true)

    // Candidate filtering should exclude A
    const eligible = filterEligibleWorkers(workers, candidateConfig, envelopes)
    expect(eligible).toHaveLength(1)
    expect(eligible[0]!.workerId).toBe("worker-b")
  })

  it("Worker A resumes — eligible again", () => {
    let workers = [
      makeWorkerState("worker-a", { draining: true }),
      makeWorkerState("worker-b"),
    ]
    const envelopes = new Map([
      ["worker-a", makeEnvelope("worker-a")],
      ["worker-b", makeEnvelope("worker-b")],
    ])

    // Initially A is draining → only B is eligible
    let eligible = filterEligibleWorkers(workers, candidateConfig, envelopes)
    expect(eligible).toHaveLength(1)

    // Resume A
    workers = resumeWorker("worker-a", workers)
    expect(isWorkerDraining(workers.find((w) => w.workerId === "worker-a")!)).toBe(false)

    // Now both are eligible
    eligible = filterEligibleWorkers(workers, candidateConfig, envelopes)
    expect(eligible).toHaveLength(2)
  })

  it("completeDrain marks worker not ready and not healthy", () => {
    let workers = [
      makeWorkerState("worker-a", { draining: true }),
      makeWorkerState("worker-b"),
    ]

    workers = completeDrain("worker-a", workers)

    const wA = workers.find((w) => w.workerId === "worker-a")!
    expect(wA.draining).toBe(false)
    expect(wA.ready).toBe(false)
    expect(wA.healthy).toBe(false)
  })

  it("draining worker excluded via checkWorkerDrain", () => {
    const draining = makeWorkerState("worker-a", { draining: true })
    expect(checkWorkerDrain(draining)).toBe(false)

    const normal = makeWorkerState("worker-b")
    expect(checkWorkerDrain(normal)).toBe(true)
  })

  it("requestDrain throws for already draining worker", () => {
    const workers = [makeWorkerState("worker-a", { draining: true })]
    expect(() => requestDrain("worker-a", workers)).toThrow(
      "is already draining",
    )
  })

  it("resumeWorker throws for non-draining worker", () => {
    const workers = [makeWorkerState("worker-a")]
    expect(() => resumeWorker("worker-a", workers)).toThrow(
      "is not draining and cannot be resumed",
    )
  })
})
