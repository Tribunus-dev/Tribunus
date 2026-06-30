/**
 * Dharma Multi-Peer Result Convergence — Claim Lifecycle State Machine
 */

import crypto from "node:crypto"
import type {
  DharmaTaskClaim,
  DharmaTaskContract,
  ClaimStatus,
} from "./multi-peer-types"

// ── Claim Actions ─────────────────────────────────────────────────────────────

export type ClaimAction =
  | "claim"
  | "start_work"
  | "submit"
  | "complete"
  | "accept"
  | "reject"
  | "conflict"
  | "supersede"
  | "release"
  | "expire"
  | "abandon"

// ── Valid Transitions ─────────────────────────────────────────────────────────

export const VALID_CLAIM_TRANSITIONS: Record<string, readonly string[]> = {
  available:         ["claimed"],
  claimed:           ["in_progress", "released", "expired"],
  in_progress:       ["result_submitted", "abandoned"],
  result_submitted:  ["completed", "accepted", "rejected", "conflicted", "superseded"],
  completed:         [],
  released:          [],
  expired:           [],
  abandoned:         [],
  accepted:          [],
  rejected:          [],
  conflicted:        [],
  superseded:        [],
} as const

// ── Action → Target Status Mapping ────────────────────────────────────────────

const ACTION_TARGET: Record<ClaimAction, string> = {
  claim:       "claimed",
  start_work:  "in_progress",
  submit:      "result_submitted",
  complete:    "completed",
  accept:      "accepted",
  reject:      "rejected",
  conflict:    "conflicted",
  supersede:   "superseded",
  release:     "released",
  expire:      "expired",
  abandon:     "abandoned",
}

// ── applyClaimAction ──────────────────────────────────────────────────────────

export function applyClaimAction(
  current: ClaimStatus,
  action: ClaimAction,
): ClaimStatus {
  const allowed = VALID_CLAIM_TRANSITIONS[current] ?? []
  const target = ACTION_TARGET[action]

  if (!allowed.includes(target)) {
    throw new Error(
      `Invalid claim transition: ${current} → ${target} (action: ${action})`,
    )
  }

  return target as ClaimStatus
}

// ── createClaim ───────────────────────────────────────────────────────────────

export interface CreateClaimConfig {
  taskId: string
  sessionId: string
  claimantIdentity: string
  claimantMembershipId: string
  sourceBasisDigest: string
}

export function createClaim(config: CreateClaimConfig): DharmaTaskClaim {
  return {
    claimId: crypto.randomUUID(),
    taskId: config.taskId,
    sessionId: config.sessionId,
    claimantIdentityPublicKey: config.claimantIdentity,
    claimantMembershipId: config.claimantMembershipId,
    claimedSourceBasisDigest: config.sourceBasisDigest,
    localSandboxAttestationDigest: "",
    claimedAt: new Date().toISOString(),
    expiresAt: null,
    status: "available",
    signature: "",
  }
}

// ── Query Helpers ─────────────────────────────────────────────────────────────

/** A claim is active if it is still being worked on or awaiting resolution. */
export function isClaimActive(claim: DharmaTaskClaim): boolean {
  const terminal: readonly ClaimStatus[] = [
    "completed",
    "released",
    "expired",
    "abandoned",
    "accepted",
    "rejected",
    "superseded",
  ]
  return !terminal.includes(claim.status)
}

/**
 * Determine whether a task can be claimed by a new participant.
 * Exclusive tasks reject additional claims.  Already-claimed tasks with
 * active claims also reject unless parallelism allows it.
 */
export function canClaimTask(
  task: DharmaTaskContract,
  existingClaims: DharmaTaskClaim[],
): { allowed: boolean; reason: string | null } {
  if (task.status !== "available") {
    return { allowed: false, reason: "Task is not available" }
  }

  if (task.parallelism === "exclusive" && existingClaims.length > 0) {
    return { allowed: false, reason: "Task is exclusive; already claimed" }
  }

  if (task.parallelism === "review_only" && existingClaims.length > 0) {
    return { allowed: false, reason: "Review-only task already claimed" }
  }

  const activeClaims = existingClaims.filter(isClaimActive)
  if (activeClaims.length >= task.maxContributors) {
    return {
      allowed: false,
      reason: `Max contributors (${task.maxContributors}) reached`,
    }
  }

  return { allowed: true, reason: null }
}
