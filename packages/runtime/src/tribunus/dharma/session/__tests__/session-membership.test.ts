/**
 * Tests for Dharma Session Authority — Membership State Machine
 */

import { describe, it, expect } from "bun:test"
import {
  isValidMembershipTransition,
  applyMembershipAction,
  isInvitationValid,
  createMembershipFromInvitation,
  createMember,
  touchMember,
  isMemberActive,
} from "../session-membership"
import type { SessionMember, SessionInvitation, MembershipStatus } from "../types"

// ── Helpers ────────────────────────────────────────────────────────────────

function makeInvitation(
  overrides?: Partial<SessionInvitation>,
): SessionInvitation {
  return {
    invitationId: "invite_001",
    sessionId: "session_001",
    federationId: "fed_001",
    inviterIdentityPublicKey: "pk_inviter_001",
    inviteeIdentityPublicKey: "pk_invitee_001",
    initialDisplayRole: "contributor",
    initialGrantTemplates: ["contributor"],
    sessionKeyEpoch: 1,
    expiresAt: "2099-12-31T23:59:59.999Z",
    maxUses: 1,
    visibilitySummary: "invited to session_001",
    encryptedJoinPayload: null,
    signature: "sig_001",
    ...overrides,
  }
}

function makeMember(overrides?: Partial<SessionMember>): SessionMember {
  return {
    membershipId: "mem_001",
    sessionId: "session_001",
    peerIdentityPublicKey: "pk_peer_001",
    peerDeviceId: null,
    invitedByIdentityPublicKey: "pk_inviter_001",
    displayRole: "contributor",
    status: "active",
    joinedAt: "2026-06-01T00:00:00.000Z",
    suspendedAt: null,
    removedAt: null,
    lastSeenAt: "2026-06-15T12:00:00.000Z",
    currentKeyEpoch: 1,
    ...overrides,
  }
}

// ── isValidMembershipTransition ────────────────────────────────────────────

describe("isValidMembershipTransition", () => {
  it("invited -> joining is valid", () => {
    expect(isValidMembershipTransition("invited", "joining")).toBe(true)
  })

  it("invited -> active is invalid (skips steps)", () => {
    expect(isValidMembershipTransition("invited", "active")).toBe(false)
  })

  it("invited -> expired is valid", () => {
    expect(isValidMembershipTransition("invited", "expired")).toBe(true)
  })

  it("joining -> active is valid", () => {
    expect(isValidMembershipTransition("joining", "active")).toBe(true)
  })

  it("active -> suspended is valid", () => {
    expect(isValidMembershipTransition("active", "suspended")).toBe(true)
  })

  it("active -> removed is valid", () => {
    expect(isValidMembershipTransition("active", "removed")).toBe(true)
  })

  it("active -> left is valid", () => {
    expect(isValidMembershipTransition("active", "left")).toBe(true)
  })

  it("suspended -> active is valid (unsuspend)", () => {
    expect(isValidMembershipTransition("suspended", "active")).toBe(true)
  })

  it("removed -> anything is invalid (terminal)", () => {
    expect(isValidMembershipTransition("removed", "active")).toBe(false)
    expect(isValidMembershipTransition("removed", "invited")).toBe(false)
  })

  it("left -> anything is invalid (terminal)", () => {
    expect(isValidMembershipTransition("left", "active")).toBe(false)
  })
})

// ── applyMembershipAction ──────────────────────────────────────────────────

describe("applyMembershipAction", () => {
  it("accept_invitation transitions invited -> joining", () => {
    expect(applyMembershipAction("invited", "accept_invitation")).toBe("joining")
  })

  it("activate transitions joining -> active", () => {
    expect(applyMembershipAction("joining", "activate")).toBe("active")
  })

  it("suspend transitions active -> suspended", () => {
    expect(applyMembershipAction("active", "suspend")).toBe("suspended")
  })

  it("unsuspend transitions suspended -> active", () => {
    expect(applyMembershipAction("suspended", "unsuspend")).toBe("active")
  })

  it("remove transitions active -> removed", () => {
    expect(applyMembershipAction("active", "remove")).toBe("removed")
  })

  it("leave transitions active -> left", () => {
    expect(applyMembershipAction("active", "leave")).toBe("left")
  })

  it("expire transitions invited -> expired", () => {
    expect(applyMembershipAction("invited", "expire")).toBe("expired")
  })

  it("throws for invalid action from state", () => {
    expect(() => applyMembershipAction("active", "accept_invitation")).toThrow()
    expect(() => applyMembershipAction("removed", "activate")).toThrow()
  })
})

// ── isInvitationValid ──────────────────────────────────────────────────────

describe("isInvitationValid", () => {
  it("returns valid for a current invitation", () => {
    const inv = makeInvitation()
    const result = isInvitationValid(inv)
    expect(result.valid).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("returns expired for invitation with past expiry", () => {
    const inv = makeInvitation({ expiresAt: "2020-01-01T00:00:00.000Z" })
    const result = isInvitationValid(inv)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("invitation has expired")
  })

  it("returns invalid for invitation with maxUses <= 0", () => {
    const inv = makeInvitation({ maxUses: 0 })
    const result = isInvitationValid(inv)
    expect(result.valid).toBe(false)
  })

  it("returns invalid for negative key epoch", () => {
    const inv = makeInvitation({ sessionKeyEpoch: -1 })
    const result = isInvitationValid(inv)
    expect(result.valid).toBe(false)
  })
})

// ── createMembershipFromInvitation ─────────────────────────────────────────

describe("createMembershipFromInvitation", () => {
  it("creates a member with joining status from invitation", () => {
    const inv = makeInvitation()
    const member = createMembershipFromInvitation(inv, "pk_peer_accepted_001")

    expect(member.membershipId).toBe("mem_invite_001")
    expect(member.sessionId).toBe("session_001")
    expect(member.peerIdentityPublicKey).toBe("pk_peer_accepted_001")
    expect(member.invitedByIdentityPublicKey).toBe("pk_inviter_001")
    expect(member.status).toBe("joining")
    expect(member.displayRole).toBe("contributor")
    expect(member.currentKeyEpoch).toBe(1)
    expect(member.joinedAt).toBeNull()
  })
})

// ── createMember ───────────────────────────────────────────────────────────

describe("createMember", () => {
  it("creates a member with invited status", () => {
    const member = createMember({
      sessionId: "session_002",
      peerIdentityPublicKey: "pk_peer_002",
      invitedBy: "pk_inviter_002",
      displayRole: "maintainer",
    })

    expect(member.sessionId).toBe("session_002")
    expect(member.peerIdentityPublicKey).toBe("pk_peer_002")
    expect(member.invitedByIdentityPublicKey).toBe("pk_inviter_002")
    expect(member.displayRole).toBe("maintainer")
    expect(member.status).toBe("invited")
    expect(member.currentKeyEpoch).toBe(0)
    expect(member.membershipId).toStartWith("mem_")
  })

  it("uses default display role when not provided", () => {
    const member = createMember({
      sessionId: "session_002",
      peerIdentityPublicKey: "pk_peer_002",
      invitedBy: "pk_inviter_002",
    })

    expect(member.displayRole).toBe("contributor")
  })
})

// ── touchMember ────────────────────────────────────────────────────────────

describe("touchMember", () => {
  it("updates lastSeenAt timestamp", () => {
    const member = makeMember({ lastSeenAt: null })
    const updated = touchMember(member)

    expect(updated.lastSeenAt).not.toBeNull()
    expect(updated.membershipId).toBe(member.membershipId)
    expect(updated.status).toBe(member.status)
  })
})

// ── isMemberActive ─────────────────────────────────────────────────────────

describe("isMemberActive", () => {
  it("returns true for active member", () => {
    const member = makeMember({ status: "active" })
    expect(isMemberActive(member)).toBe(true)
  })

  it("returns false for removed member", () => {
    const member = makeMember({ status: "removed" })
    expect(isMemberActive(member)).toBe(false)
  })

  it("returns false for invited member", () => {
    const member = makeMember({ status: "invited" })
    expect(isMemberActive(member)).toBe(false)
  })

  it("returns false for suspended member", () => {
    const member = makeMember({ status: "suspended" })
    expect(isMemberActive(member)).toBe(false)
  })

  it("returns false for left member", () => {
    const member = makeMember({ status: "left" })
    expect(isMemberActive(member)).toBe(false)
  })
})
