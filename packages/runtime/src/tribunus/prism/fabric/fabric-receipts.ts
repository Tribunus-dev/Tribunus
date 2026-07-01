/**
 * Prism Heterogeneous Memory Fabric — Execution Receipts
 *
 * Pure functions for constructing and managing execution receipts that
 * attest to KV-cache work performed on a selected device/memory domain
 * within the heterogeneous memory fabric.
 */

import type {
  PrismFabricExecutionReceipt,
  PrismMemoryTransportEdge,
  PrismMemoryDomainKind,
  WorkloadPhase,
  PrismFabricPlacementMode,
} from "./fabric-types"

// ── ID & Timestamp Helpers ──────────────────────────────────────────────────

let _receiptCounter = 0

/** Reset the receipt-id counter (exposed for tests). */
export function _resetReceiptCounter(): void {
  _receiptCounter = 0
}

function nextReceiptId(): string {
  return `receipt_${++_receiptCounter}`
}

function isoNow(): string {
  return new Date().toISOString()
}

// ── Receipt Factory ─────────────────────────────────────────────────────────

/**
 * Create a new `PrismFabricExecutionReceipt` recording a planned or completed
 * execution on a given device and memory domain.
 *
 * Fields that require explicit configuration (transport path, residency,
 * signature, etc.) are left as their zero values — use the companion
 * mutators to populate them.
 */
export function createFabricExecutionReceipt(
  requestId: string,
  routeId: string,
  deviceId: string,
  domainId: string,
  phase: WorkloadPhase,
  mode: PrismFabricPlacementMode,
): PrismFabricExecutionReceipt {
  return {
    receiptId: nextReceiptId(),
    requestId,
    routeId,
    dharmaLeaseId: null,
    sessionId: null,
    selectedDeviceId: deviceId,
    selectedMemoryDomainId: domainId,
    workloadPhase: phase,
    placementMode: mode,
    sourceMemoryDomainId: null,
    destinationMemoryDomainId: null,
    transportPath: [],
    transferRepresentation: null,
    transferredByteCount: null,
    transferDurationMs: null,
    modelArtifactDigest: "sha256:unset",
    computeImageDigest: "sha256:unset",
    targetCapabilitySignature: "unset",
    kvNamespaceDigest: null,
    kvResidencyBefore: null,
    kvResidencyAfter: null,
    cacheStatus: null,
    executionDurationMs: 0,
    peakSourceMemoryBytes: null,
    peakDestinationMemoryBytes: null,
    finalState: "pending",
    failureClass: null,
    emittedAt: isoNow(),
    signature: "",
  }
}

// ── Transport Path Attachment ───────────────────────────────────────────────

/**
 * Attach one or more transport edges to the receipt.  Replaces any
 * previously attached path.
 */
export function addTransportPath(
  receipt: PrismFabricExecutionReceipt,
  edges: PrismMemoryTransportEdge[],
): PrismFabricExecutionReceipt {
  return {
    ...receipt,
    transportPath: edges,
  }
}

// ── KV Residency Tracking ───────────────────────────────────────────────────

/**
 * Record KV-cache residency before and after execution.  Both values are
 * nullable — a `null` before means the KV was not resident on any tracked
 * domain, and a `null` after means it was freed.
 */
export function addKvResidency(
  receipt: PrismFabricExecutionReceipt,
  before: PrismMemoryDomainKind | null,
  after: PrismMemoryDomainKind | null,
): PrismFabricExecutionReceipt {
  return {
    ...receipt,
    kvResidencyBefore: before,
    kvResidencyAfter: after,
  }
}

// ── Signing ─────────────────────────────────────────────────────────────────

/**
 * Attach a cryptographic (or opaque) signature to the receipt.
 * Overwrites any existing signature.
 */
export function signReceipt(
  receipt: PrismFabricExecutionReceipt,
  signature: string,
): PrismFabricExecutionReceipt {
  return {
    ...receipt,
    signature,
  }
}

// ── Completeness Check ──────────────────────────────────────────────────────

/**
 * A receipt is considered "complete" when it has all mandatory fields
 * populated and appears ready for auditing or downstream consumption.
 *
 * Mandatory fields:
 * - receiptId, requestId, routeId: non-empty
 * - selectedDeviceId, selectedMemoryDomainId: non-empty
 * - workloadPhase: set
 * - placementMode: set
 * - emittedAt: non-empty ISO string
 * - executionDurationMs: >= 0
 * - finalState: one of the known terminal states
 * - signature: non-empty (must be signed)
 */
const TERMINAL_STATES = new Set([
  "pending",
  "completed",
  "failed",
  "cancelled",
  "abandoned",
  "evacuated",
])

export function isReceiptComplete(receipt: PrismFabricExecutionReceipt): boolean {
  if (!receipt.receiptId || receipt.receiptId.trim().length === 0) return false
  if (!receipt.requestId || receipt.requestId.trim().length === 0) return false
  if (!receipt.routeId || receipt.routeId.trim().length === 0) return false
  if (!receipt.selectedDeviceId || receipt.selectedDeviceId.trim().length === 0) return false
  if (!receipt.selectedMemoryDomainId || receipt.selectedMemoryDomainId.trim().length === 0)
    return false
  if (!receipt.workloadPhase) return false
  if (!receipt.placementMode) return false
  if (!receipt.emittedAt || receipt.emittedAt.trim().length === 0) return false
  if (receipt.executionDurationMs < 0) return false
  if (!TERMINAL_STATES.has(receipt.finalState)) return false
  if (!receipt.signature || receipt.signature.trim().length === 0) return false

  return true
}
