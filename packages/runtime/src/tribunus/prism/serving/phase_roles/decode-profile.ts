import type {
  PrismDecodeProfile,
  GenerationLengthBand,
  LatencyClass,
} from "./phase-role-types"

// ── Profile Construction ----------------------------------------------------

/**
 * Build a decode profile from operational parameters.
 */
export function createDecodeProfile(
  concurrency: number,
  maxKv: number,
  outputTokens: number,
  genBand: GenerationLengthBand,
  tokPerSec: number,
  latencyClass: LatencyClass,
): PrismDecodeProfile {
  return {
    profileDigest: "default",
    maximumDecodeConcurrency: concurrency,
    maximumActiveKvNamespaces: maxKv,
    maximumOutputTokens: outputTokens,
    preferredGenerationLengthBand: genBand,
    estimatedDecodeTokensPerSecond: tokPerSec,
    supportsStreaming: false,
    supportsCancellation: false,
    supportsKvReuse: false,
    latencyClass,
    targetCapabilitySignature: "",
    computeImageDigest: "",
  }
}

// ── Budget Checks -----------------------------------------------------------

/**
 * Check whether the decode profile has sufficient output-token and KV-namespace
 * budget for the required workload.
 */
export function isDecodeBudgetSufficient(
  profile: PrismDecodeProfile,
  requiredTokens: number,
  requiredKvNamespaces: number,
): boolean {
  return (
    profile.maximumOutputTokens >= requiredTokens &&
    profile.maximumActiveKvNamespaces >= requiredKvNamespaces
  )
}

// ── Length Classification ---------------------------------------------------

/**
 * Classify a generation token count into a length band.
 *
 * - short : < 256
 * - medium: < 1_024
 * - long  : >= 1_024
 */
export function getGenerationLengthBand(tokenCount: number): GenerationLengthBand {
  if (tokenCount < 256) return "short"
  if (tokenCount < 1_024) return "medium"
  return "long"
}
