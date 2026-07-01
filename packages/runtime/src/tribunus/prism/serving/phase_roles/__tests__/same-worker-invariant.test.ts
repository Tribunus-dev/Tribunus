/**
 * Prism Phase Roles — Same-Worker Invariant Tests
 *
 * Verifies the core architectural invariant: prefill and decode phases
 * MUST execute on the same worker instance. No cross-worker KV transfer
 * is permitted in the phase-role architecture.
 */

import { expect, test, describe } from "bun:test"
import { checkSameWorkerInvariant, checkWorkerPhaseCapability, checkPhaseCoLocation } from "../phase-route-validator"
import { createRoutePlan } from "../phase-route-plan"
import type { PrismWorkerCompatibilityEnvelopeV2 } from "../phase-role-types"

// ── Helpers -----------------------------------------------------------------

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

// ── checkSameWorkerInvariant -----------------------------------------------

describe("checkSameWorkerInvariant", () => {
  test("passes when prefill and decode worker are the same", () => {
    const plan = createRoutePlan("req-001", ["w1"], "w1", "", "")
    const r = checkSameWorkerInvariant(plan)
    expect(r.passed).toBe(true)
    expect(r.reason).toBeNull()
  })

  test("fails when prefill and decode worker differ", () => {
    const plan = createRoutePlan("req-002", ["w1", "w2"], "w1", "", "")
    plan.decodeWorkerId = "w2"
    const r = checkSameWorkerInvariant(plan)
    expect(r.passed).toBe(false)
    expect(r.reason).toContain("Same-worker invariant violated")
    expect(r.reason).toContain("w1")
    expect(r.reason).toContain("w2")
  })
})

// ── checkWorkerPhaseCapability ---------------------------------------------

describe("checkWorkerPhaseCapability", () => {
  test("passes for unified worker with both requirements", () => {
    const env = makeEnv()
    const r = checkWorkerPhaseCapability(env, true, true)
    expect(r.passed).toBe(true)
    expect(r.reason).toBeNull()
  })

  test("passes for unified worker with single requirement", () => {
    const env = makeEnv()
    expect(checkWorkerPhaseCapability(env, true, false).passed).toBe(true)
    expect(checkWorkerPhaseCapability(env, false, true).passed).toBe(true)
  })

  test("fails when prefill required but worker is decode-only", () => {
    const env = makeEnv({ workerRoles: ["decode_only"] })
    const r = checkWorkerPhaseCapability(env, true, false)
    expect(r.passed).toBe(false)
    expect(r.reason).toContain("lacks prefill capability")
  })

  test("fails when decode required but worker is prefill-only", () => {
    const env = makeEnv({ workerRoles: ["prefill_only"] })
    const r = checkWorkerPhaseCapability(env, false, true)
    expect(r.passed).toBe(false)
    expect(r.reason).toContain("lacks decode capability")
  })

  test("fails when nothing is required", () => {
    const env = makeEnv()
    const r = checkWorkerPhaseCapability(env, false, false)
    expect(r.passed).toBe(false)
    expect(r.reason).toContain("At least one")
  })

  test("passes for prefill_preferred worker with prefill required", () => {
    const env = makeEnv({ workerRoles: ["prefill_preferred"] })
    expect(checkWorkerPhaseCapability(env, true, false).passed).toBe(true)
  })

  test("passes for decode_preferred worker with decode required", () => {
    const env = makeEnv({ workerRoles: ["decode_preferred"] })
    expect(checkWorkerPhaseCapability(env, false, true).passed).toBe(true)
  })
})

// ── checkPhaseCoLocation ---------------------------------------------------

describe("checkPhaseCoLocation", () => {
  test("passes for same_worker_required policy", () => {
    const env = makeEnv({ phaseCoLocationPolicy: "same_worker_required" })
    const r = checkPhaseCoLocation(env)
    expect(r.passed).toBe(true)
    expect(r.reason).toBeNull()
  })

  test("passes for future_transfer_capable policy", () => {
    const env = makeEnv({ phaseCoLocationPolicy: "future_transfer_capable" })
    const r = checkPhaseCoLocation(env)
    expect(r.passed).toBe(true)
    expect(r.reason).toBeNull()
  })

  test("fails for not_supported policy", () => {
    const env = makeEnv({ phaseCoLocationPolicy: "not_supported" })
    const r = checkPhaseCoLocation(env)
    expect(r.passed).toBe(false)
    expect(r.reason).toContain("not_supported")
  })
})
