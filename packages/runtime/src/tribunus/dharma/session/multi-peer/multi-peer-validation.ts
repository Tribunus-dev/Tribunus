/**
 * Dharma Multi-Peer Result Convergence — Result Bundle Validation Pipeline
 */

import type {
  AcceptancePolicyLevel,
  DharmaTaskContract,
  ResultValidationState,
  SessionResultBundle,
} from "./multi-peer-types"

// ── validateResultBundle ──────────────────────────────────────────────────────
// Entry-point validation pipeline.  Returns a state and a human-readable
// reason string when validation fails.

export function validateResultBundle(
  result: SessionResultBundle,
  task: DharmaTaskContract,
): { state: ResultValidationState; reason: string | null } {
  // 1. Source basis must match the task's declared basis.
  if (!checkSourceBasis(result, task)) {
    return {
      state: "conflicted",
      reason: "Source basis digest does not match task requirement",
    }
  }

  // 2. Validate path scopes if the task defines constraints.
  if (task.allowedPathScopes.length > 0 || task.deniedPathScopes.length > 0) {
    const violations = checkPathScope(
      result.changedPathDigests,
      task.allowedPathScopes,
      task.deniedPathScopes,
    )
    if (violations.length > 0) {
      return {
        state: "rejected",
        reason: `Changed paths violate scope constraints: ${violations.join(", ")}`,
      }
    }
  }

  // 3. Verification policy compliance.
  if (!checkVerificationPolicy(result.verificationSummary, task.acceptancePolicy)) {
    return {
      state: "pending_verification",
      reason: "Verification summary does not meet required acceptance policy level",
    }
  }

  return { state: "verified", reason: null }
}

// ── checkSourceBasis ──────────────────────────────────────────────────────────

export function checkSourceBasis(
  result: SessionResultBundle,
  task: DharmaTaskContract,
): boolean {
  return result.sourceBasisDigest === task.sourceBasisDigest
}

// ── checkPathScope ────────────────────────────────────────────────────────────
// Returns the subset of `changedPaths` that violate the scope constraints.

/**
 * Check whether changed paths fall within allowed scopes and outside denied
 * scopes.  Each path must match at least one allowed scope prefix AND must
 * not match any denied scope prefix.
 *
 * A path matches a scope when it starts with the scope prefix.
 *
 * @returns The list of paths that violate scope constraints (empty = valid).
 */
export function checkPathScope(
  changedPaths: string[],
  allowedScopes: string[],
  deniedScopes: string[],
): string[] {
  if (allowedScopes.length === 0 && deniedScopes.length === 0) {
    return []
  }

  return changedPaths.filter((path) => {
    // If allowed scopes are defined, the path must match at least one.
    if (allowedScopes.length > 0) {
      const allowed = allowedScopes.some((scope) => path.startsWith(scope))
      if (!allowed) return true
    }

    // The path must not match any denied scope.
    if (deniedScopes.length > 0) {
      const denied = deniedScopes.some((scope) => path.startsWith(scope))
      if (denied) return true
    }

    return false
  })
}

// ── checkContainmentProfile ───────────────────────────────────────────────────

/**
 * Check whether the containment profile digest covers every required
 * capability.
 */
export function checkContainmentProfile(
  profileDigest: string,
  required: string[],
): boolean {
  if (required.length === 0) return true
  if (!profileDigest) return false

  // The profile digest is compared against a locked-in hash computed from
  // the required capabilities list.  This is a simplified check: when
  // the required set is non-empty, the digest must be non-empty.
  // A concrete implementation would verify the digest against a known
  // manifest stored by the containment manager.
  return profileDigest.length > 0
}

// ── checkVerificationPolicy ───────────────────────────────────────────────────

/**
 * Check whether the verification summary satisfies the required acceptance
 * policy level.
 *
 * AcceptancePolicyLevel ordering (increasing strictness):
 *   attested < reviewed < reproduced < corroborated
 *
 * The summary must indicate at least the required level.
 */
export function checkVerificationPolicy(
  verificationSummary: string,
  requiredLevel: AcceptancePolicyLevel,
): boolean {
  if (!verificationSummary) return false

  const levelOrder: Record<AcceptancePolicyLevel, number> = {
    attested: 0,
    reviewed: 1,
    reproduced: 2,
    corroborated: 3,
  }

  // Parse the strongest level claimed by the verification summary.
  // The summary is expected to contain level keywords such as "attested",
  // "reviewed", "reproduced", or "corroborated".
  const claimedLevel = parseVerificationLevel(verificationSummary)
  if (claimedLevel === null) return false

  return levelOrder[claimedLevel] >= levelOrder[requiredLevel]
}

function parseVerificationLevel(
  summary: string,
): AcceptancePolicyLevel | null {
  const levels: AcceptancePolicyLevel[] = [
    "corroborated",
    "reproduced",
    "reviewed",
    "attested",
  ]

  // Match strongest level first (corroborated > reproduced > reviewed > attested)
  for (const level of levels) {
    if (summary.includes(level)) return level
  }

  return null
}
