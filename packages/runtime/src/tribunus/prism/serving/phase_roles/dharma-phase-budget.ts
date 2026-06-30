/**
 * Dharma phase budget — computes per-phase budgets and validates
 * compatibility with worker capabilities and request requirements.
 */

import type {
  DharmaPrismPhaseBudget,
  PrismWorkerCompatibilityEnvelopeV2,
  PrismPhaseRequirements,
  PrismWorkerRole,
} from "./phase-role-types"

// Defaults when per-token estimates are unavailable
const DEFAULT_PREFILL_NS_PER_TOKEN = 250_000  // 250µs per input token
const DEFAULT_DECODE_NS_PER_TOKEN = 5_000_000  // 5ms per output token
const DEFAULT_PREFILL_MEM_PER_TOKEN = 512     // 512 bytes per input token
const DEFAULT_DECODE_MEM_PER_TOKEN = 256      // 256 bytes per output token (KV cache)

/**
 * Create a DharmaPrismPhaseBudget from input and output token estimates.
 *
 * Budgets are computed using conservative per-token resource estimates.
 * The budget always requires same-worker execution by default.
 */
export function createDharmaPhaseBudget(
  inputTokens: number,
  outputTokens: number,
): DharmaPrismPhaseBudget {
  const prefillMs = Math.ceil((inputTokens * DEFAULT_PREFILL_NS_PER_TOKEN) / 1_000_000)
  const decodeMs = Math.ceil((outputTokens * DEFAULT_DECODE_NS_PER_TOKEN) / 1_000_000)
  const prefillMem = inputTokens * DEFAULT_PREFILL_MEM_PER_TOKEN
  const decodeMem = outputTokens * DEFAULT_DECODE_MEM_PER_TOKEN

  return {
    maximumPrefillRuntimeMs: prefillMs,
    maximumDecodeRuntimeMs: decodeMs,
    maximumPrefillMemoryBytes: prefillMem,
    maximumDecodeMemoryBytes: decodeMem,
    maximumInputTokens: inputTokens,
    maximumOutputTokens: outputTokens,
    requireSameWorkerExecution: true,
    allowedWorkerRoles: ["unified", "prefill_preferred", "decode_preferred"],
    requiredLatencyClass: null,
  }
}

/**
 * Check whether the budget is compatible with a worker's capability
 * envelope.  Returns `{ compatible: true, reason: null }` when the worker
 * can serve the phase budget.
 */
export function isLeaseCompatibleWithPhase(
  budget: DharmaPrismPhaseBudget,
  env: PrismWorkerCompatibilityEnvelopeV2,
): { compatible: boolean; reason: string | null } {
  // The worker must support at least one allowed role
  const roleOverlap = budget.allowedWorkerRoles.some((r) => env.workerRoles.includes(r))
  if (!roleOverlap) {
    return {
      compatible: false,
      reason: `Worker roles ${env.workerRoles.join(",")} do not overlap with budget roles ${budget.allowedWorkerRoles.join(",")}`,
    }
  }

  // Input tokens must fit within the worker's maximum context
  if (budget.maximumInputTokens > env.maximumContextLength) {
    return {
      compatible: false,
      reason: `Budget input tokens ${budget.maximumInputTokens} exceed worker max context ${env.maximumContextLength}`,
    }
  }

  // Output tokens must fit within the worker's maximum
  if (budget.maximumOutputTokens > env.maximumOutputTokens) {
    return {
      compatible: false,
      reason: `Budget output tokens ${budget.maximumOutputTokens} exceed worker max output ${env.maximumOutputTokens}`,
    }
  }

  // Prefill runtime must fit within prefill capability
  if (
    budget.maximumPrefillRuntimeMs > env.prefillCapability.maximumRuntimeMs
  ) {
    return {
      compatible: false,
      reason: `Budget prefill runtime ${budget.maximumPrefillRuntimeMs}ms exceeds worker max ${env.prefillCapability.maximumRuntimeMs}ms`,
    }
  }

  // Prefill memory must fit within prefill capability
  if (
    budget.maximumPrefillMemoryBytes > env.prefillCapability.maximumMemoryBytes
  ) {
    return {
      compatible: false,
      reason: `Budget prefill memory ${budget.maximumPrefillMemoryBytes} exceeds worker max ${env.prefillCapability.maximumMemoryBytes}`,
    }
  }

  return { compatible: true, reason: null }
}

/**
 * Check whether a budget has sufficient capacity for the given phase
 * requirements.
 */
export function isPhaseBudgetSufficient(
  budget: DharmaPrismPhaseBudget,
  requirements: PrismPhaseRequirements,
): { sufficient: boolean; reason: string | null } {
  if (budget.maximumInputTokens < requirements.inputTokenCount) {
    return {
      sufficient: false,
      reason: `Budget input tokens ${budget.maximumInputTokens} < required ${requirements.inputTokenCount}`,
    }
  }
  if (budget.maximumOutputTokens < requirements.requestedOutputTokens) {
    return {
      sufficient: false,
      reason: `Budget output tokens ${budget.maximumOutputTokens} < required ${requirements.requestedOutputTokens}`,
    }
  }
  return { sufficient: true, reason: null }
}

/**
 * Return true when the budget requires prefill and decode to execute on
 * the same worker.
 */
export function isSameWorkerRequired(budget: DharmaPrismPhaseBudget): boolean {
  return budget.requireSameWorkerExecution
}
