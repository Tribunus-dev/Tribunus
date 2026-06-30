/**
 * Tests — Dharma Phase Budget
 */

import { describe, it, expect } from "bun:test"
import {
  createDharmaPhaseBudget,
  isLeaseCompatibleWithPhase,
  isPhaseBudgetSufficient,
  isSameWorkerRequired,
} from "../dharma-phase-budget"
import type {
  DharmaPrismPhaseBudget,
  PrismWorkerCompatibilityEnvelopeV2,
  PrismPhaseRequirements,
} from "../phase-role-types"

function makeEnvelope(overrides: Partial<PrismWorkerCompatibilityEnvelopeV2> = {}): PrismWorkerCompatibilityEnvelopeV2 {
  return {
    workerId: "worker-a",
    workerInstanceId: "inst-001",
    modelArtifactDigest: "sha256-model-aaa",
    tokenizerDigest: "sha256-tok-bbb",
    modelFamily: "llama",
    workloadClasses: ["chat_completion"],
    targetCapabilitySignature: "sig-v1",
    computeImageDigest: "compute-v1",
    precisionMode: "fp16",
    maximumContextLength: 8192,
    maximumOutputTokens: 4096,
    maximumConcurrentRequests: 4,
    kvEventVersion: 2,
    kvLocalityMode: "device_local",
    lifecycleState: "serving",
    workerRoles: ["unified"],
    prefillCapability: {
      supported: true,
      enabled: true,
      admissionState: "open",
      maximumConcurrentOperations: 4,
      maximumInputTokens: 8192,
      maximumOutputTokens: 4096,
      maximumRuntimeMs: 60_000,
      maximumMemoryBytes: 16_777_216,
      preferredBatchSize: 1,
      targetProfileDigest: "profile-prefill-v1",
      computeImageProfileDigest: "compute-prefill-v1",
    },
    decodeCapability: {
      supported: true,
      enabled: true,
      admissionState: "open",
      maximumConcurrentOperations: 4,
      maximumInputTokens: 8192,
      maximumOutputTokens: 4096,
      maximumRuntimeMs: 300_000,
      maximumMemoryBytes: 33_554_432,
      preferredBatchSize: null,
      targetProfileDigest: "profile-decode-v1",
      computeImageProfileDigest: "compute-decode-v1",
    },
    prefillProfile: {
      profileDigest: "prefill-profile-v1",
      maximumContextTokens: 8192,
      maximumPrefillBatchSize: 1,
      maximumPrefillConcurrency: 4,
      maximumPrefillMemoryBytes: 16_777_216,
      preferredPromptLengthBand: "medium",
      estimatedPrefillTokensPerSecond: 5000,
      supportsPrefixReuse: true,
      supportsPromptBatching: false,
      targetCapabilitySignature: "sig-v1",
      computeImageDigest: "compute-v1",
    },
    decodeProfile: {
      profileDigest: "decode-profile-v1",
      maximumDecodeConcurrency: 4,
      maximumActiveKvNamespaces: 64,
      maximumOutputTokens: 4096,
      preferredGenerationLengthBand: "medium",
      estimatedDecodeTokensPerSecond: 200,
      supportsStreaming: true,
      supportsCancellation: true,
      supportsKvReuse: true,
      latencyClass: "interactive",
      targetCapabilitySignature: "sig-v1",
      computeImageDigest: "compute-v1",
    },
    phaseCoLocationPolicy: "same_worker_required",
    prefillCapacity: 4,
    decodeCapacity: 4,
    supportsPhaseMetrics: true,
    supportsPhaseReceipts: true,
    ...overrides,
  }
}

describe("createDharmaPhaseBudget", () => {
  it("creates a budget from token estimates", () => {
    const budget = createDharmaPhaseBudget(1000, 500)
    expect(budget.maximumInputTokens).toBe(1000)
    expect(budget.maximumOutputTokens).toBe(500)
    // 1000 * 250_000 ns / 1_000_000 = 250ms
    expect(budget.maximumPrefillRuntimeMs).toBeGreaterThanOrEqual(250)
    // 500 * 5_000_000 ns / 1_000_000 = 2500ms
    expect(budget.maximumDecodeRuntimeMs).toBeGreaterThanOrEqual(2500)
    expect(budget.maximumPrefillMemoryBytes).toBe(1000 * 512)
    expect(budget.maximumDecodeMemoryBytes).toBe(500 * 256)
    expect(budget.requireSameWorkerExecution).toBe(true)
    expect(budget.allowedWorkerRoles).toContain("unified")
  })

  it("handles zero tokens", () => {
    const budget = createDharmaPhaseBudget(0, 0)
    expect(budget.maximumPrefillRuntimeMs).toBe(0)
    expect(budget.maximumDecodeRuntimeMs).toBe(0)
  })
})

describe("isLeaseCompatibleWithPhase", () => {
  it("returns compatible when worker roles overlap", () => {
    const budget = createDharmaPhaseBudget(100, 50)
    const env = makeEnvelope()
    expect(isLeaseCompatibleWithPhase(budget, env)).toEqual({
      compatible: true,
      reason: null,
    })
  })

  it("returns incompatible when no role overlap", () => {
    const budget = createDharmaPhaseBudget(100, 50)
    const env = makeEnvelope({ workerRoles: ["decode_only" as const] })
    const result = isLeaseCompatibleWithPhase(budget, env)
    expect(result.compatible).toBe(false)
    expect(result.reason).toContain("roles")
  })

  it("returns incompatible when input tokens exceed max context", () => {
    const budget = createDharmaPhaseBudget(9999, 50)
    const env = makeEnvelope({ maximumContextLength: 4096 })
    const result = isLeaseCompatibleWithPhase(budget, env)
    expect(result.compatible).toBe(false)
    expect(result.reason).toContain("context")
  })

  it("returns incompatible when output tokens exceed max", () => {
    const budget = createDharmaPhaseBudget(100, 9999)
    const env = makeEnvelope({ maximumOutputTokens: 2048 })
    const result = isLeaseCompatibleWithPhase(budget, env)
    expect(result.compatible).toBe(false)
    expect(result.reason).toContain("output")
  })

  it("returns incompatible when prefill runtime exceeds worker max", () => {
    const budget: DharmaPrismPhaseBudget = {
      ...createDharmaPhaseBudget(100, 50),
      maximumPrefillRuntimeMs: 999_999,
    }
    const env = makeEnvelope()
    const result = isLeaseCompatibleWithPhase(budget, env)
    expect(result.compatible).toBe(false)
    expect(result.reason).toContain("prefill runtime")
  })

  it("returns incompatible when prefill memory exceeds worker max", () => {
    const budget: DharmaPrismPhaseBudget = {
      ...createDharmaPhaseBudget(100, 50),
      maximumPrefillMemoryBytes: 999_999_999,
    }
    const env = makeEnvelope()
    const result = isLeaseCompatibleWithPhase(budget, env)
    expect(result.compatible).toBe(false)
    expect(result.reason).toContain("prefill memory")
  })
})

describe("isPhaseBudgetSufficient", () => {
  it("returns sufficient when budget covers requirements", () => {
    const budget = createDharmaPhaseBudget(2000, 1000)
    const req: PrismPhaseRequirements = {
      requiredPrefill: true,
      requiredDecode: true,
      inputTokenCount: 1000,
      requestedOutputTokens: 500,
      stream: false,
      promptLengthClass: "medium",
      generationLengthClass: "medium",
      latencyPreference: "interactive",
      batchEligibility: false,
      deadlineAt: null,
    }
    expect(isPhaseBudgetSufficient(budget, req)).toEqual({
      sufficient: true,
      reason: null,
    })
  })

  it("returns insufficient when input tokens exceed budget", () => {
    const budget = createDharmaPhaseBudget(500, 1000)
    const req: PrismPhaseRequirements = {
      requiredPrefill: true,
      requiredDecode: true,
      inputTokenCount: 1000,
      requestedOutputTokens: 200,
      stream: false,
      promptLengthClass: "long",
      generationLengthClass: "medium",
      latencyPreference: "interactive",
      batchEligibility: false,
      deadlineAt: null,
    }
    const result = isPhaseBudgetSufficient(budget, req)
    expect(result.sufficient).toBe(false)
    expect(result.reason).toContain("input tokens")
  })

  it("returns insufficient when output tokens exceed budget", () => {
    const budget = createDharmaPhaseBudget(2000, 500)
    const req: PrismPhaseRequirements = {
      requiredPrefill: true,
      requiredDecode: true,
      inputTokenCount: 500,
      requestedOutputTokens: 1000,
      stream: false,
      promptLengthClass: "long",
      generationLengthClass: "long",
      latencyPreference: "throughput",
      batchEligibility: true,
      deadlineAt: null,
    }
    const result = isPhaseBudgetSufficient(budget, req)
    expect(result.sufficient).toBe(false)
    expect(result.reason).toContain("output tokens")
  })
})

describe("isSameWorkerRequired", () => {
  it("returns true when budget requires same worker", () => {
    const budget = createDharmaPhaseBudget(100, 50)
    expect(isSameWorkerRequired(budget)).toBe(true)
  })

  it("returns false when budget does not require same worker", () => {
    const budget: DharmaPrismPhaseBudget = {
      ...createDharmaPhaseBudget(100, 50),
      requireSameWorkerExecution: false,
    }
    expect(isSameWorkerRequired(budget)).toBe(false)
  })
})
