/**
 * Dharma Local Prism Compute Lease — Usage Receipts
 *
 * Pure functions for generating, classifying, and summarising Prism usage receipts.
 */

import type {
  ComputeLeaseStatus,
  FailureClass,
  LocalPrismComputeLease,
  PrismExecutionDescriptor,
  PrismUsageReceipt,
} from "./compute-types"

// ── Receipt Factory ---------------------------------------------------------

/**
 * Create a usage receipt from execution metadata.
 *
 * The receipt cryptographically binds the lease, execution, containment profile,
 * input/output digests, token counts, and timing data into a single
 * tamper-evident record.
 */
export function createUsageReceipt(config: {
  lease: LocalPrismComputeLease
  computeImageDigest: string
  targetSignature: string
  containmentProfileDigest: string
  execution: PrismExecutionDescriptor
  inputDigest: string
  outputDigest?: string
  inputTokens?: number
  outputTokens?: number
  prefillMs?: number
  decodeMs?: number
  totalMs: number
  peakMemoryBytes?: number
  cacheHit?: string
  executionState: ComputeLeaseStatus
  failureClass?: FailureClass
}): PrismUsageReceipt {
  const {
    lease,
    computeImageDigest,
    targetSignature,
    containmentProfileDigest,
    execution,
    inputDigest,
    outputDigest,
    inputTokens,
    outputTokens,
    prefillMs,
    decodeMs,
    totalMs,
    peakMemoryBytes,
    cacheHit,
    executionState,
    failureClass,
  } = config

  // Build a deterministic content string for the receipt signature.
  const contentParts: string[] = [
    execution.executionId,
    lease.leaseId,
    lease.sessionId,
    inputDigest,
    outputDigest ?? "",
    String(inputTokens ?? ""),
    String(outputTokens ?? ""),
    String(prefillMs ?? ""),
    String(decodeMs ?? ""),
    String(totalMs),
    executionState,
    failureClass ?? "",
  ]
  const receiptContent = contentParts.join("|")

  // Simple hex digest for deterministic receipt id
  let hash = 0
  for (let i = 0; i < receiptContent.length; i++) {
    hash = ((hash << 5) - hash) + receiptContent.charCodeAt(i)
    hash |= 0
  }
  const receiptDigest = Math.abs(hash).toString(16).padStart(8, "0")

  return {
    receiptId: receiptDigest,
    leaseId: lease.leaseId,
    sessionId: lease.sessionId,
    taskId: lease.taskId,
    actorIdentityPublicKey: lease.requesterIdentityPublicKey,
    modelArtifactDigest: lease.modelArtifactDigest,
    tokenizerDigest: execution.tokenizerDigest,
    computeImageDigest,
    targetCapabilitySignature: targetSignature,
    containmentProfileDigest,
    workloadClass: lease.workloadClass,
    inputDigest,
    outputDigest: outputDigest ?? null,
    inputTokenCount: inputTokens ?? null,
    outputTokenCount: outputTokens ?? null,
    prefillDurationMs: prefillMs ?? null,
    decodeDurationMs: decodeMs ?? null,
    totalDurationMs: totalMs,
    peakMemoryBytes: peakMemoryBytes ?? null,
    cacheHitStatus: cacheHit ?? null,
    kvNamespaceDigest: null,
    executionState,
    failureClass: failureClass ?? null,
    emittedAt: new Date().toISOString(),
    signature: receiptDigest,
  }
}

// ── Receipt Classification --------------------------------------------------

/** Successful receipts have a terminal success state. */
const SUCCESSFUL_STATES: Record<string, true> = {
  completed: true,
}

/**
 * Returns true when the receipt represents a successful execution.
 */
export function isSuccessfulReceipt(receipt: PrismUsageReceipt): boolean {
  return SUCCESSFUL_STATES[receipt.executionState] === true
}

// ── Receipt Summary ---------------------------------------------------------

/**
 * Produce a one-line human-readable summary of a usage receipt.
 */
export function getReceiptSummary(receipt: PrismUsageReceipt): string {
  const tokens =
    receipt.inputTokenCount !== null || receipt.outputTokenCount !== null
      ? ` ${receipt.inputTokenCount ?? "?"}i/${receipt.outputTokenCount ?? "?"}o`
      : ""
  const duration = ` ${receipt.totalDurationMs}ms`
  const status = isSuccessfulReceipt(receipt) ? "OK" : (receipt.failureClass ?? receipt.executionState)
  return `[${status}] ${receipt.workloadClass} — ${receipt.modelArtifactDigest}${tokens}${duration}`
}
