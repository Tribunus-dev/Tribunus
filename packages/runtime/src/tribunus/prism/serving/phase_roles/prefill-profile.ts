import type {
  PrismPrefillProfile,
  PromptLengthBand,
} from "./phase-role-types"

// ── Profile Construction ----------------------------------------------------

/**
 * Build a prefill profile from operational parameters.
 */
export function createPrefillProfile(
  contextTokens: number,
  batchSize: number,
  concurrency: number,
  memory: number,
  promptBand: PromptLengthBand,
  tokPerSec: number,
): PrismPrefillProfile {
  return {
    profileDigest: "default",
    maximumContextTokens: contextTokens,
    maximumPrefillBatchSize: batchSize,
    maximumPrefillConcurrency: concurrency,
    maximumPrefillMemoryBytes: memory,
    preferredPromptLengthBand: promptBand,
    estimatedPrefillTokensPerSecond: tokPerSec,
    supportsPrefixReuse: false,
    supportsPromptBatching: false,
    targetCapabilitySignature: "",
    computeImageDigest: "",
  }
}

// ── Budget Checks -----------------------------------------------------------

/**
 * Check whether the prefill profile has sufficient token and memory budget
 * for the required workload.
 */
export function isPrefillBudgetSufficient(
  profile: PrismPrefillProfile,
  requiredTokens: number,
  requiredMemory: number,
): boolean {
  return (
    profile.maximumContextTokens >= requiredTokens &&
    profile.maximumPrefillMemoryBytes >= requiredMemory
  )
}

// ── Length Classification ---------------------------------------------------

/**
 * Classify a prompt token count into a length band.
 *
 * - short    : < 1_024
 * - medium   : < 4_096
 * - long     : < 16_384
 * - very_long: >= 16_384
 */
export function getPromptLengthBand(tokenCount: number): PromptLengthBand {
  if (tokenCount < 1_024) return "short"
  if (tokenCount < 4_096) return "medium"
  if (tokenCount < 16_384) return "long"
  return "very_long"
}
