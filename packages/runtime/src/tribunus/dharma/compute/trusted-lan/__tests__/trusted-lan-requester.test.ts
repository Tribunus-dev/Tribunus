/**
 * Tests for trusted-lan-requester.ts — provider selection, receipt verification,
 * and lease creation.
 */

import { beforeEach, describe, expect, it } from "bun:test"
import {
  selectProvider,
  verifyReceipt,
  createLanLease,
  _resetLeaseCounter,
} from "../trusted-lan-requester.ts"
import type {
  PrismLanComputeLease,
  PrismLanProvider,
  PrismLanUsageReceipt,
  RemoteLeaseStatus,
} from "../trusted-lan-types.ts"

// ── Helpers -----------------------------------------------------------------

function makeProvider(overrides?: Partial<PrismLanProvider>): PrismLanProvider {
  return {
    providerId: "prov-1",
    identityPublicKey: "pk-provider-abc",
    devicePublicKey: "dpk-provider-abc",
    federationId: "fed-1",
    displayName: "Test Provider",
    transportPublicKey: "tpk-provider-abc",
    enrollmentState: "active",
    status: "available",
    capabilityAdvertisementId: "adv-1",
    containmentCapabilityDigest: "seccomp_level_2:sha256:abc",
    createdAt: "2025-01-01T00:00:00.000Z",
    lastSeenAt: "2025-06-01T00:00:00.000Z",
    revokedAt: null,
    ...overrides,
  }
}

function makeLease(overrides?: Partial<PrismLanComputeLease>): PrismLanComputeLease {
  const farFuture = "2099-12-31T23:59:59.000Z"
  return {
    leaseId: "lease-1",
    sessionId: "sess-1",
    taskId: null,
    requesterIdentityPublicKey: "pk-requester-abc",
    requesterMembershipId: "mem-1",
    requesterDevicePublicKey: "dpk-requester-abc",
    providerId: "prov-1",
    providerIdentityPublicKey: "pk-provider-abc",
    backendKind: "prism_trusted_lan",
    workloadClass: "chat_completion",
    modelArtifactDigest: "sha256:artifact-abc",
    tokenizerDigest: "sha256:tokenizer-abc",
    artifactParityMode: "strict_artifact_parity",
    computeImagePolicyDigest: "sha256:policy-abc",
    requestedTargetConstraints: "cpu:arm64",
    inputDisclosureClass: "session_scoped",
    inputDigest: "sha256:input-abc",
    inputReference: null,
    outputDisclosureClass: "task_visible",
    requestedMaxInputTokens: 1024,
    requestedMaxOutputTokens: 2048,
    requestedMaxRuntimeSeconds: 300,
    requestedMaxMemoryBytes: 2 * 1024 * 1024 * 1024,
    requestedMaxOutputBytes: 1024 * 1024,
    requestedMaxGpuTimeMs: null,
    requiredContainmentLevel: "seccomp_level_2",
    providerTrustScopeDigest: "sha256:trust-scope",
    disconnectPolicy: "retry",
    status: "completed" as RemoteLeaseStatus,
    issuedAt: "2025-06-01T00:00:00.000Z",
    expiresAt: farFuture,
    signatureChain: "chain-abc",
    ...overrides,
  }
}

function makeReceipt(overrides?: Partial<PrismLanUsageReceipt>): PrismLanUsageReceipt {
  return {
    receiptId: "receipt-1",
    leaseId: "lease-1",
    sessionId: "sess-1",
    requesterIdentityPublicKey: "pk-requester-abc",
    providerIdentityPublicKey: "pk-provider-abc",
    providerId: "prov-1",
    modelArtifactDigest: "sha256:artifact-abc",
    tokenizerDigest: "sha256:tokenizer-abc",
    computeImageDigest: "sha256:policy-abc",
    targetCapabilitySignature: "cpu:arm64",
    containmentProfileDigest: "seccomp_level_2",
    workloadClass: "chat_completion",
    inputDigest: "sha256:input-abc",
    outputDigest: "sha256:output-abc",
    inputTokenCount: 512,
    outputTokenCount: 1024,
    prefillDurationMs: null,
    decodeDurationMs: null,
    totalDurationMs: 15000,
    peakMemoryBytes: null,
    cacheStatus: null,
    executionState: "completed" as RemoteLeaseStatus,
    failureClass: null,
    emittedAt: "2025-06-01T00:00:05.000Z",
    providerSignature: "",
    ...overrides,
  }
}

// ── selectProvider ----------------------------------------------------------

describe("selectProvider", () => {
  it("selects an active available provider", () => {
    const providers = [makeProvider()]
    const result = selectProvider(providers, { workload: "chat_completion" })
    expect(result).not.toBeNull()
    expect(result!.providerId).toBe("prov-1")
  })

  it("returns null when no active providers", () => {
    const providers = [makeProvider({ enrollmentState: "revoked" })]
    const result = selectProvider(providers, { workload: "chat_completion" })
    expect(result).toBeNull()
  })

  it("returns null when no draining providers either", () => {
    const providers = [makeProvider({ enrollmentState: "suspended" })]
    const result = selectProvider(providers, { workload: "chat_completion" })
    expect(result).toBeNull()
  })

  it("selects draining provider when no active one exists", () => {
    const providers = [
      makeProvider({ providerId: "prov-drain", enrollmentState: "draining", status: "draining" }),
    ]
    const result = selectProvider(providers, { workload: "chat_completion" })
    expect(result).not.toBeNull()
    expect(result!.providerId).toBe("prov-drain")
  })

  it("prefers available over busy provider", () => {
    const providers = [
      makeProvider({ providerId: "prov-busy", status: "busy", lastSeenAt: "2025-06-02T00:00:00.000Z" }),
      makeProvider({ providerId: "prov-avail", status: "available", lastSeenAt: "2025-06-01T00:00:00.000Z" }),
    ]
    const result = selectProvider(providers, { workload: "chat_completion" })
    expect(result!.providerId).toBe("prov-avail")
  })

  it("prefers active over draining when both have same status", () => {
    const providers = [
      makeProvider({ providerId: "prov-drain", enrollmentState: "draining", status: "available" }),
      makeProvider({ providerId: "prov-active", enrollmentState: "active", status: "available" }),
    ]
    const result = selectProvider(providers, { workload: "chat_completion" })
    expect(result!.providerId).toBe("prov-active")
  })

  it("sorts by lastSeenAt when statuses are equal", () => {
    const providers = [
      makeProvider({ providerId: "prov-old", lastSeenAt: "2025-01-01T00:00:00.000Z" }),
      makeProvider({ providerId: "prov-new", lastSeenAt: "2025-06-01T00:00:00.000Z" }),
    ]
    const result = selectProvider(providers, { workload: "chat_completion" })
    expect(result!.providerId).toBe("prov-new")
  })

  it("returns null from empty list", () => {
    const result = selectProvider([], { workload: "chat_completion" })
    expect(result).toBeNull()
  })
})

// ── verifyReceipt -----------------------------------------------------------

describe("verifyReceipt", () => {
  it("passes for a valid receipt matching its lease", () => {
    const lease = makeLease({ status: "completed" })
    const receipt = makeReceipt()
    const result = verifyReceipt(receipt, lease, "pk-provider-abc")
    expect(result.valid).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("fails when receipt leaseId does not match", () => {
    const result = verifyReceipt(
      makeReceipt({ leaseId: "lease-wrong" }),
      makeLease(),
      "pk-provider-abc",
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("leaseId")
  })

  it("fails when receipt sessionId does not match", () => {
    const result = verifyReceipt(
      makeReceipt({ sessionId: "sess-wrong" }),
      makeLease(),
      "pk-provider-abc",
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("sessionId")
  })

  it("fails when receipt providerId does not match", () => {
    const result = verifyReceipt(
      makeReceipt({ providerId: "prov-wrong" }),
      makeLease(),
      "pk-provider-abc",
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("providerId")
  })

  it("fails when receipt providerIdentityPublicKey does not match", () => {
    const result = verifyReceipt(
      makeReceipt({ providerIdentityPublicKey: "pk-wrong" }),
      makeLease(),
      "pk-provider-abc",
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("providerIdentityPublicKey")
  })

  it("fails when receipt requesterIdentityPublicKey does not match", () => {
    const result = verifyReceipt(
      makeReceipt({ requesterIdentityPublicKey: "pk-wrong-requester" }),
      makeLease(),
      "pk-provider-abc",
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("requesterIdentityPublicKey")
  })

  it("fails when receipt modelArtifactDigest does not match", () => {
    const result = verifyReceipt(
      makeReceipt({ modelArtifactDigest: "sha256:different-model" }),
      makeLease(),
      "pk-provider-abc",
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("modelArtifactDigest")
  })

  it("fails when input tokens exceed requested max", () => {
    const result = verifyReceipt(
      makeReceipt({ inputTokenCount: 99999 }),
      makeLease({ requestedMaxInputTokens: 4096 }),
      "pk-provider-abc",
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Input tokens")
  })

  it("fails when output tokens exceed requested max", () => {
    const result = verifyReceipt(
      makeReceipt({ outputTokenCount: 99999 }),
      makeLease({ requestedMaxOutputTokens: 4096 }),
      "pk-provider-abc",
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Output tokens")
  })

  it("fails when duration exceeds requested max", () => {
    const result = verifyReceipt(
      makeReceipt({ totalDurationMs: 99999999 }),
      makeLease({ requestedMaxRuntimeSeconds: 60 }),
      "pk-provider-abc",
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Duration")
  })

  it("passes when input/output token counts are null in receipt", () => {
    const result = verifyReceipt(
      makeReceipt({ inputTokenCount: null, outputTokenCount: null }),
      makeLease({ status: "completed" }),
      "pk-provider-abc",
    )
    expect(result.valid).toBe(true)
  })

  it("skips token check when requested max is 0 (unlimited)", () => {
    const result = verifyReceipt(
      makeReceipt({ inputTokenCount: 99999 }),
      makeLease({ requestedMaxInputTokens: 0, status: "completed" }),
      "pk-provider-abc",
    )
    expect(result.valid).toBe(true)
  })

  it("skips duration check when max is 0 (unlimited)", () => {
    const result = verifyReceipt(
      makeReceipt({ totalDurationMs: 99999999 }),
      makeLease({ requestedMaxRuntimeSeconds: 0, status: "completed" }),
      "pk-provider-abc",
    )
    expect(result.valid).toBe(true)
  })
})

// ── createLanLease ----------------------------------------------------------

describe("createLanLease", () => {
  beforeEach(() => _resetLeaseCounter())

  it("creates a draft lease with expected fields", () => {
    const lease = createLanLease({
      sessionId: "sess-1",
      requesterKey: "pk-requester-abc",
      membershipId: "mem-1",
      providerId: "prov-1",
      providerKey: "pk-provider-abc",
      workload: "chat_completion",
      artifactDigest: "sha256:artifact-abc",
      inputDigest: "sha256:input-abc",
    })

    expect(lease.sessionId).toBe("sess-1")
    expect(lease.requesterIdentityPublicKey).toBe("pk-requester-abc")
    expect(lease.requesterMembershipId).toBe("mem-1")
    expect(lease.providerId).toBe("prov-1")
    expect(lease.providerIdentityPublicKey).toBe("pk-provider-abc")
    expect(lease.workloadClass).toBe("chat_completion")
    expect(lease.modelArtifactDigest).toBe("sha256:artifact-abc")
    expect(lease.inputDigest).toBe("sha256:input-abc")
    expect(lease.status).toBe("draft")
    expect(lease.backendKind).toBe("prism_trusted_lan")
    expect(lease.taskId).toBeNull()
    expect(lease.inputReference).toBeNull()
    expect(lease.artifactParityMode).toBe("strict_artifact_parity")
    expect(lease.inputDisclosureClass).toBe("session_scoped")
    expect(lease.outputDisclosureClass).toBe("task_visible")
    expect(lease.requestedMaxRuntimeSeconds).toBe(300)
    expect(lease.requestedMaxMemoryBytes).toBe(2 * 1024 * 1024 * 1024)
    expect(lease.requestedMaxOutputBytes).toBe(1024 * 1024)
    expect(lease.issuedAt).toBeTruthy()
    expect(() => new Date(lease.issuedAt)).not.toThrow()
  })

  it("produces unique lease ids", () => {
    _resetLeaseCounter()
    const l1 = createLanLease({
      sessionId: "sess-1", requesterKey: "pk-1", membershipId: "mem-1",
      providerId: "prov-1", providerKey: "pk-p", workload: "chat_completion",
      artifactDigest: "sha256:a", inputDigest: "sha256:i",
    })
    const l2 = createLanLease({
      sessionId: "sess-2", requesterKey: "pk-2", membershipId: "mem-2",
      providerId: "prov-2", providerKey: "pk-p2", workload: "embedding",
      artifactDigest: "sha256:b", inputDigest: "sha256:j",
    })
    expect(l1.leaseId).not.toBe(l2.leaseId)
    expect(l1.leaseId.length).toBeGreaterThan(0)
    expect(l2.leaseId.length).toBeGreaterThan(0)
  })
})
