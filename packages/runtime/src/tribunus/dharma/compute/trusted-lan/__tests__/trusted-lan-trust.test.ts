/**
 * Tests for trusted-lan-trust.ts — Typed trust scopes
 */

import { describe, it, expect } from "bun:test"
import {
  createTrust,
  getTrustTemplate,
  evaluateTrust,
  isTrustExpired,
  isTrustRevoked,
  revokeTrust,
} from "../trusted-lan-trust.ts"
import type { PrismLanProviderTrust, PrismLanComputeLease, TrustScopeKind } from "../trusted-lan-types"
import { TrustError } from "../trusted-lan-errors"

// ── Helpers -----------------------------------------------------------------

const FUTURE = new Date(Date.now() + 86_400_000).toISOString()
const PAST = new Date(Date.now() - 10_000).toISOString()

function makeTrust(overrides?: Partial<PrismLanProviderTrust>): PrismLanProviderTrust {
  return {
    trustId: "trust-1",
    federationId: "fed-main",
    providerIdentityPublicKey: "pk-provider-bob",
    grantedByIdentityPublicKey: "pk-granter-alice",
    allowedSessionIds: null,
    allowedWorkloadClasses: ["inference", "embedding"],
    allowedDisclosureClasses: ["standard"],
    allowedArtifactDigests: [],
    allowedTargetClasses: ["gpu"],
    maximumRuntimeSeconds: 3600,
    maximumTokens: 262144,
    maximumMemoryBytes: 16 * 1024 * 1024 * 1024, // 16 GiB
    maximumConcurrentLeases: 4,
    allowStreaming: true,
    allowResultArtifactReturn: true,
    expiresAt: FUTURE,
    revokedAt: null,
    reasonDigest: null,
    signature: "sig-abc",
    ...overrides,
  }
}

function makeLease(overrides?: Partial<PrismLanComputeLease>): PrismLanComputeLease {
  return {
    leaseId: "lease-1",
    sessionId: "session-42",
    taskId: "task-1",
    requesterIdentityPublicKey: "pk-requester-alice",
    requesterMembershipId: "mem-7",
    requesterDevicePublicKey: "dk-alice-laptop",
    providerId: "prov-bob",
    providerIdentityPublicKey: "pk-provider-bob",
    backendKind: "prism_trusted_lan",
    workloadClass: "inference",
    modelArtifactDigest: "sha256:abc",
    tokenizerDigest: "sha256:token-xyz",
    artifactParityMode: "strict_artifact_parity",
    computeImagePolicyDigest: "sha256:img-policy",
    requestedTargetConstraints: "gpu",
    inputDisclosureClass: "standard",
    inputDigest: "sha256:input-data",
    inputReference: null,
    outputDisclosureClass: "standard",
    requestedMaxInputTokens: 4096,
    requestedMaxOutputTokens: 4096,
    requestedMaxRuntimeSeconds: 300,
    requestedMaxMemoryBytes: 1_073_741_824,
    requestedMaxOutputBytes: 1_048_576,
    requestedMaxGpuTimeMs: null,
    requiredContainmentLevel: "standard",
    providerTrustScopeDigest: "digest-trust",
    disconnectPolicy: "restart",
    status: "requested",
    issuedAt: new Date().toISOString(),
    expiresAt: FUTURE,
    signatureChain: "chain-abc",
    ...overrides,
  }
}

// ── createTrust -------------------------------------------------------------

describe("createTrust", () => {
  it("creates a personal_cluster trust with template defaults", () => {
    const trust = createTrust({
      federationId: "fed-main",
      providerKey: "pk-provider-bob",
      grantedBy: "pk-granter-alice",
      kind: "personal_cluster",
      expiresAt: FUTURE,
    })

    expect(trust.trustId).toBeTruthy()
    expect(trust.federationId).toBe("fed-main")
    expect(trust.providerIdentityPublicKey).toBe("pk-provider-bob")
    expect(trust.grantedByIdentityPublicKey).toBe("pk-granter-alice")
    expect(trust.expiresAt).toBe(FUTURE)
    expect(trust.revokedAt).toBeNull()
    expect(trust.reasonDigest).toBeNull()
    expect(trust.signature).toBeTruthy()
    // personal_cluster defaults
    expect(trust.allowedWorkloadClasses).toContain("inference")
    expect(trust.allowStreaming).toBeTrue()
    expect(trust.maximumConcurrentLeases).toBe(8)
    expect(trust.maximumTokens).toBe(262144)
  })

  it("creates a restricted_provider trust with all-empty defaults", () => {
    const trust = createTrust({
      federationId: "fed-main",
      providerKey: "pk-provider-malicious",
      grantedBy: "pk-admin",
      kind: "restricted_provider",
      expiresAt: FUTURE,
    })

    expect(trust.allowedWorkloadClasses).toEqual([])
    expect(trust.allowedDisclosureClasses).toEqual([])
    expect(trust.allowedArtifactDigests).toEqual([])
    expect(trust.maximumConcurrentLeases).toBe(0)
    expect(trust.allowStreaming).toBeFalse()
  })

  it("throws TrustError when expiresAt is in the past", () => {
    expect(() =>
      createTrust({
        federationId: "fed-main",
        providerKey: "pk-bob",
        grantedBy: "pk-alice",
        kind: "personal_cluster",
        expiresAt: PAST,
      }),
    ).toThrow(TrustError)
  })

  it("throws TrustError when expiresAt is not a valid date", () => {
    expect(() =>
      createTrust({
        federationId: "fed-main",
        providerKey: "pk-bob",
        grantedBy: "pk-alice",
        kind: "personal_cluster",
        expiresAt: "not-a-date",
      }),
    ).toThrow(TrustError)
  })

  it("throws TrustError when federationId is empty", () => {
    expect(() =>
      createTrust({
        federationId: "",
        providerKey: "pk-bob",
        grantedBy: "pk-alice",
        kind: "personal_cluster",
        expiresAt: FUTURE,
      }),
    ).toThrow(TrustError)
  })

  it("throws TrustError when providerKey is empty", () => {
    expect(() =>
      createTrust({
        federationId: "fed-main",
        providerKey: "",
        grantedBy: "pk-alice",
        kind: "personal_cluster",
        expiresAt: FUTURE,
      }),
    ).toThrow(TrustError)
  })
})

// ── getTrustTemplate --------------------------------------------------------

describe("getTrustTemplate", () => {
  it("returns personal_cluster defaults", () => {
    const t = getTrustTemplate("personal_cluster")
    expect(t.maximumConcurrentLeases).toBe(8)
    expect(t.allowStreaming).toBeTrue()
    expect(t.allowedWorkloadClasses).toContain("inference")
  })

  it("returns private_team_provider defaults", () => {
    const t = getTrustTemplate("private_team_provider")
    expect(t.maximumConcurrentLeases).toBe(4)
    expect(t.allowResultArtifactReturn).toBeFalse()
    expect(t.allowedWorkloadClasses).toContain("training")
  })

  it("returns benchmark_provider defaults", () => {
    const t = getTrustTemplate("benchmark_provider")
    expect(t.maximumConcurrentLeases).toBe(1)
    expect(t.allowStreaming).toBeFalse()
  })

  it("returns restricted_provider defaults", () => {
    const t = getTrustTemplate("restricted_provider")
    expect(t.maximumConcurrentLeases).toBe(0)
    expect(t.allowedWorkloadClasses).toEqual([])
  })

  it("returns a new copy each call (no mutation)", () => {
    const t1 = getTrustTemplate("personal_cluster")
    const t2 = getTrustTemplate("personal_cluster")
    expect(t1).not.toBe(t2)
    expect(t1).toEqual(t2)
  })

  it("throws TrustError for unknown kind", () => {
    expect(() => getTrustTemplate("unknown_kind" as TrustScopeKind)).toThrow(TrustError)
  })
})

// ── evaluateTrust -----------------------------------------------------------

describe("evaluateTrust", () => {
  it("returns satisfied when trust meets lease requirements", () => {
    const trust = makeTrust()
    const lease = makeLease()
    const result = evaluateTrust(trust, lease)
    expect(result.satisfied).toBeTrue()
    expect(result.reason).toBeNull()
  })

  it("rejects when trust is expired", () => {
    const trust = makeTrust({ expiresAt: PAST })
    const result = evaluateTrust(trust, makeLease())
    expect(result.satisfied).toBeFalse()
    expect(result.reason).toContain("expired")
  })

  it("rejects when trust is revoked", () => {
    const trust = makeTrust({ revokedAt: new Date().toISOString() })
    const result = evaluateTrust(trust, makeLease())
    expect(result.satisfied).toBeFalse()
    expect(result.reason).toContain("revoked")
  })

  it("rejects when workload class is not allowed", () => {
    const trust = makeTrust({ allowedWorkloadClasses: ["embedding"] })
    const lease = makeLease({ workloadClass: "training" })
    const result = evaluateTrust(trust, lease)
    expect(result.satisfied).toBeFalse()
    expect(result.reason).toContain("training")
  })

  it("rejects when requested runtime exceeds trust limit", () => {
    const trust = makeTrust({ maximumRuntimeSeconds: 100 })
    const lease = makeLease({ requestedMaxRuntimeSeconds: 200 })
    const result = evaluateTrust(trust, lease)
    expect(result.satisfied).toBeFalse()
    expect(result.reason).toContain("200")
    expect(result.reason).toContain("100")
  })

  it("allows runtime when trust limit is 0 (unlimited)", () => {
    const trust = makeTrust({ maximumRuntimeSeconds: 0 })
    const lease = makeLease({ requestedMaxRuntimeSeconds: 1_000_000 })
    const result = evaluateTrust(trust, lease)
    expect(result.satisfied).toBeTrue()
  })

  it("rejects when requested tokens exceed trust limit", () => {
    const trust = makeTrust({ maximumTokens: 5000 })
    // input 4096 + output 4096 = 8192 > 5000
    const lease = makeLease({ requestedMaxInputTokens: 4096, requestedMaxOutputTokens: 4096 })
    const result = evaluateTrust(trust, lease)
    expect(result.satisfied).toBeFalse()
    expect(result.reason).toContain("8192")
    expect(result.reason).toContain("5000")
  })

  it("allows tokens when trust limit is 0 (unlimited)", () => {
    const trust = makeTrust({ maximumTokens: 0 })
    const lease = makeLease({ requestedMaxInputTokens: 1_000_000, requestedMaxOutputTokens: 1_000_000 })
    const result = evaluateTrust(trust, lease)
    expect(result.satisfied).toBeTrue()
  })

  it("rejects when requested memory exceeds trust limit", () => {
    const trust = makeTrust({ maximumMemoryBytes: 1_000_000 })
    const lease = makeLease({ requestedMaxMemoryBytes: 2_000_000 })
    const result = evaluateTrust(trust, lease)
    expect(result.satisfied).toBeFalse()
    expect(result.reason).toContain("2000000")
    expect(result.reason).toContain("1000000")
  })

  it("allows memory when trust limit is 0 (unlimited)", () => {
    const trust = makeTrust({ maximumMemoryBytes: 0 })
    const lease = makeLease({ requestedMaxMemoryBytes: 1_000_000_000 })
    const result = evaluateTrust(trust, lease)
    expect(result.satisfied).toBeTrue()
  })
})

// ── isTrustExpired ----------------------------------------------------------

describe("isTrustExpired", () => {
  it("returns true when expiresAt is in the past", () => {
    expect(isTrustExpired(makeTrust({ expiresAt: PAST }))).toBeTrue()
  })

  it("returns false when expiresAt is in the future", () => {
    expect(isTrustExpired(makeTrust({ expiresAt: FUTURE }))).toBeFalse()
  })
})

// ── isTrustRevoked ----------------------------------------------------------

describe("isTrustRevoked", () => {
  it("returns false when revokedAt is null", () => {
    expect(isTrustRevoked(makeTrust({ revokedAt: null }))).toBeFalse()
  })

  it("returns true when revokedAt is set", () => {
    expect(isTrustRevoked(makeTrust({ revokedAt: new Date().toISOString() }))).toBeTrue()
  })
})

// ── revokeTrust -------------------------------------------------------------

describe("revokeTrust", () => {
  it("sets revokedAt and reasonDigest on the new trust object", () => {
    const trust = makeTrust()
    const revoked = revokeTrust(trust, "provider violated SLA")

    expect(revoked.revokedAt).toBeTruthy()
    expect(revoked.reasonDigest).toBeTruthy()
    expect(revoked.reasonDigest!.length).toBeGreaterThan(0)
    // Original is not mutated
    expect(trust.revokedAt).toBeNull()
    expect(trust.reasonDigest).toBeNull()
  })

  it("preserves all other fields from the original trust", () => {
    const trust = makeTrust()
    const revoked = revokeTrust(trust, "security concern")

    expect(revoked.trustId).toBe(trust.trustId)
    expect(revoked.federationId).toBe(trust.federationId)
    expect(revoked.providerIdentityPublicKey).toBe(trust.providerIdentityPublicKey)
    expect(revoked.maximumConcurrentLeases).toBe(trust.maximumConcurrentLeases)
  })

  it("throws TrustError when reason is empty", () => {
    expect(() => revokeTrust(makeTrust(), "")).toThrow(TrustError)
  })

  it("throws TrustError when trust is already revoked", () => {
    const trust = makeTrust({ revokedAt: new Date().toISOString() })
    expect(() => revokeTrust(trust, "second revocation")).toThrow(TrustError)
  })
})
