import type {
  PrismPhaseCapability,
  PrismWorkerCompatibilityEnvelopeV2,
  PrismWorkerRole,
  PhaseCoLocationPolicy,
} from "./phase-role-types"

// ── Capability Construction -------------------------------------------------

/**
 * Build a phase capability from core configuration values.
 */
export function createPhaseCapability(
  supported: boolean,
  enabled: boolean,
  maxOps: number,
  maxTokens: number,
  maxMemory: number,
): PrismPhaseCapability {
  return {
    supported,
    enabled,
    admissionState: enabled ? "open" : "closed",
    maximumConcurrentOperations: maxOps,
    maximumInputTokens: maxTokens,
    maximumOutputTokens: null,
    maximumRuntimeMs: 300_000,
    maximumMemoryBytes: maxMemory,
    preferredBatchSize: null,
    targetProfileDigest: "",
    computeImageProfileDigest: "",
  }
}

// ── Compatibility Envelope --------------------------------------------------

/**
 * Build a version 2 compatibility envelope for a worker.
 */
export function createCompatibilityEnvelopeV2(
  workerId: string,
  instanceId: string,
  roles: PrismWorkerRole[],
  prefillCap: PrismPhaseCapability,
  decodeCap: PrismPhaseCapability,
  coLocation: PhaseCoLocationPolicy,
): PrismWorkerCompatibilityEnvelopeV2 {
  return {
    workerId,
    workerInstanceId: instanceId,
    modelArtifactDigest: "",
    tokenizerDigest: "",
    modelFamily: "",
    workloadClasses: [],
    targetCapabilitySignature: "",
    computeImageDigest: "",
    precisionMode: "fp16",
    maximumContextLength: prefillCap.maximumInputTokens,
    maximumOutputTokens: decodeCap.maximumOutputTokens ?? 0,
    maximumConcurrentRequests: Math.max(
      prefillCap.maximumConcurrentOperations,
      decodeCap.maximumConcurrentOperations,
    ),
    kvEventVersion: 1,
    kvLocalityMode: "local",
    lifecycleState: "active",
    workerRoles: roles,
    prefillCapability: prefillCap,
    decodeCapability: decodeCap,
    prefillProfile: {
      profileDigest: "default",
      maximumContextTokens: prefillCap.maximumInputTokens,
      maximumPrefillBatchSize: 0,
      maximumPrefillConcurrency: 0,
      maximumPrefillMemoryBytes: prefillCap.maximumMemoryBytes,
      preferredPromptLengthBand: "short",
      estimatedPrefillTokensPerSecond: 0,
      supportsPrefixReuse: false,
      supportsPromptBatching: false,
      targetCapabilitySignature: "",
      computeImageDigest: "",
    },
    decodeProfile: {
      profileDigest: "default",
      maximumDecodeConcurrency: 0,
      maximumActiveKvNamespaces: 0,
      maximumOutputTokens: decodeCap.maximumOutputTokens ?? 0,
      preferredGenerationLengthBand: "short",
      estimatedDecodeTokensPerSecond: 0,
      supportsStreaming: false,
      supportsCancellation: false,
      supportsKvReuse: false,
      latencyClass: "interactive",
      targetCapabilitySignature: "",
      computeImageDigest: "",
    },
    phaseCoLocationPolicy: coLocation,
    prefillCapacity: prefillCap.enabled && prefillCap.supported ? 1 : 0,
    decodeCapacity: decodeCap.enabled && decodeCap.supported ? 1 : 0,
    supportsPhaseMetrics: true,
    supportsPhaseReceipts: true,
  }
}

// ── Eligibility Checks ------------------------------------------------------

const PREFILL_ROLES: Record<PrismWorkerRole, boolean> = {
  unified: true,
  prefill_preferred: true,
  prefill_only: true,
  decode_preferred: false,
  decode_only: false,
}

const DECODE_ROLES: Record<PrismWorkerRole, boolean> = {
  unified: true,
  decode_preferred: true,
  decode_only: true,
  prefill_preferred: false,
  prefill_only: false,
}

const END_TO_END_ROLES: Record<PrismWorkerRole, boolean> = {
  unified: true,
  prefill_preferred: true,
  decode_preferred: true,
  prefill_only: false,
  decode_only: false,
}

/**
 * Check whether a worker is eligible to handle a request that may require
 * prefill, decode, or both phases.
 *
 * Returns `{ eligible, reason }` where `reason` is non-null only when
 * `eligible` is false.
 */
export function isWorkerEligibleForRequest(
  env: PrismWorkerCompatibilityEnvelopeV2,
  requiresPrefill: boolean,
  requiresDecode: boolean,
): { eligible: boolean; reason: string | null } {
  const roles = env.workerRoles

  if (requiresPrefill && !roles.some(r => PREFILL_ROLES[r])) {
    return { eligible: false, reason: "Worker lacks a prefill-capable role" }
  }

  if (requiresDecode && !roles.some(r => DECODE_ROLES[r])) {
    return { eligible: false, reason: "Worker lacks a decode-capable role" }
  }

  if (requiresPrefill && !env.prefillCapability.enabled) {
    return { eligible: false, reason: "Worker prefill capability is not enabled" }
  }

  if (requiresDecode && !env.decodeCapability.enabled) {
    return { eligible: false, reason: "Worker decode capability is not enabled" }
  }

  return { eligible: true, reason: null }
}

/**
 * Returns `true` when a single role can handle both phases
 * (prefill *and* decode) on the same worker.
 */
export function isRoleRoutableForEndToEnd(role: PrismWorkerRole): boolean {
  return END_TO_END_ROLES[role] === true
}

/**
 * Returns `true` when at least one of the worker's advertised roles can
 * handle both prefill and decode end-to-end.
 */
export function canWorkerServeEndToEnd(
  env: PrismWorkerCompatibilityEnvelopeV2,
): boolean {
  return env.workerRoles.some(role => isRoleRoutableForEndToEnd(role))
}
