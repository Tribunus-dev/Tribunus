/**
 * Tests for trusted-lan-provider.ts — admission gate, artifact parity,
 * containment, disclosure, and receipt creation.
 */

import { beforeEach, describe, expect, it } from "bun:test"
import {
  evaluateLeaseAdmission,
  checkArtifactParity,
  checkContainmentCapability,
  checkDisclosureClass,
  createProviderReceipt,
  _resetReceiptCounter,
} from "../trusted-lan-provider.ts"
import type {
  PrismLanComputeLease,
  PrismLanProvider,
  PrismLanProviderTrust,
  ProviderRejectionClass,
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

function makeTrust(overrides?: Partial<PrismLanProviderTrust>): PrismLanProviderTrust {
  const farFuture = "2099-12-31T23:59:59.000Z"
  return {
    trustId: "trust-1",
    federationId: "fed-1",
    providerIdentityPublicKey: "pk-provider-abc",
    grantedByIdentityPublicKey: "pk-granter",
    allowedSessionIds: null,
    allowedWorkloadClasses: ["chat_completion", "embedding"],
    allowedDisclosureClasses: ["session_scoped", "task_visible"],
    allowedArtifactDigests: [],
    allowedTargetClasses: [],
    maximumRuntimeSeconds: 600,
    maximumTokens: 4096,
    maximumMemoryBytes: 4 * 1024 * 1024 * 1024,
    maximumConcurrentLeases: 2,
    allowStreaming: true,
    allowResultArtifactReturn: true,
    expiresAt: farFuture,
    revokedAt: null,
    reasonDigest: null,
    signature: "sig-abc",
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
    status: "requested" as RemoteLeaseStatus,
    issuedAt: "2025-06-01T00:00:00.000Z",
    expiresAt: farFuture,
    signatureChain: "chain-abc",
    ...overrides,
  }
}

const ADVERTISED_CAPABILITIES = ["sha256:artifact-abc", "sha256:tokenizer-abc", "sha256:other-artifact"]

// ── evaluateLeaseAdmission — All 18 Rejection Classes -----------------------

describe("evaluateLeaseAdmission", () => {
  describe("admission succeeds", () => {
    it("admits a valid lease", () => {
      const result = evaluateLeaseAdmission(
        makeLease(),
        makeProvider(),
        makeTrust(),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(true)
      expect(result.rejectionClass).toBeNull()
      expect(result.reason).toBeNull()
    })
  })

  describe("protocol_incompatible", () => {
    it("rejects when provider enrollment is suspended", () => {
      const result = evaluateLeaseAdmission(
        makeLease(),
        makeProvider({ enrollmentState: "suspended" }),
        makeTrust(),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("protocol_incompatible")
      expect(result.reason).toContain("suspended")
    })

    it("rejects when provider enrollment is revoked", () => {
      const result = evaluateLeaseAdmission(
        makeLease(),
        makeProvider({ enrollmentState: "revoked" }),
        makeTrust(),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("protocol_incompatible")
    })

    it("rejects when provider enrollment is draft", () => {
      const result = evaluateLeaseAdmission(
        makeLease(),
        makeProvider({ enrollmentState: "draft" }),
        makeTrust(),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("protocol_incompatible")
    })
  })

  describe("provider_trust_missing", () => {
    it("rejects when trust is null", () => {
      const result = evaluateLeaseAdmission(
        makeLease(),
        makeProvider(),
        null,
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("provider_trust_missing")
    })
  })

  describe("provider_trust_expired", () => {
    it("rejects when trust has expired", () => {
      const result = evaluateLeaseAdmission(
        makeLease(),
        makeProvider(),
        makeTrust({ expiresAt: "2020-01-01T00:00:00.000Z" }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("provider_trust_expired")
    })

    it("rejects when trust has been revoked", () => {
      const result = evaluateLeaseAdmission(
        makeLease(),
        makeProvider(),
        makeTrust({ revokedAt: "2025-01-01T00:00:00.000Z" }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("provider_trust_expired")
    })
  })

  describe("session_membership_invalid", () => {
    it("rejects when session is not in trust's allowed sessions", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ sessionId: "sess-unknown" }),
        makeProvider(),
        makeTrust({ allowedSessionIds: ["sess-1", "sess-2"] }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("session_membership_invalid")
    })

    it("allows when trust has null allowedSessionIds", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ sessionId: "sess-anything" }),
        makeProvider(),
        makeTrust({ allowedSessionIds: null }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(true)
    })
  })

  describe("artifact_unavailable", () => {
    it("rejects when artifact not in advertised capabilities", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ modelArtifactDigest: "sha256:unknown-artifact" }),
        makeProvider(),
        makeTrust(),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("artifact_unavailable")
    })

    it("rejects when artifact not in trust's allowed artifact digests", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ modelArtifactDigest: "sha256:artifact-abc" }),
        makeProvider(),
        makeTrust({ allowedArtifactDigests: ["sha256:different-artifact"] }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("artifact_unavailable")
    })
  })

  describe("workload_unsupported", () => {
    it("rejects when workload not in trust's allowed workloads", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ workloadClass: "classification" }),
        makeProvider(),
        makeTrust({ allowedWorkloadClasses: ["chat_completion"] }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("workload_unsupported")
    })
  })

  describe("target_incompatible", () => {
    it("rejects when target not in trust's allowed targets", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ requestedTargetConstraints: "gpu:nvidia" }),
        makeProvider(),
        makeTrust({ allowedTargetClasses: ["cpu:arm64"] }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("target_incompatible")
    })
  })

  describe("containment_insufficient", () => {
    it("rejects when provider containment does not match lease requirements", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ requiredContainmentLevel: "seccomp_level_3" }),
        makeProvider({ containmentCapabilityDigest: "seccomp_level_2:sha256:abc" }),
        makeTrust(),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("containment_insufficient")
    })
  })

  describe("disclosure_class_forbidden", () => {
    it("rejects when input disclosure class not allowed", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ inputDisclosureClass: "public" }),
        makeProvider(),
        makeTrust({ allowedDisclosureClasses: ["session_scoped", "task_visible"] }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("disclosure_class_forbidden")
    })

    it("rejects when output disclosure class not allowed", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ outputDisclosureClass: "federation_summary" }),
        makeProvider(),
        makeTrust({ allowedDisclosureClasses: ["session_scoped", "task_visible"] }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("disclosure_class_forbidden")
    })
  })

  describe("budget_exceeded", () => {
    it("rejects when input tokens exceed trust max", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ requestedMaxInputTokens: 99999 }),
        makeProvider(),
        makeTrust({ maximumTokens: 4096 }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("budget_exceeded")
    })

    it("rejects when output tokens exceed trust max", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ requestedMaxOutputTokens: 99999 }),
        makeProvider(),
        makeTrust({ maximumTokens: 4096 }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("budget_exceeded")
    })

    it("rejects when runtime exceeds trust max", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ requestedMaxRuntimeSeconds: 99999 }),
        makeProvider(),
        makeTrust({ maximumRuntimeSeconds: 600 }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("budget_exceeded")
    })

    it("rejects when memory exceeds trust max", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ requestedMaxMemoryBytes: 99999999999 }),
        makeProvider(),
        makeTrust({ maximumMemoryBytes: 4 * 1024 * 1024 * 1024 }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("budget_exceeded")
    })

    it("does not reject when trust maximumTokens is 0 (unlimited)", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ requestedMaxInputTokens: 99999 }),
        makeProvider(),
        makeTrust({ maximumTokens: 0 }),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(true)
    })
  })

  describe("provider_busy", () => {
    it("rejects when provider is busy", () => {
      const result = evaluateLeaseAdmission(
        makeLease(),
        makeProvider({ status: "busy" }),
        makeTrust(),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("provider_busy")
    })
  })

  describe("provider_draining", () => {
    it("rejects when provider is draining", () => {
      const result = evaluateLeaseAdmission(
        makeLease(),
        makeProvider({ enrollmentState: "draining" }),
        makeTrust(),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("provider_draining")
    })
  })

  describe("lease_expired", () => {
    it("rejects when lease has expired", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ expiresAt: "2020-01-01T00:00:00.000Z" }),
        makeProvider(),
        makeTrust(),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("lease_expired")
    })
  })

  describe("tokenizer_mismatch", () => {
    it("rejects when tokenizer digest not in advertised capabilities", () => {
      const result = evaluateLeaseAdmission(
        makeLease({ tokenizerDigest: "sha256:unknown-tokenizer" }),
        makeProvider(),
        makeTrust(),
        ADVERTISED_CAPABILITIES,
      )
      expect(result.admitted).toBe(false)
      expect(result.rejectionClass).toBe("tokenizer_mismatch")
    })
  })

  describe("replay_detected", () => {
    // replay_detected requires nonce/signature state not available in pure function;
    // the admission gate currently does not check for replays. This test documents
    // the gap rather than asserting behavior. When replay detection is added,
    // update this test to match.
  })
})

// ── checkArtifactParity ----------------------------------------------------

describe("checkArtifactParity", () => {
  it("strict mode: returns true when digest in available set", () => {
    expect(checkArtifactParity(
      makeLease({ artifactParityMode: "strict_artifact_parity" }),
      ["sha256:artifact-abc", "sha256:other"],
    )).toBe(true)
  })

  it("strict mode: returns false when digest not in available set", () => {
    expect(checkArtifactParity(
      makeLease({ artifactParityMode: "strict_artifact_parity", modelArtifactDigest: "sha256:missing" }),
      ["sha256:artifact-abc"],
    )).toBe(false)
  })

  it("family_compatible mode: returns true with matching digest", () => {
    expect(checkArtifactParity(
      makeLease({ artifactParityMode: "family_compatible" }),
      ["sha256:artifact-abc"],
    )).toBe(true)
  })

  it("evaluation_only mode: always returns true", () => {
    expect(checkArtifactParity(
      makeLease({ artifactParityMode: "evaluation_only", modelArtifactDigest: "sha256:anything" }),
      [],
    )).toBe(true)
  })
})

// ── checkContainmentCapability ----------------------------------------------

describe("checkContainmentCapability", () => {
  it("returns true when provider digest starts with lease level", () => {
    expect(checkContainmentCapability(
      makeLease({ requiredContainmentLevel: "seccomp_level_2" }),
      "seccomp_level_2:sha256:abc",
    )).toBe(true)
  })

  it("returns false when provider digest does not satisfy lease level", () => {
    expect(checkContainmentCapability(
      makeLease({ requiredContainmentLevel: "seccomp_level_3" }),
      "seccomp_level_2:sha256:abc",
    )).toBe(false)
  })

  it("returns false when provider digest is empty", () => {
    expect(checkContainmentCapability(
      makeLease({ requiredContainmentLevel: "seccomp_level_2" }),
      "",
    )).toBe(false)
  })

  it("returns true when lease has no containment requirement", () => {
    expect(checkContainmentCapability(
      makeLease({ requiredContainmentLevel: "" }),
      "seccomp_level_2:sha256:abc",
    )).toBe(true)
  })
})

// ── checkDisclosureClass ----------------------------------------------------

describe("checkDisclosureClass", () => {
  it("returns true when input and output are in allowed set", () => {
    expect(checkDisclosureClass(
      makeLease({ inputDisclosureClass: "session_scoped", outputDisclosureClass: "task_visible" }),
      ["session_scoped", "task_visible"],
    )).toBe(true)
  })

  it("returns false when input not in allowed set", () => {
    expect(checkDisclosureClass(
      makeLease({ inputDisclosureClass: "public" }),
      ["session_scoped"],
    )).toBe(false)
  })

  it("returns false when output not in allowed set", () => {
    expect(checkDisclosureClass(
      makeLease({ outputDisclosureClass: "federation_summary" }),
      ["session_scoped"],
    )).toBe(false)
  })
})

// ── createProviderReceipt ---------------------------------------------------

describe("createProviderReceipt", () => {
  beforeEach(() => _resetReceiptCounter())

  it("creates a receipt from a lease and execution result", () => {
    const lease = makeLease()
    const receipt = createProviderReceipt(lease, {
      outputDigest: "sha256:output-abc",
      inputTokens: 512,
      outputTokens: 1024,
      durationMs: 15000,
    })

    expect(receipt.leaseId).toBe(lease.leaseId)
    expect(receipt.sessionId).toBe(lease.sessionId)
    expect(receipt.requesterIdentityPublicKey).toBe(lease.requesterIdentityPublicKey)
    expect(receipt.providerIdentityPublicKey).toBe(lease.providerIdentityPublicKey)
    expect(receipt.providerId).toBe(lease.providerId)
    expect(receipt.modelArtifactDigest).toBe(lease.modelArtifactDigest)
    expect(receipt.workloadClass).toBe(lease.workloadClass)
    expect(receipt.inputDigest).toBe(lease.inputDigest)
    expect(receipt.outputDigest).toBe("sha256:output-abc")
    expect(receipt.inputTokenCount).toBe(512)
    expect(receipt.outputTokenCount).toBe(1024)
    expect(receipt.totalDurationMs).toBe(15000)
    expect(receipt.emittedAt).toBeTruthy()
  })

  it("sets null fields when result fields are omitted", () => {
    const receipt = createProviderReceipt(makeLease(), { durationMs: 5000 })
    expect(receipt.outputDigest).toBeNull()
    expect(receipt.inputTokenCount).toBeNull()
    expect(receipt.outputTokenCount).toBeNull()
  })

  it("produces incrementing receipt ids", () => {
    _resetReceiptCounter()
    const r1 = createProviderReceipt(makeLease(), { durationMs: 100 })
    const r2 = createProviderReceipt(makeLease(), { durationMs: 200 })
    expect(r1.receiptId).not.toBe(r2.receiptId)
    expect(r1.receiptId.length).toBeGreaterThan(0)
    expect(r2.receiptId.length).toBeGreaterThan(0)
  })
})
