/**
 * Phase-aware usage receipt — scoped to prefill/decode separation with
 * per-phase worker and resource tracking.
 */

import { createHash } from "node:crypto"
import type { PrismPhaseUsageReceipt, PhaseFailureClass, PhaseCoLocationPolicy } from "./phase-role-types"

/**
 * Create a PrismPhaseUsageReceipt from the supplied configuration.
 */
export function createPhaseReceipt(config: {
  requestId: string
  routeId: string
  workerId: string
  instanceId: string
  prefillWorkerId: string
  decodeWorkerId: string
  coLocation: string
  modelDigest: string
  tokenizerDigest: string
  prefillComputeDigest: string
  decodeComputeDigest: string
  targetSig: string
  inputDigest: string
  outputDigest?: string
  inputTokens?: number
  outputTokens?: number
  prefillMs?: number
  decodeMs?: number
  totalMs: number
  prefillMem?: number
  decodeMem?: number
  kvDigest?: string
  kvStatus?: string
  execState: string
  failureClass?: PhaseFailureClass
}): PrismPhaseUsageReceipt {
  const now = new Date().toISOString()
  const raw = `${config.requestId}:${config.workerId}:${config.instanceId}:${now}`
  const receiptId = createHash("sha256").update(raw).digest("hex").slice(0, 16)

  const receipt: PrismPhaseUsageReceipt = {
    receiptId,
    requestId: config.requestId,
    routeId: config.routeId,
    dharmaLeaseId: null,
    sessionId: null,
    workerId: config.workerId,
    workerInstanceId: config.instanceId,
    prefillWorkerId: config.prefillWorkerId,
    decodeWorkerId: config.decodeWorkerId,
    phaseCoLocationPolicy: config.coLocation as PhaseCoLocationPolicy,
    modelArtifactDigest: config.modelDigest,
    tokenizerDigest: config.tokenizerDigest,
    prefillComputeImageDigest: config.prefillComputeDigest,
    decodeComputeImageDigest: config.decodeComputeDigest,
    targetCapabilitySignature: config.targetSig,
    inputDigest: config.inputDigest,
    outputDigest: config.outputDigest ?? null,
    inputTokenCount: config.inputTokens ?? null,
    outputTokenCount: config.outputTokens ?? null,
    prefillDurationMs: config.prefillMs ?? null,
    decodeDurationMs: config.decodeMs ?? null,
    totalDurationMs: config.totalMs,
    prefillPeakMemoryBytes: config.prefillMem ?? null,
    decodePeakMemoryBytes: config.decodeMem ?? null,
    kvNamespaceDigest: config.kvDigest ?? null,
    kvCacheStatus: config.kvStatus ?? null,
    executionState: config.execState,
    failureClass: config.failureClass ?? null,
    emittedAt: now,
    workerSignature: "",
  }

  // Build a deterministic signature over the receipt payload
  const sigPayload = [
    receipt.receiptId,
    receipt.requestId,
    receipt.routeId,
    receipt.workerId,
    receipt.workerInstanceId,
    receipt.totalDurationMs,
    receipt.executionState,
  ].join("|")
  receipt.workerSignature = createHash("sha256").update(sigPayload).digest("hex")

  return receipt
}

const VALID_EXECUTION_STATES: Record<string, true> = {
  completed: true, failed: true, cancelled: true, timeout: true, pending: true,
}

/**
 * Validate the structural integrity of a phase receipt.
 */
export function isPhaseReceiptValid(receipt: PrismPhaseUsageReceipt): boolean {
  if (!receipt.receiptId) return false
  if (!receipt.workerId) return false
  if (!receipt.workerSignature) return false
  if (receipt.totalDurationMs < 0) return false
  if (!VALID_EXECUTION_STATES[receipt.executionState]) return false
  if (receipt.inputTokenCount !== null && receipt.inputTokenCount < 0) return false
  if (receipt.outputTokenCount !== null && receipt.outputTokenCount < 0) return false
  if (receipt.prefillDurationMs !== null && receipt.prefillDurationMs < 0) return false
  if (receipt.decodeDurationMs !== null && receipt.decodeDurationMs < 0) return false
  if (receipt.prefillPeakMemoryBytes !== null && receipt.prefillPeakMemoryBytes < 0) return false
  if (receipt.decodePeakMemoryBytes !== null && receipt.decodePeakMemoryBytes < 0) return false
  return true
}

/**
 * Return a human-readable summary of a phase receipt.
 */
export function getPhaseReceiptSummary(receipt: PrismPhaseUsageReceipt): string {
  const parts: string[] = [
    `receipt:${receipt.receiptId}`,
    `request:${receipt.requestId}`,
    `worker:${receipt.workerId}`,
    `prefill:${receipt.prefillWorkerId}`,
    `decode:${receipt.decodeWorkerId}`,
    `state:${receipt.executionState}`,
    `total:${receipt.totalDurationMs}ms`,
  ]
  if (receipt.inputTokenCount !== null) parts.push(`in:${receipt.inputTokenCount}`)
  if (receipt.outputTokenCount !== null) parts.push(`out:${receipt.outputTokenCount}`)
  if (receipt.prefillDurationMs !== null) parts.push(`prefill_ms:${receipt.prefillDurationMs}`)
  if (receipt.decodeDurationMs !== null) parts.push(`decode_ms:${receipt.decodeDurationMs}`)
  if (receipt.kvNamespaceDigest) parts.push(`kv:${receipt.kvNamespaceDigest}`)
  if (receipt.failureClass) parts.push(`fail:${receipt.failureClass}`)
  return parts.join(" ")
}
