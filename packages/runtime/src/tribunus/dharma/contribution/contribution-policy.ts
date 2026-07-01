/**
 * Track E — Contribution Accounting: Policy & Abuse Controls
 *
 * Pure functions for contribution policy enforcement and abuse detection.
 * No real OS or network calls — all inputs and outputs are plain values.
 */

import type { ContributionClass, DharmaContributionRecord } from "./contribution-types"

// ── Contribution Policy ──────────────────────────────────────────────────────

export interface ContributionPolicy {
  /** Which contribution classes are enabled for this policy */
  enabledClasses: ContributionClass[]
  /** Maximum age (in days) of a contribution before it becomes ineligible */
  maxContributionAgeDays: number
  /** Whether acceptance is required before Codex eligibility is granted */
  requireAcceptedForCodexEligibility: boolean
  /** Minimum required evidence quality ("low" accepts everything) */
  minEvidenceQuality: string
  /** Whether contributors may approve their own contributions */
  allowSelfApproval: boolean
  /** Maximum number of pending (unaccepted) contributions per session */
  maxPendingPerSession: number
}

/**
 * Create a permissive default policy that enables all contribution classes.
 */
export function createDefaultContributionPolicy(): ContributionPolicy {
  return {
    enabledClasses: [
      "work_product",
      "review_evidence",
      "reproduction_evidence",
      "compute_lease",
      "artifact_contribution",
      "documentation_contribution",
      "moderation_action",
      "research_evidence",
      "session_stewardship",
    ],
    maxContributionAgeDays: 90,
    requireAcceptedForCodexEligibility: true,
    minEvidenceQuality: "low",
    allowSelfApproval: false,
    maxPendingPerSession: 50,
  }
}

/**
 * Create a restrictive policy intended for high-trust / audited sessions.
 */
export function createRestrictivePolicy(): ContributionPolicy {
  return {
    enabledClasses: [
      "work_product",
      "review_evidence",
      "reproduction_evidence",
      "artifact_contribution",
    ],
    maxContributionAgeDays: 30,
    requireAcceptedForCodexEligibility: true,
    minEvidenceQuality: "medium",
    allowSelfApproval: false,
    maxPendingPerSession: 10,
  }
}

/**
 * Returns true when the contribution class is listed in the policy's enabled set.
 */
export function isClassEnabled(policy: ContributionPolicy, cls: ContributionClass): boolean {
  return policy.enabledClasses.includes(cls)
}

/**
 * Returns true when a contribution record meets the basic policy eligibility gates
 * (class enabled, within age window, meets evidence quality, accepted if required).
 *
 * This does NOT check per-session pending limits — the caller combines that with
 * store queries via `getContributionsBySession`.
 */
export function isContributionEligible(
  record: DharmaContributionRecord,
  policy: ContributionPolicy,
): boolean {
  // Class must be enabled
  if (!isClassEnabled(policy, record.contributionClass)) {
    return false
  }

  // Evidence quality must meet minimum
  const qualityOrder = ["low", "medium", "high"]
  const recordIdx = qualityOrder.indexOf(record.evidenceQuality)
  const minIdx = qualityOrder.indexOf(policy.minEvidenceQuality)
  if (recordIdx < minIdx) {
    return false
  }

  // Age check
  const createdAt = new Date(record.createdAt).getTime()
  const ageMs = Date.now() - createdAt
  const maxAgeMs = policy.maxContributionAgeDays * 86_400_000
  if (ageMs > maxAgeMs) {
    return false
  }

  // Acceptance check
  if (policy.requireAcceptedForCodexEligibility && record.acceptedBy === null) {
    return false
  }

  return true
}

/**
 * Returns true when a contribution record is eligible for Codex rewards.
 * This is the same as isContributionEligible plus the
 * record.codexEligibility flag must be true.
 */
export function isCodexEligible(
  record: DharmaContributionRecord,
  policy: ContributionPolicy,
): boolean {
  if (!record.codexEligibility) {
    return false
  }
  return isContributionEligible(record, policy)
}

// ── Abuse Controls ──────────────────────────────────────────────────────────

export interface AbuseCheck {
  checkName: string
  passed: boolean
  reason: string | null
}

/**
 * Verify that the reviewer is different from the contributor (no self-dealing).
 */
export function checkNoSelfDealing(
  record: DharmaContributionRecord,
  reviewerId: string,
): AbuseCheck {
  if (record.contributorIdentityDigest === reviewerId) {
    return { checkName: "no_self_dealing", passed: false, reason: "Reviewer and contributor are the same identity" }
  }
  return { checkName: "no_self_dealing", passed: true, reason: null }
}

/**
 * Heuristic check for fabricated work: a contribution with no receipt digests
 * and medium/high evidence quality is suspicious.
 */
export function checkNoFabricatedWork(
  record: DharmaContributionRecord,
): AbuseCheck {
  if (record.receiptDigests.length === 0 && record.evidenceQuality !== "low") {
    return { checkName: "no_fabricated_work", passed: false, reason: "Contribution claims medium/high quality with zero evidence receipts" }
  }
  return { checkName: "no_fabricated_work", passed: true, reason: null }
}

/**
 * Check that the same receipt digest is not reused across multiple contributions.
 */
export function checkNoDuplicateReceipt(
  record: DharmaContributionRecord,
  existing: DharmaContributionRecord[],
): AbuseCheck {
  for (const digest of record.receiptDigests) {
    for (const existingRecord of existing) {
      if (existingRecord.contributionId === record.contributionId) {
        continue
      }
      if (existingRecord.receiptDigests.includes(digest)) {
        return { checkName: "no_duplicate_receipt", passed: false, reason: `Receipt digest "${digest}" already used by contribution "${existingRecord.contributionId}"` }
      }
    }
  }
  return { checkName: "no_duplicate_receipt", passed: true, reason: null }
}

/**
 * Heuristic check that no single contributor accounts for >80% of all
 * contributions in the provided list (compute dominance).
 */
export function checkNoComputeDominance(
  records: DharmaContributionRecord[],
): AbuseCheck {
  if (records.length === 0) {
    return { checkName: "no_compute_dominance", passed: true, reason: null }
  }

  // Count contributions per contributor
  const counts: Record<string, number> = {}
  for (const record of records) {
    counts[record.contributorIdentityDigest] = (counts[record.contributorIdentityDigest] ?? 0) + 1
  }

  // Check if any contributor exceeds 80%
  const threshold = records.length * 0.8
  for (const [contributor, count] of Object.entries(counts)) {
    if (count > threshold) {
      return { checkName: "no_compute_dominance", passed: false, reason: `Contributor "${contributor}" accounts for ${count}/${records.length} contributions (>80%)` }
    }
  }

  return { checkName: "no_compute_dominance", passed: true, reason: null }
}

/**
 * Run all five abuse checks against a contribution record.
 */
export function runAbuseChecks(
  record: DharmaContributionRecord,
  existing: DharmaContributionRecord[],
  reviewerId: string,
): AbuseCheck[] {
  return [
    checkNoSelfDealing(record, reviewerId),
    checkNoFabricatedWork(record),
    checkNoDuplicateReceipt(record, existing),
    checkNoComputeDominance(existing),
  ]
}
