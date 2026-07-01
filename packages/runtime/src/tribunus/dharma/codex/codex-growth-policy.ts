/**
 * Codex — Growth Policy
 *
 * Limits Codex growth to O(novel_claims). Caps entries per knowledge class
 * per time period. When the cap is reached, new contributions must either
 * corroborate existing entries or wait until the next period.
 */

import type { KnowledgeClass } from "./codex-types"

// ── Growth Policy ───────────────────────────────────────────────────────

export interface CodexGrowthPolicy {
  /** Maximum new entries per knowledge class per rolling window */
  maxEntriesPerClassPerWindow: number
  /** Rolling window in milliseconds (default: 30 days) */
  windowMs: number
  /** Whether to allow new entry creation when cap is reached */
  blockNewEntriesWhenCapped: boolean
  /** Whether corroboration is always allowed (bypasses cap) */
  allowCorroborationWhenCapped: boolean
}

export function createDefaultGrowthPolicy(): CodexGrowthPolicy {
  return {
    maxEntriesPerClassPerWindow: 100,
    windowMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    blockNewEntriesWhenCapped: true,
    allowCorroborationWhenCapped: true,
  }
}

export function createPermissiveGrowthPolicy(): CodexGrowthPolicy {
  return {
    maxEntriesPerClassPerWindow: 1000,
    windowMs: 30 * 24 * 60 * 60 * 1000,
    blockNewEntriesWhenCapped: false,
    allowCorroborationWhenCapped: true,
  }
}

export function createRestrictiveGrowthPolicy(): CodexGrowthPolicy {
  return {
    maxEntriesPerClassPerWindow: 20,
    windowMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    blockNewEntriesWhenCapped: true,
    allowCorroborationWhenCapped: true,
  }
}

// ── Entry Count Tracking ────────────────────────────────────────────────

export interface EntryCountWindow {
  knowledgeClass: KnowledgeClass
  windowStart: number
  entryIds: string[]
}

export function countEntriesInWindow(
  entryTimestamps: { knowledgeClass: KnowledgeClass; createdAt: string }[],
  knowledgeClass: KnowledgeClass,
  windowMs: number,
  now: number,
): number {
  const windowStart = now - windowMs
  return entryTimestamps.filter(
    (e) => e.knowledgeClass === knowledgeClass && new Date(e.createdAt).getTime() >= windowStart,
  ).length
}

// ── Cap Check ──────────────────────────────────────────────────────────

export interface CapCheckResult {
  allowed: boolean
  currentCount: number
  maxAllowed: number
  reason: string | null
}

export function checkCreationCap(
  policy: CodexGrowthPolicy,
  knowledgeClass: KnowledgeClass,
  entryTimestamps: { knowledgeClass: KnowledgeClass; createdAt: string }[],
  now: number,
): CapCheckResult {
  const currentCount = countEntriesInWindow(entryTimestamps, knowledgeClass, policy.windowMs, now)
  const allowed = !policy.blockNewEntriesWhenCapped || currentCount < policy.maxEntriesPerClassPerWindow

  return {
    allowed,
    currentCount,
    maxAllowed: policy.maxEntriesPerClassPerWindow,
    reason: allowed
      ? null
      : `Cap reached for ${knowledgeClass}: ${currentCount}/${policy.maxEntriesPerClassPerWindow} in current window`,
  }
}

/**
 * Check whether a new entry can be created. Returns true when:
 *   - The cap is not reached, OR
 *   - The cap is reached but blockNewEntriesWhenCapped is false
 * Corroboration is always allowed (bypasses cap).
 */
export function canCreateEntry(
  policy: CodexGrowthPolicy,
  knowledgeClass: KnowledgeClass,
  entryTimestamps: { knowledgeClass: KnowledgeClass; createdAt: string }[],
  now: number,
): boolean {
  const check = checkCreationCap(policy, knowledgeClass, entryTimestamps, now)
  return check.allowed
}
