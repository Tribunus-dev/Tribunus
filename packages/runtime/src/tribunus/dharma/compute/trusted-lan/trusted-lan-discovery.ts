/**
 * Dharma Trusted-LAN — Enrollment, Capability Advertisement, Pairing
 *
 * Pure functions for provider enrollment lifecycle, capability advertising,
 * and bidirectional pairing for encrypted transport.
 */

import type { PrismLanProvider, PrismLanCapabilityAdvertisement, ArtifactSummary, LanPairing } from "./trusted-lan-types"
import { ProviderError, PairingError } from "./trusted-lan-errors"
import { applyEnrollmentAction, isProviderActive } from "./trusted-lan-lifecycle"

// ── Crypto Helpers ----------------------------------------------------------

function nowISO(): string {
  return new Date().toISOString()
}

function generateId(): string {
  return crypto.randomUUID()
}

function hashHex(data: string): string {
  // Deterministic hex digest for signature derivation
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    const ch = data.charCodeAt(i)
    hash = ((hash << 5) - hash) + ch
    hash |= 0
  }
  // Widen to 64 hex chars via multiple seeds
  let h1 = 0, h2 = 5381
  for (let i = 0; i < data.length; i++) {
    const ch = data.charCodeAt(i)
    h1 = ((h1 << 5) - h1) + ch; h1 |= 0
    h2 = ((h2 << 5) + h2) + ch; h2 |= 0
  }
  const abs = (n: number) => Math.abs(n)
  const hex = (n: number) => n.toString(16).padStart(8, "0")
  return hex(abs(h1)) + hex(abs(h2)) + hex(abs(h1 + h2)) + hex(abs(h1 * h2))
}

// ── Enrollment --------------------------------------------------------------

/**
 * Enroll a new Prism compute provider on the trusted LAN.
 *
 * The provider starts in `draft` state with `available` health.
 * Callers must attest and activate through the lifecycle state machine
 * before the provider can accept work.
 */
export function enrollProvider(config: {
  identityKey: string
  deviceKey: string
  federationId: string
  transportKey: string
}): PrismLanProvider {
  if (!config.identityKey) throw new ProviderError("identityKey is required")
  if (!config.deviceKey) throw new ProviderError("deviceKey is required")
  if (!config.federationId) throw new ProviderError("federationId is required")
  if (!config.transportKey) throw new ProviderError("transportKey is required")

  const providerId = generateId()

  return {
    providerId,
    identityPublicKey: config.identityKey,
    devicePublicKey: config.deviceKey,
    federationId: config.federationId,
    displayName: null,
    transportPublicKey: config.transportKey,
    enrollmentState: "draft",
    status: "available",
    capabilityAdvertisementId: null,
    containmentCapabilityDigest: "",
    createdAt: nowISO(),
    lastSeenAt: null,
    revokedAt: null,
  }
}

// ── Capability Advertisement ------------------------------------------------

/**
 * Create a capability advertisement for a provider.
 *
 * The advertisement describes what artifacts, workloads, and compute
 * targets the provider supports, along with resource limits.
 */
export function createAdvertisement(config: {
  providerId: string
  providerKey: string
  artifacts: ArtifactSummary[]
  workloads: string[]
  targets: string[]
}): PrismLanCapabilityAdvertisement {
  if (!config.providerId) throw new ProviderError("providerId is required")
  if (!config.providerKey) throw new ProviderError("providerKey is required")
  if (config.workloads.length === 0) throw new ProviderError("at least one workload class is required")

  const advertisementId = generateId()
  const issuedAt = nowISO()
  const oneHourMs = 60 * 60 * 1000
  const expiresAt = new Date(Date.now() + oneHourMs).toISOString()

  // Build a deterministic signature over the advertisement content
  const adPayload = [
    advertisementId, config.providerId, config.providerKey,
    ...[...config.workloads].sort(), ...[...config.targets].sort(),
    config.artifacts.map(a => a.artifactDigest).sort().join(","),
    issuedAt, expiresAt,
  ].join("|")
  const signature = hashHex(adPayload)

  return {
    advertisementId,
    providerId: config.providerId,
    providerIdentityPublicKey: config.providerKey,
    protocolVersion: 1,
    supportedWorkloadClasses: [...config.workloads],
    artifactSummaries: [...config.artifacts],
    computeTargetSummaries: [...config.targets],
    containmentCapabilityDigest: "",
    maximumConcurrentLeases: 4,
    maximumInputTokens: 131072,
    maximumOutputTokens: 65536,
    maximumRuntimeSeconds: 3600,
    maximumMemoryBytes: 16 * 1024 * 1024 * 1024, // 16 GiB
    supportedOutputModes: ["token_delta", "structured_chunk", "embedding_chunk"],
    supportedDisclosureClasses: ["standard", "restricted", "unrestricted"],
    healthSummary: "available",
    issuedAt,
    expiresAt,
    signature,
  }
}

/**
 * Check whether an advertisement has expired by comparing its
 * `expiresAt` timestamp to the current wall clock.
 */
export function isAdvertisementExpired(ad: PrismLanCapabilityAdvertisement): boolean {
  return new Date(ad.expiresAt).getTime() <= Date.now()
}

// ── Pairing -----------------------------------------------------------------

/**
 * Create a bidirectional pairing between a requester and a provider.
 *
 * Pairing establishes a shared transportPublicKey that encrypts the
 * handshake and subsequent compute frames.  The pairing starts active
 * and transitions to expired or revoked through the lifecycle.
 */
export function createPairing(
  requesterKey: string,
  providerKey: string,
  method: string,
): LanPairing {
  if (!requesterKey) throw new PairingError("requesterKey is required")
  if (!providerKey) throw new PairingError("providerKey is required")
  if (!method) throw new PairingError("pairing method is required")

  const pairingId = generateId()
  const pairedAt = nowISO()

  // Derive a transport key fingerprint from both participants' keys
  const transportKey = hashHex(`transport:${requesterKey}:${providerKey}`).slice(0, 32)

  return {
    pairingId,
    requesterIdentityPublicKey: requesterKey,
    providerIdentityPublicKey: providerKey,
    transportPublicKey: transportKey,
    pairingMethod: method,
    pairedAt,
    expiresAt: null,
    status: "active",
  }
}

/**
 * A pairing is active when its status is `"active"` and it has not
 * expired (if an expiry is set).
 */
export function isPairingActive(pairing: LanPairing): boolean {
  if (pairing.status !== "active") return false
  if (pairing.expiresAt !== null && new Date(pairing.expiresAt).getTime() <= Date.now()) return false
  return true
}

/**
 * A provider can accept compute work when its enrollment is `active`
 * or `draining` (the lifecycle view) and its health is `available`.
 */
export function canProviderAcceptWork(provider: PrismLanProvider): boolean {
  if (!isProviderActive(provider.enrollmentState)) return false
  if (provider.status !== "available") return false
  return true
}
