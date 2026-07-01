/**
 * Compute Prism Adapter Tests — descriptor, transitions, receipts
 *
 * Tests for execution descriptor creation, stage transitions, and usage receipt generation.
 */

import { describe, test, expect } from "bun:test"
import type {
  ComputeBudget,
  LocalPrismComputeLease,
} from "../compute-types"
import {
  createExecutionDescriptor,
  transitionExecutionStage,
  type ExecutionStage,
} from "../compute-execution"
import {
  createUsageReceipt,
  isSuccessfulReceipt,
  getReceiptSummary,
} from "../compute-receipt"
import type { PrismExecutionDescriptor } from "../compute-types"

// ── Helpers -----------------------------------------------------------------

function makeLease(
  overrides: Partial<LocalPrismComputeLease> = {},
): LocalPrismComputeLease {
  return {
    leaseId: "lease-1",
    sessionId: "session-1",
    taskId: "task-1",
    requesterIdentityPublicKey: "key-requester-1",
    requesterMembershipId: "member-1",
    approvingIdentityPublicKey: "key-approver-1",
    grantId: "grant-1",
    sessionKeyEpoch: 1,
    backendKind: "prism_local",
    workloadClass: "chat_completion",
    modelArtifactDigest: "model-digest-abc",
    computeImagePolicyDigest: "policy-digest-1",
    inputDisclosureClass: "session_scoped",
    inputDigest: "input-digest-xyz",
    inputReference: "input-ref-1",
    outputDisclosureClass: "task_visible",
    requestedMaxTokens: 2048,
    requestedMaxRuntimeSeconds: 300,
    requestedMaxMemoryBytes: 4_294_967_296,
    requestedMaxOutputBytes: 1_048_576,
    requestedMaxGpuTimeMs: null,
    requiredContainmentLevel: "standard",
    approvalPolicy: "auto",
    status: "approved",
    issuedAt: "2025-06-01T00:00:00Z",
    expiresAt: "2025-06-01T01:00:00Z",
    revokedAt: null,
    cancellationReason: null,
    signatureChain: "sig-chain-1",
    ...overrides,
  }
}

function makeBudget(
  overrides: Partial<ComputeBudget> = {},
): ComputeBudget {
  return {
    maximumRuntimeSeconds: 300,
    maximumPrefillMs: 30_000,
    maximumDecodeMs: 60_000,
    maximumTokens: 4096,
    maximumInputTokens: 2048,
    maximumOutputTokens: 2048,
    maximumMemoryBytes: 4_294_967_296,
    maximumGpuTimeMs: null,
    maximumCpuTimeMs: null,
    maximumOutputBytes: 1_048_576,
    maximumCompileTimeMs: 60_000,
    ...overrides,
  }
}

function makeDescriptor(
  overrides: Partial<PrismExecutionDescriptor> = {},
): PrismExecutionDescriptor {
  return {
    executionId: "exec-1",
    leaseId: "lease-1",
    modelArtifactDigest: "model-digest-abc",
    tokenizerDigest: "tokenizer-digest-1",
    computeImageDigest: "image-digest-1",
    targetCapabilitySignature: "sig-target-1",
    workloadClass: "chat_completion",
    inputReference: "input-ref-1",
    maxTokens: 2048,
    samplingPolicy: "default",
    outputSchema: null,
    executionBudget: makeBudget(),
    containmentContextDigest: "standard",
    sessionContextDigest: "session-1",
    ...overrides,
  }
}

// ── Execution Descriptor Tests ----------------------------------------------

describe("createExecutionDescriptor", () => {
  test("creates a valid descriptor with expected fields", () => {
    const lease = makeLease()
    const budget = makeBudget()

    const descriptor = createExecutionDescriptor({
      lease,
      computeImageDigest: "image-digest-1",
      targetSignature: "sig-target-m1-ultra",
      budget,
    })

    expect(descriptor.executionId).toBeTypeOf("string")
    expect(descriptor.executionId.length).toBeGreaterThan(0)
    expect(descriptor.leaseId).toBe("lease-1")
    expect(descriptor.modelArtifactDigest).toBe("model-digest-abc")
    expect(descriptor.computeImageDigest).toBe("image-digest-1")
    expect(descriptor.targetCapabilitySignature).toBe("sig-target-m1-ultra")
    expect(descriptor.workloadClass).toBe("chat_completion")
    expect(descriptor.inputReference).toBe("input-ref-1")
    expect(descriptor.maxTokens).toBe(2048)
    expect(descriptor.executionBudget).toEqual(budget)
    expect(descriptor.containmentContextDigest).toBe("standard")
    expect(descriptor.sessionContextDigest).toBe("session-1")
  })

  test("falls back to inputDigest when inputReference is null", () => {
    const lease = makeLease({ inputReference: null })
    const budget = makeBudget()

    const descriptor = createExecutionDescriptor({
      lease,
      computeImageDigest: "img-1",
      targetSignature: "sig-1",
      budget,
    })

    expect(descriptor.inputReference).toBe("input-digest-xyz")
  })

  test("falls back to 4096 maxTokens when requestedMaxTokens is null", () => {
    const lease = makeLease({ requestedMaxTokens: null })
    const budget = makeBudget()

    const descriptor = createExecutionDescriptor({
      lease,
      computeImageDigest: "img-1",
      targetSignature: "sig-1",
      budget,
    })

    expect(descriptor.maxTokens).toBe(4096)
  })

  test("includes tokenizer digest matching model artifact digest", () => {
    const lease = makeLease({ modelArtifactDigest: "model-v2-xyz" })
    const budget = makeBudget()

    const descriptor = createExecutionDescriptor({
      lease,
      computeImageDigest: "img-2",
      targetSignature: "sig-2",
      budget,
    })

    expect(descriptor.tokenizerDigest).toBe("model-v2-xyz")
  })

  test("each call produces a unique executionId", () => {
    const lease = makeLease()
    const budget = makeBudget()

    const a = createExecutionDescriptor({ lease, computeImageDigest: "i", targetSignature: "s", budget })
    const b = createExecutionDescriptor({ lease, computeImageDigest: "i", targetSignature: "s", budget })

    expect(a.executionId).not.toBe(b.executionId)
  })
})

// ── Stage Transition Tests --------------------------------------------------

describe("transitionExecutionStage", () => {
  const VALID_TRANSITIONS: Array<[ExecutionStage, string, ExecutionStage]> = [
    ["pending",   "compile",  "compiling"],
    ["pending",   "fail",     "failed"],
    ["pending",   "cancel",   "cancelled"],
    ["compiling", "load",     "loading"],
    ["compiling", "fail",     "failed"],
    ["compiling", "cancel",   "cancelled"],
    ["loading",   "prefill",  "prefill"],
    ["loading",   "fail",     "failed"],
    ["loading",   "cancel",   "cancelled"],
    ["prefill",   "decode",   "decode"],
    ["prefill",   "fail",     "failed"],
    ["prefill",   "cancel",   "cancelled"],
    ["decode",    "stream",   "streaming"],
    ["decode",    "fail",     "failed"],
    ["decode",    "cancel",   "cancelled"],
    ["streaming", "complete", "completed"],
    ["streaming", "fail",     "failed"],
    ["streaming", "cancel",   "cancelled"],
  ]

  for (const [from, action, expected] of VALID_TRANSITIONS) {
    test(`${from} —"${action}"→ ${expected}`, () => {
      expect(transitionExecutionStage(from, action)).toBe(expected)
    })
  }

  test("throws on unknown action", () => {
    expect(() =>
      transitionExecutionStage("pending", "jump"),
    ).toThrow('Unknown execution action: "jump"')
  })

  test("throws on invalid transition from terminal stage", () => {
    const terminalStages: ExecutionStage[] = ["completed", "failed", "cancelled"]

    for (const stage of terminalStages) {
      expect(() =>
        transitionExecutionStage(stage, "compile"),
      ).toThrow("not allowed")
    }
  })

  test("throws on re-entrant transition (completed → complete)", () => {
    expect(() =>
      transitionExecutionStage("completed", "complete"),
    ).toThrow("not allowed")
  })

  test("throws on skip transition (pending → stream)", () => {
    expect(() =>
      transitionExecutionStage("pending", "stream"),
    ).toThrow("not allowed")
  })
})

// ── Receipt Tests -----------------------------------------------------------

describe("createUsageReceipt", () => {
  test("creates a receipt with all fields populated", () => {
    const lease = makeLease()
    const execution = makeDescriptor()

    const receipt = createUsageReceipt({
      lease,
      computeImageDigest: "img-1",
      targetSignature: "sig-1",
      containmentProfileDigest: "containment-1",
      execution,
      inputDigest: "input-digest-xyz",
      outputDigest: "output-digest-abc",
      inputTokens: 150,
      outputTokens: 42,
      prefillMs: 1200,
      decodeMs: 3400,
      totalMs: 4600,
      peakMemoryBytes: 2_147_483_648,
      cacheHit: "partial",
      executionState: "completed",
    })

    expect(receipt.receiptId).toBeTypeOf("string")
    expect(receipt.receiptId.length).toBeGreaterThan(0)
    expect(receipt.leaseId).toBe("lease-1")
    expect(receipt.sessionId).toBe("session-1")
    expect(receipt.taskId).toBe("task-1")
    expect(receipt.actorIdentityPublicKey).toBe("key-requester-1")
    expect(receipt.modelArtifactDigest).toBe("model-digest-abc")
    expect(receipt.tokenizerDigest).toBe("tokenizer-digest-1")
    expect(receipt.computeImageDigest).toBe("img-1")
    expect(receipt.targetCapabilitySignature).toBe("sig-1")
    expect(receipt.containmentProfileDigest).toBe("containment-1")
    expect(receipt.workloadClass).toBe("chat_completion")
    expect(receipt.inputDigest).toBe("input-digest-xyz")
    expect(receipt.outputDigest).toBe("output-digest-abc")
    expect(receipt.inputTokenCount).toBe(150)
    expect(receipt.outputTokenCount).toBe(42)
    expect(receipt.prefillDurationMs).toBe(1200)
    expect(receipt.decodeDurationMs).toBe(3400)
    expect(receipt.totalDurationMs).toBe(4600)
    expect(receipt.peakMemoryBytes).toBe(2_147_483_648)
    expect(receipt.cacheHitStatus).toBe("partial")
    expect(receipt.executionState).toBe("completed")
    expect(receipt.failureClass).toBeNull()
    expect(receipt.emittedAt).toBeTypeOf("string")
    expect(receipt.signature).toBeTypeOf("string")
  })

  test("sets null for omitted optional fields", () => {
    const receipt = createUsageReceipt({
      lease: makeLease(),
      computeImageDigest: "img-1",
      targetSignature: "sig-1",
      containmentProfileDigest: "cp-1",
      execution: makeDescriptor(),
      inputDigest: "in-1",
      totalMs: 1000,
      executionState: "failed",
      failureClass: "execution_timeout",
    })

    expect(receipt.outputDigest).toBeNull()
    expect(receipt.inputTokenCount).toBeNull()
    expect(receipt.outputTokenCount).toBeNull()
    expect(receipt.prefillDurationMs).toBeNull()
    expect(receipt.decodeDurationMs).toBeNull()
    expect(receipt.peakMemoryBytes).toBeNull()
    expect(receipt.cacheHitStatus).toBeNull()
    expect(receipt.kvNamespaceDigest).toBeNull()
    expect(receipt.failureClass).toBe("execution_timeout")
  })

  test("receipt has deterministic signature", () => {
    // Same inputs produce the same signature (deterministic hash).
    const config = {
      lease: makeLease(),
      computeImageDigest: "img",
      targetSignature: "sig",
      containmentProfileDigest: "cp",
      execution: makeDescriptor(),
      inputDigest: "in-1",
      totalMs: 1000,
      executionState: "completed" as const,
    }

    const a = createUsageReceipt(config)
    const b = createUsageReceipt(config)

    expect(a.signature).toBe(b.signature)
    expect(a.receiptId).toBe(b.receiptId)
  })
})

describe("isSuccessfulReceipt", () => {
  test("returns true for completed state", () => {
    const receipt = createUsageReceipt({
      lease: makeLease(),
      computeImageDigest: "i",
      targetSignature: "s",
      containmentProfileDigest: "c",
      execution: makeDescriptor(),
      inputDigest: "in",
      totalMs: 500,
      executionState: "completed",
    })
    expect(isSuccessfulReceipt(receipt)).toBe(true)
  })

  test("returns false for failed state", () => {
    const receipt = createUsageReceipt({
      lease: makeLease(),
      computeImageDigest: "i",
      targetSignature: "s",
      containmentProfileDigest: "c",
      execution: makeDescriptor(),
      inputDigest: "in",
      totalMs: 500,
      executionState: "failed",
    })
    expect(isSuccessfulReceipt(receipt)).toBe(false)
  })

  test("returns false for cancelled state", () => {
    const receipt = createUsageReceipt({
      lease: makeLease(),
      computeImageDigest: "i",
      targetSignature: "s",
      containmentProfileDigest: "c",
      execution: makeDescriptor(),
      inputDigest: "in",
      totalMs: 500,
      executionState: "cancelled",
    })
    expect(isSuccessfulReceipt(receipt)).toBe(false)
  })
})

describe("getReceiptSummary", () => {
  test("includes failure class and model digest for failed receipts", () => {
    const receipt = createUsageReceipt({
      lease: makeLease({ modelArtifactDigest: "model-digest-abc" }),
      computeImageDigest: "i",
      targetSignature: "s",
      containmentProfileDigest: "c",
      execution: makeDescriptor(),
      inputDigest: "in",
      totalMs: 500,
      executionState: "failed",
      failureClass: "execution_timeout",
    })
    const summary = getReceiptSummary(receipt)
    expect(summary).toContain("execution_timeout")
    expect(summary).toContain("model-digest-abc")
    expect(summary).toContain("500ms")
  })

  test("formats successful receipt without failure info", () => {
    const receipt = createUsageReceipt({
      lease: makeLease({ modelArtifactDigest: "model-digest-abc" }),
      computeImageDigest: "i",
      targetSignature: "s",
      containmentProfileDigest: "c",
      execution: makeDescriptor(),
      inputDigest: "in",
      totalMs: 1200,
      executionState: "completed",
      inputTokens: 200,
      outputTokens: 50,
    })
    const summary = getReceiptSummary(receipt)
    expect(summary).toContain("[OK]")
    expect(summary).toContain("chat_completion")
    expect(summary).toContain("200i/50o")
    expect(summary).toContain("1200ms")
  })
})
