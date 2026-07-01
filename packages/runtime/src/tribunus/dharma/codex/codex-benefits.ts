/**
 * Codex Benefit Accounting — Event-Based Benefits Layer
 *
 * Benefits are event-based and auditable, never a mutable reputation counter.
 * A benefit event is created when a downstream action (citation, reuse,
 * independent reproduction, maintenance) is attributable to a CodexEntry.
 *
 * Allocations distribute the benefit among contributors with verifiable roles,
 * normalized to sum to 1.0 per event.
 */

import { randomUUID } from "node:crypto"
import type {
  CodexBenefitEvent,
  BenefitAllocation,
  BenefitAllocationKind,
  BenefitPolicy,
  CodexEntry,
} from "./codex-types"

// ── Benefit Kinds ────────────────────────────────────────────────────────────

/** The only benefit kinds implemented in this version. */
export const BENEFIT_KINDS = [
  "citation",
  "reuse",
  "independent_reproduction",
  "maintenance",
] as const

// ── Role Derivation ──────────────────────────────────────────────────────────

/**
 * Derive contributor roles for a benefit event.
 *
 * Contributors matching the entry's authoredBy list receive the
 * "original_evidence" role.  All other contributors receive roles
 * determined by the benefit kind:
 *
 *   citation                → synthesis, review
 *   reuse                   → synthesis
 *   independent_reproduction → reproduction, review
 *   maintenance             → maintenance, review
 */
function deriveContributorRoles(
  contributors: string[],
  entry: CodexEntry,
  benefitKind: CodexBenefitEvent["benefitKind"],
): { identityDigest: string; roles: BenefitAllocationKind[] }[] {
  const authoredBy = new Set(entry.provenance.authoredBy)

  const otherRoles = roleMapForKind(benefitKind)

  return contributors.map((digest) => ({
    identityDigest: digest,
    roles: authoredBy.has(digest) ? ["original_evidence"] : [...otherRoles],
  }))
}

function roleMapForKind(
  kind: CodexBenefitEvent["benefitKind"],
): BenefitAllocationKind[] {
  switch (kind) {
    case "citation":
      return ["synthesis", "review"]
    case "reuse":
      return ["synthesis"]
    case "independent_reproduction":
      return ["reproduction", "review"]
    case "maintenance":
      return ["maintenance", "review"]
  }
}

// ── Benefit Event Creation ───────────────────────────────────────────────────

/**
 * Create a benefit event for a downstream action attributable to an entry.
 *
 * Derives each contributor's role from the entry provenance and benefit kind,
 * then allocates shares via the policy.  Returns a fully formed event with
 * a unique event id and current timestamp.
 */
export function createBenefitEvent(
  entry: CodexEntry,
  benefitKind: CodexBenefitEvent["benefitKind"],
  sourceContributionId: string,
  policy: BenefitPolicy,
  contributors: string[],
): CodexBenefitEvent {
  const contributorRoles = deriveContributorRoles(contributors, entry, benefitKind)
  const allocations = computeAllocations(policy, benefitKind, contributorRoles)

  return {
    eventId: randomUUID(),
    codexEntryId: entry.codexEntryId,
    benefitKind,
    sourceContributionId,
    allocations,
    policyVersion: policy.version,
    recordedAt: new Date().toISOString(),
  }
}

// ── Share & Allocation Computation ──────────────────────────────────────────

/**
 * Get the allocation share weights defined by a policy.
 *
 * The benefitKind parameter is reserved for future per-kind weighting
 * and returns the policy's flat allocation shares in this version.
 */
export function getAllocationShares(
  policy: BenefitPolicy,
  _benefitKind: string,
): Record<BenefitAllocationKind, number> {
  return { ...policy.allocationShares }
}

/**
 * Compute benefit allocations for a set of contributors with known roles.
 *
 * Algorithm:
 *   1. For each role (BenefitAllocationKind), divide its policy share equally
 *      among all contributors claiming that role.
 *   2. Sum the partial shares for each contributor across every role they hold.
 *   3. Normalise so the total sum is exactly 1.0 (correcting for floating-point
 *      drift and unclaimed role shares).
 *
 * Returns one BenefitAllocation per contributor, sorted by identityDigest
 * for determinism.
 */
export function computeAllocations(
  policy: BenefitPolicy,
  _benefitKind: string,
  contributors: { identityDigest: string; roles: BenefitAllocationKind[] }[],
): BenefitAllocation[] {
  if (contributors.length === 0) return []

  const shares = policy.allocationShares

  // Count how many contributors claim each role
  const roleCount: Record<string, number> = {}
  for (const c of contributors) {
    for (const role of c.roles) {
      const key = String(role)
      roleCount[key] = (roleCount[key] ?? 0) + 1
    }
  }

  // Compute raw per-contributor share
  const raw: Map<string, number> = new Map()
  for (const c of contributors) {
    let total = 0
    const seenRoles = new Set<string>()
    for (const role of c.roles) {
      const key = String(role)
      if (seenRoles.has(key)) continue // deduplicate per contributor
      seenRoles.add(key)
      const count = roleCount[key] ?? 1
      total += (shares[role] ?? 0) / count
    }
    raw.set(c.identityDigest, total)
  }

  // Normalise so sum == 1.0
  const rawSum = Array.from(raw.values()).reduce((a, b) => a + b, 0)
  const normalise = rawSum > 0 ? 1 / rawSum : 0

  const allocations: BenefitAllocation[] = []
  for (const [digest, share] of raw) {
    // Determine the primary role (first in the contributor's role list)
    const contributor = contributors.find((c) => c.identityDigest === digest)
    const primaryKind = contributor && contributor.roles.length > 0 ? contributor.roles[0] : "synthesis"

    allocations.push({
      kind: primaryKind,
      recipientIdentityDigest: digest,
      share: Math.round(share * normalise * 10000) / 10000,
    })
  }

  // Sort by identityDigest for determinism
  allocations.sort((a, b) => a.recipientIdentityDigest.localeCompare(b.recipientIdentityDigest))

  return allocations
}

// ── Validation ───────────────────────────────────────────────────────────────

const ALLOCATION_EPSILON = 0.001

/**
 * Validate a set of allocations.
 *
 * Checks:
 *  - All shares are finite numbers in [0, 1]
 *  - Sum of shares ≈ 1.0 (within `ALLOCATION_EPSILON`)
 *  - No duplicate recipient within the same event
 *
 * Returns `{ valid: true, reason: null }` when every check passes,
 * otherwise `{ valid: false, reason: "<description>" }`.
 */
export function validateAllocations(
  allocs: BenefitAllocation[],
): { valid: boolean; reason: string | null } {
  if (!Array.isArray(allocs) || allocs.length === 0) {
    return { valid: false, reason: "Allocations array is empty" }
  }

  let sum = 0
  const seen = new Set<string>()

  for (const alloc of allocs) {
    if (typeof alloc.share !== "number" || !Number.isFinite(alloc.share)) {
      return { valid: false, reason: `Non-finite share for ${alloc.recipientIdentityDigest}` }
    }
    if (alloc.share < 0 || alloc.share > 1) {
      return { valid: false, reason: `Share ${alloc.share} out of [0, 1] for ${alloc.recipientIdentityDigest}` }
    }
    if (seen.has(alloc.recipientIdentityDigest)) {
      return { valid: false, reason: `Duplicate recipient ${alloc.recipientIdentityDigest}` }
    }
    seen.add(alloc.recipientIdentityDigest)
    sum += alloc.share
  }

  if (Math.abs(sum - 1.0) > ALLOCATION_EPSILON) {
    return { valid: false, reason: `Allocation sum ${sum.toFixed(4)} deviates from 1.0 by more than ${ALLOCATION_EPSILON}` }
  }

  return { valid: true, reason: null }
}

// ── Benefit Store ────────────────────────────────────────────────────────────

export interface BenefitStore {
  events: Map<string, CodexBenefitEvent>
  policies: Map<string, BenefitPolicy>
}

/** Create an empty benefit store. */
export function createBenefitStore(): BenefitStore {
  return {
    events: new Map(),
    policies: new Map(),
  }
}

/**
 * Record a benefit event in the store.
 * Returns a new store — does not mutate the original.
 */
export function recordBenefitEvent(
  store: BenefitStore,
  event: CodexBenefitEvent,
): BenefitStore {
  const next = new Map(store.events)
  next.set(event.eventId, event)
  return { events: next, policies: store.policies }
}

/**
 * Get all benefit events involving a specific contributor.
 * Searches allocations for matching `recipientIdentityDigest`.
 */
export function getContributorBenefits(
  store: BenefitStore,
  contributorDigest: string,
): CodexBenefitEvent[] {
  const result: CodexBenefitEvent[] = []
  for (const event of store.events.values()) {
    if (event.allocations.some((a) => a.recipientIdentityDigest === contributorDigest)) {
      result.push(event)
    }
  }
  return result
}

/**
 * Get all benefit events referencing a specific codex entry.
 */
export function getEntryBenefits(
  store: BenefitStore,
  codexEntryId: string,
): CodexBenefitEvent[] {
  const result: CodexBenefitEvent[] = []
  for (const event of store.events.values()) {
    if (event.codexEntryId === codexEntryId) {
      result.push(event)
    }
  }
  return result
}

/**
 * Get the total allocated share for a contributor across all benefit events.
 * Aggregates share values (not a counter or reputation — purely audit data).
 */
export function getTotalAllocation(
  store: BenefitStore,
  contributorDigest: string,
): number {
  let total = 0
  for (const event of store.events.values()) {
    for (const alloc of event.allocations) {
      if (alloc.recipientIdentityDigest === contributorDigest) {
        total += alloc.share
      }
    }
  }
  // Round to 4 decimal places to avoid floating-point noise
  return Math.round(total * 10000) / 10000
}

/**
 * Add a policy to the store.
 * Returns a new store — does not mutate the original.
 */
export function addPolicy(
  store: BenefitStore,
  policy: BenefitPolicy,
): BenefitStore {
  const next = new Map(store.policies)
  next.set(policy.policyId, policy)
  return { events: store.events, policies: next }
}
