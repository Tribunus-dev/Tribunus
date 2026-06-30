/**
 * Prism Phase Role Separation — Phase Request Requirements
 *
 * Pure functions for modeling and validating phase requirements against
 * a worker's compatibility envelope.
 */

import type {
  PrismPhaseRequirements,
  PrismWorkerCompatibilityEnvelopeV2,
  PromptLengthBand,
  GenerationLengthBand,
  LatencyClass,
} from "./phase-role-types"

// ── Token Class Thresholds ──────────────────────────────────────────────────

const PROMPT_LENGTH_BANDS: [number, PromptLengthBand][] = [
  [1024, "short"],
  [8192, "medium"],
  [32768, "long"],
  [Infinity, "very_long"],
]

const GENERATION_LENGTH_BANDS: [number, GenerationLengthBand][] = [
  [256, "short"],
  [2048, "medium"],
  [Infinity, "long"],
]

/**
 * Classify prompt token count into a PromptLengthBand.
 */
export function getPromptLengthClass(tokenCount: number): PromptLengthBand {
  for (const [threshold, band] of PROMPT_LENGTH_BANDS) {
    if (tokenCount <= threshold) return band
  }
  return "very_long"
}

/**
 * Classify generation token count into a GenerationLengthBand.
 */
export function getGenerationLengthClass(tokenCount: number): GenerationLengthBand {
  for (const [threshold, band] of GENERATION_LENGTH_BANDS) {
    if (tokenCount <= threshold) return band
  }
  return "long"
}

/**
 * Build a PrismPhaseRequirements from request-level parameters.
 *
 * Every request requires prefill. Decode is required when output tokens
 * are requested or streaming is enabled.
 */
export function createPhaseRequirements(
  inputTokens: number,
  outputTokens: number,
  stream: boolean,
): PrismPhaseRequirements {
  const requiredPrefill = true
  const requiredDecode = outputTokens > 0 || stream

  const latencyPreference: LatencyClass = stream ? "interactive" : "balanced"

  return {
    requiredPrefill,
    requiredDecode,
    inputTokenCount: inputTokens,
    requestedOutputTokens: outputTokens,
    stream,
    promptLengthClass: getPromptLengthClass(inputTokens),
    generationLengthClass: getGenerationLengthClass(outputTokens),
    latencyPreference,
    batchEligibility: !stream,
    deadlineAt: null,
  }
}

/**
 * Check whether a worker's compatibility envelope satisfies a request's
 * phase requirements.
 *
 * Returns `{ satisfied: true, reason: null }` on success, or
 * `{ satisfied: false, reason: "<description>" }` with the first
 * blocking deficiency.
 */
export function isPhaseRequirementsSatisfied(
  req: PrismPhaseRequirements,
  env: PrismWorkerCompatibilityEnvelopeV2,
): { satisfied: boolean; reason: string | null } {
  // Prefill capability must be supported and enabled
  if (req.requiredPrefill) {
    if (!env.prefillCapability.supported) {
      return { satisfied: false, reason: "Worker does not support prefill" }
    }
    if (!env.prefillCapability.enabled) {
      return { satisfied: false, reason: "Worker prefill is not enabled" }
    }
    if (req.inputTokenCount > env.maximumContextLength) {
      return {
        satisfied: false,
        reason: `Input tokens ${req.inputTokenCount} exceeds maximum context length ${env.maximumContextLength}`,
      }
    }
    if (req.inputTokenCount > env.prefillCapability.maximumInputTokens) {
      return {
        satisfied: false,
        reason: `Input tokens ${req.inputTokenCount} exceeds prefill max input ${env.prefillCapability.maximumInputTokens}`,
      }
    }
  }

  // Decode capability must be supported and enabled
  if (req.requiredDecode) {
    if (!env.decodeCapability.supported) {
      return { satisfied: false, reason: "Worker does not support decode" }
    }
    if (!env.decodeCapability.enabled) {
      return { satisfied: false, reason: "Worker decode is not enabled" }
    }
    if (req.requestedOutputTokens > env.maximumOutputTokens) {
      return {
        satisfied: false,
        reason: `Requested output tokens ${req.requestedOutputTokens} exceeds maximum ${env.maximumOutputTokens}`,
      }
    }
    if (req.stream && !env.decodeProfile.supportsStreaming) {
      return { satisfied: false, reason: "Worker does not support streaming" }
    }
  }

  return { satisfied: true, reason: null }
}
