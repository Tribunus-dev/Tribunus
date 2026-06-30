/**
 * Prism KV Handoff Receipt — creation, integrity verification, summary
 */

import crypto from "node:crypto"

import type {
  PrismKvHandoffRequest,
  PrismKvExportManifest,
  HandoffState,
  PrismKvHandoffReceipt,
} from "./handoff-types"

// ── Helpers ─────────────────────────────────────────────────────────────────

function hexDigest(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    hash = ((hash << 5) - hash + c) | 0
  }
  const unsigned = hash >>> 0
  return unsigned.toString(16).padStart(8, "0")
}

function receiptDigest(receipt: PrismKvHandoffReceipt): string {
  const parts = [
    receipt.receiptId,
    receipt.handoffId,
    receipt.sourceWorkerId,
    receipt.destinationWorkerId,
    receipt.manifestDigest,
    receipt.payloadDigest,
    receipt.finalState,
    String(receipt.totalDurationMs),
    receipt.emittedAt,
  ].join("|")
  return hexDigest(parts)
}

// ── Receipt Factory ─────────────────────────────────────────────────────────

export function createHandoffReceipt(
  request: PrismKvHandoffRequest,
  manifest: PrismKvExportManifest,
  finalState: HandoffState,
  durations: {
    exportMs?: number
    transferMs?: number
    importMs?: number
    totalMs: number
  },
  signatures: {
    sourceSig: string
    destSig?: string
    coordSig: string
  },
): PrismKvHandoffReceipt {
  const receiptId = `receipt-${crypto.randomUUID()}`
  const now = new Date().toISOString()

  const receipt: PrismKvHandoffReceipt = {
    receiptId,
    handoffId: request.handoffId,
    routeId: request.routeId,
    requestId: request.requestId,
    dharmaLeaseId: request.dharmaLeaseId,
    sessionId: request.sessionId,
    sourceWorkerId: request.sourceWorkerId,
    sourceWorkerInstanceId: request.sourceWorkerInstanceId,
    destinationWorkerId: request.destinationWorkerId,
    destinationWorkerInstanceId: request.destinationWorkerInstanceId,
    sourceKvNamespaceDigest: hexDigest(request.sourceKvNamespaceId),
    destinationKvNamespaceDigest: null,
    modelArtifactDigest: request.modelArtifactDigest,
    tokenizerDigest: request.tokenizerDigest,
    compatibilityDescriptorDigest: manifest.compatibilityDescriptorDigest,
    sourceComputeImageDigest: request.sourceComputeImageDigest,
    destinationComputeImageDigest: request.destinationComputeImageDigest,
    transferRepresentation: manifest.transferRepresentation,
    handoffMode: request.handoffMode,
    manifestDigest: hexDigest(manifest.manifestId + manifest.deterministicContentDigest),
    payloadDigest: hexDigest(manifest.deterministicContentDigest),
    byteLength: manifest.byteLength,
    sequenceLength: manifest.sequenceLength,
    pageCount: manifest.pageCount,
    sourceExportDurationMs: durations.exportMs ?? null,
    transferDurationMs: durations.transferMs ?? null,
    destinationImportDurationMs: durations.importMs ?? null,
    totalDurationMs: durations.totalMs,
    sourceDisposition: "pending",
    finalState,
    failureClass: null,
    emittedAt: now,
    sourceSignature: signatures.sourceSig,
    destinationSignature: signatures.destSig ?? null,
    coordinatorSignature: signatures.coordSig,
  }

  // Overwrite coordinatorSignature with the receipt digest (our "signature").
  receipt.coordinatorSignature = receiptDigest(receipt)

  return receipt
}

// ── Verification ────────────────────────────────────────────────────────────

export function verifyReceiptIntegrity(receipt: PrismKvHandoffReceipt): boolean {
  const expected = receiptDigest(receipt)
  return receipt.coordinatorSignature === expected
}

// ── Summary ─────────────────────────────────────────────────────────────────

export function getReceiptSummary(receipt: PrismKvHandoffReceipt): string {
  const mode = receipt.handoffMode
  const state = receipt.finalState
  const src = receipt.sourceWorkerId
  const dst = receipt.destinationWorkerId
  const dur = receipt.totalDurationMs
  const bytes = receipt.byteLength
  const id = receipt.handoffId.slice(0, 12)

  let base = `Handoff[${id}] ${mode} ${src}→${dst}: ${state} (${dur}ms, ${bytes}bytes)`

  if (receipt.failureClass) {
    base += ` FAIL=${receipt.failureClass}`
  }

  return base
}
