/**
 * Execution Lifecycle
 *
 * Pure-function state machine for Prism execution stages and descriptor creation.
 */

import type {
  ComputeBudget,
  LocalPrismComputeLease,
  PrismExecutionDescriptor,
} from "./compute-types"

// ── Execution Stage ---------------------------------------------------------

export type ExecutionStage =
  | "pending"
  | "compiling"
  | "loading"
  | "prefill"
  | "decode"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled"

// ── Stage Transition Map ----------------------------------------------------
//
// Valid forward transitions between execution stages.
// Terminal stages (completed, failed, cancelled) have no onward edges.

const STAGE_TRANSITIONS: Record<ExecutionStage, readonly ExecutionStage[]> = {
  pending:    ["compiling", "failed", "cancelled"],
  compiling:  ["loading", "failed", "cancelled"],
  loading:    ["prefill", "failed", "cancelled"],
  prefill:    ["decode", "failed", "cancelled"],
  decode:     ["streaming", "failed", "cancelled"],
  streaming:  ["completed", "failed", "cancelled"],
  completed:  [],
  failed:     [],
  cancelled:  [],
}

/** Map from an action string to the target execution stage. */
const ACTION_STAGE_MAP: Record<string, ExecutionStage> = {
  compile:   "compiling",
  load:      "loading",
  prefill:   "prefill",
  decode:    "decode",
  stream:    "streaming",
  complete:  "completed",
  fail:      "failed",
  cancel:    "cancelled",
}

// ── Descriptor Factory ------------------------------------------------------

/**
 * Create a fully-resolved execution descriptor from a lease and resolved
 * compute image / target metadata.
 */
export function createExecutionDescriptor(config: {
  lease: LocalPrismComputeLease
  computeImageDigest: string
  targetSignature: string
  budget: ComputeBudget
}): PrismExecutionDescriptor {
  const { lease, computeImageDigest, targetSignature, budget } = config

  return {
    executionId: crypto.randomUUID(),
    leaseId: lease.leaseId,
    modelArtifactDigest: lease.modelArtifactDigest,
    tokenizerDigest: lease.modelArtifactDigest,
    computeImageDigest,
    targetCapabilitySignature: targetSignature,
    workloadClass: lease.workloadClass,
    inputReference: lease.inputReference ?? lease.inputDigest,
    maxTokens: lease.requestedMaxTokens ?? 4096,
    samplingPolicy: "default",
    outputSchema: null,
    executionBudget: budget,
    containmentContextDigest: lease.requiredContainmentLevel,
    sessionContextDigest: lease.sessionId,
  }
}

// ── Stage Transitions -------------------------------------------------------

/**
 * Transition an execution stage given an action string.
 * Returns the next stage if the transition is valid, or throws on invalid move.
 */
export function transitionExecutionStage(
  stage: ExecutionStage,
  action: string,
): ExecutionStage {
  const target = ACTION_STAGE_MAP[action]
  if (!target) {
    throw new Error(`Unknown execution action: "${action}"`)
  }

  const allowed = STAGE_TRANSITIONS[stage]
  if (!allowed.includes(target)) {
    throw new Error(
      `Invalid execution stage transition: ${stage} —"${action}"→ ${target} not allowed`,
    )
  }

  return target
}
