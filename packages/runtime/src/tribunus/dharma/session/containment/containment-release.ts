/**
 * Dharma OS-Enforced Sandbox — Release Packaging Evidence
 *
 * Types and helpers for validating that a release artifact meets the
 * containment packaging requirements for the target platform. The
 * evidence aggregates signing, notarization, sandbox profile, and
 * entitlement checks alongside a digest of the full containment report.
 */

import type {
  ContainmentPlatform,
  ContainmentPackagingMode,
} from "./containment-report"

// ── Release Packaging Evidence ------------------------------------------------

export interface ReleasePackagingEvidence {
  platform: ContainmentPlatform
  packagingMode: ContainmentPackagingMode
  binarySigned: boolean
  notarized: boolean
  sandboxProfileCompiled: boolean
  entitlementsValidated: boolean
  containmentReportDigest: string
}

// ── Builder -------------------------------------------------------------------

/**
 * Create a new release packaging evidence record for the given platform
 * and packaging mode. All check fields default to false; the
 * containmentReportDigest is initialised to an empty string.
 */
export function createReleaseEvidence(
  platform: ContainmentPlatform,
  mode: ContainmentPackagingMode,
): ReleasePackagingEvidence {
  return {
    platform,
    packagingMode: mode,
    binarySigned: false,
    notarized: false,
    sandboxProfileCompiled: false,
    entitlementsValidated: false,
    containmentReportDigest: "",
  }
}

// ── Readiness Gate ------------------------------------------------------------

/**
 * Returns true when all release gates are satisfied:
 * binary signed, notarised (applicable), sandbox profile compiled,
 * entitlements validated, and the containment report digest is non-empty.
 *
 * On macOS, notarization is required for hardened_runtime and
 * signed_app_bundle modes. On Linux packaging modes like AppImage,
 * notarization is not applicable; the gate considers the check
 * satisfied when the field is false but the mode does not require it.
 */
export function isReleaseReady(evidence: ReleasePackagingEvidence): boolean {
  const notarizationRequired =
    evidence.platform === "macos" &&
    (evidence.packagingMode === "hardened_runtime" ||
      evidence.packagingMode === "signed_app_bundle")

  const notarizationOk = notarizationRequired
    ? evidence.notarized
    : true

  return (
    evidence.binarySigned &&
    notarizationOk &&
    evidence.sandboxProfileCompiled &&
    evidence.entitlementsValidated &&
    evidence.containmentReportDigest.length > 0
  )
}
