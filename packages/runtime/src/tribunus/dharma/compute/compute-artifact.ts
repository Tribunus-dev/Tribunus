/**
 * Dharma Local Prism Compute Lease — Artifact Registry
 *
 * Pure functions for artifact admission lifecycle.
 */

import type {
  ArtifactAdmissionState,
  ComputeWorkloadClass,
  PrismArtifactAdmission,
} from "./compute-types.ts"

// ── Transition table ---------------------------------------------------------

const VALID_ARTIFACT_TRANSITIONS: Record<ArtifactAdmissionState, readonly ArtifactAdmissionState[]> = {
  unknown: ["pending_validation"],
  pending_validation: ["admitted", "unavailable"],
  admitted: ["deprecated", "revoked"],
  deprecated: ["revoked"],
  revoked: [],
  unavailable: [],
}

// ── Create Artifact ---------------------------------------------------------

/**
 * Create a new artifact admission record in "pending_validation" state.
 */
export function createArtifact(
  digest: string,
  name: string,
  family: string,
  version: string,
): PrismArtifactAdmission {
  const now = new Date().toISOString()

  return {
    artifactDigest: digest,
    artifactName: name,
    modelFamily: family,
    modelVersion: version,
    tokenizerDigest: "",
    weightFormat: "fp16",
    quantizationScheme: "none",
    supportedWorkloadClasses: [],
    supportedComputeTargets: [],
    requiredMemoryBytes: 0,
    artifactProvenance: "",
    signatureStatus: "unsigned",
    localAvailability: "unknown",
    admissionState: "pending_validation",
    admittedAt: now,
    revokedAt: null,
  }
}

// ── State transitions -------------------------------------------------------

function assertValidArtifactTransition(
  current: ArtifactAdmissionState,
  next: ArtifactAdmissionState,
  actionLabel: string,
): void {
  const allowed = VALID_ARTIFACT_TRANSITIONS[current]
  if (!allowed || !allowed.some((s) => s === next)) {
    throw new Error(
      `Cannot ${actionLabel}: invalid transition from "${current}" to "${next}". ` +
        `Allowed: [${allowed?.join(", ") ?? "none"}]`,
    )
  }
}

/**
 * Admit an artifact (transition from pending_validation to admitted).
 */
export function admitArtifact(artifact: PrismArtifactAdmission): PrismArtifactAdmission {
  assertValidArtifactTransition(artifact.admissionState, "admitted", "admit artifact")
  return { ...artifact, admissionState: "admitted", localAvailability: "staged" }
}

/**
 * Revoke an admitted artifact.
 */
export function revokeArtifact(artifact: PrismArtifactAdmission): PrismArtifactAdmission {
  assertValidArtifactTransition(artifact.admissionState, "revoked", "revoke artifact")
  return { ...artifact, admissionState: "revoked", revokedAt: new Date().toISOString() }
}

// ── Queries -----------------------------------------------------------------

/**
 * Returns true if the artifact is in the "admitted" state.
 */
export function isArtifactAdmitted(artifact: PrismArtifactAdmission): boolean {
  return artifact.admissionState === "admitted"
}

/**
 * Returns true if the artifact supports the given workload class.
 */
export function canArtifactSatisfyWorkload(
  artifact: PrismArtifactAdmission,
  workload: ComputeWorkloadClass,
): boolean {
  return artifact.supportedWorkloadClasses.some((w) => w === workload)
}

/**
 * Returns true if the artifact is available locally (not explicitly unavailable).
 */
export function isArtifactAvailableLocally(artifact: PrismArtifactAdmission): boolean {
  return artifact.localAvailability !== "unavailable"
}
