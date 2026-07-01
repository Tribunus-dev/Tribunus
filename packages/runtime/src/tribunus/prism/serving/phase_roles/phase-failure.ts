/**
 * Phase failure classification — maps failure stage + reason to a
 * PhaseFailureClass and provides retry-policy helpers.
 */

import type { PhaseFailureClass } from "./phase-role-types"

/**
 * Map a stage ("prefill" or "decode") and a free-form reason to the most
 * specific PhaseFailureClass.
 *
 * When the reason matches a known budget / timeout / cancellation signal the
 * corresponding class is returned.  Otherwise a generic "failed" class is
 * used.
 */
export function classifyPhaseFailure(
  stage: string,
  reason: string,
): PhaseFailureClass {
  if (stage === "prefill") {
    if (/budget/i.test(reason)) return "prefill_budget_exceeded"
    if (/(?:timed|time)\s?out/i.test(reason)) return "prefill_timeout"
    if (/cancel/i.test(reason)) return "prefill_cancelled"
    return "prefill_failed"
  }
  if (stage === "decode") {
    if (/budget/i.test(reason)) return "decode_budget_exceeded"
    if (/(?:timed|time)\s?out/i.test(reason)) return "decode_timeout"
    if (/cancel/i.test(reason)) return "decode_cancelled"
    if (/kv.?invalid/i.test(reason)) return "decode_kv_invalid"
    if (/worker.?mismatch/i.test(reason)) return "decode_worker_mismatch"
    return "decode_failed"
  }
  // Fallback — caller supplied an unrecognised stage
  return "decode_failed"
}

/**
 * Return a retry policy for the given failure class and output-emitted flag.
 */
export function getFailureRetryPolicy(
  failure: PhaseFailureClass,
  outputEmitted: boolean,
): { retryable: boolean; reason: string } {
  if (outputEmitted) {
    const retryableAfter = isRetryableAfterOutput(failure)
    return {
      retryable: retryableAfter,
      reason: retryableAfter
        ? "Retryable after output emitted"
        : "Not retryable after output emitted",
    }
  }

  const retryableBefore = isRetryableBeforeOutput(failure)
  return {
    retryable: retryableBefore,
    reason: retryableBefore
      ? "Retryable before output emitted"
      : "Not retryable before output emitted",
  }
}

/**
 * Return true when the failure class is retryable if no output has been
 * emitted yet.
 *
 * Prefill failures, decode timeouts, decode budget exceeded, decode KV
 * invalid, and decode worker mismatch are retryable before output.
 */
export function isRetryableBeforeOutput(failure: PhaseFailureClass): boolean {
  switch (failure) {
    case "prefill_failed":
    case "prefill_budget_exceeded":
    case "prefill_timeout":
    case "prefill_cancelled":
    case "decode_timeout":
    case "decode_budget_exceeded":
    case "decode_kv_invalid":
    case "decode_worker_mismatch":
      return true
    case "decode_failed":
    case "decode_cancelled":
      return false
  }
}

/**
 * Return true when the failure class is retryable after output has been
 * emitted.
 *
 * Currently only prefill failures that don't affect emitted output are
 * retryable after output.
 */
export function isRetryableAfterOutput(failure: PhaseFailureClass): boolean {
  switch (failure) {
    case "prefill_failed":
    case "prefill_budget_exceeded":
    case "prefill_timeout":
      return true
    default:
      return false
  }
}
