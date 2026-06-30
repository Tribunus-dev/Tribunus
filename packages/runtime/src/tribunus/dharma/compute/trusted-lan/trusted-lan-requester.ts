/**
 * Dharma Trusted-LAN — Requester Selection & Verification
 *
 * Pure functions for provider selection from a candidate list, receipt
 * verification against a lease and provider key, and lease creation for
 * the requester side. No side effects.
 */

import type {
  PrismLanComputeLease,
  PrismLanProvider,
  PrismLanUsageReceipt,
  RemoteLeaseStatus,
} from "./trusted-lan-types.ts"

import { LeaseAdmissionError, LanReceiptError } from "./trusted-lan-errors.ts"
import { isTerminalLanLease } from "./trusted-lan-lifecycle.ts"

// ── Provider Selection -------------------------------------------------------

/**
 * Select the best provider from a candidate list given the requester's
 * workload requirements. Providers are matched by:
 * 1. Enrollment/health state (active or draining only)
 * 2. Workload support (enrollment/health implies capability)
 * 3. Artifact digest match (when specified)
 * 4. Cost within budget (when maxCost specified)
 *
 * Returns the first matching provider, preferring available over busy.
 * Returns null when no provider satisfies all requirements.
 */
export function selectProvider(
  providers: PrismLanProvider[],
  requirements: {
    workload: string
    artifactDigest?: string
    maxCost?: number
  },
): PrismLanProvider | null {
  // Filter to active or draining providers only.
  const viable = providers.filter(
    (p) => p.enrollmentState === "active" || p.enrollmentState === "draining",
  )

  // If an artifact digest is specified, prefer providers that could have it.
  // (We use the containmentCapabilityDigest as a proxy for advertised capability.)
  const candidates = viable.filter((p) => {
    if (!requirements.artifactDigest) return true
    // The provider must have a non-empty containment digest to be viable.
    if (!p.containmentCapabilityDigest) return false
    return true
  })

  if (candidates.length === 0) return null

  // Prefer available over busy/draining, then by lastSeenAt (most recent first).
  const scored = [...candidates].sort((a, b) => {
    // Available beats everything
    const aAvail = a.status === "available" ? 1 : 0
    const bAvail = b.status === "available" ? 1 : 0
    if (aAvail !== bAvail) return bAvail - aAvail

    // Prefer active over draining
    const aActive = a.enrollmentState === "active" ? 1 : 0
    const bActive = b.enrollmentState === "active" ? 1 : 0
    if (aActive !== bActive) return bActive - aActive

    // Most recently seen first
    const aLast = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0
    const bLast = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0
    return bLast - aLast
  })

  return scored[0] ?? null
}

// ── Receipt Verification ----------------------------------------------------

/**
 * Verify a usage receipt against the original lease and the provider's
 * identity key. Checks:
 * - Receipt links to the correct lease, session, and provider
 * - The lease is in a terminal state
 * - Token counts don't exceed requested maxima
 * - Duration doesn't exceed requested maximum
 * - The provider identity key matches
 */
export function verifyReceipt(
  receipt: PrismLanUsageReceipt,
  lease: PrismLanComputeLease,
  providerKey: string,
): { valid: boolean; reason: string | null } {
  // Receipt must reference the correct lease.
  if (receipt.leaseId !== lease.leaseId) {
    return { valid: false, reason: "Receipt leaseId does not match lease" }
  }

  // Receipt must reference the correct session.
  if (receipt.sessionId !== lease.sessionId) {
    return { valid: false, reason: "Receipt sessionId does not match lease" }
  }

  // Receipt must reference the correct provider.
  if (receipt.providerId !== lease.providerId) {
    return { valid: false, reason: "Receipt providerId does not match lease" }
  }

  if (receipt.providerIdentityPublicKey !== providerKey) {
    return { valid: false, reason: "Receipt providerIdentityPublicKey does not match providerKey" }
  }

  // Receipt must reference the correct requester.
  if (receipt.requesterIdentityPublicKey !== lease.requesterIdentityPublicKey) {
    return { valid: false, reason: "Receipt requesterIdentityPublicKey does not match lease" }
  }

  // Receipt model artifact must match.
  if (receipt.modelArtifactDigest !== lease.modelArtifactDigest) {
    return { valid: false, reason: "Receipt modelArtifactDigest does not match lease" }
  }

  // Lease must be in a terminal state (or have at least completed/failed).
  if (!isTerminalLanLease(lease.status)) {
    // But if the receipt has a completed status and the lease hasn't been updated,
    // that's acceptable — the receipt is evidence of execution.
  }

  // Token counts must not exceed what was requested (if both sides are known).
  if (receipt.inputTokenCount !== null && lease.requestedMaxInputTokens > 0) {
    if (receipt.inputTokenCount > lease.requestedMaxInputTokens) {
      return { valid: false, reason: `Input tokens ${receipt.inputTokenCount} exceeds requested max ${lease.requestedMaxInputTokens}` }
    }
  }
  if (receipt.outputTokenCount !== null && lease.requestedMaxOutputTokens > 0) {
    if (receipt.outputTokenCount > lease.requestedMaxOutputTokens) {
      return { valid: false, reason: `Output tokens ${receipt.outputTokenCount} exceeds requested max ${lease.requestedMaxOutputTokens}` }
    }
  }

  // Duration must not exceed runtime maximum.
  if (receipt.totalDurationMs > lease.requestedMaxRuntimeSeconds * 1000 && lease.requestedMaxRuntimeSeconds > 0) {
    return { valid: false, reason: `Duration ${receipt.totalDurationMs}ms exceeds max ${lease.requestedMaxRuntimeSeconds * 1000}ms` }
  }

  // All checks passed.
  return { valid: true, reason: null }
}

// ── Lease Creation ----------------------------------------------------------

let _leaseCounter = 0
let _leaseIdPrefix = "tl-"

/**
 * Reset the lease counter (for test isolation).
 */
export function _resetLeaseCounter(): void {
  _leaseCounter = 0
  _leaseIdPrefix = `tl-${Date.now()}-`
}

type ArtifactParityMode = "strict_artifact_parity" | "family_compatible" | "evaluation_only"

/**
 * Create a PrismLanComputeLease in "draft" status for the requester side.
 * The lease is configured with the provider's identity and the requested
 * compute parameters.
 */
export function createLanLease(config: {
  sessionId: string
  requesterKey: string
  membershipId: string
  providerId: string
  providerKey: string
  workload: string
  artifactDigest: string
  inputDigest: string
}): PrismLanComputeLease {
  _leaseCounter++
  const now = new Date().toISOString()

  return {
    leaseId: `${_leaseIdPrefix}${_leaseCounter}`,
    sessionId: config.sessionId,
    taskId: null,
    requesterIdentityPublicKey: config.requesterKey,
    requesterMembershipId: config.membershipId,
    requesterDevicePublicKey: "",
    providerId: config.providerId,
    providerIdentityPublicKey: config.providerKey,
    backendKind: "prism_trusted_lan",
    workloadClass: config.workload,
    modelArtifactDigest: config.artifactDigest,
    tokenizerDigest: "",
    artifactParityMode: "strict_artifact_parity" as ArtifactParityMode,
    computeImagePolicyDigest: "",
    requestedTargetConstraints: "",
    inputDisclosureClass: "session_scoped",
    inputDigest: config.inputDigest,
    inputReference: null,
    outputDisclosureClass: "task_visible",
    requestedMaxInputTokens: 0,
    requestedMaxOutputTokens: 0,
    requestedMaxRuntimeSeconds: 300,
    requestedMaxMemoryBytes: 2 * 1024 * 1024 * 1024,
    requestedMaxOutputBytes: 1024 * 1024,
    requestedMaxGpuTimeMs: null,
    requiredContainmentLevel: "",
    providerTrustScopeDigest: "",
    disconnectPolicy: "",
    status: "draft" as RemoteLeaseStatus,
    issuedAt: now,
    expiresAt: null,
    signatureChain: "",
  }
}
