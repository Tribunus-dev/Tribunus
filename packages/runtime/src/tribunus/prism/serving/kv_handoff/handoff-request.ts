/**
 * Prism KV Handoff Protocol Simulation — Request Creation
 */

import type {
  PrismKvHandoffRequest,
  HandoffMode,
  SourceRetentionPolicy,
} from "./handoff-types"

const DEFAULT_DEADLINE_MS = 300_000 // 5 minutes

/**
 * Creates a new `PrismKvHandoffRequest` from the essential routing and
 * identity fields.  Remaining fields receive sensible defaults for the
 * simulation-only handoff protocol.
 */
export function createHandoffRequest(config: {
  routeId: string
  requestId: string
  executionId: string
  sourceWorkerId: string
  sourceInstanceId: string
  destWorkerId: string
  destInstanceId: string
  sourceNsId: string
  modelDigest: string
  tokenizerDigest: string
}): PrismKvHandoffRequest {
  const now = Date.now()
  return {
    handoffId: crypto.randomUUID(),
    routeId: config.routeId,
    requestId: config.requestId,
    executionId: config.executionId,
    sessionId: null,
    dharmaLeaseId: null,
    sourceWorkerId: config.sourceWorkerId,
    sourceWorkerInstanceId: config.sourceInstanceId,
    destinationWorkerId: config.destWorkerId,
    destinationWorkerInstanceId: config.destInstanceId,
    sourceKvNamespaceId: config.sourceNsId,
    modelArtifactDigest: config.modelDigest,
    tokenizerDigest: config.tokenizerDigest,
    sourceComputeImageDigest: "",
    destinationComputeImageDigest: "",
    handoffMode: "simulation_only" as HandoffMode,
    sourceRetentionPolicy:
      "retain_until_destination_commit" as SourceRetentionPolicy,
    requestedDeadlineAt: new Date(now + DEFAULT_DEADLINE_MS).toISOString(),
    requestedBy: config.sourceWorkerId,
    authorizationDigest: "",
    createdAt: new Date(now).toISOString(),
    signature: null,
  }
}

/**
 * Returns true when the request's deadline has passed.
 */
export function isRequestExpired(req: PrismKvHandoffRequest): boolean {
  return Date.now() > new Date(req.requestedDeadlineAt).getTime()
}

/**
 * Returns the ISO-8601 deadline string from the request.
 */
export function getDeadline(req: PrismKvHandoffRequest): string {
  return req.requestedDeadlineAt
}
