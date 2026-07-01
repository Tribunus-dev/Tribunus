/**
 * Track E — Contribution Accounting: In-Memory Store
 *
 * Minimal in-memory store with query functions. No real DB dependency.
 * All functions are pure: they take a store and return a new store or a value.
 */

import type { ContributionClass, DharmaContributionRecord } from "./contribution-types"
export type { DharmaContributionRecord } from "./contribution-types"

export interface ContributionStore {
  records: Map<string, DharmaContributionRecord>
}

export interface ContributionSummary {
  sessionId: string
  contributorCount: number
  acceptedCount: number
  pendingCount: number
  byClass: Partial<Record<ContributionClass, number>>
  computeMsTotal: number
  codexEligibleCount: number
}

/**
 * Create an empty contribution store.
 */
export function createContributionStore(): ContributionStore {
  return { records: new Map() }
}

/**
 * Add a contribution to the store by its contributionId.
 * Returns a new store — does not mutate the original.
 */
export function addContribution(
  store: ContributionStore,
  record: DharmaContributionRecord,
): ContributionStore {
  const next = new Map(store.records)
  next.set(record.contributionId, record)
  return { records: next }
}

/**
 * Retrieve a single contribution record by id.
 */
export function getContribution(
  store: ContributionStore,
  id: string,
): DharmaContributionRecord | undefined {
  return store.records.get(id)
}

/**
 * Return all contributions belonging to a given session.
 */
export function getContributionsBySession(
  store: ContributionStore,
  sessionId: string,
): DharmaContributionRecord[] {
  const results: DharmaContributionRecord[] = []
  for (const record of store.records.values()) {
    if (record.sessionId === sessionId) {
      results.push(record)
    }
  }
  return results
}

/**
 * Return all contributions made by a given contributor.
 */
export function getContributionsByContributor(
  store: ContributionStore,
  contributorId: string,
): DharmaContributionRecord[] {
  const results: DharmaContributionRecord[] = []
  for (const record of store.records.values()) {
    if (record.contributorIdentityDigest === contributorId) {
      results.push(record)
    }
  }
  return results
}

/**
 * Accept a contribution by setting acceptedBy and acceptedAt.
 * Returns the updated record, or undefined if the contribution does not exist.
 * Returns a new store — does not mutate the original.
 */
export function acceptContribution(
  store: ContributionStore,
  id: string,
  acceptedBy: string,
): DharmaContributionRecord | undefined {
  const record = store.records.get(id)
  if (!record) return undefined

  const updated: DharmaContributionRecord = {
    ...record,
    acceptedBy,
    acceptedAt: new Date().toISOString(),
  }
  return updated
}

/**
 * Revoke a contribution by clearing acceptedBy / acceptedAt and
 * resetting codexEligibility to false.
 * Returns the updated record, or undefined if the contribution does not exist.
 * Returns a new store — does not mutate the original.
 */
export function revokeContribution(
  store: ContributionStore,
  id: string,
): DharmaContributionRecord | undefined {
  const record = store.records.get(id)
  if (!record) return undefined

  const updated: DharmaContributionRecord = {
    ...record,
    acceptedBy: null,
    acceptedAt: null,
    codexEligibility: false,
  }
  return updated
}

/**
 * Build a summary object for all contributions in a given session.
 */
export function getSessionSummary(
  store: ContributionStore,
  sessionId: string,
): ContributionSummary {
  const sessionContributions = getContributionsBySession(store, sessionId)

  const contributors = new Set<string>()
  let acceptedCount = 0
  let pendingCount = 0
  const byClass: Partial<Record<ContributionClass, number>> = {}
  let computeMsTotal = 0
  let codexEligibleCount = 0

  for (const record of sessionContributions) {
    contributors.add(record.contributorIdentityDigest)

    if (record.acceptedBy !== null) {
      acceptedCount++
    } else {
      pendingCount++
    }

    const clsCount = byClass[record.contributionClass] ?? 0
    byClass[record.contributionClass] = clsCount + 1

    if (record.resourceCostSummary?.computeMs) {
      computeMsTotal += record.resourceCostSummary.computeMs
    }

    if (record.codexEligibility) {
      codexEligibleCount++
    }
  }

  return {
    sessionId,
    contributorCount: contributors.size,
    acceptedCount,
    pendingCount,
    byClass,
    computeMsTotal,
    codexEligibleCount,
  }
}
