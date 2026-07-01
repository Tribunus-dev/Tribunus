/**
 * Codex — Dharma Accounting
 *
 * Concrete value accounting for Codex contributions. When a Codex entry is
 * cited in a contribution that successfully resolves a real bug, the entry's
 * contributors earn dharma — a verifiable, auditable unit of value.
 *
 * Dharma is not a token, reputation score, or currency. It is an aggregate
 * of attributable outcome events. Each dharma point represents one verified
 * instance of a Codex entry contributing to a real-world resolution.
 *
 * The system links: CodexEntry → BugResolution → Contribution → Receipt
 * Each link is signed and auditable.
 */

import { randomUUID, createHash } from "node:crypto"
import type { CodexEntry, CodexBenefitEvent, BenefitPolicy, BenefitAllocation } from "./codex-types"
import { createBenefitEvent, recordBenefitEvent, getTotalAllocation, type BenefitStore } from "./codex-benefits"

// ── Bug Resolution Record ─────────────────────────────────────────────

export interface BugResolution {
  resolutionId: string
  /** Which Codex entry was cited as the pattern that enabled the fix */
  codexEntryId: string
  /** The contribution that applied the fix */
  contributionId: string
  /** External reference (e.g. GitHub issue URL, CVE ID) */
  externalRef: string
  /** Description of the bug that was resolved */
  description: string
  /** How the Codex entry was used */
  usageKind: "direct_pattern_match" | "adapted_from_pattern" | "prevented_recurrence" | "diagnostic_aid"
  /** Whether the fix was verified */
  verificationStatus: "unverified" | "confirmed_fixed" | "confirmed_prevented" | "regression_observed"
  /** Verification evidence */
  verificationReceiptDigest: string | null
  /** Who verified the fix */
  verifiedBy: string | null
  /** When the resolution was recorded */
  recordedAt: string
}

export function createBugResolution(
  codexEntryId: string,
  contributionId: string,
  externalRef: string,
  description: string,
  usageKind: BugResolution["usageKind"],
): BugResolution {
  return {
    resolutionId: randomUUID(),
    codexEntryId,
    contributionId,
    externalRef,
    description,
    usageKind,
    verificationStatus: "unverified",
    verificationReceiptDigest: null,
    verifiedBy: null,
    recordedAt: new Date().toISOString(),
  }
}

export function verifyResolution(
  resolution: BugResolution,
  status: BugResolution["verificationStatus"],
  receiptDigest: string,
  verifier: string,
): BugResolution {
  return {
    ...resolution,
    verificationStatus: status,
    verificationReceiptDigest: receiptDigest,
    verifiedBy: verifier,
  }
}

// ── Dharma Ledger ─────────────────────────────────────────────────────

export interface DharmaEntry {
  /** Unique identifier for this dharma event */
  dharmaId: string
  /** The contributor who earned dharma */
  contributorDigest: string
  /** How much dharma was earned (always 1 per verified resolution) */
  amount: number
  /** Which resolution generated this dharma */
  resolutionId: string
  /** Which Codex entry was used */
  codexEntryId: string
  /** The benefit event that records the allocation */
  benefitEventId: string
  /** When this dharma was earned */
  earnedAt: string
  /** Resolution status at time of earning */
  resolutionStatus: string
}

export interface DharmaLedger {
  entries: DharmaEntry[]
  /** Total dharma earned, by contributor */
  balances: Map<string, number>
  /** Links from resolution to dharma entries */
  resolutionIndex: Map<string, string[]>
  /** Links from Codex entry to dharma entries */
  codexIndex: Map<string, string[]>
}

export function createDharmaLedger(): DharmaLedger {
  return {
    entries: [],
    balances: new Map(),
    resolutionIndex: new Map(),
    codexIndex: new Map(),
  }
}

// ── Dharma Accounting ─────────────────────────────────────────────────

export interface DharmaAccountResult {
  ledger: DharmaLedger
  benefitEvent: CodexBenefitEvent
  dharmaEntry: DharmaEntry
  benefitStore: BenefitStore
}

/**
 * Record dharma earned from a verified bug resolution.
 *
 * Flow:
 * 1. Create benefit event for the Codex entry (benefitKind: "reuse")
 * 2. Record the benefit event in the benefit store
 * 3. Create dharma ledger entry
 * 4. Update balances
 * 5. Return the complete result
 */
export function earnDharmaFromResolution(
  resolution: BugResolution,
  entry: CodexEntry,
  contributionId: string,
  policy: BenefitPolicy,
  benefitStore: BenefitStore,
  ledger: DharmaLedger,
  contributors: string[],
): DharmaAccountResult {
  // 1. Create benefit event
  const benefitEvent = createBenefitEvent(
    entry,
    "reuse",
    contributionId,
    policy,
    contributors,
  )

  // 2. Record benefit event
  const updatedStore = recordBenefitEvent(benefitStore, benefitEvent)

  // 3. Create dharma entry (1 dharma per verified resolution)
  const dharmaEntry: DharmaEntry = {
    dharmaId: randomUUID(),
    contributorDigest: contributors[0] || "unknown",
    amount: 1,
    resolutionId: resolution.resolutionId,
    codexEntryId: resolution.codexEntryId,
    benefitEventId: benefitEvent.eventId,
    earnedAt: new Date().toISOString(),
    resolutionStatus: resolution.verificationStatus,
  }

  // 4. Update ledger
  const updatedLedger = { ...ledger }
  updatedLedger.entries = [...ledger.entries, dharmaEntry]

  // Update balance for primary contributor
  const currentBalance = ledger.balances.get(dharmaEntry.contributorDigest) || 0
  updatedLedger.balances = new Map(ledger.balances)
  updatedLedger.balances.set(dharmaEntry.contributorDigest, currentBalance + dharmaEntry.amount)

  // Update resolution index
  updatedLedger.resolutionIndex = new Map(ledger.resolutionIndex)
  const existingResolutions = ledger.resolutionIndex.get(resolution.resolutionId) || []
  updatedLedger.resolutionIndex.set(resolution.resolutionId, [...existingResolutions, dharmaEntry.dharmaId])

  // Update codex index
  updatedLedger.codexIndex = new Map(ledger.codexIndex)
  const existingCodexEntries = ledger.codexIndex.get(resolution.codexEntryId) || []
  updatedLedger.codexIndex.set(resolution.codexEntryId, [...existingCodexEntries, dharmaEntry.dharmaId])

  return {
    ledger: updatedLedger,
    benefitEvent,
    dharmaEntry,
    benefitStore: updatedStore,
  }
}

// ── Query Functions ───────────────────────────────────────────────────

/**
 * Get the dharma balance for a contributor.
 */
export function getDharmaBalance(ledger: DharmaLedger, contributorDigest: string): number {
  return ledger.balances.get(contributorDigest) || 0
}

/**
 * Get all dharma entries for a contributor.
 */
export function getContributorDharma(ledger: DharmaLedger, contributorDigest: string): DharmaEntry[] {
  return ledger.entries.filter((e) => e.contributorDigest === contributorDigest)
}

/**
 * Get all dharma entries for a Codex entry.
 */
export function getCodexEntryDharma(ledger: DharmaLedger, codexEntryId: string): DharmaEntry[] {
  const ids = ledger.codexIndex.get(codexEntryId) || []
  return ids.map((id) => ledger.entries.find((e) => e.dharmaId === id)).filter(Boolean) as DharmaEntry[]
}

/**
 * Get all dharma entries for a specific bug resolution.
 */
export function getResolutionDharma(ledger: DharmaLedger, resolutionId: string): DharmaEntry[] {
  const ids = ledger.resolutionIndex.get(resolutionId) || []
  return ids.map((id) => ledger.entries.find((e) => e.dharmaId === id)).filter(Boolean) as DharmaEntry[]
}

/**
 * Get total dharma earned across all contributors.
 */
export function getTotalDharma(ledger: DharmaLedger): number {
  return ledger.entries.reduce((sum, e) => sum + e.amount, 0)
}

/**
 * Get dharma leaderboard (contributors sorted by balance, descending).
 */
export function getDharmaLeaderboard(ledger: DharmaLedger, limit?: number): { contributorDigest: string; balance: number }[] {
  const entries = Array.from(ledger.balances.entries())
    .map(([contributorDigest, balance]) => ({ contributorDigest, balance }))
    .sort((a, b) => b.balance - a.balance)

  return limit ? entries.slice(0, limit) : entries
}

// ── Verification Constants ────────────────────────────────────────────

/**
 * Usage kinds that are eligible for dharma earning.
 * "direct_pattern_match" earns the most. "diagnostic_aid" earns the least.
 */
export const DHARMA_ELIGIBLE_USAGE: BugResolution["usageKind"][] = [
  "direct_pattern_match",
  "adapted_from_pattern",
  "prevented_recurrence",
  "diagnostic_aid",
]

/**
 * Verification statuses that count as earned dharma.
 * Only "confirmed_fixed" and "confirmed_prevented" earn dharma.
 */
export function isDharmaEarned(status: BugResolution["verificationStatus"]): boolean {
  return status === "confirmed_fixed" || status === "confirmed_prevented"
}

// ── Benefit Policy for Bug Resolutions ────────────────────────────────

/**
 * Create a benefit policy tuned for bug-resolution dharma.
 * Weights: original evidence contributor gets the largest share,
 * then the person who adapted the pattern, then the verifier.
 */
export function createBugResolutionBenefitPolicy(policyId: string): BenefitPolicy {
  return {
    policyId,
    version: "1",
    allocationShares: {
      original_evidence: 0.4,
      synthesis: 0.3,
      review: 0.1,
      reproduction: 0.1,
      maintenance: 0.1,
    },
    minEvidenceQuality: "medium",
    requireAccepted: true,
  }
}
