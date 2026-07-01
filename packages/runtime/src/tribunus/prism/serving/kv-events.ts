/**
 * Prism llm-d Worker — KV Locality Event Creation + Publisher
 *
 * Pure functions for creating and validating KV cache locality events.
 */

import type { PrismKvEvent, PrismKvEventBatch, KvEventState, ResidencyLocation } from "./worker-types"
import crypto from "node:crypto"

export interface CreateKvEventConfig {
  workerId: string
  instanceId: string
  modelDigest: string
  tokenizerDigest: string
  prefixDigest: string
  namespaceId: string
  location: ResidencyLocation
  tier: string
  bytes: number
  tokens?: number
  state: KvEventState
}

export function createKvEvent(config: CreateKvEventConfig): PrismKvEvent {
  return {
    eventId: crypto.randomUUID(),
    eventVersion: 1,
    workerId: config.workerId,
    workerInstanceId: config.instanceId,
    modelArtifactDigest: config.modelDigest,
    tokenizerDigest: config.tokenizerDigest,
    requestNamespace: config.namespaceId,
    prefixDigest: config.prefixDigest,
    kvNamespaceId: `${config.namespaceId}::${config.prefixDigest}`,
    localityKey: `${config.workerId}:${config.instanceId}:${config.prefixDigest}`,
    residencyLocation: config.location,
    residencyTier: config.tier,
    byteCount: config.bytes,
    tokenCount: config.tokens ?? null,
    state: config.state,
    emittedAt: new Date().toISOString(),
  }
}

export function createKvEventBatch(workerId: string, events: PrismKvEvent[]): PrismKvEventBatch {
  return {
    workerId,
    sequenceNumber: 0,
    emittedAt: new Date().toISOString(),
    events,
  }
}

export function isKvEventValid(event: PrismKvEvent): boolean {
  if (!event.eventId || typeof event.eventId !== "string") return false
  if (event.eventVersion < 1) return false
  if (!event.workerId || typeof event.workerId !== "string") return false
  if (!event.workerInstanceId || typeof event.workerInstanceId !== "string") return false
  if (!event.modelArtifactDigest || typeof event.modelArtifactDigest !== "string") return false
  if (!event.tokenizerDigest || typeof event.tokenizerDigest !== "string") return false
  if (!event.requestNamespace || typeof event.requestNamespace !== "string") return false
  if (!event.prefixDigest || typeof event.prefixDigest !== "string") return false
  if (!event.kvNamespaceId || typeof event.kvNamespaceId !== "string") return false
  if (!event.localityKey || typeof event.localityKey !== "string") return false
  if (!event.residencyLocation || typeof event.residencyLocation !== "string") return false
  if (!event.residencyTier || typeof event.residencyTier !== "string") return false
  if (typeof event.byteCount !== "number" || event.byteCount < 0) return false
  if (event.tokenCount !== null && (typeof event.tokenCount !== "number" || event.tokenCount < 0)) return false
  if (!event.state || typeof event.state !== "string") return false
  if (!event.emittedAt || typeof event.emittedAt !== "string") return false

  const validStates: KvEventState[] = ["stored", "touched", "reused", "evicted", "invalidated", "released"]
  if (!validStates.includes(event.state as KvEventState)) return false

  const validLocations: ResidencyLocation[] = ["device_local", "unified_memory", "host_memory", "durable_local_cache"]
  if (!validLocations.includes(event.residencyLocation as ResidencyLocation)) return false

  return true
}
