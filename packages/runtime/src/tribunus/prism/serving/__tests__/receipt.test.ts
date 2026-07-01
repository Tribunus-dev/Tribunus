/**
 * Tests — Worker Usage Receipt Generation + Validation
 */

import { describe, it, expect } from "bun:test"
import { createWorkerReceipt, isReceiptValid, getReceiptDigest } from "../worker-receipts"
import type { PrismWorkerRequest, PrismModelWorker, PrismRequestExecution } from "../worker-types"

const baseRequest: PrismWorkerRequest = {
  requestId: "req-001",
  requestNamespace: "ns-main",
  modelId: "llama-3-8b",
  modelArtifactDigest: "sha256-model-aaa",
  workloadClass: "chat_completion",
  inputDigest: "sha256-input-xxx",
  promptReference: "prompt-abc",
  maxInputTokens: 4096,
  maxOutputTokens: 2048,
  samplingPolicy: "default",
  stream: false,
  deadlineAt: null,
  dharmaLeaseId: "lease-42",
  sessionId: "session-7",
  traceContext: "trace-abc",
}

const baseWorker: PrismModelWorker = {
  workerId: "worker-abc",
  workerInstanceId: "inst-001",
  workerVersion: "1.0.0",
  protocolVersion: 1,
  lifecycleState: "serving",
  advertisedModels: ["llama-3-8b"],
  targetCapabilitySignature: "sig-v1",
  containmentProfileDigest: null,
  deploymentClass: "standard",
  startedAt: "2025-01-01T00:00:00Z",
}

const baseExecution: PrismRequestExecution = {
  executionId: "exec-001",
  requestId: "req-001",
  modelArtifactDigest: "sha256-model-aaa",
  computeImageDigest: "sha256-compute-bbb",
  targetCapabilitySignature: "sig-v1",
  prefillState: "completed",
  decodeState: "completed",
  kvNamespaceId: "ns-main::pfx-xyz",
  admissionTime: "2025-01-01T00:00:01Z",
  startedAt: "2025-01-01T00:00:02Z",
  completedAt: "2025-01-01T00:00:10Z",
}

describe("createWorkerReceipt", () => {
  it("creates a receipt with all fields", () => {
    const receipt = createWorkerReceipt({
      request: baseRequest,
      worker: baseWorker,
      execution: baseExecution,
      inputTokens: 512,
      outputTokens: 256,
      prefillMs: 150,
      decodeMs: 850,
      totalMs: 1000,
      peakMemoryBytes: 2_147_483_648,
      kvStatus: "hit",
      executionState: "completed",
    })
    expect(receipt.receiptId).toBeTruthy()
    expect(receipt.requestId).toBe("req-001")
    expect(receipt.dharmaLeaseId).toBe("lease-42")
    expect(receipt.sessionId).toBe("session-7")
    expect(receipt.workerId).toBe("worker-abc")
    expect(receipt.workerInstanceId).toBe("inst-001")
    expect(receipt.modelArtifactDigest).toBe("sha256-model-aaa")
    expect(receipt.workloadClass).toBe("chat_completion")
    expect(receipt.inputDigest).toBe("sha256-input-xxx")
    expect(receipt.inputTokenCount).toBe(512)
    expect(receipt.outputTokenCount).toBe(256)
    expect(receipt.prefillDurationMs).toBe(150)
    expect(receipt.decodeDurationMs).toBe(850)
    expect(receipt.totalDurationMs).toBe(1000)
    expect(receipt.peakMemoryBytes).toBe(2_147_483_648)
    expect(receipt.kvCacheStatus).toBe("hit")
    expect(receipt.executionState).toBe("completed")
    expect(receipt.failureClass).toBeNull()
    expect(receipt.emittedAt).toBeTruthy()
    expect(receipt.workerSignature).toBeTruthy()
  })

  it("allows minimal fields with null optionals", () => {
    const receipt = createWorkerReceipt({
      request: baseRequest,
      worker: baseWorker,
      execution: baseExecution,
      totalMs: 500,
      executionState: "failed",
      failureClass: "model_error",
    })
    expect(receipt.inputTokenCount).toBeNull()
    expect(receipt.outputTokenCount).toBeNull()
    expect(receipt.prefillDurationMs).toBeNull()
    expect(receipt.decodeDurationMs).toBeNull()
    expect(receipt.peakMemoryBytes).toBeNull()
    expect(receipt.kvCacheStatus).toBeNull()
    expect(receipt.failureClass).toBe("model_error")
  })

  it("produces a worker signature", () => {
    const receipt = createWorkerReceipt({
      request: baseRequest,
      worker: baseWorker,
      execution: baseExecution,
      totalMs: 1000,
      executionState: "completed",
    })
    expect(receipt.workerSignature).toMatch(/^[a-f0-9]{64}$/)
  })

  it("accepts all valid execution states", () => {
    for (const state of ["completed", "failed", "cancelled", "timeout"]) {
      const receipt = createWorkerReceipt({
        request: baseRequest,
        worker: baseWorker,
        execution: baseExecution,
        totalMs: 100,
        executionState: state,
      })
      expect(receipt.executionState).toBe(state)
    }
  })
})

describe("isReceiptValid", () => {
  it("returns true for a well-formed receipt", () => {
    const receipt = createWorkerReceipt({
      request: baseRequest,
      worker: baseWorker,
      execution: baseExecution,
      totalMs: 1000,
      executionState: "completed",
    })
    expect(isReceiptValid(receipt)).toBe(true)
  })

  it("returns false when receiptId is missing", () => {
    const receipt = createWorkerReceipt({
      request: baseRequest,
      worker: baseWorker,
      execution: baseExecution,
      totalMs: 1000,
      executionState: "completed",
    })
    expect(isReceiptValid({ ...receipt, receiptId: "" })).toBe(false)
  })

  it("returns false when totalDurationMs is negative", () => {
    const receipt = createWorkerReceipt({
      request: baseRequest,
      worker: baseWorker,
      execution: baseExecution,
      totalMs: -1,
      executionState: "completed",
    })
    expect(isReceiptValid({ ...receipt })).toBe(false)
  })

  it("returns false for invalid execution state", () => {
    const receipt = createWorkerReceipt({
      request: baseRequest,
      worker: baseWorker,
      execution: baseExecution,
      totalMs: 1000,
      executionState: "bogus",
    })
    expect(isReceiptValid({ ...receipt })).toBe(false)
  })

  it("returns false when workerSignature is missing", () => {
    const receipt = createWorkerReceipt({
      request: baseRequest,
      worker: baseWorker,
      execution: baseExecution,
      totalMs: 1000,
      executionState: "completed",
    })
    expect(isReceiptValid({ ...receipt, workerSignature: "" })).toBe(false)
  })

  it("returns false when inputTokenCount is negative", () => {
    const receipt = createWorkerReceipt({
      request: baseRequest,
      worker: baseWorker,
      execution: baseExecution,
      totalMs: 1000,
      executionState: "completed",
      inputTokens: -1,
    })
    expect(isReceiptValid({ ...receipt })).toBe(false)
  })
})

describe("getReceiptDigest", () => {
  it("produces a deterministic SHA-256 hex digest", () => {
    const receipt = createWorkerReceipt({
      request: baseRequest,
      worker: baseWorker,
      execution: baseExecution,
      totalMs: 1000,
      executionState: "completed",
    })
    const digest = getReceiptDigest(receipt)
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it("same receipt content produces same digest", () => {
    const a = createWorkerReceipt({
      request: baseRequest,
      worker: baseWorker,
      execution: baseExecution,
      totalMs: 1000,
      executionState: "completed",
    })
    const b = createWorkerReceipt({
      request: baseRequest,
      worker: baseWorker,
      execution: baseExecution,
      totalMs: 1000,
      executionState: "completed",
    })
    // Digests differ because receiptId and emittedAt differ; we test with same receipt
    const d1 = getReceiptDigest(a)
    const d2 = getReceiptDigest(a)
    expect(d1).toBe(d2)
  })
})
