/**
 * Tests for trusted-lan-discovery.ts — Enrollment, advertisement, pairing
 */

import { describe, it, expect } from "bun:test"
import {
  enrollProvider,
  createAdvertisement,
  isAdvertisementExpired,
  createPairing,
  isPairingActive,
  canProviderAcceptWork,
} from "../trusted-lan-discovery.ts"
import type { PrismLanProvider, ArtifactSummary, PrismLanCapabilityAdvertisement, LanPairing } from "../trusted-lan-types"
import { ProviderError, PairingError } from "../trusted-lan-errors"

// ── Helper Values -----------------------------------------------------------

const VALID_CONFIG = {
  identityKey: "pk-alice-001",
  deviceKey: "dk-alice-device-x1",
  federationId: "fed-main",
  transportKey: "tk-alice-transport-99",
}

const SAMPLE_ARTIFACTS: ArtifactSummary[] = [
  {
    artifactDigest: "sha256:abc123",
    modelFamily: "llama",
    modelVersion: "3.1-8b",
    tokenizerDigest: "sha256:token-llama",
    quantizationScheme: "fp16",
    maximumContextLength: 8192,
    supportedWorkloadClasses: ["inference"],
    supportedComputeTargets: ["gpu"],
    admissionState: "available",
  },
]

// ── enrollProvider ----------------------------------------------------------

describe("enrollProvider", () => {
  it("creates a provider in draft state with available health", () => {
    const p = enrollProvider(VALID_CONFIG)

    expect(p.providerId).toBeTruthy()
    expect(typeof p.providerId).toBe("string")
    expect(p.identityPublicKey).toBe("pk-alice-001")
    expect(p.devicePublicKey).toBe("dk-alice-device-x1")
    expect(p.federationId).toBe("fed-main")
    expect(p.transportPublicKey).toBe("tk-alice-transport-99")
    expect(p.enrollmentState).toBe("draft")
    expect(p.status).toBe("available")
    expect(p.displayName).toBeNull()
    expect(p.capabilityAdvertisementId).toBeNull()
    expect(p.containmentCapabilityDigest).toBe("")
    expect(p.createdAt).toBeTruthy()
    expect(p.lastSeenAt).toBeNull()
    expect(p.revokedAt).toBeNull()
  })

  it("generates a unique id for each provider", () => {
    const p1 = enrollProvider(VALID_CONFIG)
    const p2 = enrollProvider({
      ...VALID_CONFIG,
      identityKey: "pk-bob-002",
    })
    expect(p1.providerId).not.toBe(p2.providerId)
  })

  it("throws ProviderError when identityKey is empty", () => {
    expect(() => enrollProvider({ ...VALID_CONFIG, identityKey: "" })).toThrow(ProviderError)
  })

  it("throws ProviderError when deviceKey is empty", () => {
    expect(() => enrollProvider({ ...VALID_CONFIG, deviceKey: "" })).toThrow(ProviderError)
  })

  it("throws ProviderError when federationId is empty", () => {
    expect(() => enrollProvider({ ...VALID_CONFIG, federationId: "" })).toThrow(ProviderError)
  })

  it("throws ProviderError when transportKey is empty", () => {
    expect(() => enrollProvider({ ...VALID_CONFIG, transportKey: "" })).toThrow(ProviderError)
  })
})

// ── createAdvertisement -----------------------------------------------------

describe("createAdvertisement", () => {
  const AD_CONFIG = {
    providerId: "prov-1",
    providerKey: "pk-alice-001",
    artifacts: SAMPLE_ARTIFACTS,
    workloads: ["inference", "embedding"],
    targets: ["gpu", "cpu"],
  }

  it("creates an advertisement with the correct provider identity", () => {
    const ad = createAdvertisement(AD_CONFIG)

    expect(ad.advertisementId).toBeTruthy()
    expect(ad.providerId).toBe("prov-1")
    expect(ad.providerIdentityPublicKey).toBe("pk-alice-001")
    expect(ad.protocolVersion).toBe(1)
    expect(ad.supportedWorkloadClasses).toEqual(["inference", "embedding"])
    expect(ad.computeTargetSummaries).toEqual(["gpu", "cpu"])
    expect(ad.artifactSummaries).toEqual(SAMPLE_ARTIFACTS)
    expect(ad.signature).toBeTruthy()
  })

  it("sets sensible default resource limits", () => {
    const ad = createAdvertisement(AD_CONFIG)

    expect(ad.maximumConcurrentLeases).toBeGreaterThan(0)
    expect(ad.maximumInputTokens).toBeGreaterThan(0)
    expect(ad.maximumOutputTokens).toBeGreaterThan(0)
    expect(ad.maximumRuntimeSeconds).toBeGreaterThan(0)
    expect(ad.maximumMemoryBytes).toBeGreaterThan(0)
    expect(ad.supportedOutputModes).toContain("token_delta")
    expect(ad.supportedDisclosureClasses).toContain("standard")
    expect(ad.healthSummary).toBe("available")
  })

  it("sets issuedAt and a future expiresAt", () => {
    const ad = createAdvertisement(AD_CONFIG)
    const issued = new Date(ad.issuedAt)
    const expires = new Date(ad.expiresAt)

    expect(issued.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
    expect(expires.getTime()).toBeGreaterThan(issued.getTime())
    // Roughly 1 hour delta
    expect(expires.getTime() - issued.getTime()).toBeCloseTo(3600_000, -3)
  })

  it("throws ProviderError when providerId is empty", () => {
    expect(() => createAdvertisement({ ...AD_CONFIG, providerId: "" })).toThrow(ProviderError)
  })

  it("throws ProviderError when workloads array is empty", () => {
    expect(() => createAdvertisement({ ...AD_CONFIG, workloads: [] })).toThrow(ProviderError)
  })

  it("throws ProviderError when providerKey is empty", () => {
    expect(() => createAdvertisement({ ...AD_CONFIG, providerKey: "" })).toThrow(ProviderError)
  })
})

// ── isAdvertisementExpired --------------------------------------------------

describe("isAdvertisementExpired", () => {
  it("returns true when expiresAt is in the past", () => {
    const past = new Date(Date.now() - 10_000).toISOString()
    const ad: PrismLanCapabilityAdvertisement = {
      advertisementId: "ad-1",
      providerId: "prov-1",
      providerIdentityPublicKey: "pk-alice",
      protocolVersion: 1,
      supportedWorkloadClasses: ["inference"],
      artifactSummaries: [],
      computeTargetSummaries: [],
      containmentCapabilityDigest: "",
      maximumConcurrentLeases: 1,
      maximumInputTokens: 4096,
      maximumOutputTokens: 4096,
      maximumRuntimeSeconds: 300,
      maximumMemoryBytes: 1_073_741_824,
      supportedOutputModes: ["token_delta"],
      supportedDisclosureClasses: ["standard"],
      healthSummary: "available",
      issuedAt: new Date(Date.now() - 86_400_000).toISOString(),
      expiresAt: past,
      signature: "sig",
    }

    expect(isAdvertisementExpired(ad)).toBeTrue()
  })

  it("returns false when expiresAt is in the future", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    const ad: PrismLanCapabilityAdvertisement = {
      advertisementId: "ad-2",
      providerId: "prov-1",
      providerIdentityPublicKey: "pk-alice",
      protocolVersion: 1,
      supportedWorkloadClasses: ["inference"],
      artifactSummaries: [],
      computeTargetSummaries: [],
      containmentCapabilityDigest: "",
      maximumConcurrentLeases: 1,
      maximumInputTokens: 4096,
      maximumOutputTokens: 4096,
      maximumRuntimeSeconds: 300,
      maximumMemoryBytes: 1_073_741_824,
      supportedOutputModes: ["token_delta"],
      supportedDisclosureClasses: ["standard"],
      healthSummary: "available",
      issuedAt: new Date().toISOString(),
      expiresAt: future,
      signature: "sig",
    }

    expect(isAdvertisementExpired(ad)).toBeFalse()
  })
})

// ── createPairing -----------------------------------------------------------

describe("createPairing", () => {
  it("creates an active pairing between requester and provider", () => {
    const pair = createPairing("pk-alice", "pk-bob-provider", "psk_handshake")

    expect(pair.pairingId).toBeTruthy()
    expect(pair.requesterIdentityPublicKey).toBe("pk-alice")
    expect(pair.providerIdentityPublicKey).toBe("pk-bob-provider")
    expect(pair.transportPublicKey).toBeTruthy()
    expect(typeof pair.transportPublicKey).toBe("string")
    expect(pair.pairingMethod).toBe("psk_handshake")
    expect(pair.status).toBe("active")
    expect(pair.expiresAt).toBeNull()
    expect(pair.pairedAt).toBeTruthy()
  })

  it("generates a deterministic transport key for the same keys", () => {
    const pair1 = createPairing("pk-alice", "pk-bob", "psk")
    const pair2 = createPairing("pk-alice", "pk-bob", "psk")
    expect(pair1.transportPublicKey).toBe(pair2.transportPublicKey)
  })

  it("throws PairingError when requesterKey is empty", () => {
    expect(() => createPairing("", "pk-bob", "psk")).toThrow(PairingError)
  })

  it("throws PairingError when providerKey is empty", () => {
    expect(() => createPairing("pk-alice", "", "psk")).toThrow(PairingError)
  })

  it("throws PairingError when method is empty", () => {
    expect(() => createPairing("pk-alice", "pk-bob", "")).toThrow(PairingError)
  })
})

// ── isPairingActive ---------------------------------------------------------

describe("isPairingActive", () => {
  function makePairing(overrides?: Partial<LanPairing>): LanPairing {
    return {
      pairingId: "pair-1",
      requesterIdentityPublicKey: "pk-alice",
      providerIdentityPublicKey: "pk-bob",
      transportPublicKey: "tk-xyz",
      pairingMethod: "psk",
      pairedAt: new Date().toISOString(),
      expiresAt: null,
      status: "active",
      ...overrides,
    }
  }

  it("returns true for an active pairing with no expiry", () => {
    expect(isPairingActive(makePairing())).toBeTrue()
  })

  it("returns true for an active pairing with a future expiry", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    expect(isPairingActive(makePairing({ expiresAt: future }))).toBeTrue()
  })

  it("returns false when status is not active", () => {
    expect(isPairingActive(makePairing({ status: "expired" }))).toBeFalse()
    expect(isPairingActive(makePairing({ status: "revoked" }))).toBeFalse()
    expect(isPairingActive(makePairing({ status: "pending" }))).toBeFalse()
  })

  it("returns false when expiresAt is in the past", () => {
    const past = new Date(Date.now() - 10_000).toISOString()
    expect(isPairingActive(makePairing({ expiresAt: past }))).toBeFalse()
  })
})

// ── canProviderAcceptWork ---------------------------------------------------

describe("canProviderAcceptWork", () => {
  function makeProvider(overrides?: Partial<PrismLanProvider>): PrismLanProvider {
    return {
      providerId: "prov-1",
      identityPublicKey: "pk-alice",
      devicePublicKey: "dk-alice",
      federationId: "fed-main",
      displayName: null,
      transportPublicKey: "tk-alice",
      enrollmentState: "active",
      status: "available",
      capabilityAdvertisementId: "ad-1",
      containmentCapabilityDigest: "digest-abc",
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      revokedAt: null,
      ...overrides,
    }
  }

  it("returns true for an active, available provider", () => {
    expect(canProviderAcceptWork(makeProvider())).toBeTrue()
  })

  it("returns true for a draining, available provider", () => {
    expect(canProviderAcceptWork(makeProvider({ enrollmentState: "draining" }))).toBeTrue()
  })

  it("returns false when provider is not in active/draining enrollment state", () => {
    expect(canProviderAcceptWork(makeProvider({ enrollmentState: "draft" }))).toBeFalse()
    expect(canProviderAcceptWork(makeProvider({ enrollmentState: "suspended" }))).toBeFalse()
    expect(canProviderAcceptWork(makeProvider({ enrollmentState: "revoked" }))).toBeFalse()
  })

  it("returns false when provider health is not available", () => {
    expect(canProviderAcceptWork(makeProvider({ status: "busy" }))).toBeFalse()
    expect(canProviderAcceptWork(makeProvider({ status: "degraded" }))).toBeFalse()
    expect(canProviderAcceptWork(makeProvider({ status: "offline" }))).toBeFalse()
  })
})
