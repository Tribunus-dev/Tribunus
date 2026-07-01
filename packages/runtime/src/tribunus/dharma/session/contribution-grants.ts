/**
 * Track E — Contribution Accounting: Grant Profiles
 *
 * Links contribution records to grant profiles.  Defines what grant profile
 * a contributor earns based on their contributions.
 */

import type { DharmaContributionRecord, ContributionClass } from "../contribution/contribution-types"
import type { GrantProfile } from "./types"

// ── Contribution Thresholds -------------------------------------------------

/**
 * Minimum contributions needed per profile.
 *
 * A contributor earns a profile when they meet both the minimum contribution
 * count AND have at least one accepted contribution in each required class.
 */
export const CONTRIBUTION_THRESHOLDS: Record<GrantProfile, { minContributions: number; requiredClasses: ContributionClass[] }> = {
  observer: { minContributions: 0, requiredClasses: [] },
  reviewer: { minContributions: 3, requiredClasses: ["review_evidence"] },
  contributor: { minContributions: 5, requiredClasses: ["work_product"] },
  test_runner: { minContributions: 3, requiredClasses: ["reproduction_evidence"] },
  maintainer: { minContributions: 10, requiredClasses: ["work_product", "review_evidence"] },
  session_coowner: { minContributions: 20, requiredClasses: ["work_product", "review_evidence", "session_stewardship"] },
}

// ── Earned Profile ----------------------------------------------------------

/**
 * Determine the highest grant profile a contributor has earned.
 *
 * Iterates profiles from highest to lowest and returns the first one
 * whose thresholds (minimum contributions + required classes) are met.
 * Falls back to "observer" when no profile is earned.
 */
export function getEarnedProfile(records: DharmaContributionRecord[]): GrantProfile {
  const acceptedRecords = records.filter(r => r.acceptedAt !== null)
  const byClass: Record<string, number> = {}
  for (const r of acceptedRecords) {
    byClass[r.contributionClass] = (byClass[r.contributionClass] || 0) + 1
  }
  const total = acceptedRecords.length

  // Check from highest to lowest
  const profiles = Object.entries(CONTRIBUTION_THRESHOLDS).reverse() as [GrantProfile, typeof CONTRIBUTION_THRESHOLDS[GrantProfile]][]
  for (const [profile, threshold] of profiles) {
    if (total >= threshold.minContributions &&
        threshold.requiredClasses.every(c => (byClass[c] || 0) > 0)) {
      return profile
    }
  }
  return "observer"
}

// ── Helper ------------------------------------------------------------------

/**
 * Get the minimum contribution count required for a profile.
 */
export function getRequiredContributionsForProfile(profile: GrantProfile): number {
  return CONTRIBUTION_THRESHOLDS[profile].minContributions
}
