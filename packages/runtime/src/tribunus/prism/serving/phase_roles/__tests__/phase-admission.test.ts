/**
 * Prism Phase Role Separation — Phase Requirements Admission Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createPhaseRequirements,
  isPhaseRequirementsSatisfied,
  getPromptLengthClass,
  getGenerationLengthClass,
} from "../phase-request-requirements"
import type {
  PrismWorkerCompatibilityEnvelopeV2,
  PrismPhaseCapability,
  PrismPrefillProfile,
  PrismDecodeProfile,
} from "../phase-role-types"

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePrefillCapability(overrides: Partial<PrismPhaseCapability> = {}): PrismPhaseCapability {
  return {
    supported: true,
    enabled: true,
    admissionState: "open",
    maximumConcurrentOperations: 8,
    maximumInputTokens: 65536,
    maximumOutputTokens: null,
    maximumRuntimeMs: 120_000,
    maximumMemoryBytes: 2_147_483_648,
    preferredBatchSize: 4,
    targetProfileDigest: "pfx1abc",
    computeImageProfileDigest: "img1abc",
    ...overrides,
  }
}

function makeDecodeCapability(overrides: Partial<PrismPhaseCapability> = {}): PrismPhaseCapability {
  return {
    supported: true,
    enabled: true,
    admissionState: "open",
    maximumConcurrentOperations: 16,
    maximumInputTokens: 0,
    maximumOutputTokens: 16384,
    maximumRuntimeMs: 300_000,
    maximumMemoryBytes: 1_073_741_824,
    preferredBatchSize: null,
    targetProfileDigest: "pfx2abc",
    computeImageProfileDigest: "img2abc",
    ...overrides,
  }
}

function makePrefillProfile(overrides: Partial<PrismPrefillProfile> = {}): PrismPrefillProfile {
  return {
    profileDigest: "pfp1abc",
    maximumContextTokens: 65536,
    maximumPrefillBatchSize: 4,
    maximumPrefillConcurrency: 8,
    maximumPrefillMemoryBytes: 2_147_483_648,
    preferredPromptLengthBand: "medium",
    estimatedPrefillTokensPerSecond: 2000,
    supportsPrefixReuse: true,
    supportsPromptBatching: true,
    targetCapabilitySignature: "sig1",
    computeImageDigest: "img1abc",
    ...overrides,
  }
}

function makeDecodeProfile(overrides: Partial<PrismDecodeProfile> = {}): PrismDecodeProfile {
  return {
    profileDigest: "pdp1abc",
    maximumDecodeConcurrency: 16,
    maximumActiveKvNamespaces: 64,
    maximumOutputTokens: 16384,
    preferredGenerationLengthBand: "medium",
    estimatedDecodeTokensPerSecond: 100,
    supportsStreaming: true,
    supportsCancellation: true,
    supportsKvReuse: true,
    latencyClass: "interactive",
    targetCapabilitySignature: "sig2",
    computeImageDigest: "img2abc",
    ...overrides,
  }
}

function makeEnvelope(
  overrides: Partial<PrismWorkerCompatibilityEnvelopeV2> = {},
): PrismWorkerCompatibilityEnvelopeV2 {
  return {
    workerId: "w1",
    workerInstanceId: "w1-i1",
    modelArtifactDigest: "mdl1",
    tokenizerDigest: "tkz1",
    modelFamily: "llama",
    workloadClasses: ["chat", "completion"],
    targetCapabilitySignature: "sig1",
    computeImageDigest: "img1abc",
    precisionMode: "fp16",
    maximumContextLength: 8192,
    maximumOutputTokens: 4096,
    maximumConcurrentRequests: 64,
    kvEventVersion: 2,
    kvLocalityMode: "local",
    lifecycleState: "active",
    workerRoles: ["unified"],
    prefillCapability: makePrefillCapability(),
    decodeCapability: makeDecodeCapability(),
    prefillProfile: makePrefillProfile(),
    decodeProfile: makeDecodeProfile(),
    phaseCoLocationPolicy: "same_worker_required",
    prefillCapacity: 8,
    decodeCapacity: 16,
    supportsPhaseMetrics: true,
    supportsPhaseReceipts: true,
    ...overrides,
  }
}

// ── Prompt Length Class ────────────────────────────────────────────────────

describe("getPromptLengthClass", () => {
  test("short for ≤1024 tokens", () => {
    expect(getPromptLengthClass(0)).toBe("short")
    expect(getPromptLengthClass(512)).toBe("short")
    expect(getPromptLengthClass(1024)).toBe("short")
  })

  test("medium for 1025–8192 tokens", () => {
    expect(getPromptLengthClass(1025)).toBe("medium")
    expect(getPromptLengthClass(4096)).toBe("medium")
    expect(getPromptLengthClass(8192)).toBe("medium")
  })

  test("long for 8193–32768 tokens", () => {
    expect(getPromptLengthClass(8193)).toBe("long")
    expect(getPromptLengthClass(16384)).toBe("long")
    expect(getPromptLengthClass(32768)).toBe("long")
  })

  test("very_long for >32768 tokens", () => {
    expect(getPromptLengthClass(32769)).toBe("very_long")
    expect(getPromptLengthClass(65536)).toBe("very_long")
  })
})

// ── Generation Length Class ────────────────────────────────────────────────

describe("getGenerationLengthClass", () => {
  test("short for ≤256 tokens", () => {
    expect(getGenerationLengthClass(0)).toBe("short")
    expect(getGenerationLengthClass(128)).toBe("short")
    expect(getGenerationLengthClass(256)).toBe("short")
  })

  test("medium for 257–2048 tokens", () => {
    expect(getGenerationLengthClass(257)).toBe("medium")
    expect(getGenerationLengthClass(1024)).toBe("medium")
    expect(getGenerationLengthClass(2048)).toBe("medium")
  })

  test("long for >2048 tokens", () => {
    expect(getGenerationLengthClass(2049)).toBe("long")
    expect(getGenerationLengthClass(4096)).toBe("long")
  })
})

// ── createPhaseRequirements ────────────────────────────────────────────────

describe("createPhaseRequirements", () => {
  test("creates requirements with prefill and decode for stream requests", () => {
    const req = createPhaseRequirements(512, 0, true)
    expect(req.requiredPrefill).toBe(true)
    expect(req.requiredDecode).toBe(true)
    expect(req.inputTokenCount).toBe(512)
    expect(req.requestedOutputTokens).toBe(0)
    expect(req.stream).toBe(true)
    expect(req.promptLengthClass).toBe("short")
    expect(req.generationLengthClass).toBe("short")
    expect(req.latencyPreference).toBe("interactive")
    expect(req.batchEligibility).toBe(false)
    expect(req.deadlineAt).toBeNull()
  })

  test("creates requirements with decode when output tokens > 0", () => {
    const req = createPhaseRequirements(2048, 1024, false)
    expect(req.requiredDecode).toBe(true)
    expect(req.requestedOutputTokens).toBe(1024)
    expect(req.stream).toBe(false)
    expect(req.latencyPreference).toBe("balanced")
    expect(req.batchEligibility).toBe(true)
  })

  test("creates requirements without decode for zero-output non-stream requests", () => {
    const req = createPhaseRequirements(100, 0, false)
    expect(req.requiredDecode).toBe(false)
  })

  test("classifies token lengths correctly", () => {
    const req = createPhaseRequirements(5000, 500, false)
    expect(req.promptLengthClass).toBe("medium")
    expect(req.generationLengthClass).toBe("medium")
  })

  test("classifies very long prompts", () => {
    const req = createPhaseRequirements(40000, 10, false)
    expect(req.promptLengthClass).toBe("very_long")
  })

  test("classifies long generations", () => {
    const req = createPhaseRequirements(100, 3000, false)
    expect(req.generationLengthClass).toBe("long")
  })
})

// ── isPhaseRequirementsSatisfied ───────────────────────────────────────────

describe("isPhaseRequirementsSatisfied", () => {
  test("accepts a satisfying envelope", () => {
    const req = createPhaseRequirements(512, 256, false)
    const env = makeEnvelope()
    const result = isPhaseRequirementsSatisfied(req, env)
    expect(result.satisfied).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("accepts a stream request against streaming-capable worker", () => {
    const req = createPhaseRequirements(512, 0, true)
    const env = makeEnvelope()
    const result = isPhaseRequirementsSatisfied(req, env)
    expect(result.satisfied).toBe(true)
  })

  test("rejects when prefill capability is not supported", () => {
    const req = createPhaseRequirements(512, 0, false)
    const env = makeEnvelope({
      prefillCapability: makePrefillCapability({ supported: false }),
    })
    const result = isPhaseRequirementsSatisfied(req, env)
    expect(result.satisfied).toBe(false)
    expect(result.reason).toContain("does not support prefill")
  })

  test("rejects when prefill capability is not enabled", () => {
    const req = createPhaseRequirements(512, 0, false)
    const env = makeEnvelope({
      prefillCapability: makePrefillCapability({ enabled: false }),
    })
    const result = isPhaseRequirementsSatisfied(req, env)
    expect(result.satisfied).toBe(false)
    expect(result.reason).toContain("not enabled")
  })

  test("rejects when input tokens exceed maximum context length", () => {
    const req = createPhaseRequirements(10000, 0, false)
    const env = makeEnvelope({ maximumContextLength: 8192 })
    const result = isPhaseRequirementsSatisfied(req, env)
    expect(result.satisfied).toBe(false)
    expect(result.reason).toContain("exceeds maximum context length")
  })

  test("rejects when input tokens exceed prefill max input", () => {
    const req = createPhaseRequirements(50000, 0, false)
    const env = makeEnvelope({
      maximumContextLength: 65536,
      prefillCapability: makePrefillCapability({ maximumInputTokens: 32768 }),
    })
    const result = isPhaseRequirementsSatisfied(req, env)
    expect(result.satisfied).toBe(false)
    expect(result.reason).toContain("exceeds prefill max input")
  })

  test("rejects when decode capability is not supported", () => {
    const req = createPhaseRequirements(512, 256, false)
    const env = makeEnvelope({
      decodeCapability: makeDecodeCapability({ supported: false }),
    })
    const result = isPhaseRequirementsSatisfied(req, env)
    expect(result.satisfied).toBe(false)
    expect(result.reason).toContain("does not support decode")
  })

  test("rejects when decode capability is not enabled", () => {
    const req = createPhaseRequirements(512, 256, false)
    const env = makeEnvelope({
      decodeCapability: makeDecodeCapability({ enabled: false }),
    })
    const result = isPhaseRequirementsSatisfied(req, env)
    expect(result.satisfied).toBe(false)
    expect(result.reason).toContain("not enabled")
  })

  test("rejects when requested output tokens exceed maximum", () => {
    const req = createPhaseRequirements(512, 8192, false)
    const env = makeEnvelope({ maximumOutputTokens: 4096 })
    const result = isPhaseRequirementsSatisfied(req, env)
    expect(result.satisfied).toBe(false)
    expect(result.reason).toContain("exceeds maximum")
  })

  test("rejects streaming when worker does not support streaming", () => {
    const req = createPhaseRequirements(512, 0, true)
    const env = makeEnvelope({
      decodeProfile: makeDecodeProfile({ supportsStreaming: false }),
    })
    const result = isPhaseRequirementsSatisfied(req, env)
    expect(result.satisfied).toBe(false)
    expect(result.reason).toContain("does not support streaming")
  })

  test("does not check decode for non-decode requests", () => {
    const req = createPhaseRequirements(512, 0, false)
    const env = makeEnvelope({
      decodeCapability: makeDecodeCapability({ supported: false }),
    })
    const result = isPhaseRequirementsSatisfied(req, env)
    expect(result.satisfied).toBe(true)
  })
})
