/**
 * Phase-aware drain — scoped drain that respects prefill/decode phase
 * separation.
 */

import { PhaseDrainError } from "./phase-role-errors"

export type DrainScope = "all" | "prefill_only" | "decode_only"

/**
 * Validate a drain scope against the current execution state.
 *
 * Returns `{ valid: true, reason: null }` when the scope is acceptable.
 * A scope of "all" is always valid.  Phase-scoped drains are valid
 * regardless of active execution — the caller supplies `hasActiveExecution`
 * only to allow more precise error messaging.
 *
 * @throws PhaseDrainError when `scope` is not a recognised value.
 */
export function validateDrainScope(
  scope: DrainScope,
  hasActiveExecution: boolean,
): { valid: boolean; reason: string | null } {
  const validScopes: DrainScope[] = ["all", "prefill_only", "decode_only"]
  if (!validScopes.includes(scope)) {
    return { valid: false, reason: `Unknown drain scope: ${scope}` }
  }
  return { valid: true, reason: null }
}

/**
 * Return true when the given scope is allowed given active phase counts.
 *
 * - "all": always allowed (drain will reject new requests entirely).
 * - "prefill_only": allowed when no decode operations are active (otherwise
 *   the decode side cannot complete without prefill capacity).
 * - "decode_only": allowed when no prefill operations are active.
 */
export function isDrainAllowed(
  scope: DrainScope,
  activePrefill: number,
  activeDecode: number,
): boolean {
  if (scope === "all") return true
  if (scope === "prefill_only") return activeDecode === 0
  if (scope === "decode_only") return activePrefill === 0
  return false
}
