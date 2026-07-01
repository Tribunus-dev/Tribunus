/**
 * Tests — Handoff receipt creation, integrity, summary
 */

import { describe, it, expect } from "bun:test"
import { createHandoffReceipt, verifyReceiptIntegrity, getReceiptSummary } from "../handoff-receipts"
import type { PrismKvHandoffRequest, PrismKvExportManifest } from "../handoff-types"

// ── Fixtures ────────────────────────────────────────────────────────────────

const baseRequest: PrismKvHandoffRequest = {
  handoffId: "handoff-001",
  routeId: "route-abc",
  requestId: "req-001",
  executionId: "exec-001",
  sessionId: "session-7",
  dharmaLeaseId: "lease-42",
  sourceWorkerId: "worker-prefill-1",
  sourceWorkerInstanceId: "inst-p1",
  destinationWorkerId: "worker-decode-2",
  destinationWorkerInstanceId: "inst-d2",
  sourceKvNamespaceId: "ns-prefill-abc",
  modelArtifactDigest: "sha256-model-aaa",
  tokenizerDigest: "sha256-tok-bbb",
  sourceComputeImageDigest: "img-v1",
  destinationComputeImageDigest: "img-v1",
  handoffMode: "simulation_only",
  sourceRetentionPolicy: "retain_until_destination_commit",
  requestedDeadlineAt: "2025-06-01T00:00:00Z",
  requestedBy: "coordinator-1",
  authorizationDigest: "auth-digest-xyz",
  createdAt: "2025-06-01T00:00:00Z",
  signature: "sig-test",
}

const baseManifest: PrismKvExportManifest = {
  manifestId: "manifest-001",
  handoffId: "handoff-001",
  sourceWorkerId: "worker-prefill-1",
  sourceWorkerInstanceId: "inst-p1",
  sourceKvNamespaceId: "ns-prefill-abc",
  modelArtifactDigest: "sha256-model-aaa",
  tokenizerDigest: "sha256-tok-bbb",
  compatibilityDescriptorDigest: "cdd-001",
  transferRepresentation: "simulated_copy",
  sequenceLength: 4096,
  pageCount: 128,
  byteLength: 8_388_608,
  deterministicContentDigest: "dcd-abc",
  exportGeneration: 1,
  exportedAt: "2025-06-01T00:00:05Z",
  expiresAt: "2025-06-01T00:05:00Z",
  sourceSignature: "source-sig-001",
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("createHandoffReceipt", () => {
  it("creates a receipt with all fields populated", () => {
    const receipt = createHandoffReceipt(
      baseRequest,
      baseManifest,
      "completed",
      { exportMs: 120, transferMs: 50, importMs: 80, totalMs: 250 },
      { sourceSig: "src-sig", destSig: "dst-sig", coordSig: "coord-sig" },
    )

    expect(receipt.receiptId).toBeTruthy()
    expect(receipt.receiptId).toMatch(/^receipt-/)
    expect(receipt.handoffId).toBe("handoff-001")
    expect(receipt.requestId).toBe("req-001")
    expect(receipt.sourceWorkerId).toBe("worker-prefill-1")
    expect(receipt.destinationWorkerId).toBe("worker-decode-2")
    expect(receipt.sourceExportDurationMs).toBe(120)
    expect(receipt.transferDurationMs).toBe(50)
    expect(receipt.destinationImportDurationMs).toBe(80)
    expect(receipt.totalDurationMs).toBe(250)
    expect(receipt.byteLength).toBe(8_388_608)
    expect(receipt.finalState).toBe("completed")
    expect(receipt.failureClass).toBeNull()
    expect(receipt.emittedAt).toBeTruthy()
    expect(receipt.coordinatorSignature).toBeTruthy()
  })

  it("uses null for missing duration fields", () => {
    const receipt = createHandoffReceipt(
      baseRequest,
      baseManifest,
      "failed",
      { totalMs: 5000 },
      { sourceSig: "src-sig", coordSig: "coord-sig" },
    )

    expect(receipt.sourceExportDurationMs).toBeNull()
    expect(receipt.transferDurationMs).toBeNull()
    expect(receipt.destinationImportDurationMs).toBeNull()
    expect(receipt.totalDurationMs).toBe(5000)
    expect(receipt.destinationSignature).toBeNull()
    expect(receipt.finalState).toBe("failed")
  })
})

describe("verifyReceiptIntegrity", () => {
  it("returns true for a fresh receipt", () => {
    const receipt = createHandoffReceipt(
      baseRequest,
      baseManifest,
      "completed",
      { totalMs: 250 },
      { sourceSig: "src-sig", coordSig: "coord-sig" },
    )

    expect(verifyReceiptIntegrity(receipt)).toBeTrue()
  })

  it("returns false when the coordinator signature is tampered", () => {
    const receipt = createHandoffReceipt(
      baseRequest,
      baseManifest,
      "completed",
      { totalMs: 250 },
      { sourceSig: "src-sig", coordSig: "coord-sig" },
    )

    receipt.coordinatorSignature = "tampered"
    expect(verifyReceiptIntegrity(receipt)).toBeFalse()
  })
})

describe("getReceiptSummary", () => {
  it("produces a non-empty summary string", () => {
    const receipt = createHandoffReceipt(
      baseRequest,
      baseManifest,
      "completed",
      { totalMs: 250 },
      { sourceSig: "src-sig", coordSig: "coord-sig" },
    )

    const summary = getReceiptSummary(receipt)
    expect(summary).toBeTruthy()
    expect(summary).toContain("Handoff[")
    expect(summary).toContain("simulation_only")
    expect(summary).toContain("worker-prefill-1")
    expect(summary).toContain("worker-decode-2")
    expect(summary).toContain("completed")
    expect(summary).toContain("250ms")
  })

  it("includes failure class when present", () => {
    const receipt = createHandoffReceipt(
      baseRequest,
      baseManifest,
      "failed",
      { totalMs: 500 },
      { sourceSig: "src-sig", coordSig: "coord-sig" },
    )

    receipt.failureClass = "source_export_failed"
    const summary = getReceiptSummary(receipt)
    expect(summary).toContain("FAIL=source_export_failed")
  })
})
