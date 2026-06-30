/**
 * Dharma Session Authority — Workspace Model Tests
 *
 * Tests for mutation creation, overlay management, approval state
 * transitions, and mutation classification.
 */

import { describe, test, expect } from "bun:test"
import {
  createMutation,
  createOverlay,
  updateOverlayAfterMutation,
  hasWorkspaceConflict,
  isDestructiveMutation,
  mutationRequiresApproval,
  isValidMutationTransition,
  applyMutationAction,
} from "../workspace-model"
import type {
  WorkspaceMutation,
  WorkspaceOverlay,
  MutationKind,
} from "../types"

// ── Helpers ------------------------------------------------------------------

const SESSION_ID = "session-123"
const ACTOR_KEY = "actor-public-key-abc"
const GRANT_ID = "grant-456"
const BASE_DIGEST = "digest-base-abc123"
const OVERLAY_OWNER_KEY = "overlay-owner-key-xyz"

function makeTestMutation(
  overrides?: Partial<WorkspaceMutation>,
): WorkspaceMutation {
  return {
    mutationId: "test-mutation-id",
    sessionId: SESSION_ID,
    actorIdentityPublicKey: ACTOR_KEY,
    overlayId: null,
    grantId: GRANT_ID,
    baseWorkspaceDigest: BASE_DIGEST,
    targetWorkspaceDigest: null,
    mutationKind: "file_create",
    pathScope: "/src",
    beforeDigest: null,
    afterDigest: null,
    patchDigest: null,
    approvalState: "pending",
    acceptedBy: null,
    acceptedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeTestOverlay(
  overrides?: Partial<WorkspaceOverlay>,
): WorkspaceOverlay {
  return {
    overlayId: "test-overlay-id",
    sessionId: SESSION_ID,
    ownerIdentityPublicKey: OVERLAY_OWNER_KEY,
    baseWorkspaceDigest: BASE_DIGEST,
    currentDigest: BASE_DIGEST,
    mutationCount: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── Tests: createMutation ----------------------------------------------------

describe("createMutation", () => {
  test("creates mutation with pending state", () => {
    const mutation = createMutation({
      sessionId: SESSION_ID,
      actorIdentityPublicKey: ACTOR_KEY,
      grantId: GRANT_ID,
      mutationKind: "file_create",
      pathScope: "/src",
      baseWorkspaceDigest: BASE_DIGEST,
    })

    expect(mutation.mutationId).toBeDefined()
    expect(mutation.mutationId.length).toBeGreaterThan(0)
    expect(mutation.sessionId).toBe(SESSION_ID)
    expect(mutation.actorIdentityPublicKey).toBe(ACTOR_KEY)
    expect(mutation.grantId).toBe(GRANT_ID)
    expect(mutation.mutationKind).toBe("file_create")
    expect(mutation.pathScope).toBe("/src")
    expect(mutation.baseWorkspaceDigest).toBe(BASE_DIGEST)
    expect(mutation.approvalState).toBe("pending")
    expect(mutation.overlayId).toBeNull()
    expect(mutation.targetWorkspaceDigest).toBeNull()
    expect(mutation.afterDigest).toBeNull()
    expect(mutation.beforeDigest).toBeNull()
    expect(mutation.patchDigest).toBeNull()
    expect(mutation.acceptedBy).toBeNull()
    expect(mutation.acceptedAt).toBeNull()
    expect(mutation.createdAt).toBeDefined()
  })

  test("creates mutation with optional overlay and digest fields", () => {
    const mutation = createMutation({
      sessionId: SESSION_ID,
      actorIdentityPublicKey: ACTOR_KEY,
      grantId: GRANT_ID,
      mutationKind: "file_update",
      pathScope: "/src/main.ts",
      baseWorkspaceDigest: BASE_DIGEST,
      overlayId: "overlay-789",
      beforeDigest: "before-digest",
      patchDigest: "patch-digest",
    })

    expect(mutation.overlayId).toBe("overlay-789")
    expect(mutation.beforeDigest).toBe("before-digest")
    expect(mutation.patchDigest).toBe("patch-digest")
  })
})

// ── Tests: createOverlay -----------------------------------------------------

describe("createOverlay", () => {
  test("creates overlay with base digest", () => {
    const overlay = createOverlay({
      sessionId: SESSION_ID,
      ownerIdentityPublicKey: OVERLAY_OWNER_KEY,
      baseWorkspaceDigest: BASE_DIGEST,
    })

    expect(overlay.overlayId).toBeDefined()
    expect(overlay.overlayId.length).toBeGreaterThan(0)
    expect(overlay.sessionId).toBe(SESSION_ID)
    expect(overlay.ownerIdentityPublicKey).toBe(OVERLAY_OWNER_KEY)
    expect(overlay.baseWorkspaceDigest).toBe(BASE_DIGEST)
    expect(overlay.currentDigest).toBe(BASE_DIGEST)
    expect(overlay.mutationCount).toBe(0)
    expect(overlay.createdAt).toBeDefined()
  })
})

// ── Tests: updateOverlayAfterMutation ----------------------------------------

describe("updateOverlayAfterMutation", () => {
  test("updates digest and increments mutation count", () => {
    const overlay = makeTestOverlay({ mutationCount: 5 })
    const newDigest = "digest-after-mutation"

    const updated = updateOverlayAfterMutation(overlay, newDigest)

    expect(updated.currentDigest).toBe(newDigest)
    expect(updated.mutationCount).toBe(6)
    // Unchanged fields
    expect(updated.overlayId).toBe(overlay.overlayId)
    expect(updated.sessionId).toBe(overlay.sessionId)
    expect(updated.baseWorkspaceDigest).toBe(overlay.baseWorkspaceDigest)
    expect(updated.createdAt).toBe(overlay.createdAt)
  })

  test("does not mutate the original overlay", () => {
    const overlay = makeTestOverlay({ mutationCount: 3 })
    const originalCount = overlay.mutationCount
    const originalDigest = overlay.currentDigest

    updateOverlayAfterMutation(overlay, "new-digest")

    expect(overlay.currentDigest).toBe(originalDigest)
    expect(overlay.mutationCount).toBe(originalCount)
  })
})

// ── Tests: hasWorkspaceConflict ----------------------------------------------

describe("hasWorkspaceConflict", () => {
  test("returns true on digest mismatch", () => {
    const mutation = makeTestMutation({ baseWorkspaceDigest: "digest-A" })
    expect(hasWorkspaceConflict(mutation, "digest-B")).toBe(true)
  })

  test("returns false when digests match", () => {
    const mutation = makeTestMutation({ baseWorkspaceDigest: "digest-A" })
    expect(hasWorkspaceConflict(mutation, "digest-A")).toBe(false)
  })
})

// ── Tests: isDestructiveMutation ---------------------------------------------

describe("isDestructiveMutation", () => {
  const destructiveKinds: MutationKind[] = ["file_delete", "file_rename", "patch_revert"]
  const benignKinds: MutationKind[] = [
    "file_create",
    "file_update",
    "patch_apply",
    "overlay_merge",
    "dependency_manifest_update",
    "generated_artifact_write",
  ]

  test("returns true for delete mutations", () => {
    for (const kind of destructiveKinds) {
      expect(isDestructiveMutation(kind)).toBe(true)
    }
  })

  test("returns false for benign mutations", () => {
    for (const kind of benignKinds) {
      expect(isDestructiveMutation(kind)).toBe(false)
    }
  })
})

// ── Tests: mutationRequiresApproval ------------------------------------------

describe("mutationRequiresApproval", () => {
  test("returns true for destructive mutations", () => {
    expect(mutationRequiresApproval("file_delete")).toBe(true)
    expect(mutationRequiresApproval("file_rename")).toBe(true)
    expect(mutationRequiresApproval("patch_revert")).toBe(true)
  })

  test("returns false for benign mutations", () => {
    expect(mutationRequiresApproval("file_create")).toBe(false)
    expect(mutationRequiresApproval("file_update")).toBe(false)
    expect(mutationRequiresApproval("patch_apply")).toBe(false)
    expect(mutationRequiresApproval("overlay_merge")).toBe(false)
    expect(mutationRequiresApproval("dependency_manifest_update")).toBe(false)
    expect(mutationRequiresApproval("generated_artifact_write")).toBe(false)
  })
})

// ── Tests: isValidMutationTransition -----------------------------------------

describe("isValidMutationTransition", () => {
  test("pending → accepted is valid", () => {
    expect(isValidMutationTransition("pending", "accepted")).toBe(true)
  })

  test("pending → rejected is valid", () => {
    expect(isValidMutationTransition("pending", "rejected")).toBe(true)
  })

  test("pending → conflict is valid", () => {
    expect(isValidMutationTransition("pending", "conflict")).toBe(true)
  })

  test("conflict → resolved is valid", () => {
    expect(isValidMutationTransition("conflict", "resolved")).toBe(true)
  })

  test("conflict → rejected is valid", () => {
    expect(isValidMutationTransition("conflict", "rejected")).toBe(true)
  })

  test("resolved → accepted is valid", () => {
    expect(isValidMutationTransition("resolved", "accepted")).toBe(true)
  })

  test("accepted → pending is invalid", () => {
    expect(isValidMutationTransition("accepted", "pending")).toBe(false)
  })

  test("rejected → accepted is invalid", () => {
    expect(isValidMutationTransition("rejected", "accepted")).toBe(false)
  })

  test("pending has no outgoing transitions when none defined", () => {
    // Verify all states that are NOT valid
    const invalidTargets: string[] = ["pending", "resolved"]
    for (const target of invalidTargets) {
      expect(isValidMutationTransition("pending", target as any)).toBe(false)
    }
  })
})

// ── Tests: applyMutationAction -----------------------------------------------

describe("applyMutationAction", () => {
  test("accept on pending returns accepted", () => {
    expect(applyMutationAction("pending", "accept")).toBe("accepted")
  })

  test("reject on pending returns rejected", () => {
    expect(applyMutationAction("pending", "reject")).toBe("rejected")
  })

  test("detect_conflict on pending returns conflict", () => {
    expect(applyMutationAction("pending", "detect_conflict")).toBe("conflict")
  })

  test("resolve on conflict returns resolved", () => {
    expect(applyMutationAction("conflict", "resolve")).toBe("resolved")
  })

  test("reject on conflict returns rejected", () => {
    expect(applyMutationAction("conflict", "reject")).toBe("rejected")
  })

  test("accept on resolved returns accepted", () => {
    expect(applyMutationAction("resolved", "accept")).toBe("accepted")
  })

  test("throws on invalid action for state", () => {
    expect(() => applyMutationAction("accepted", "reject")).toThrow()
    expect(() => applyMutationAction("pending", "resolve")).toThrow()
    expect(() => applyMutationAction("accepted", "accept")).toThrow()
  })
})
