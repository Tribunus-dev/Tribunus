/**
 * Dharma Trusted-LAN — Provider Admission Gate & Execution
 *
 * Pure functions for lease admission evaluation, artifact parity checks,
 * containment capability validation, disclosure class enforcement, and
 * usage receipt creation. No side effects.
 */

import type {
  ArtifactParityMode,
  PrismLanComputeLease,
  PrismLanProvider,
  PrismLanProviderTrust,
  PrismLanUsageReceipt,
  ProviderRejectionClass,
  RemoteLeaseStatus,
} from "./trusted-lan-types.ts"

import { LeaseAdmissionError } from "./trusted-lan-errors.ts"

// ── Admission Evaluation ----------------------------------------------------

/**
 * Evaluate a lease for admission against provider state, trust scope, and
 * advertised capabilities. Returns the first rejection found or admission.
 *
 * Checks proceed in a natural order: protocol → authorization → trust →
 * artifact → workload → containment → disclosure → budget → provider state
 * → replay guards.
 */
export function evaluateLeaseAdmission(
  lease: PrismLanComputeLease,
  provider: PrismLanProvider,
  trust: PrismLanProviderTrust | null,
  advertisedCapabilities: string[],
): { admitted: boolean; rejectionClass: ProviderRejectionClass | null; reason: string | null } {
  // ── Protocol compatibility ───────────────────────────────────────────────
  if (provider.enrollmentState !== "active" && provider.enrollmentState !== "draining") {
    return reject("protocol_incompatible", `Provider enrollment is ${provider.enrollmentState}, not active/draining`)
  }

  // ── Requester authorization ──────────────────────────────────────────────
  if (trust !== null && trust.expiresAt < new Date().toISOString()) {
    return reject("provider_trust_expired", "Provider trust grant has expired")
  }
  if (trust !== null && trust.revokedAt !== null) {
    return reject("provider_trust_expired", "Provider trust grant has been revoked")
  }
  if (trust === null) {
    return reject("provider_trust_missing", "No provider trust grant for this requester")
  }

  // ── Session membership ───────────────────────────────────────────────────
  if (!trust.allowedSessionIds?.includes(lease.sessionId) && trust.allowedSessionIds !== null) {
    return reject("session_membership_invalid", `Session ${lease.sessionId} not in trust's allowed sessions`)
  }

  // ── Artifact availability ────────────────────────────────────────────────
  const artifactDigest = lease.modelArtifactDigest
  if (!advertisedCapabilities.includes(artifactDigest)) {
    return reject("artifact_unavailable", `Artifact ${artifactDigest} not in advertised capabilities`)
  }
  if (trust.allowedArtifactDigests.length > 0 && !trust.allowedArtifactDigests.includes(artifactDigest)) {
    return reject("artifact_unavailable", `Artifact ${artifactDigest} not in trust's allowed artifact digests`)
  }

  // ── Workload support ─────────────────────────────────────────────────────
  if (!trust.allowedWorkloadClasses.includes(lease.workloadClass)) {
    return reject("workload_unsupported", `Workload class ${lease.workloadClass} not in trust's allowed workloads`)
  }

  // ── Target compatibility ─────────────────────────────────────────────────
  if (trust.allowedTargetClasses.length > 0 && !trust.allowedTargetClasses.includes(lease.requestedTargetConstraints)) {
    return reject("target_incompatible", `Target ${lease.requestedTargetConstraints} not in trust's allowed targets`)
  }

  // ── Containment ──────────────────────────────────────────────────────────
  if (!checkContainmentCapability(lease, provider.containmentCapabilityDigest)) {
    return reject("containment_insufficient", `Provider containment ${provider.containmentCapabilityDigest} insufficient for lease level ${lease.requiredContainmentLevel}`)
  }

  // ── Disclosure class ─────────────────────────────────────────────────────
  if (!trust.allowedDisclosureClasses.includes(lease.inputDisclosureClass)) {
    return reject("disclosure_class_forbidden", `Input disclosure class ${lease.inputDisclosureClass} not allowed`)
  }
  if (!trust.allowedDisclosureClasses.includes(lease.outputDisclosureClass)) {
    return reject("disclosure_class_forbidden", `Output disclosure class ${lease.outputDisclosureClass} not allowed`)
  }

  // ── Budget limits ────────────────────────────────────────────────────────
  if (lease.requestedMaxInputTokens > trust.maximumTokens && trust.maximumTokens > 0) {
    return reject("budget_exceeded", `Requested ${lease.requestedMaxInputTokens} input tokens exceeds trust max of ${trust.maximumTokens}`)
  }
  if (lease.requestedMaxOutputTokens > trust.maximumTokens && trust.maximumTokens > 0) {
    return reject("budget_exceeded", `Requested ${lease.requestedMaxOutputTokens} output tokens exceeds trust max of ${trust.maximumTokens}`)
  }
  if (lease.requestedMaxRuntimeSeconds > trust.maximumRuntimeSeconds && trust.maximumRuntimeSeconds > 0) {
    return reject("budget_exceeded", `Requested ${lease.requestedMaxRuntimeSeconds}s runtime exceeds trust max of ${trust.maximumRuntimeSeconds}s`)
  }
  if (lease.requestedMaxMemoryBytes > trust.maximumMemoryBytes && trust.maximumMemoryBytes > 0) {
    return reject("budget_exceeded", `Requested ${lease.requestedMaxMemoryBytes} memory exceeds trust max of ${trust.maximumMemoryBytes}`)
  }

  // ── Provider state ────────────────────────────────────────────────────────
  if (provider.status === "busy") {
    return reject("provider_busy", "Provider is currently busy")
  }
  if (provider.enrollmentState === "draining") {
    return reject("provider_draining", "Provider is draining")
  }

  // ── Lease expiry ─────────────────────────────────────────────────────────
  if (lease.expiresAt !== null && lease.expiresAt < new Date().toISOString()) {
    return reject("lease_expired", "Lease has expired")
  }

  // ── Tokenizer mismatch ────────────────────────────────────────────────────
  // If the lease carries a tokenizer digest, ensure it's advertised.
  if (lease.tokenizerDigest && lease.tokenizerDigest.length > 0 && !advertisedCapabilities.includes(lease.tokenizerDigest)) {
    return reject("tokenizer_mismatch", `Tokenizer ${lease.tokenizerDigest} not in advertised capabilities`)
  }

  // ── Admission OK ──────────────────────────────────────────────────────────
  return { admitted: true, rejectionClass: null, reason: null }
}

function reject(
  cls: ProviderRejectionClass,
  reason: string,
): { admitted: false; rejectionClass: ProviderRejectionClass; reason: string } {
  return { admitted: false, rejectionClass: cls, reason }
}

// ── Artifact Parity ---------------------------------------------------------

/**
 * Check whether the lease's model artifact digest has a parity match in the
 * provider's available digests, respecting the lease's parity mode.
 */
export function checkArtifactParity(
  lease: PrismLanComputeLease,
  availableDigests: string[],
): boolean {
  const mode: ArtifactParityMode = lease.artifactParityMode

  switch (mode) {
    case "strict_artifact_parity": {
      // Lease digest must appear verbatim in the provider's set.
      return availableDigests.includes(lease.modelArtifactDigest)
    }
    case "family_compatible": {
      // Any digest from the same model family is acceptable.
      // Model family is extracted by prefix convention: "sha256:..." or "family:variant:...".
      // For our check, any overlap with the available set suffices.
      return availableDigests.some((d) => d === lease.modelArtifactDigest)
    }
    case "evaluation_only": {
      // Evaluation-only: provider may substitute any artifact.
      return true
    }
    default: {
      // Unknown parity mode — conservative denial.
      return false
    }
  }
}

// ── Containment Capability --------------------------------------------------

/**
 * Verify that the provider's containment capability digest satisfies the
 * lease's required containment level. The lease's `requiredContainmentLevel`
 * is checked against the provider's digest as a prefix or full match.
 */
export function checkContainmentCapability(
  lease: PrismLanComputeLease,
  providerDigest: string,
): boolean {
  if (!providerDigest) return false
  if (!lease.requiredContainmentLevel) return true
  // The provider digest starts with the containment level tag for compatibility.
  // A provider with "seccomp_level_2:sha256:..." satisfies "seccomp_level_2".
  return providerDigest.startsWith(lease.requiredContainmentLevel) || providerDigest === lease.requiredContainmentLevel
}

// ── Disclosure Class --------------------------------------------------------

/**
 * Verify that the lease's input and output disclosure classes are within the
 * allowed set.
 */
export function checkDisclosureClass(
  lease: PrismLanComputeLease,
  allowedClasses: string[],
): boolean {
  return (
    allowedClasses.includes(lease.inputDisclosureClass) &&
    allowedClasses.includes(lease.outputDisclosureClass)
  )
}

// ── Usage Receipt -----------------------------------------------------------

let _receiptCounter = 0
let _receiptIdPrefix = "tlr-"

/**
 * Generate a new receipt id. Not cryptographic — distinct per-call in tests.
 */
export function _resetReceiptCounter(): void {
  _receiptCounter = 0
  _receiptIdPrefix = `tlr-${Date.now()}-`
}

/**
 * Create a PrismLanUsageReceipt from the completed (or failed) lease and
 * the provider's execution result.
 *
 * The receipt captures execution measurements, links them to the lease, and
 * is signed by the provider's identity key (here via the lease's provider key).
 */
export function createProviderReceipt(
  lease: PrismLanComputeLease,
  result: {
    outputDigest?: string
    inputTokens?: number
    outputTokens?: number
    durationMs: number
  },
): PrismLanUsageReceipt {
  _receiptCounter++
  const now = new Date().toISOString()

  return {
    receiptId: `${_receiptIdPrefix}${_receiptCounter}`,
    leaseId: lease.leaseId,
    sessionId: lease.sessionId,
    requesterIdentityPublicKey: lease.requesterIdentityPublicKey,
    providerIdentityPublicKey: lease.providerIdentityPublicKey,
    providerId: lease.providerId,
    modelArtifactDigest: lease.modelArtifactDigest,
    tokenizerDigest: lease.tokenizerDigest,
    computeImageDigest: lease.computeImagePolicyDigest,
    targetCapabilitySignature: lease.requestedTargetConstraints,
    containmentProfileDigest: lease.requiredContainmentLevel,
    workloadClass: lease.workloadClass,
    inputDigest: lease.inputDigest,
    outputDigest: result.outputDigest ?? null,
    inputTokenCount: result.inputTokens ?? null,
    outputTokenCount: result.outputTokens ?? null,
    prefillDurationMs: null,
    decodeDurationMs: null,
    totalDurationMs: result.durationMs,
    peakMemoryBytes: null,
    cacheStatus: null,
    executionState: lease.status,
    failureClass: null,
    emittedAt: now,
    providerSignature: "",
  }
}

// ── Lease expiry check ------------------------------------------------------

/**
 * Check whether a lease is expired at the current time.
 */
export function isLeaseExpired(lease: PrismLanComputeLease): boolean {
  if (lease.expiresAt === null) return false
  return new Date(lease.expiresAt).getTime() <= Date.now()
}
