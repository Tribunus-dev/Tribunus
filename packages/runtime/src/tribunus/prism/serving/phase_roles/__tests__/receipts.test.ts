/**
 * Tests — Phase-aware Usage Receipts
 */

import { describe, it, expect } from "bun:test"
import { createPhaseReceipt, isPhaseReceiptValid, getPhaseReceiptSummary } from "../phase-receipts"
import type { PhaseFailureClass } from "../phase-role-types"

const baseConfig = {
  requestId: "req-001",
  routeId: "route-001",
  workerId: "worker-a",
  instanceId: "inst-001",
  prefillWorkerId: "worker-a",
  decodeWorkerId: "worker-a",
  coLocation: "same_worker_required",
  modelDigest: "sha256-model-aaa",
  tokenizerDigest: "sha256-tok-bbb",
  prefillComputeDigest: "compute-prefill-v1",
  decodeComputeDigest: "compute-decode-v1",
  targetSig: "sig-v1",
  inputDigest: "sha256-input-xxx",
  totalMs: 1500,
  execState: "completed",
}

describe("createPhaseReceipt", () => {
  it("creates a receipt with all fields", () => {
    const r = createPhaseReceipt({
      ...baseConfig,
      outputDigest: "sha256-output-yyy",
      inputTokens: 512,
      outputTokens: 256,
      prefillMs: 500,
      decodeMs: 1000,
      prefillMem: 256_000,
      decodeMem: 128_000,
      kvDigest: "kv-pfx-xyz",
      kvStatus: "hit",
    })
    expect(r.receiptId).toBeTruthy()
    expect(r.requestId).toBe("req-001")
    expect(r.routeId).toBe("route-001")
    expect(r.workerId).toBe("worker-a")
    expect(r.workerInstanceId).toBe("inst-001")
    expect(r.prefillWorkerId).toBe("worker-a")
    expect(r.decodeWorkerId).toBe("worker-a")
    expect(r.phaseCoLocationPolicy).toBe("same_worker_required")
    expect(r.modelArtifactDigest).toBe("sha256-model-aaa")
    expect(r.tokenizerDigest).toBe("sha256-tok-bbb")
    expect(r.prefillComputeImageDigest).toBe("compute-prefill-v1")
    expect(r.decodeComputeImageDigest).toBe("compute-decode-v1")
    expect(r.targetCapabilitySignature).toBe("sig-v1")
    expect(r.inputDigest).toBe("sha256-input-xxx")
    expect(r.outputDigest).toBe("sha256-output-yyy")
    expect(r.inputTokenCount).toBe(512)
    expect(r.outputTokenCount).toBe(256)
    expect(r.prefillDurationMs).toBe(500)
    expect(r.decodeDurationMs).toBe(1000)
    expect(r.totalDurationMs).toBe(1500)
    expect(r.prefillPeakMemoryBytes).toBe(256_000)
    expect(r.decodePeakMemoryBytes).toBe(128_000)
    expect(r.kvNamespaceDigest).toBe("kv-pfx-xyz")
    expect(r.kvCacheStatus).toBe("hit")
    expect(r.executionState).toBe("completed")
    expect(r.failureClass).toBeNull()
    expect(r.emittedAt).toBeTruthy()
    expect(r.workerSignature).toMatch(/^[a-f0-9]{64}$/)
  })

  it("allows minimal fields with null optionals", () => {
    const r = createPhaseReceipt({
      ...baseConfig,
      execState: "failed",
      failureClass: "prefill_failed" as PhaseFailureClass,
    })
    expect(r.inputTokenCount).toBeNull()
    expect(r.outputTokenCount).toBeNull()
    expect(r.prefillDurationMs).toBeNull()
    expect(r.decodeDurationMs).toBeNull()
    expect(r.outputDigest).toBeNull()
    expect(r.prefillPeakMemoryBytes).toBeNull()
    expect(r.decodePeakMemoryBytes).toBeNull()
    expect(r.kvNamespaceDigest).toBeNull()
    expect(r.kvCacheStatus).toBeNull()
    expect(r.failureClass).toBe("prefill_failed")
  })

  it("accepts all valid execution states", () => {
    for (const state of ["completed", "failed", "cancelled", "timeout", "pending"]) {
      const r = createPhaseReceipt({ ...baseConfig, execState: state })
      expect(r.executionState).toBe(state)
    }
  })

  it("populates separate prefill and decode workers", () => {
    const r = createPhaseReceipt({
      ...baseConfig,
      prefillWorkerId: "worker-p",
      decodeWorkerId: "worker-d",
    })
    expect(r.prefillWorkerId).toBe("worker-p")
    expect(r.decodeWorkerId).toBe("worker-d")
  })
})

describe("isPhaseReceiptValid", () => {
  it("returns true for a well-formed receipt", () => {
    const r = createPhaseReceipt(baseConfig)
    expect(isPhaseReceiptValid(r)).toBe(true)
  })

  it("returns false when receiptId is missing", () => {
    const r = createPhaseReceipt(baseConfig)
    expect(isPhaseReceiptValid({ ...r, receiptId: "" })).toBe(false)
  })

  it("returns false when workerSignature is missing", () => {
    const r = createPhaseReceipt(baseConfig)
    expect(isPhaseReceiptValid({ ...r, workerSignature: "" })).toBe(false)
  })

  it("returns false when totalDurationMs is negative", () => {
    const r = createPhaseReceipt({ ...baseConfig, totalMs: -1 })
    expect(isPhaseReceiptValid(r)).toBe(false)
  })

  it("returns false when inputTokenCount is negative", () => {
    const r = createPhaseReceipt({ ...baseConfig, inputTokens: -5 })
    expect(isPhaseReceiptValid(r)).toBe(false)
  })

  it("returns false when outputTokenCount is negative", () => {
    const r = createPhaseReceipt({ ...baseConfig, outputTokens: -1 })
    expect(isPhaseReceiptValid(r)).toBe(false)
  })

  it("returns false when prefillDurationMs is negative", () => {
    const r = createPhaseReceipt({ ...baseConfig, prefillMs: -1 })
    expect(isPhaseReceiptValid(r)).toBe(false)
  })

  it("returns false when decodeDurationMs is negative", () => {
    const r = createPhaseReceipt({ ...baseConfig, decodeMs: -1 })
    expect(isPhaseReceiptValid(r)).toBe(false)
  })

  it("returns false when prefillMem is negative", () => {
    const r = createPhaseReceipt({ ...baseConfig, prefillMem: -1 })
    expect(isPhaseReceiptValid(r)).toBe(false)
  })

  it("returns false when decodeMem is negative", () => {
    const r = createPhaseReceipt({ ...baseConfig, decodeMem: -1 })
    expect(isPhaseReceiptValid(r)).toBe(false)
  })

  it("returns false for invalid execution state", () => {
    const r = createPhaseReceipt({ ...baseConfig, execState: "bogus" })
    expect(isPhaseReceiptValid(r)).toBe(false)
  })
})

describe("getPhaseReceiptSummary", () => {
  it("produces a concise summary string", () => {
    const r = createPhaseReceipt({
      ...baseConfig,
      inputTokens: 512,
      outputTokens: 256,
      prefillMs: 500,
      decodeMs: 1000,
      kvDigest: "kv-digest-abc",
    })
    const summary = getPhaseReceiptSummary(r)
    expect(summary).toContain("receipt:")
    expect(summary).toContain("req-001")
    expect(summary).toContain("worker-a")
    expect(summary).toContain("completed")
    expect(summary).toContain("1500ms")
    expect(summary).toContain("in:512")
    expect(summary).toContain("out:256")
    expect(summary).toContain("prefill_ms:500")
    expect(summary).toContain("decode_ms:1000")
    expect(summary).toContain("kv:kv-digest-abc")
  })

  it("includes failure class when present", () => {
    const r = createPhaseReceipt({
      ...baseConfig,
      execState: "failed",
      failureClass: "prefill_timeout" as PhaseFailureClass,
    })
    const summary = getPhaseReceiptSummary(r)
    expect(summary).toContain("fail:prefill_timeout")
  })

  it("omits optional fields when null", () => {
    const r = createPhaseReceipt(baseConfig)
    const summary = getPhaseReceiptSummary(r)
    expect(summary).not.toContain("in:")
    expect(summary).not.toContain("out:")
    expect(summary).not.toContain("fail:")
  })
})
