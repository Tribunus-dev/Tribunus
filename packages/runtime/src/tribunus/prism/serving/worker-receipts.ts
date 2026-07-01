/**
 * Prism llm-d Worker — Usage Receipt Generation
 *
 * Pure functions for creating, validating, and digesting worker usage receipts.
 */

import type { PrismWorkerUsageReceipt, PrismWorkerRequest, PrismModelWorker, PrismRequestExecution } from "./worker-types"
import crypto from "node:crypto"

export interface CreateWorkerReceiptConfig {
  request: PrismWorkerRequest
  worker: PrismModelWorker
  execution: PrismRequestExecution
  inputTokens?: number
  outputTokens?: number
  prefillMs?: number
  decodeMs?: number
  totalMs: number
  peakMemoryBytes?: number
  kvStatus?: string
  executionState: string
  failureClass?: string
}

export function createWorkerReceipt(config: CreateWorkerReceiptConfig): PrismWorkerUsageReceipt {
  const { request, worker, execution } = config

  const digestPayload = `${worker.workerId}:${worker.workerInstanceId}:${config.totalMs}`
  const workerSignature = crypto.createHash("sha256").update(digestPayload).digest("hex")

  return {
    receiptId: crypto.randomUUID(),
    requestId: request.requestId,
    dharmaLeaseId: request.dharmaLeaseId,
    sessionId: request.sessionId,
    workerId: worker.workerId,
    workerInstanceId: worker.workerInstanceId,
    modelArtifactDigest: request.modelArtifactDigest,
    tokenizerDigest: "",
    computeImageDigest: execution.computeImageDigest,
    targetCapabilitySignature: execution.targetCapabilitySignature,
    workloadClass: request.workloadClass,
    inputDigest: request.inputDigest,
    outputDigest: null,
    inputTokenCount: config.inputTokens ?? null,
    outputTokenCount: config.outputTokens ?? null,
    prefillDurationMs: config.prefillMs ?? null,
    decodeDurationMs: config.decodeMs ?? null,
    totalDurationMs: config.totalMs,
    peakMemoryBytes: config.peakMemoryBytes ?? null,
    kvCacheStatus: config.kvStatus ?? null,
    executionState: config.executionState,
    failureClass: config.failureClass ?? null,
    emittedAt: new Date().toISOString(),
    workerSignature,
  }
}

const VALID_EXECUTION_STATES = new Set([
  "completed", "failed", "cancelled", "timeout",
])

export function isReceiptValid(receipt: PrismWorkerUsageReceipt): boolean {
  if (!receipt.receiptId || typeof receipt.receiptId !== "string") return false
  if (!receipt.requestId || typeof receipt.requestId !== "string") return false
  if (!receipt.workerId || typeof receipt.workerId !== "string") return false
  if (!receipt.workerInstanceId || typeof receipt.workerInstanceId !== "string") return false
  if (!receipt.modelArtifactDigest || typeof receipt.modelArtifactDigest !== "string") return false
  if (typeof receipt.totalDurationMs !== "number" || receipt.totalDurationMs < 0) return false
  if (!receipt.executionState || typeof receipt.executionState !== "string") return false
  if (!VALID_EXECUTION_STATES.has(receipt.executionState)) return false
  if (!receipt.emittedAt || typeof receipt.emittedAt !== "string") return false
  if (!receipt.workerSignature || typeof receipt.workerSignature !== "string") return false

  if (receipt.inputTokenCount !== null && (typeof receipt.inputTokenCount !== "number" || receipt.inputTokenCount < 0)) return false
  if (receipt.outputTokenCount !== null && (typeof receipt.outputTokenCount !== "number" || receipt.outputTokenCount < 0)) return false
  if (receipt.prefillDurationMs !== null && (typeof receipt.prefillDurationMs !== "number" || receipt.prefillDurationMs < 0)) return false
  if (receipt.decodeDurationMs !== null && (typeof receipt.decodeDurationMs !== "number" || receipt.decodeDurationMs < 0)) return false
  if (receipt.peakMemoryBytes !== null && (typeof receipt.peakMemoryBytes !== "number" || receipt.peakMemoryBytes < 0)) return false

  return true
}

export function getReceiptDigest(receipt: PrismWorkerUsageReceipt): string {
  const canonical = JSON.stringify(receipt, Object.keys(receipt).sort())
  return crypto.createHash("sha256").update(canonical).digest("hex")
}
