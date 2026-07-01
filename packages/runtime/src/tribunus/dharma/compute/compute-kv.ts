/**
 * KV Namespace Tracking
 *
 * Pure-function state machine for local KV namespace lifecycle within
 * a Prism compute session.
 */

import type { KvNamespaceState, LocalKvNamespace } from "./compute-types"

// ── State Machine -----------------------------------------------------------
//
//   allocated ──prime──→ primed ──decode──→ decoding ──sync──→ synchronized
//                         │                  │                 │
//                         │                  │                 │
//                         │     decode ←─────┘                 │
//                         │                                    │
//                         └──────────invalidate ←──────────────┘
//
// Any non-released state may transition to "released" via the release action.
// invalidated is terminal (only → released).

/** Valid onward transitions per state. */
export const VALID_KV_TRANSITIONS: Record<
  KvNamespaceState,
  readonly KvNamespaceState[]
> = {
  allocated:     ["primed", "released"],
  primed:        ["decoding", "invalidated", "released"],
  decoding:      ["synchronized", "invalidated", "released"],
  synchronized:  ["decoding", "invalidated", "released"],
  invalidated:   ["released"],
  released:      [],
}

/** Maps action strings to their target state. */
const KV_ACTION_TARGET: Record<KvAction, KvNamespaceState> = {
  prime:       "primed",
  decode:      "decoding",
  sync:        "synchronized",
  invalidate:  "invalidated",
  release:     "released",
}

// ── Action Type -------------------------------------------------------------

export type KvAction = "prime" | "decode" | "sync" | "invalidate" | "release"

// ── State Machine Application -----------------------------------------------

/**
 * Apply a named action to a KV namespace state.
 * Throws if the transition is not permitted by the state machine.
 */
export function applyKvAction(
  state: KvNamespaceState,
  action: KvAction,
): KvNamespaceState {
  const target = KV_ACTION_TARGET[action]
  const allowed = VALID_KV_TRANSITIONS[state]

  if (!allowed.includes(target)) {
    throw new Error(
      `Invalid KV namespace transition: ${state} —"${action}"→ ${target} not allowed`,
    )
  }

  return target
}

// ── Namespace Factory -------------------------------------------------------

/**
 * Create a new local KV namespace record for a compute lease.
 */
export function createKvNamespace(config: {
  sessionId: string
  leaseId: string
  modelDigest: string
  ownerIdentity: string
  prefixDigest: string
}): LocalKvNamespace {
  const { sessionId, leaseId, modelDigest, ownerIdentity, prefixDigest } =
    config
  const namespaceId = crypto.randomUUID()

  return {
    namespaceId,
    sessionId,
    leaseId,
    modelArtifactDigest: modelDigest,
    ownerIdentityPublicKey: ownerIdentity,
    prefixDigest,
    residencyTier: "local",
    createdAt: new Date().toISOString(),
    expiresAt: null,
    state: "allocated",
  }
}
