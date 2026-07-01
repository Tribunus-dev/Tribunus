/**
 * Track E — Contribution Accounting: Types
 *
 * Pure types for contribution records, independent of the receipt-based
 * ContributionReceipt system.  These capture higher-level contribution
 * accounting — evidence quality, codex eligibility, visibility scoping —
 * that the receipt layer does not cover.
 */

export type ContributionClass =
  | "work_product"
  | "review_evidence"
  | "reproduction_evidence"
  | "compute_lease"
  | "artifact_contribution"
  | "documentation_contribution"
  | "moderation_action"
  | "research_evidence"
  | "session_stewardship"

export interface DharmaContributionRecord {
  /** Unique identifier for this contribution */
  contributionId: string
  /** Session in which the contribution was made */
  sessionId: string
  /** Identity digest of the contributor */
  contributorIdentityDigest: string
  /** Primary class/category of this contribution */
  contributionClass: ContributionClass
  /** Human-readable free-text description */
  description: string
  /** Digests of supporting evidence receipts */
  receiptDigests: string[]
  /** Identity digest of the acceptor, or null if not yet accepted */
  acceptedBy: string | null
  /** ISO-8601 timestamp of acceptance, or null */
  acceptedAt: string | null
  /** Subjective evidence quality rating */
  evidenceQuality: "high" | "medium" | "low"
  /** Optional resource cost breakdown */
  resourceCostSummary: {
    computeMs?: number
    tokenCount?: number
    storageBytes?: number
  } | null
  /** Related outcome / artifact / work-offer identifier */
  outcomeRelation: string
  /** Whether this contribution is eligible for the Codex reward program */
  codexEligibility: boolean
  /** Who is allowed to see this record */
  visibilityClass: "session" | "contributor" | "public"
  /** ISO-8601 timestamp of creation */
  createdAt: string
}
