/**
 * Dharma Session Authority — Membership State Machine
 *
 * Membership status transitions, invitation validation, member lifecycle.
 */

import type { SessionMember, MembershipStatus, SessionInvitation } from "./types"
import {
  MemberNotFoundError,
  InvitationExpiredError,
  InvitationInvalidError,
} from "./session-errors"

// ── Valid Transitions ──────────────────────────────────────────────────────

export const VALID_MEMBERSHIP_TRANSITIONS: Record<
  MembershipStatus,
  readonly MembershipStatus[]
> = {
  invited: ["joining", "expired"],
  joining: ["active", "expired"],
  active: ["suspended", "removed", "left"],
  suspended: ["active"],
  removed: [],
  left: [],
  expired: [],
}

export type MembershipAction =
  | "accept_invitation"
  | "activate"
  | "suspend"
  | "unsuspend"
  | "remove"
  | "leave"
  | "expire"

/** Map membership actions to resulting states from each current state. */
const MEMBERSHIP_ACTION_TRANSITIONS: Record<
  MembershipStatus,
  Partial<Record<MembershipAction, MembershipStatus>>
> = {
  invited: {
    accept_invitation: "joining",
    expire: "expired",
  },
  joining: {
    activate: "active",
    expire: "expired",
  },
  active: {
    suspend: "suspended",
    remove: "removed",
    leave: "left",
  },
  suspended: {
    unsuspend: "active",
  },
  removed: {},
  left: {},
  expired: {},
}

// ── Checks ─────────────────────────────────────────────────────────────────

/** Check if a membership status transition is valid. */
export function isValidMembershipTransition(
  current: MembershipStatus,
  next: MembershipStatus,
): boolean {
  return VALID_MEMBERSHIP_TRANSITIONS[current].includes(next)
}

/** Compute next membership status from current state and action. */
export function applyMembershipAction(
  current: MembershipStatus,
  action: MembershipAction,
): MembershipStatus {
  const transitions = MEMBERSHIP_ACTION_TRANSITIONS[current]
  if (!transitions) {
    throw new MemberNotFoundError("unknown", current)
  }
  const next = transitions[action]
  if (next === undefined) {
    throw new MemberNotFoundError("unknown", `No transition for action ${action} from ${current}`)
  }
  return next
}

// ── Invitation Validation ──────────────────────────────────────────────────

/** Check if an invitation is still valid. */
export function isInvitationValid(
  invitation: SessionInvitation,
): { valid: boolean; reason: string | null } {
  const now = new Date().toISOString()

  if (invitation.expiresAt < now) {
    return { valid: false, reason: "invitation has expired" }
  }

  if (invitation.sessionKeyEpoch < 0) {
    return { valid: false, reason: "invalid session key epoch" }
  }

  if (invitation.maxUses <= 0) {
    return { valid: false, reason: "invitation has no remaining uses" }
  }

  return { valid: true, reason: null }
}

// ── Member Creation ────────────────────────────────────────────────────────

/** Create a membership record from an accepted invitation. */
export function createMembershipFromInvitation(
  invitation: SessionInvitation,
  peerIdentityPublicKey: string,
): SessionMember {
  return {
    membershipId: `mem_${invitation.invitationId}`,
    sessionId: invitation.sessionId,
    peerIdentityPublicKey,
    peerDeviceId: null,
    invitedByIdentityPublicKey: invitation.inviterIdentityPublicKey,
    displayRole: invitation.initialDisplayRole,
    status: "joining",
    joinedAt: null,
    suspendedAt: null,
    removedAt: null,
    lastSeenAt: null,
    currentKeyEpoch: invitation.sessionKeyEpoch,
  }
}

/** Create a new session member record. */
export function createMember(config: {
  sessionId: string
  peerIdentityPublicKey: string
  invitedBy: string
  displayRole?: string
}): SessionMember {
  return {
    membershipId: `mem_${crypto.randomUUID()}`,
    sessionId: config.sessionId,
    peerIdentityPublicKey: config.peerIdentityPublicKey,
    peerDeviceId: null,
    invitedByIdentityPublicKey: config.invitedBy,
    displayRole: config.displayRole ?? "contributor",
    status: "invited",
    joinedAt: null,
    suspendedAt: null,
    removedAt: null,
    lastSeenAt: null,
    currentKeyEpoch: 0,
  }
}

// ── Member Updates ─────────────────────────────────────────────────────────

/** Update member's last seen timestamp. */
export function touchMember(member: SessionMember): SessionMember {
  return {
    ...member,
    lastSeenAt: new Date().toISOString(),
  }
}

/** Check if member is active. */
export function isMemberActive(member: SessionMember): boolean {
  return member.status === "active"
}
