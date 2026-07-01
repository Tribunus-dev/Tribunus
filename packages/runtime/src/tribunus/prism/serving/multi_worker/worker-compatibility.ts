/**
 * Prism Multi-Worker Router — Worker Compatibility Envelope & Filtering
 *
 * Pure functions for creating compatibility envelopes and checking
 * whether a worker satisfies a request's constraints.
 *
 * @module worker-compatibility
 */

import type { PrismWorkerCompatibilityEnvelope } from "./router-types.ts"

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a compatibility envelope from worker identity and capability parameters.
 *
 * The envelope summarises the artifact versions, workload classes, streaming,
 * context budget, and advanced features (drain, cancellation, dharma) — all
 * in one value object the router uses to filter candidates.
 */
export function createCompatibilityEnvelope(
  workerId: string,
  instanceId: string,
  modelDigest: string,
  tokenizerDigest: string,
  targetSig: string,
): PrismWorkerCompatibilityEnvelope {
  return {
    workerId,
    workerInstanceId: instanceId,
    modelArtifactDigest: modelDigest,
    tokenizerDigest,
    // Derived from the target signature in practice; here we use a
    // plausible family label so the envelope is self-describing.
    modelFamily: targetSig.split("/")[0] ?? "unknown",
    workloadClasses: ["chat_completion", "completion"],
    targetCapabilitySignature: targetSig,
    computeImageDigest: "",
    precisionMode: "fp16",
    maximumContextLength: 8192,
    maximumOutputTokens: 2048,
    maximumConcurrentRequests: 4,
    kvEventVersion: 1,
    kvLocalityMode: "device_local",
    supportsStreaming: true,
    supportsCancellation: true,
    supportsDrain: true,
    supportsDharmaCorrelation: false,
    lifecycleState: "ready",
  }
}

// ── Compatibility Predicates ────────────────────────────────────────────────

/**
 * Returns `true` when the worker's model artifact digest exactly matches the
 * required digest (artifact parity).
 */
export function isArtifactParityCompatible(
  env: PrismWorkerCompatibilityEnvelope,
  requiredDigest: string,
): boolean {
  return env.modelArtifactDigest === requiredDigest
}

/**
 * Returns `true` when the worker advertises support for the given workload
 * class (e.g. `"chat_completion"`, `"embedding"`).
 */
export function isWorkloadSupported(
  env: PrismWorkerCompatibilityEnvelope,
  workloadClass: string,
): boolean {
  return env.workloadClasses.includes(workloadClass)
}

/**
 * Returns `true` when the worker supports streaming — either because it is
 * not required (`required === false`) or because the worker advertises it.
 */
export function isStreamingSupported(
  env: PrismWorkerCompatibilityEnvelope,
  required: boolean,
): boolean {
  return !required || env.supportsStreaming
}

/**
 * Returns `true` when the worker's maximum context length is at least
 * `requiredTokens`.
 */
export function isContextBudgetSufficient(
  env: PrismWorkerCompatibilityEnvelope,
  requiredTokens: number,
): boolean {
  return env.maximumContextLength >= requiredTokens
}

/**
 * Returns `true` when the worker supports Dharma lease correlation via KV
 * events.
 */
export function isDharmaCorrelationSupported(
  env: PrismWorkerCompatibilityEnvelope,
): boolean {
  return env.supportsDharmaCorrelation
}

// ── Summary ─────────────────────────────────────────────────────────────────

/**
 * Produce a quick human-readable summary of the envelope's key compatibility
 * characteristics.
 */
export function getCompatibilitySummary(
  env: PrismWorkerCompatibilityEnvelope,
): string {
  const parts: string[] = [
    `worker=${env.workerId}`,
    `model=${env.modelFamily}`,
    `artifact=${env.modelArtifactDigest.slice(0, 12)}`,
    `ctx=${env.maximumContextLength}`,
    `stream=${env.supportsStreaming}`,
    `dharma=${env.supportsDharmaCorrelation}`,
  ]
  return parts.join(" ")
}
