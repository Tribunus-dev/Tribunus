/**
 * Prism Heterogeneous Memory Fabric — Placement Request Creation
 *
 * Pure functions for constructing and classifying placement requests.
 */

import type {
  PrismFabricPlacementRequest,
  PromptLengthClass,
  GenerationLengthClass,
  WorkloadClass,
  WorkloadPhase,
  LatencyPreference,
} from "./fabric-types"

// ── Prompt Length Classification Thresholds ───────────────────────────────────

const PROMPT_SHORT_MAX = 511
const PROMPT_MEDIUM_MAX = 2047
const PROMPT_LONG_MAX = 8191

const GENERATION_SHORT_MAX = 127
const GENERATION_MEDIUM_MAX = 1023

// ── Request Factory ───────────────────────────────────────────────────────────

/**
 * Create a fully populated placement request.
 */
export function createPlacementRequest(
  requestId: string,
  routeId: string,
  workload: WorkloadClass,
  modelDigest: string,
  tokenizerDigest: string,
  inputTokens: number,
  outputTokens: number,
): PrismFabricPlacementRequest {
  return {
    requestId,
    routeId,
    dharmaLeaseId: null,
    workloadClass: workload,
    modelArtifactDigest: modelDigest,
    tokenizerDigest,
    phase: "prefill",
    inputTokenCount: inputTokens,
    requestedOutputTokens: outputTokens,
    promptLengthClass: classifyPromptLength(inputTokens),
    generationLengthClass: classifyGenerationLength(outputTokens),
    latencyPreference: "standard",
    energyPreference: null,
    dataResidencyRequirements: [],
    allowedDevices: [],
    forbiddenDevices: [],
  }
}

// ── Lease Check ───────────────────────────────────────────────────────────────

/**
 * Check whether a placement request falls within a lease policy envelope.
 *
 * The `leasePolicy` opaque record may contain constraints that the fabric
 * layer applies when a dharma lease mediates resource access.  For now we
 * accept any request when the policy record is empty or when no lease is
 * active.
 */
export function isRequestWithinLease(
  request: PrismFabricPlacementRequest,
  leasePolicy: Record<string, unknown>,
): boolean {
  // No explicit lease → no constraint.
  if (request.dharmaLeaseId === null) return true

  // Empty policy means unrestricted.
  if (Object.keys(leasePolicy).length === 0) return true

  // When a lease policy exists, require input + output to stay under
  // an optional "maxTotalTokens" cap.
  const maxTotal = leasePolicy.maxTotalTokens as number | undefined
  if (maxTotal !== undefined) {
    const total = request.inputTokenCount + request.requestedOutputTokens
    if (total > maxTotal) return false
  }

  // Optionally check allowed workload classes.
  const allowedWorkloads = leasePolicy.allowedWorkloads as string[] | undefined
  if (allowedWorkloads !== undefined && !allowedWorkloads.includes(request.workloadClass)) {
    return false
  }

  return true
}

// ── Classification Helpers ────────────────────────────────────────────────────

/**
 * Classify a prompt (input) token count into a discrete class.
 */
export function classifyPromptLength(tokens: number): PromptLengthClass {
  if (tokens <= PROMPT_SHORT_MAX) return "short"
  if (tokens <= PROMPT_MEDIUM_MAX) return "medium"
  if (tokens <= PROMPT_LONG_MAX) return "long"
  return "very_long"
}

/**
 * Classify a generation (output) token count into a discrete class.
 */
export function classifyGenerationLength(tokens: number): GenerationLengthClass {
  if (tokens <= GENERATION_SHORT_MAX) return "short"
  if (tokens <= GENERATION_MEDIUM_MAX) return "medium"
  return "long"
}
