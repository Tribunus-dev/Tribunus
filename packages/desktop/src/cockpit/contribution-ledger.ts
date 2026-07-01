/**
 * ContributionLedger — session-local contribution list (not Codex-wide).
 *
 * Pure data types and state machine — no UI rendering. Tracks contributions
 * within a single session context.
 */

/* ── Types ──────────────────────────────────────────────── */

export interface ContributionLedgerEntry {
  contributionId: string
  sessionId: string
  contributorId: string
  contributionClass: string
  description: string
  receiptDigests: string[]
  acceptedAt: string | null
  acceptedBy: string | null
}

/* ── Helpers ────────────────────────────────────────────── */

function copy(e: ContributionLedgerEntry): ContributionLedgerEntry {
  return {
    ...e,
    receiptDigests: [...e.receiptDigests],
  }
}

/* ── Factory ────────────────────────────────────────────── */

export function createLedgerEntry(
  sessionId: string,
  contributorId: string,
  contributionClass: string,
  description: string,
): ContributionLedgerEntry {
  return {
    contributionId: crypto.randomUUID(),
    sessionId,
    contributorId,
    contributionClass,
    description,
    receiptDigests: [],
    acceptedAt: null,
    acceptedBy: null,
  }
}

/* ── Transitions ────────────────────────────────────────── */

export function acceptEntry(
  entry: ContributionLedgerEntry,
  acceptedBy: string,
): ContributionLedgerEntry {
  if (entry.acceptedAt !== null) {
    throw new Error("Contribution entry already accepted")
  }
  return {
    ...copy(entry),
    acceptedAt: new Date().toISOString(),
    acceptedBy,
  }
}

/* ── Queries ────────────────────────────────────────────── */

export function getEntriesByContributor(
  entries: ContributionLedgerEntry[],
  contributorId: string,
): ContributionLedgerEntry[] {
  return entries.filter((e) => e.contributorId === contributorId)
}

export function getSessionSummary(
  entries: ContributionLedgerEntry[],
): { totalContributors: number; totalAccepted: number; byClass: Record<string, number> } {
  const contributors = new Set<string>()
  let accepted = 0
  const byClass: Record<string, number> = {}

  for (const e of entries) {
    contributors.add(e.contributorId)
    if (e.acceptedAt !== null) {
      accepted++
    }
    byClass[e.contributionClass] = (byClass[e.contributionClass] ?? 0) + 1
  }

  return {
    totalContributors: contributors.size,
    totalAccepted: accepted,
    byClass,
  }
}
