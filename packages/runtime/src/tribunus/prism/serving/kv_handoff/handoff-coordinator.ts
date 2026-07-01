/**
 * Prism KV Handoff — Handoff Coordinator
 *
 * Orchestrates the full prefill-to-decode handoff lifecycle using a transport
 * adapter and pure state-machine functions.  No real network I/O — all
 * side effects go through PrismKvTransportAdapter.
 */

import type {
  PrismKvExportManifest,
  PrismKvHandoffReceipt,
  PrismKvHandoffRequest,
  PrismKvTransportAdapter,
  HandoffState,
} from "./handoff-types"
import { createImportRecord, transitionImport } from "./destination-import"
import {
  createDispositionRecord,
  resolveDisposition,
} from "./source-disposition"
import { getRollbackState, shouldRollback, classifyRollbackReason } from "./handoff-rollback"

// ── Handoff Coordinator ─────────────────────────────────────────────────────

export class HandoffCoordinator {
  constructor(private readonly transport: PrismKvTransportAdapter) {}

  /**
   * Run the full happy-path handoff:
   *   authorize → validate source → validate dest → export → transfer → import → commit
   *
   * Returns a receipt on success, or a failed receipt + final state on error.
   */
  async executeHandoff(
    request: PrismKvHandoffRequest,
    sourceEligible: boolean,
    destEligible: boolean,
    compatible: boolean,
    manifest: PrismKvExportManifest,
  ): Promise<{ receipt: PrismKvHandoffReceipt | null; finalState: HandoffState }> {
    // ── Phase 1: Authorization & Validation ───────────────────────────────────
    if (!sourceEligible) {
      return this.buildFailureResult(request, "rejected")
    }
    if (!destEligible) {
      return this.buildFailureResult(request, "rejected")
    }
    if (!compatible) {
      return this.buildFailureResult(request, "rejected")
    }

    // ── Phase 2: Export Preparation ───────────────────────────────────────────
    const prepResult = await this.transport.prepareTransfer(
      request.handoffId,
      manifest,
    )
    if (!prepResult.prepared) {
      return this.buildFailureResult(request, "failed")
    }

    // ── Phase 3: Transfer ─────────────────────────────────────────────────────
    let transferResult: { transferred: boolean; payloadDigest: string; bytes: number }
    try {
      transferResult = await this.transport.transfer(request.handoffId)
    } catch {
      return this.buildFailureResult(request, "timeout")
    }
    if (!transferResult.transferred) {
      return this.buildFailureResult(request, "failed")
    }

    // ── Phase 4: Destination Import ───────────────────────────────────────────
    const importRecord = createImportRecord(
      request.handoffId,
      request.destinationWorkerId,
      request.destinationWorkerInstanceId,
    )
    const importActions = [
      "receive_payload",
      "validate_integrity",
      "validate_compatibility",
      "materialize_namespace",
      "activate",
      "acknowledge",
    ]
    let currentRecord = importRecord
    for (const action of importActions) {
      currentRecord = transitionImport(currentRecord, action)
    }

    // ── Phase 5: Acknowledge on transport ────────────────────────────────────
    const ackResult = await this.transport.acknowledgeImport(request.handoffId)
    if (!ackResult.acknowledged) {
      return this.buildFailureResult(request, "failed")
    }

    // ── Phase 6: Source Disposition ───────────────────────────────────────────
    const disposition = createDispositionRecord(
      request.handoffId,
      request.sourceWorkerId,
      request.sourceKvNamespaceId,
      request.sourceRetentionPolicy,
    )
    resolveDisposition(disposition, true, true)

    // ── Phase 7: Build Receipt ────────────────────────────────────────────────
    const receipt = this.buildReceipt(request, manifest, transferResult, "committed")

    return {
      receipt,
      finalState: "committed",
    }
  }

  /**
   * Run the rollback protocol.
   * Aborts any in-flight transfer, resolves state to rolled_back, and returns
   * a receipt documenting the failure.
   */
  async rollbackHandoff(
    request: PrismKvHandoffRequest,
    state: HandoffState,
    reason: string,
  ): Promise<{ receipt: PrismKvHandoffReceipt; finalState: HandoffState }> {
    await this.transport.abortTransfer(request.handoffId)

    const finalState = getRollbackState(state)
    const failureClass = shouldRollback(state) ? classifyRollbackReason(state) : null

    // Build a minimal receipt for the rollback
    const receipt: PrismKvHandoffReceipt = {
      receiptId: `rollback_${request.handoffId}`,
      handoffId: request.handoffId,
      routeId: request.routeId,
      requestId: request.requestId,
      dharmaLeaseId: request.dharmaLeaseId,
      sessionId: request.sessionId,
      sourceWorkerId: request.sourceWorkerId,
      sourceWorkerInstanceId: request.sourceWorkerInstanceId,
      destinationWorkerId: request.destinationWorkerId,
      destinationWorkerInstanceId: request.destinationWorkerInstanceId,
      sourceKvNamespaceDigest: "",
      destinationKvNamespaceDigest: null,
      modelArtifactDigest: request.modelArtifactDigest,
      tokenizerDigest: request.tokenizerDigest,
      compatibilityDescriptorDigest: "",
      sourceComputeImageDigest: request.sourceComputeImageDigest,
      destinationComputeImageDigest: request.destinationComputeImageDigest,
      transferRepresentation: "",
      handoffMode: request.handoffMode,
      manifestDigest: "",
      payloadDigest: "",
      byteLength: 0,
      sequenceLength: 0,
      pageCount: 0,
      sourceExportDurationMs: null,
      transferDurationMs: null,
      destinationImportDurationMs: null,
      totalDurationMs: 0,
      sourceDisposition: "released",
      finalState,
      failureClass,
      emittedAt: new Date().toISOString(),
      sourceSignature: "",
      destinationSignature: null,
      coordinatorSignature: reason,
    }

    return { receipt, finalState }
  }

  /**
   * Reconcile a degraded handoff — check transport status and attempt recovery.
   * This is a simulation-level reconciliation; it cannot fix real network
   * failures but can resolve timeouts where the transport later reports
   * a completed transfer.
   */
  async reconcileHandoff(
    request: PrismKvHandoffRequest,
  ): Promise<{ resolved: boolean; state: HandoffState }> {
    try {
      const status = await this.transport.getTransferStatus(request.handoffId)

      if (status.state === "completed") {
        return { resolved: true, state: "degraded_completed" }
      }

      return { resolved: false, state: "failed" }
    } catch {
      return { resolved: false, state: "timeout" }
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private buildFailureResult(
    request: PrismKvHandoffRequest,
    finalState: HandoffState,
  ): { receipt: null; finalState: HandoffState } {
    return { receipt: null, finalState }
  }

  private buildReceipt(
    request: PrismKvHandoffRequest,
    manifest: PrismKvExportManifest,
    transferResult: { payloadDigest: string; bytes: number },
    finalState: HandoffState,
  ): PrismKvHandoffReceipt {
    return {
      receiptId: `receipt_${request.handoffId}`,
      handoffId: request.handoffId,
      routeId: request.routeId,
      requestId: request.requestId,
      dharmaLeaseId: request.dharmaLeaseId,
      sessionId: request.sessionId,
      sourceWorkerId: request.sourceWorkerId,
      sourceWorkerInstanceId: request.sourceWorkerInstanceId,
      destinationWorkerId: request.destinationWorkerId,
      destinationWorkerInstanceId: request.destinationWorkerInstanceId,
      sourceKvNamespaceDigest: "sim_digest",
      destinationKvNamespaceDigest: "sim_digest",
      modelArtifactDigest: request.modelArtifactDigest,
      tokenizerDigest: request.tokenizerDigest,
      compatibilityDescriptorDigest: "sim_compat_digest",
      sourceComputeImageDigest: request.sourceComputeImageDigest,
      destinationComputeImageDigest: request.destinationComputeImageDigest,
      transferRepresentation: manifest.transferRepresentation,
      handoffMode: request.handoffMode,
      manifestDigest: manifest.deterministicContentDigest,
      payloadDigest: transferResult.payloadDigest,
      byteLength: transferResult.bytes,
      sequenceLength: manifest.sequenceLength,
      pageCount: manifest.pageCount,
      sourceExportDurationMs: 100,
      transferDurationMs: 200,
      destinationImportDurationMs: 150,
      totalDurationMs: 450,
      sourceDisposition: "retained",
      finalState,
      failureClass: null,
      emittedAt: new Date().toISOString(),
      sourceSignature: manifest.sourceSignature,
      destinationSignature: "sim_dest_sig",
      coordinatorSignature: "sim_coordinator_sig",
    }
  }
}
