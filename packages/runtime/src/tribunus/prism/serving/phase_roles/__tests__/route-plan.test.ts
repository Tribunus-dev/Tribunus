/**
 * Prism Phase Roles — Route Plan Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createRoutePlan,
  validateRoutePlan,
  isRoutePlanSameWorker,
  scorePhaseWorker,
} from "../phase-route-plan"
import type { PrismRoutePlan, PrismWorkerCompatibilityEnvelopeV2, PrismPhaseCapacitySnapshot } from "../phase-role-types"
import type { RouterWorkerState, SelectionWeights } from "../../multi_worker/router-types"

// ── Fixtures ----------------------------------------------------------------

const BASE_SELECTION_WEIGHTS: SelectionWeights = {
  cacheAffinityWeight: 0.5,
  loadWeight: 0.2,
  healthWeight: 0.2,
  errorWeight: 0.05,
  drainWeight: 0.05,
}

function makeHealthyWorkerState(overrides?: Partial<RouterWorkerState>): RouterWorkerState {
  return {
    workerId: "worker-a",
    instanceId: "instance-a-1",
    compatibility: null,
    healthy: true,
    ready: true,
    draining: false,
    activeRequests: 1,
    maxConcurrentRequests: 10,
    lastHealthCheck: "2026-06-30T00:00:00.000Z",
    lastError: null,
    lastKvEventSequence: 42,
    kvEventFreshness: "2026-06-30T00:00:00.000Z",
    ...overrides,
  }
}

function makeEnv(
  overrides?: Partial<PrismWorkerCompatibilityEnvelopeV2>,
): PrismWorkerCompatibilityEnvelopeV2 {
  return {
    workerId: "worker-a",
    workerInstanceId: "instance-a-1",
    modelArtifactDigest: "mdl-abc",
    tokenizerDigest: "tok-xyz",
    modelFamily: "gpt-4",
    workloadClasses: ["llm-inference"],
    targetCapabilitySignature: "sig-v1",
    computeImageDigest: "img-123",
    precisionMode: "fp16",
    maximumContextLength: 128000,
    maximumOutputTokens: 4096,
    maximumConcurrentRequests: 10,
    kvEventVersion: 2,
    kvLocalityMode: "local",
    lifecycleState: "active",
    workerRoles: ["unified"],
    prefillCapability: {
      supported: true,
      enabled: true,
      admissionState: "open",
      maximumConcurrentOperations: 10,
      maximumInputTokens: 128000,
      maximumOutputTokens: null,
      maximumRuntimeMs: 30000,
      maximumMemoryBytes: 8589934592,
      preferredBatchSize: null,
      targetProfileDigest: "pf-prefill-1",
      computeImageProfileDigest: "ci-prefill-1",
    },
    decodeCapability: {
      supported: true,
      enabled: true,
      admissionState: "open",
      maximumConcurrentOperations: 10,
      maximumInputTokens: 128000,
      maximumOutputTokens: 4096,
      maximumRuntimeMs: 120000,
      maximumMemoryBytes: 8589934592,
      preferredBatchSize: null,
      targetProfileDigest: "pf-decode-1",
      computeImageProfileDigest: "ci-decode-1",
    },
    prefillProfile: {
      profileDigest: "pf-prefill-1",
      maximumContextTokens: 128000,
      maximumPrefillBatchSize: 8,
      maximumPrefillConcurrency: 10,
      maximumPrefillMemoryBytes: 8589934592,
      preferredPromptLengthBand: "medium",
      estimatedPrefillTokensPerSecond: 5000,
      supportsPrefixReuse: true,
      supportsPromptBatching: true,
      targetCapabilitySignature: "sig-v1",
      computeImageDigest: "ci-prefill-1",
    },
    decodeProfile: {
      profileDigest: "pf-decode-1",
      maximumDecodeConcurrency: 10,
      maximumActiveKvNamespaces: 100,
      maximumOutputTokens: 4096,
      preferredGenerationLengthBand: "medium",
      estimatedDecodeTokensPerSecond: 100,
      supportsStreaming: true,
      supportsCancellation: true,
      supportsKvReuse: true,
      latencyClass: "interactive",
      targetCapabilitySignature: "sig-v1",
      computeImageDigest: "ci-decode-1",
    },
    phaseCoLocationPolicy: "same_worker_required",
    prefillCapacity: 10,
    decodeCapacity: 10,
    supportsPhaseMetrics: true,
    supportsPhaseReceipts: true,
    ...overrides,
  }
}

// ── createRoutePlan ---------------------------------------------------------

describe("createRoutePlan", () => {
  test("creates a valid route plan with same-worker pinning", () => {
    const plan = createRoutePlan(
      "req-001",
      ["worker-a", "worker-b"],
      "worker-a",
      "Prefill selection: worker-a has prefix cache",
      "Decode selection: same worker as prefill",
    )
    expect(plan.routeId).toBeDefined()
    expect(plan.routeId.length).toBeGreaterThan(0)
    expect(plan.requestId).toBe("req-001")
    expect(plan.candidateWorkers).toEqual(["worker-a", "worker-b"])
    expect(plan.selectedWorkerId).toBe("worker-a")
    expect(plan.prefillWorkerId).toBe("worker-a")
    expect(plan.decodeWorkerId).toBe("worker-a")
    expect(plan.executionPinningPolicy).toBe("same_worker_required")
    expect(plan.prefillSelectionReason).toBe("Prefill selection: worker-a has prefix cache")
    expect(plan.decodeSelectionReason).toBe("Decode selection: same worker as prefill")
    expect(plan.createdAt).toBeDefined()
    expect(() => new Date(plan.createdAt)).not.toThrow()
  })

  test("includes ULID routeId", () => {
    const a = createRoutePlan("req-002", ["w1"], "w1", "", "")
    const b = createRoutePlan("req-002", ["w1"], "w1", "", "")
    expect(a.routeId).not.toBe(b.routeId)
  })
})

// ── validateRoutePlan -------------------------------------------------------

describe("validateRoutePlan", () => {
  function validPlan(): PrismRoutePlan {
    return createRoutePlan("req-001", ["worker-a"], "worker-a", "reason", "reason")
  }

  test("accepts a valid plan", () => {
    const r = validateRoutePlan(validPlan())
    expect(r.valid).toBe(true)
    expect(r.reason).toBeNull()
  })

  test("rejects empty routeId", () => {
    const plan = validPlan()
    plan.routeId = ""
    const r = validateRoutePlan(plan)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain("routeId")
  })

  test("rejects empty requestId", () => {
    const plan = validPlan()
    plan.requestId = ""
    const r = validateRoutePlan(plan)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain("requestId")
  })

  test("rejects empty selectedWorkerId", () => {
    const plan = validPlan()
    plan.selectedWorkerId = ""
    const r = validateRoutePlan(plan)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain("selectedWorkerId")
  })

  test("rejects empty prefillWorkerId", () => {
    const plan = validPlan()
    plan.prefillWorkerId = ""
    const r = validateRoutePlan(plan)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain("prefillWorkerId")
  })

  test("rejects empty decodeWorkerId", () => {
    const plan = validPlan()
    plan.decodeWorkerId = ""
    const r = validateRoutePlan(plan)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain("decodeWorkerId")
  })

  test("rejects empty candidates", () => {
    const plan = validPlan()
    plan.candidateWorkers = []
    const r = validateRoutePlan(plan)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain("candidateWorkers")
  })

  test("rejects selectedWorkerId not in candidates", () => {
    const plan = validPlan()
    plan.selectedWorkerId = "worker-z"
    const r = validateRoutePlan(plan)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain("candidateWorkers")
  })

  test("rejects invalid createdAt", () => {
    const plan = validPlan()
    plan.createdAt = "not-a-date"
    const r = validateRoutePlan(plan)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain("createdAt")
  })
})

// ── isRoutePlanSameWorker ---------------------------------------------------

describe("isRoutePlanSameWorker", () => {
  test("returns true when prefill and decode worker are the same", () => {
    const plan = createRoutePlan("req-001", ["w1"], "w1", "", "")
    expect(isRoutePlanSameWorker(plan)).toBe(true)
  })

  test("returns false when prefill and decode worker differ", () => {
    const plan = createRoutePlan("req-002", ["w1", "w2"], "w1", "", "")
    plan.decodeWorkerId = "w2"
    expect(isRoutePlanSameWorker(plan)).toBe(false)
  })
})

// ── scorePhaseWorker ---------------------------------------------------------

describe("scorePhaseWorker", () => {
  test("scores a healthy ready worker higher than an unhealthy one", () => {
    const env = makeEnv()

    const healthy = makeHealthyWorkerState()
    const unhealthy = makeHealthyWorkerState({ healthy: false, ready: false })

    const scoreHealthy = scorePhaseWorker(
      healthy,
      env,
      null,
      0,
      BASE_SELECTION_WEIGHTS,
    )
    const scoreUnhealthy = scorePhaseWorker(
      unhealthy,
      env,
      null,
      0,
      BASE_SELECTION_WEIGHTS,
    )
    expect(scoreHealthy).toBeGreaterThan(scoreUnhealthy)
  })

  test("scores a non-draining worker higher than a draining one", () => {
    const env = makeEnv()

    const normal = makeHealthyWorkerState()
    const draining = makeHealthyWorkerState({ draining: true })

    const scoreNormal = scorePhaseWorker(
      normal,
      env,
      null,
      0,
      BASE_SELECTION_WEIGHTS,
    )
    const scoreDraining = scorePhaseWorker(
      draining,
      env,
      null,
      0,
      BASE_SELECTION_WEIGHTS,
    )
    expect(scoreNormal).toBeGreaterThan(scoreDraining)
  })

  test("applies cache affinity weight", () => {
    const env = makeEnv()

    const worker = makeHealthyWorkerState()

    const highAffinity = scorePhaseWorker(
      worker,
      env,
      null,
      1.0,
      BASE_SELECTION_WEIGHTS,
    )
    const lowAffinity = scorePhaseWorker(
      worker,
      env,
      null,
      0.0,
      BASE_SELECTION_WEIGHTS,
    )
    expect(highAffinity - lowAffinity).toBeCloseTo(BASE_SELECTION_WEIGHTS.cacheAffinityWeight, 5)
  })

  test("applies error penalty", () => {
    const env = makeEnv()

    const clean = makeHealthyWorkerState()
    const errored = makeHealthyWorkerState({ lastError: "OOM" })

    const scoreClean = scorePhaseWorker(
      clean,
      env,
      null,
      0,
      BASE_SELECTION_WEIGHTS,
    )
    const scoreErrored = scorePhaseWorker(
      errored,
      env,
      null,
      0,
      BASE_SELECTION_WEIGHTS,
    )
    const diff = scoreClean - scoreErrored
    expect(diff).toBeCloseTo(BASE_SELECTION_WEIGHTS.errorWeight * 0.5, 10)
  })

  test("clamps prefixAffinity to 0..1 range", () => {
    const env = makeEnv()
    const worker = makeHealthyWorkerState()

    const clampedHigh = scorePhaseWorker(
      worker,
      env,
      null,
      5.0,
      BASE_SELECTION_WEIGHTS,
    )
    const clampedLow = scorePhaseWorker(
      worker,
      env,
      null,
      -1.0,
      BASE_SELECTION_WEIGHTS,
    )
    const normal = scorePhaseWorker(
      worker,
      env,
      null,
      0.5,
      BASE_SELECTION_WEIGHTS,
    )
    expect(clampedHigh).toBe(normal + BASE_SELECTION_WEIGHTS.cacheAffinityWeight * 0.5)
    expect(clampedLow).toBe(normal - BASE_SELECTION_WEIGHTS.cacheAffinityWeight * 0.5)
  })

  test("applies load weight proportional to remaining capacity", () => {
    const env = makeEnv()

    const idle = makeHealthyWorkerState({ activeRequests: 0, maxConcurrentRequests: 10 })
    const full = makeHealthyWorkerState({ activeRequests: 10, maxConcurrentRequests: 10 })

    const scoreIdle = scorePhaseWorker(
      idle,
      env,
      null,
      0,
      BASE_SELECTION_WEIGHTS,
    )
    const scoreFull = scorePhaseWorker(
      full,
      env,
      null,
      0,
      BASE_SELECTION_WEIGHTS,
    )
    expect(scoreIdle - scoreFull).toBeCloseTo(BASE_SELECTION_WEIGHTS.loadWeight, 5)
  })
})
