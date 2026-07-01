/**
 * MLS Group Lifecycle — State Machines for Group Lifecycle Operations
 *
 * Each Codex visibility domain is an MLS group with a defined lifecycle:
 *   creating → active → epoch_transition → active …
 *                    → suspended → active | dissolved
 *
 * This module provides pure state machine functions that validate transitions,
 * manage member lists, and record epoch history.
 */

import type {
  CodexMlsGroupDescriptor,
  CodexMlsPolicy,
  DharmaMlsCommitReceipt,
  MlsDomainKind,
} from "./mls-types"

// ── Types ────────────────────────────────────────────────────────────────────

export type GroupLifecycleState =
  | "creating"
  | "active"
  | "epoch_transition"
  | "suspended"
  | "dissolved"

export interface GroupLifecycle {
  descriptor: CodexMlsGroupDescriptor
  policy: CodexMlsPolicy
  state: GroupLifecycleState
  currentEpoch: number
  memberCount: number
  memberIdentities: string[]
  epochHistory: {
    epoch: number
    committedAt: string
    operation: string
    affectedIdentities: string[]
  }[]
  createdAt: string
  lastTransitionAt: string
}

// ── Valid State Transitions ──────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<GroupLifecycleState, GroupLifecycleState[]> = {
  creating: ["active"],
  active: ["epoch_transition", "suspended", "dissolved"],
  epoch_transition: ["active"],
  suspended: ["active", "dissolved"],
  dissolved: [],
}

/**
 * Create a new GroupLifecycle from a descriptor and policy.
 *
 * The group starts in "creating" state at epoch 0.
 */
export function createGroupLifecycle(
  descriptor: CodexMlsGroupDescriptor,
  policy: CodexMlsPolicy,
): GroupLifecycle {
  const now = new Date().toISOString()
  return {
    descriptor,
    policy,
    state: "creating",
    currentEpoch: 0,
    memberCount: 0,
    memberIdentities: [],
    epochHistory: [],
    createdAt: now,
    lastTransitionAt: now,
  }
}

/**
 * Transition a group lifecycle to a new state.
 *
 * Validates that the transition is allowed by the state machine.
 * Throws if the transition is invalid.
 */
export function transitionGroupState(
  state: GroupLifecycle,
  newState: GroupLifecycleState,
): GroupLifecycle {
  const allowed = VALID_TRANSITIONS[state.state]
  if (!allowed.includes(newState)) {
    throw new Error(
      `Invalid group state transition: ${state.state} → ${newState}`,
    )
  }
  return {
    ...state,
    state: newState,
    lastTransitionAt: new Date().toISOString(),
  }
}

/**
 * Record an epoch transition from an MLS commit receipt.
 *
 * Updates the current epoch, records the epoch history entry, and transitions
 * the group state to "active" (since an epoch transition completes the commit).
 *
 * Only valid from "active" (new commit) or "epoch_transition" (completing
 * an in-progress transition). Throws if the receipt epoch does not match
 * the expected next epoch.
 */
export function recordEpochTransition(
  state: GroupLifecycle,
  receipt: DharmaMlsCommitReceipt,
): GroupLifecycle {
  if (state.state !== "active" && state.state !== "epoch_transition") {
    throw new Error(
      `Cannot record epoch transition from state: ${state.state}`,
    )
  }

  if (receipt.priorEpoch !== state.currentEpoch) {
    throw new Error(
      `Epoch mismatch: receipt priorEpoch ${receipt.priorEpoch} !== currentEpoch ${state.currentEpoch}`,
    )
  }

  if (receipt.nextEpoch <= state.currentEpoch) {
    throw new Error(
      `Receipt nextEpoch ${receipt.nextEpoch} must be > currentEpoch ${state.currentEpoch}`,
    )
  }

  const now = new Date().toISOString()
  const historyEntry = {
    epoch: receipt.nextEpoch,
    committedAt: now,
    operation: receipt.operation,
    affectedIdentities: [...receipt.affectedIdentities],
  }

  // Update member identities based on operation
  let memberIdentities = [...state.memberIdentities]
  if (receipt.operation === "add") {
    for (const id of receipt.affectedIdentities) {
      if (!memberIdentities.includes(id)) {
        memberIdentities.push(id)
      }
    }
  } else if (receipt.operation === "remove") {
    memberIdentities = memberIdentities.filter(
      (id) => !receipt.affectedIdentities.includes(id),
    )
  }

  return {
    ...state,
    currentEpoch: receipt.nextEpoch,
    memberCount: memberIdentities.length,
    memberIdentities,
    epochHistory: [...state.epochHistory, historyEntry],
    state: "active",
    lastTransitionAt: now,
  }
}

/**
 * Add a member to the group.
 *
 * This is a local membership operation — it does NOT trigger an MLS commit.
 * The caller must separately trigger an epoch transition via recordEpochTransition
 * to persist the change in the MLS group.
 */
export function addMember(
  state: GroupLifecycle,
  identityId: string,
): GroupLifecycle {
  if (state.state !== "active") {
    throw new Error(
      `Cannot add member when group is ${state.state}`,
    )
  }

  if (state.memberIdentities.includes(identityId)) {
    return state // idempotent
  }

  return {
    ...state,
    memberCount: state.memberCount + 1,
    memberIdentities: [...state.memberIdentities, identityId],
  }
}

/**
 * Remove a member from the group.
 *
 * Same caveat as addMember — the change takes effect in the MLS group only
 * when committed via an epoch transition.
 */
export function removeMember(
  state: GroupLifecycle,
  identityId: string,
): GroupLifecycle {
  if (state.state !== "active") {
    throw new Error(
      `Cannot remove member when group is ${state.state}`,
    )
  }

  if (!state.memberIdentities.includes(identityId)) {
    return state // idempotent
  }

  return {
    ...state,
    memberCount: state.memberCount - 1,
    memberIdentities: state.memberIdentities.filter((id) => id !== identityId),
  }
}

/**
 * Check if a given identity is currently a group member.
 */
export function isMemberActive(
  state: GroupLifecycle,
  identityId: string,
): boolean {
  return state.memberIdentities.includes(identityId)
}

/**
 * Check whether a grant profile is authorized to join a visibility domain.
 *
 * Grant profile is a role string (e.g. "owner", "maintainer", "contributor",
 * "session_participant", "policy_controller"). Not all profiles can join all
 * domains.
 */
export function canJoinDomain(
  domainKind: MlsDomainKind,
  grantProfile: string,
): boolean {
  switch (domainKind) {
    case "public":
      // Anyone can join public groups
      return true
    case "contributor":
      return grantProfile === "contributor" ||
        grantProfile === "maintainer" ||
        grantProfile === "owner"
    case "project":
      return grantProfile === "maintainer" ||
        grantProfile === "owner" ||
        grantProfile === "policy_controller"
    case "session":
      return grantProfile === "session_participant" ||
        grantProfile === "owner" ||
        grantProfile === "maintainer"
    case "export_recovery":
      return grantProfile === "policy_controller" ||
        grantProfile === "owner"
    default:
      return false
  }
}

/**
 * Calculate the minimum number of MLS groups required for a given number of
 * encrypted entries, assuming each group can host approximately 100,000 entries
 * across its epochs.
 *
 * Returns at least 1 group.
 */
export function getRequiredGroupCount(entries: number): number {
  const CAPACITY = 100_000
  if (entries <= 0) return 1
  return Math.ceil(entries / CAPACITY)
}
