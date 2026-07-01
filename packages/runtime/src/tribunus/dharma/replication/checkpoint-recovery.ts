/**
 * Dharma Replication — Checkpoint Recovery
 *
 * Loads and applies checkpoints so the runtime can resume from the
 * last confirmed Autobase state without replaying the full event log.
 */

import type { FederationBase } from "./federation-base"

// ── Types --------------------------------------------------------------------

export interface CheckpointRecoveryResult {
  checkpointExists: boolean
  recovered: boolean
  lastOrderIndex: number
  recoveredAt: string
  error: string | null
}

// ── Recovery -----------------------------------------------------------------

/**
 * Attempt to recover from the last checkpoint stored in the federation base.
 *
 * When a checkpoint exists the returned `lastOrderIndex` indicates how many
 * ordered events have been confirmed — callers can skip replaying events
 * at or below this index.
 */
export async function recoverFromCheckpoint(
  federationBase: FederationBase,
): Promise<CheckpointRecoveryResult> {
  const recoveredAt = new Date().toISOString()

  try {
    const checkpoint = await federationBase.getCheckpoint()

    if (checkpoint === null) {
      return {
        checkpointExists: false,
        recovered: false,
        lastOrderIndex: 0,
        recoveredAt,
        error: null,
      }
    }

    return {
      checkpointExists: true,
      recovered: true,
      lastOrderIndex: checkpoint.signedLength,
      recoveredAt,
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      checkpointExists: false,
      recovered: false,
      lastOrderIndex: 0,
      recoveredAt,
      error: message,
    }
  }
}

/**
 * Returns true when a checkpoint existed and the runtime should skip
 * replaying events up to `lastOrderIndex`.
 */
export function isRecoveryNeeded(checkpointRecovery: CheckpointRecoveryResult): boolean {
  return checkpointRecovery.checkpointExists && checkpointRecovery.recovered && checkpointRecovery.lastOrderIndex > 0
}

/**
 * Return a human-readable summary of a checkpoint recovery attempt.
 */
export function getRecoverySummary(checkpointRecovery: CheckpointRecoveryResult): string {
  if (checkpointRecovery.error) {
    return `Checkpoint recovery failed: ${checkpointRecovery.error}`
  }
  if (!checkpointRecovery.checkpointExists) {
    return "No checkpoint found — starting from scratch"
  }
  if (checkpointRecovery.recovered) {
    return `Recovered from checkpoint at order index ${checkpointRecovery.lastOrderIndex} (${checkpointRecovery.recoveredAt})`
  }
  return `Checkpoint exists but recovery incomplete at order index ${checkpointRecovery.lastOrderIndex}`
}
