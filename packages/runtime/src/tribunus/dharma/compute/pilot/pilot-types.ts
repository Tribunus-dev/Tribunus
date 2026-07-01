/**
 * Dharma Trusted-LAN Pilot — Session types, constraints, and evidence bundles
 *
 * A "pilot" is a short-lived compute session run under the Trusted-LAN prism
 * to validate reproduction, refactors, benchmarks, documentation repair, model
 * backend compatibility, or hardware bringup. Each pilot records evidence
 * required to close a TRIBUNUS-MUTUAL-AID-PRODUCTION-PROOF ticket.
 */

// ── Session Type ------------------------------------------------------------

export type PilotSessionType =
  | "bug_reproduction" | "small_refactor" | "benchmark"
  | "documentation_repair" | "model_backend_compatibility" | "hardware_bringup"

// ── Session Configuration ---------------------------------------------------

export interface PilotSessionConfig {
  sessionId: string
  sessionType: PilotSessionType
  title: string
  description: string
  maxContributors: number
  allowedModelDigests: string[]
  allowedArtifactDigests: string[]
  allowedDisclosureClasses: string[]
  maxComputeBudgetMs: number
  maxDurationMs: number
  requireManualReview: boolean
  requireManualModeration: boolean
  createdAt: string
}

// ── Constraints -------------------------------------------------------------

export interface PilotConstraints {
  anonymousProviders: boolean
  publicComputeDiscovery: boolean
  modelAllowlist: boolean
  sourceDisclosureLimit: boolean
  computeBudget: boolean
  manualReview: boolean
  incognitoResults: boolean
  maxConcurrentTasks: number
}

// ── Evidence Bundle ---------------------------------------------------------

export interface PilotEvidenceBundle {
  sessionId: string
  sessionType: PilotSessionType
  contributorCount: number
  completionRate: number
  acceptedResultCount: number
  computeLeaseCompletionRate: number
  containmentIncidents: number
  recoveryEvents: number
  receiptValidationFailures: number
  totalDurationMs: number
  timeToFirstResultMs: number
}

// ── Helpers -----------------------------------------------------------------

function nowISO(): string {
  return new Date().toISOString()
}

// ── Default Constraints per type --------------------------------------------

const DEFAULT_CONSTRAINTS: Record<PilotSessionType, PilotConstraints> = {
  bug_reproduction: {
    anonymousProviders: false,
    publicComputeDiscovery: false,
    modelAllowlist: true,
    sourceDisclosureLimit: true,
    computeBudget: true,
    manualReview: false,
    incognitoResults: false,
    maxConcurrentTasks: 2,
  },
  small_refactor: {
    anonymousProviders: false,
    publicComputeDiscovery: false,
    modelAllowlist: true,
    sourceDisclosureLimit: true,
    computeBudget: true,
    manualReview: false,
    incognitoResults: false,
    maxConcurrentTasks: 3,
  },
  benchmark: {
    anonymousProviders: false,
    publicComputeDiscovery: false,
    modelAllowlist: true,
    sourceDisclosureLimit: false,
    computeBudget: true,
    manualReview: true,
    incognitoResults: true,
    maxConcurrentTasks: 4,
  },
  documentation_repair: {
    anonymousProviders: true,
    publicComputeDiscovery: false,
    modelAllowlist: false,
    sourceDisclosureLimit: false,
    computeBudget: false,
    manualReview: false,
    incognitoResults: false,
    maxConcurrentTasks: 5,
  },
  model_backend_compatibility: {
    anonymousProviders: false,
    publicComputeDiscovery: false,
    modelAllowlist: true,
    sourceDisclosureLimit: true,
    computeBudget: true,
    manualReview: true,
    incognitoResults: true,
    maxConcurrentTasks: 3,
  },
  hardware_bringup: {
    anonymousProviders: false,
    publicComputeDiscovery: true,
    modelAllowlist: true,
    sourceDisclosureLimit: true,
    computeBudget: true,
    manualReview: true,
    incognitoResults: true,
    maxConcurrentTasks: 2,
  },
}

// ── createPilotSession ------------------------------------------------------

/**
 * Build a new pilot session configuration with sensible defaults.
 *
 * @param sessionId  Unique identifier for this pilot session.
 * @param sessionType  Kind of pilot being run.
 * @param title  Short human-readable label.
 * @returns A fully populated `PilotSessionConfig`.
 */
export function createPilotSession(
  sessionId: string,
  sessionType: PilotSessionType,
  title: string,
): PilotSessionConfig {
  const defaults: Record<PilotSessionType, {
    maxContributors: number
    maxComputeBudgetMs: number
    maxDurationMs: number
    requireManualReview: boolean
    requireManualModeration: boolean
  }> = {
    bug_reproduction: {
      maxContributors: 3,
      maxComputeBudgetMs: 30_000,
      maxDurationMs: 600_000,
      requireManualReview: false,
      requireManualModeration: false,
    },
    small_refactor: {
      maxContributors: 3,
      maxComputeBudgetMs: 60_000,
      maxDurationMs: 1_800_000,
      requireManualReview: false,
      requireManualModeration: false,
    },
    benchmark: {
      maxContributors: 5,
      maxComputeBudgetMs: 120_000,
      maxDurationMs: 3_600_000,
      requireManualReview: true,
      requireManualModeration: false,
    },
    documentation_repair: {
      maxContributors: 5,
      maxComputeBudgetMs: 15_000,
      maxDurationMs: 300_000,
      requireManualReview: false,
      requireManualModeration: false,
    },
    model_backend_compatibility: {
      maxContributors: 4,
      maxComputeBudgetMs: 300_000,
      maxDurationMs: 3_600_000,
      requireManualReview: true,
      requireManualModeration: true,
    },
    hardware_bringup: {
      maxContributors: 6,
      maxComputeBudgetMs: 600_000,
      maxDurationMs: 7_200_000,
      requireManualReview: true,
      requireManualModeration: true,
    },
  }

  const d = defaults[sessionType]

  return {
    sessionId,
    sessionType,
    title,
    description: "",
    maxContributors: d.maxContributors,
    allowedModelDigests: [],
    allowedArtifactDigests: [],
    allowedDisclosureClasses: [],
    maxComputeBudgetMs: d.maxComputeBudgetMs,
    maxDurationMs: d.maxDurationMs,
    requireManualReview: d.requireManualReview,
    requireManualModeration: d.requireManualModeration,
    createdAt: nowISO(),
  }
}

// ── getDefaultConstraints ---------------------------------------------------

/**
 * Return the default constraints that apply to a given pilot session type.
 */
export function getDefaultConstraints(sessionType: PilotSessionType): PilotConstraints {
  return { ...DEFAULT_CONSTRAINTS[sessionType] }
}

// ── isSessionWithinConstraints ----------------------------------------------

/**
 * Check whether a session configuration is within the bounds of a constraint
 * set. Returns `allowed: true` when every checked constraint is satisfied,
 * together with an array of human-readable violation messages.
 */
export function isSessionWithinConstraints(
  config: PilotSessionConfig,
  constraints: PilotConstraints,
): { allowed: boolean; violations: string[] } {
  const violations: string[] = []

  if (constraints.modelAllowlist && config.allowedModelDigests.length === 0) {
    violations.push("modelAllowlist requires at least one allowed model digest")
  }

  if (constraints.computeBudget && config.maxComputeBudgetMs <= 0) {
    violations.push("computeBudget requires a positive maxComputeBudgetMs")
  }

  if (constraints.manualReview && !config.requireManualReview) {
    violations.push("manualReview constraint requires requireManualReview=true")
  }

  return {
    allowed: violations.length === 0,
    violations,
  }
}

// ── createEvidenceBundle ----------------------------------------------------

/**
 * Create an empty evidence bundle for a pilot session. All counters start at
 * zero; only the identity and type fields are populated.
 */
export function createEvidenceBundle(
  sessionId: string,
  sessionType: PilotSessionType,
): PilotEvidenceBundle {
  return {
    sessionId,
    sessionType,
    contributorCount: 0,
    completionRate: 0,
    acceptedResultCount: 0,
    computeLeaseCompletionRate: 0,
    containmentIncidents: 0,
    recoveryEvents: 0,
    receiptValidationFailures: 0,
    totalDurationMs: 0,
    timeToFirstResultMs: 0,
  }
}

// ── isPilotSuccessful -------------------------------------------------------

/**
 * Determine whether a pilot is considered successful based on accumulated
 * evidence. A pilot is successful when it meets all of the following criteria:
 *
 * - At least one acceptable result.
 * - Completion rate >= 0.7 (70 %).
 * - Compute lease completion rate >= 0.7.
 * - No containment incidents.
 * - Receipt validation failures < 3.
 */
export function isPilotSuccessful(bundle: PilotEvidenceBundle): boolean {
  return (
    bundle.acceptedResultCount >= 1 &&
    bundle.completionRate >= 0.7 &&
    bundle.computeLeaseCompletionRate >= 0.7 &&
    bundle.containmentIncidents === 0 &&
    bundle.receiptValidationFailures < 3
  )
}
