/**
 * MLS Group Lifecycle — Tests
 *
 * Verifies state machine transitions, member management, epoch recording,
 * and domain access control.
 */

import { describe, test, expect } from "bun:test"
import {
  createGroupLifecycle,
  transitionGroupState,
  recordEpochTransition,
  addMember,
  removeMember,
  isMemberActive,
  canJoinDomain,
  getRequiredGroupCount,
  type GroupLifecycle,
} from "../mls-group-lifecycle"
import { createDefaultMlsPolicy, createMlsCommitReceipt, type CodexMlsGroupDescriptor } from "../mls-types"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDescriptor(
  overrides?: Partial<CodexMlsGroupDescriptor>,
): CodexMlsGroupDescriptor {
  return {
    groupId: "test-group-001",
    domainId: "domain-session",
    domainKind: "session",
    mlsProtocolVersion: 1,
    ciphersuite: "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
    authorityBinding: {
      dharmaPolicyDigest: "a1b2c3d4e5f6",
      membershipRuleVersion: "1.0.0",
      autobaseHeadCommitment: "abc123def456",
    },
    currentEpoch: 0,
    groupStateDigest: "0000000000000000",
    createdBy: "test-creator-001",
    createdAtLogicalTime: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }
}

function makeReceipt(
  groupId: string,
  priorEpoch: number,
  nextEpoch: number,
  operation: "create" | "add" | "remove" | "update" | "reinit" | "external_commit" = "add",
  affectedIdentities: string[] = ["member-001"],
) {
  return createMlsCommitReceipt(groupId, priorEpoch, nextEpoch, operation, affectedIdentities)
}

// ── Tests: createGroupLifecycle ──────────────────────────────────────────────

describe("createGroupLifecycle", () => {
  test("creates lifecycle in creating state", () => {
    const descriptor = makeDescriptor()
    const policy = createDefaultMlsPolicy("session")
    const lifecycle = createGroupLifecycle(descriptor, policy)

    expect(lifecycle.state).toBe("creating")
    expect(lifecycle.currentEpoch).toBe(0)
    expect(lifecycle.memberCount).toBe(0)
    expect(lifecycle.memberIdentities).toEqual([])
    expect(lifecycle.epochHistory).toEqual([])
    expect(lifecycle.descriptor).toBe(descriptor)
    expect(lifecycle.policy).toBe(policy)
    expect(lifecycle.createdAt).toBeTruthy()
    expect(lifecycle.lastTransitionAt).toBeTruthy()
  })
})

// ── Tests: State Transitions ─────────────────────────────────────────────────

describe("transitionGroupState", () => {
  test("creating → active", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const updated = transitionGroupState(lifecycle, "active")
    expect(updated.state).toBe("active")
  })

  test("active → epoch_transition", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const updated = transitionGroupState(active, "epoch_transition")
    expect(updated.state).toBe("epoch_transition")
  })

  test("active → suspended", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const updated = transitionGroupState(active, "suspended")
    expect(updated.state).toBe("suspended")
  })

  test("active → dissolved", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const updated = transitionGroupState(active, "dissolved")
    expect(updated.state).toBe("dissolved")
  })

  test("suspended → active (resume)", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const suspended = transitionGroupState(active, "suspended")
    const resumed = transitionGroupState(suspended, "active")
    expect(resumed.state).toBe("active")
  })

  test("suspended → dissolved", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const suspended = transitionGroupState(active, "suspended")
    const dissolved = transitionGroupState(suspended, "dissolved")
    expect(dissolved.state).toBe("dissolved")
  })

  test("epoch_transition → active", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const transitioning = transitionGroupState(active, "epoch_transition")
    const completed = transitionGroupState(transitioning, "active")
    expect(completed.state).toBe("active")
  })

  describe("invalid transitions", () => {
    test("creating → dissolved throws", () => {
      const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
      expect(() => transitionGroupState(lifecycle, "dissolved")).toThrow(
        /Invalid group state transition/,
      )
    })

    test("creating → epoch_transition throws", () => {
      const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
      expect(() => transitionGroupState(lifecycle, "epoch_transition")).toThrow(
        /Invalid group state transition/,
      )
    })

    test("active → creating throws", () => {
      const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
      const active = transitionGroupState(lifecycle, "active")
      expect(() => transitionGroupState(active, "creating")).toThrow(
        /Invalid group state transition/,
      )
    })

    test("dissolved → any state throws", () => {
      const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
      const active = transitionGroupState(lifecycle, "active")
      const dissolved = transitionGroupState(active, "dissolved")
      expect(() => transitionGroupState(dissolved, "active")).toThrow(
        /Invalid group state transition/,
      )
      expect(() => transitionGroupState(dissolved, "epoch_transition")).toThrow(
        /Invalid group state transition/,
      )
      expect(() => transitionGroupState(dissolved, "suspended")).toThrow(
        /Invalid group state transition/,
      )
    })

    test("epoch_transition → suspended throws", () => {
      const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
      const active = transitionGroupState(lifecycle, "active")
      const transitioning = transitionGroupState(active, "epoch_transition")
      expect(() => transitionGroupState(transitioning, "suspended")).toThrow(
        /Invalid group state transition/,
      )
    })

    test("suspended → epoch_transition throws", () => {
      const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
      const active = transitionGroupState(lifecycle, "active")
      const suspended = transitionGroupState(active, "suspended")
      expect(() => transitionGroupState(suspended, "epoch_transition")).toThrow(
        /Invalid group state transition/,
      )
    })
  })
})

// ── Tests: recordEpochTransition ──────────────────────────────────────────

describe("recordEpochTransition", () => {
  test("records epoch transition from active state", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const receipt = makeReceipt("test-group-001", 0, 1, "add", ["member-001"])

    const updated = recordEpochTransition(active, receipt)

    expect(updated.currentEpoch).toBe(1)
    expect(updated.state).toBe("active")
    expect(updated.epochHistory).toHaveLength(1)
    expect(updated.epochHistory[0].epoch).toBe(1)
    expect(updated.epochHistory[0].operation).toBe("add")
    expect(updated.epochHistory[0].affectedIdentities).toEqual(["member-001"])
  })

  test("adds affected identities for add operation", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const receipt = makeReceipt("test-group-001", 0, 1, "add", ["alice", "bob"])

    const updated = recordEpochTransition(active, receipt)

    expect(updated.memberCount).toBe(2)
    expect(updated.memberIdentities).toContain("alice")
    expect(updated.memberIdentities).toContain("bob")
  })

  test("removes affected identities for remove operation", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const addReceipt = makeReceipt("test-group-001", 0, 1, "add", ["alice", "bob"])
    const withMembers = recordEpochTransition(active, addReceipt)

    const removeReceipt = makeReceipt("test-group-001", 1, 2, "remove", ["alice"])
    const updated = recordEpochTransition(withMembers, removeReceipt)

    expect(updated.currentEpoch).toBe(2)
    expect(updated.memberCount).toBe(1)
    expect(updated.memberIdentities).not.toContain("alice")
    expect(updated.memberIdentities).toContain("bob")
    expect(updated.epochHistory).toHaveLength(2)
  })

  test("completes epoch_transition state", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const transitioning = transitionGroupState(active, "epoch_transition")
    const receipt = makeReceipt("test-group-001", 0, 1, "add", ["member-001"])

    const updated = recordEpochTransition(transitioning, receipt)

    expect(updated.state).toBe("active")
    expect(updated.currentEpoch).toBe(1)
  })

  test("throws from suspended state", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const suspended = transitionGroupState(active, "suspended")
    const receipt = makeReceipt("test-group-001", 0, 1)

    expect(() => recordEpochTransition(suspended, receipt)).toThrow(
      /Cannot record epoch transition from state/,
    )
  })

  test("throws on epoch mismatch", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const receipt = makeReceipt("test-group-001", 5, 6, "add", ["member-001"])

    expect(() => recordEpochTransition(active, receipt)).toThrow(
      /Epoch mismatch/,
    )
  })

  test("throws on non-increasing epoch", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const receipt1 = makeReceipt("test-group-001", 0, 1, "add", ["member-001"])
    const updated = recordEpochTransition(active, receipt1)

    const badReceipt = makeReceipt("test-group-001", 1, 0, "add", ["member-002"])
    expect(() => recordEpochTransition(updated, badReceipt)).toThrow(
      /must be > currentEpoch/,
    )
  })
})

// ── Tests: addMember ─────────────────────────────────────────────────────

describe("addMember", () => {
  test("adds a member to the group", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const updated = addMember(active, "alice")

    expect(updated.memberCount).toBe(1)
    expect(updated.memberIdentities).toEqual(["alice"])
  })

  test("is idempotent for duplicate members", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const once = addMember(active, "alice")
    const twice = addMember(once, "alice")

    expect(twice.memberCount).toBe(1)
    expect(twice.memberIdentities).toEqual(["alice"])
  })

  test("adds multiple members", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const withAlice = addMember(active, "alice")
    const withBob = addMember(withAlice, "bob")

    expect(withBob.memberCount).toBe(2)
    expect(withBob.memberIdentities).toEqual(["alice", "bob"])
  })

  test("throws when group is not active", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    expect(() => addMember(lifecycle, "alice")).toThrow(
      /Cannot add member when group is creating/,
    )

    const active = transitionGroupState(lifecycle, "active")
    const suspended = transitionGroupState(active, "suspended")
    expect(() => addMember(suspended, "bob")).toThrow(
      /Cannot add member when group is suspended/,
    )
  })
})

// ── Tests: removeMember ──────────────────────────────────────────────────

describe("removeMember", () => {
  test("removes a member from the group", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const withAlice = addMember(active, "alice")
    const updated = removeMember(withAlice, "alice")

    expect(updated.memberCount).toBe(0)
    expect(updated.memberIdentities).toEqual([])
  })

  test("is idempotent for non-members", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const updated = removeMember(active, "nonexistent")

    expect(updated.memberCount).toBe(0)
    expect(updated.memberIdentities).toEqual([])
  })

  test("does not affect other members", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const withAlice = addMember(active, "alice")
    const withBob = addMember(withAlice, "bob")
    const updated = removeMember(withBob, "alice")

    expect(updated.memberCount).toBe(1)
    expect(updated.memberIdentities).toEqual(["bob"])
  })

  test("throws when group is not active", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    expect(() => removeMember(lifecycle, "alice")).toThrow(
      /Cannot remove member when group is creating/,
    )
  })
})

// ── Tests: isMemberActive ────────────────────────────────────────────────

describe("isMemberActive", () => {
  test("returns true for current member", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const withAlice = addMember(active, "alice")

    expect(isMemberActive(withAlice, "alice")).toBe(true)
  })

  test("returns false for non-member", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")

    expect(isMemberActive(active, "alice")).toBe(false)
  })

  test("returns false after removal", () => {
    const lifecycle = createGroupLifecycle(makeDescriptor(), createDefaultMlsPolicy("session"))
    const active = transitionGroupState(lifecycle, "active")
    const withAlice = addMember(active, "alice")
    const withoutAlice = removeMember(withAlice, "alice")

    expect(isMemberActive(withoutAlice, "alice")).toBe(false)
  })
})

// ── Tests: canJoinDomain ────────────────────────────────────────────────

describe("canJoinDomain", () => {
  test("public domain allows anyone", () => {
    expect(canJoinDomain("public", "contributor")).toBe(true)
    expect(canJoinDomain("public", "anonymous")).toBe(true)
    expect(canJoinDomain("public", "")).toBe(true)
  })

  test("contributor domain requires contributor+", () => {
    expect(canJoinDomain("contributor", "contributor")).toBe(true)
    expect(canJoinDomain("contributor", "maintainer")).toBe(true)
    expect(canJoinDomain("contributor", "owner")).toBe(true)
    expect(canJoinDomain("contributor", "viewer")).toBe(false)
  })

  test("project domain requires maintainer+", () => {
    expect(canJoinDomain("project", "maintainer")).toBe(true)
    expect(canJoinDomain("project", "owner")).toBe(true)
    expect(canJoinDomain("project", "policy_controller")).toBe(true)
    expect(canJoinDomain("project", "contributor")).toBe(false)
  })

  test("session domain requires session_participant+", () => {
    expect(canJoinDomain("session", "session_participant")).toBe(true)
    expect(canJoinDomain("session", "owner")).toBe(true)
    expect(canJoinDomain("session", "maintainer")).toBe(true)
    expect(canJoinDomain("session", "contributor")).toBe(false)
  })

  test("export_recovery requires policy_controller+", () => {
    expect(canJoinDomain("export_recovery", "policy_controller")).toBe(true)
    expect(canJoinDomain("export_recovery", "owner")).toBe(true)
    expect(canJoinDomain("export_recovery", "maintainer")).toBe(false)
    expect(canJoinDomain("export_recovery", "contributor")).toBe(false)
  })
})

// ── Tests: getRequiredGroupCount ─────────────────────────────────────────

describe("getRequiredGroupCount", () => {
  test("returns 1 for 0 entries", () => {
    expect(getRequiredGroupCount(0)).toBe(1)
  })

  test("returns 1 for negative entries", () => {
    expect(getRequiredGroupCount(-5)).toBe(1)
  })

  test("returns 1 for up to 100,000 entries", () => {
    expect(getRequiredGroupCount(1)).toBe(1)
    expect(getRequiredGroupCount(100_000)).toBe(1)
  })

  test("returns 2 for 100,001 entries", () => {
    expect(getRequiredGroupCount(100_001)).toBe(2)
  })

  test("returns correct count for large numbers", () => {
    expect(getRequiredGroupCount(250_000)).toBe(3)
    expect(getRequiredGroupCount(500_000)).toBe(5)
    expect(getRequiredGroupCount(1_000_000)).toBe(10)
  })
})

// ── Integration ──────────────────────────────────────────────────────────────

describe("group lifecycle integration", () => {
  test("full lifecycle: create, add members, epoch transitions, suspend, dissolve", () => {
    const descriptor = makeDescriptor()
    const policy = createDefaultMlsPolicy("session")
    let group = createGroupLifecycle(descriptor, policy)

    // creating → active
    group = transitionGroupState(group, "active")
    expect(group.state).toBe("active")

    // Add members locally
    group = addMember(group, "alice")
    group = addMember(group, "bob")
    expect(group.memberCount).toBe(2)

    // Commit add via epoch transition
    const receipt1 = makeReceipt("test-group-001", 0, 1, "add", ["alice", "bob"])
    group = recordEpochTransition(group, receipt1)
    expect(group.currentEpoch).toBe(1)
    expect(group.memberCount).toBe(2)

    // Remove alice
    const receipt2 = makeReceipt("test-group-001", 1, 2, "remove", ["alice"])
    group = recordEpochTransition(group, receipt2)
    expect(group.currentEpoch).toBe(2)
    expect(group.memberCount).toBe(1)
    expect(isMemberActive(group, "alice")).toBe(false)
    expect(isMemberActive(group, "bob")).toBe(true)

    // Suspend
    group = transitionGroupState(group, "suspended")
    expect(group.state).toBe("suspended")

    // Resume
    group = transitionGroupState(group, "active")
    expect(group.state).toBe("active")

    // Dissolve
    group = transitionGroupState(group, "dissolved")
    expect(group.state).toBe("dissolved")

    // Terminal state — no further transitions
    expect(() => transitionGroupState(group, "active")).toThrow(
      /Invalid group state transition/,
    )

    // Epoch history recorded
    expect(group.epochHistory).toHaveLength(2)
  })
})
