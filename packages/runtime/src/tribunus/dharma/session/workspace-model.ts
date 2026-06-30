/**
 * Dharma Session Authority — Workspace Mutation & Overlay Model
 *
 * Pure business logic for workspace mutations, overlays, approval state
 * transitions, and conflict detection.
 */

import type {
  WorkspaceMutation,
  WorkspaceOverlay,
  MutationKind,
  MutationApprovalState,
} from "./types"

// ── State Machine: Mutation Approval Transitions -----------------------------

/**
 * Valid mutation approval state transitions.
 *
 * Rules:
 *   pending  → accepted, rejected, conflict
 *   conflict → resolved, rejected
 *   resolved → accepted
 *   accepted and rejected are terminal (no outgoing transitions)
 */
export const VALID_MUTATION_TRANSITIONS: Record<
  MutationApprovalState,
  readonly MutationApprovalState[]
> = {
  pending: ["accepted", "rejected", "conflict"],
  accepted: [],
  rejected: [],
  conflict: ["resolved", "rejected"],
  resolved: ["accepted"],
} as const

export type MutationAction =
  | "accept"
  | "reject"
  | "detect_conflict"
  | "resolve"

/**
 * Check if a mutation approval transition is valid.
 */
export function isValidMutationTransition(
  current: MutationApprovalState,
  next: MutationApprovalState,
): boolean {
  const allowed = VALID_MUTATION_TRANSITIONS[current]
  if (!allowed) return false
  return allowed.includes(next)
}

/**
 * Apply an action to a mutation approval state to produce the next state.
 *
 * @throws {Error} If the action is not valid for the current state
 */
export function applyMutationAction(
  state: MutationApprovalState,
  action: MutationAction,
): MutationApprovalState {
  switch (state) {
    case "pending": {
      if (action === "accept") return "accepted"
      if (action === "reject") return "rejected"
      if (action === "detect_conflict") return "conflict"
      break
    }
    case "conflict": {
      if (action === "resolve") return "resolved"
      if (action === "reject") return "rejected"
      break
    }
    case "resolved": {
      if (action === "accept") return "accepted"
      break
    }
    case "accepted":
    case "rejected":
      // Terminal states — no action transitions out
      break
  }

  throw new Error(
    `Invalid action '${action}' for mutation approval state '${state}'`,
  )
}

// ── Mutation Factory ---------------------------------------------------------

/**
 * Create a new workspace mutation.
 */
export function createMutation(config: {
  sessionId: string
  actorIdentityPublicKey: string
  grantId: string
  mutationKind: MutationKind
  pathScope: string
  baseWorkspaceDigest: string
  overlayId?: string
  beforeDigest?: string
  patchDigest?: string
}): WorkspaceMutation {
  const mutationId = crypto.randomUUID()
  const now = new Date().toISOString()

  return {
    mutationId,
    sessionId: config.sessionId,
    actorIdentityPublicKey: config.actorIdentityPublicKey,
    overlayId: config.overlayId ?? null,
    grantId: config.grantId,
    baseWorkspaceDigest: config.baseWorkspaceDigest,
    targetWorkspaceDigest: null,
    mutationKind: config.mutationKind,
    pathScope: config.pathScope,
    beforeDigest: config.beforeDigest ?? null,
    afterDigest: null,
    patchDigest: config.patchDigest ?? null,
    approvalState: "pending",
    acceptedBy: null,
    acceptedAt: null,
    createdAt: now,
  }
}

// ── Overlay Factory ----------------------------------------------------------

/**
 * Create a new workspace overlay.
 */
export function createOverlay(config: {
  sessionId: string
  ownerIdentityPublicKey: string
  baseWorkspaceDigest: string
}): WorkspaceOverlay {
  const overlayId = crypto.randomUUID()

  return {
    overlayId,
    sessionId: config.sessionId,
    ownerIdentityPublicKey: config.ownerIdentityPublicKey,
    baseWorkspaceDigest: config.baseWorkspaceDigest,
    currentDigest: config.baseWorkspaceDigest,
    mutationCount: 0,
    createdAt: new Date().toISOString(),
  }
}

// ── Overlay State Updates ----------------------------------------------------

/**
 * Update overlay state after applying a mutation.
 * Returns a new overlay with the updated digest and incremented mutation count.
 */
export function updateOverlayAfterMutation(
  overlay: WorkspaceOverlay,
  newDigest: string,
): WorkspaceOverlay {
  return {
    ...overlay,
    currentDigest: newDigest,
    mutationCount: overlay.mutationCount + 1,
  }
}

// ── Conflict Detection -------------------------------------------------------

/**
 * Check for workspace conflict by comparing the mutation's base digest against
 * the current workspace digest.
 *
 * A mismatch means the mutation was created against an older version of the
 * workspace and cannot be applied cleanly.
 */
export function hasWorkspaceConflict(
  mutation: WorkspaceMutation,
  currentWorkspaceDigest: string,
): boolean {
  return mutation.baseWorkspaceDigest !== currentWorkspaceDigest
}

// ── Mutation Classification --------------------------------------------------

const DESTRUCTIVE_MUTATION_KINDS: Partial<Record<MutationKind, true>> = {
  file_delete: true,
  file_rename: true,
  patch_revert: true,
} as const

const BENIGN_MUTATION_KINDS: Partial<Record<MutationKind, true>> = {
  file_create: true,
  file_update: true,
  patch_apply: true,
  overlay_merge: true,
  dependency_manifest_update: true,
  generated_artifact_write: true,
} as const

/**
 * Check if a mutation kind is destructive.
 * Destructive mutations are those that delete, rename, or revert changes.
 */
export function isDestructiveMutation(kind: MutationKind): boolean {
  return DESTRUCTIVE_MUTATION_KINDS[kind] === true
}

/**
 * Check if a mutation kind requires explicit approval.
 * Destructive mutations require approval; benign ones may not.
 */
export function mutationRequiresApproval(kind: MutationKind): boolean {
  return DESTRUCTIVE_MUTATION_KINDS[kind] === true
}
