/**
 * Dharma Trusted-LAN — Typed Trust Scopes
 *
 * Pure functions for granting, evaluating, and revoking provider
 * trust scopes.  Each trust scope belongs to a `TrustScopeKind`
 * that carries default resource limits and access constraints.
 */

import type { PrismLanProviderTrust, TrustScopeKind, PrismLanComputeLease } from "./trusted-lan-types"
import { TrustError } from "./trusted-lan-errors"

// ── Crypto Helpers ----------------------------------------------------------

function nowISO(): string {
  return new Date().toISOString()
}

function generateId(): string {
  return crypto.randomUUID()
}

function hashDigest(data: string): string {
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

// ── Default Templates by Trust Scope Kind -----------------------------------

const TRUST_TEMPLATES: Record<TrustScopeKind, Partial<PrismLanProviderTrust>> = {
  personal_cluster: {
    allowedSessionIds: null,
    allowedWorkloadClasses: ["inference", "embedding"],
    allowedDisclosureClasses: ["standard", "restricted"],
    allowedArtifactDigests: [],
    allowedTargetClasses: ["gpu", "cpu"],
    maximumRuntimeSeconds: 7200,
    maximumTokens: 262144,
    maximumMemoryBytes: 64 * 1024 * 1024 * 1024, // 64 GiB
    maximumConcurrentLeases: 8,
    allowStreaming: true,
    allowResultArtifactReturn: true,
  },
  private_team_provider: {
    allowedSessionIds: null,
    allowedWorkloadClasses: ["inference", "embedding", "training"],
    allowedDisclosureClasses: ["standard"],
    allowedArtifactDigests: [],
    allowedTargetClasses: ["gpu"],
    maximumRuntimeSeconds: 14400,
    maximumTokens: 524288,
    maximumMemoryBytes: 128 * 1024 * 1024 * 1024, // 128 GiB
    maximumConcurrentLeases: 4,
    allowStreaming: true,
    allowResultArtifactReturn: false,
  },
  benchmark_provider: {
    allowedSessionIds: null,
    allowedWorkloadClasses: ["inference"],
    allowedDisclosureClasses: ["standard", "restricted"],
    allowedArtifactDigests: [],
    allowedTargetClasses: ["gpu", "cpu"],
    maximumRuntimeSeconds: 3600,
    maximumTokens: 131072,
    maximumMemoryBytes: 32 * 1024 * 1024 * 1024, // 32 GiB
    maximumConcurrentLeases: 1,
    allowStreaming: false,
    allowResultArtifactReturn: false,
  },
  restricted_provider: {
    allowedSessionIds: [],
    allowedWorkloadClasses: [],
    allowedDisclosureClasses: [],
    allowedArtifactDigests: [],
    allowedTargetClasses: [],
    maximumRuntimeSeconds: 0,
    maximumTokens: 0,
    maximumMemoryBytes: 0,
    maximumConcurrentLeases: 0,
    allowStreaming: false,
    allowResultArtifactReturn: false,
  },
}

// ── Trust Operations --------------------------------------------------------

/**
 * Create a typed trust scope for a provider.
 *
 * The trust defines what workloads, disclosure classes, artifacts,
 * targets, and resource limits the provider is authorised for.
 * Fields not specified in `config` inherit defaults from the
 * template for the given `kind`.
 */
export function createTrust(config: {
  federationId: string
  providerKey: string
  grantedBy: string
  kind: TrustScopeKind
  expiresAt: string
}): PrismLanProviderTrust {
  if (!config.federationId) throw new TrustError("federationId is required")
  if (!config.providerKey) throw new TrustError("providerKey is required")
  if (!config.grantedBy) throw new TrustError("grantedBy is required")
  if (!config.expiresAt) throw new TrustError("expiresAt is required")

  const expires = new Date(config.expiresAt)
  if (Number.isNaN(expires.getTime())) throw new TrustError("expiresAt must be a valid ISO date")
  if (expires.getTime() <= Date.now()) throw new TrustError("expiresAt must be in the future")

  const trustId = generateId()
  const template = getTrustTemplate(config.kind)
  const signaturePayload = [
    trustId, config.federationId, config.providerKey, config.grantedBy,
    config.kind, config.expiresAt,
  ].join("|")
  const signature = hashDigest(signaturePayload)

  return {
    trustId,
    federationId: config.federationId,
    providerIdentityPublicKey: config.providerKey,
    grantedByIdentityPublicKey: config.grantedBy,
    allowedSessionIds: template.allowedSessionIds ?? null,
    allowedWorkloadClasses: template.allowedWorkloadClasses ?? [],
    allowedDisclosureClasses: template.allowedDisclosureClasses ?? [],
    allowedArtifactDigests: template.allowedArtifactDigests ?? [],
    allowedTargetClasses: template.allowedTargetClasses ?? [],
    maximumRuntimeSeconds: template.maximumRuntimeSeconds ?? 0,
    maximumTokens: template.maximumTokens ?? 0,
    maximumMemoryBytes: template.maximumMemoryBytes ?? 0,
    maximumConcurrentLeases: template.maximumConcurrentLeases ?? 0,
    allowStreaming: template.allowStreaming ?? false,
    allowResultArtifactReturn: template.allowResultArtifactReturn ?? false,
    expiresAt: config.expiresAt,
    revokedAt: null,
    reasonDigest: null,
    signature,
  }
}

/**
 * Return the default template for a given trust scope kind.
 *
 * Trust templates supply sensible defaults for resource limits and
 * access constraints based on the trust relationship category.
 */
export function getTrustTemplate(kind: TrustScopeKind): Partial<PrismLanProviderTrust> {
  const template = TRUST_TEMPLATES[kind]
  if (!template) throw new TrustError(`unknown trust scope kind: ${kind}`)
  return { ...template }
}

/**
 * Evaluate whether a trust scope satisfies the requirements of a
 * compute lease.
 *
 * Checks performed (in order):
 * 1. Trust is not expired
 * 2. Trust is not revoked
 * 3. Workload class is allowed
 * 4. Lease runtime is within trust limit
 * 5. Lease tokens are within trust limit
 * 6. Lease memory is within trust limit
 *
 * Returns `{ satisfied, reason }` where `reason` is non-null when
 * `satisfied` is false.
 */
export function evaluateTrust(
  trust: PrismLanProviderTrust,
  lease: PrismLanComputeLease,
): { satisfied: boolean; reason: string | null } {
  // 1. Expired?
  if (isTrustExpired(trust)) {
    return { satisfied: false, reason: "trust scope has expired" }
  }

  // 2. Revoked?
  if (isTrustRevoked(trust)) {
    return { satisfied: false, reason: "trust scope has been revoked" }
  }

  // 3. Workload class must be allowed
  if (!trust.allowedWorkloadClasses.includes(lease.workloadClass)) {
    return {
      satisfied: false,
      reason: `workload class "${lease.workloadClass}" is not in allowed set [${trust.allowedWorkloadClasses.join(", ")}]`,
    }
  }

  // 4. Runtime limit
  if (trust.maximumRuntimeSeconds > 0 && lease.requestedMaxRuntimeSeconds > trust.maximumRuntimeSeconds) {
    return {
      satisfied: false,
      reason: `requested runtime ${lease.requestedMaxRuntimeSeconds}s exceeds trust limit of ${trust.maximumRuntimeSeconds}s`,
    }
  }

  // 5. Token limit
  const requestedTokens = lease.requestedMaxInputTokens + lease.requestedMaxOutputTokens
  if (trust.maximumTokens > 0 && requestedTokens > trust.maximumTokens) {
    return {
      satisfied: false,
      reason: `requested tokens ${requestedTokens} exceeds trust limit of ${trust.maximumTokens}`,
    }
  }

  // 6. Memory limit
  if (trust.maximumMemoryBytes > 0 && lease.requestedMaxMemoryBytes > trust.maximumMemoryBytes) {
    return {
      satisfied: false,
      reason: `requested memory ${lease.requestedMaxMemoryBytes} bytes exceeds trust limit of ${trust.maximumMemoryBytes} bytes`,
    }
  }

  return { satisfied: true, reason: null }
}

/**
 * Check whether a trust scope has expired (its `expiresAt` is in
 * the past relative to the current wall clock).
 */
export function isTrustExpired(trust: PrismLanProviderTrust): boolean {
  return new Date(trust.expiresAt).getTime() <= Date.now()
}

/**
 * Check whether a trust scope has been explicitly revoked.
 */
export function isTrustRevoked(trust: PrismLanProviderTrust): boolean {
  return trust.revokedAt !== null
}

/**
 * Revoke a trust scope, setting its `revokedAt` timestamp and a
 * digest of the revocation reason.
 *
 * Returns a _new_ trust object representing the revoked state.
 * The original is not mutated.
 */
export function revokeTrust(trust: PrismLanProviderTrust, reason: string): PrismLanProviderTrust {
  if (!reason) throw new TrustError("revocation reason is required")
  if (trust.revokedAt !== null) throw new TrustError("trust is already revoked")

  return {
    ...trust,
    revokedAt: nowISO(),
    reasonDigest: hashDigest(reason),
  }
}
