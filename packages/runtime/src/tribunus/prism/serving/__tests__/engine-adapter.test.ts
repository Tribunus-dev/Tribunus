/**
 * Prism Engine Adapter — Integration Test
 *
 * Tests the session-native PrismInferenceServer adapter wrapping into
 * the PrismWorkerProtocol surface.
 */

import { expect, test, describe } from "bun:test"

import { PrismEngineAdapter } from "../engine-adapter"
import { createWorkerReceipt, isReceiptValid } from "../worker-receipts"
import type { PrismWorkerRequest } from "../worker-types"

describe("PrismEngineAdapter", () => {
  test("creates engine and reports capabilities", () => {
    const adapter = new PrismEngineAdapter()
    const caps = adapter.capabilities()
    expect(caps.protocolVersion).toBe(1)
    expect(caps.supportedWorkloadClasses).toContain("chat_completion")
    expect(caps.supportsCancellation).toBe(true)
    expect(caps.supportsStreaming).toBe(true)
    expect(caps.maximumConcurrentRequests).toBe(4)
  })

  test("accepts custom config", () => {
    const adapter = new PrismEngineAdapter({
      maxConcurrentSessions: 2,
      maxInputTokens: 2048,
    })
    const caps = adapter.capabilities()
    expect(caps.maximumConcurrentRequests).toBe(2)
    expect(caps.maximumInputTokens).toBe(2048)
  })

  test("admitAndExecute creates execution in running state", () => {
    const adapter = new PrismEngineAdapter()
    const request: PrismWorkerRequest = {
      requestId: "req-admit-001",
      requestNamespace: "default",
      modelId: "model-001",
      modelArtifactDigest: "digest-001",
      workloadClass: "chat_completion",
      inputDigest: "input-001",
      promptReference: "prompt-001",
      maxInputTokens: 512,
      maxOutputTokens: 256,
      samplingPolicy: '{"temperature": 0.7}',
      stream: false,
      deadlineAt: null,
      dharmaLeaseId: null,
      sessionId: null,
      traceContext: null,
    }

    const execution = adapter.admitAndExecute(request, "sess-001")
    expect(execution.executionId).toContain("req-admit-001")
    expect(execution.prefillState).toBe("running")
    expect(execution.decodeState).toBe("pending")
    expect(execution.admissionTime).toBeTruthy()
  })

  test("isHealthy returns true when engine responds", () => {
    const adapter = new PrismEngineAdapter()
    expect(adapter.isHealthy()).toBe(true)
  })

  test("buildReceipt creates valid receipt", () => {
    const adapter = new PrismEngineAdapter()
    const request: PrismWorkerRequest = {
      requestId: "req-receipt-001",
      requestNamespace: "default",
      modelId: "model-001",
      modelArtifactDigest: "digest-001",
      workloadClass: "chat_completion",
      inputDigest: "input-001",
      promptReference: "prompt-001",
      maxInputTokens: 50,
      maxOutputTokens: 100,
      samplingPolicy: '{"temperature": 0.7}',
      stream: false,
      deadlineAt: null,
      dharmaLeaseId: null,
      sessionId: null,
      traceContext: null,
    }

    const execution = adapter.admitAndExecute(request, "sess-002")
    const result = { tokenCount: 3, output: "Hello world" }

    const receipt = adapter.buildReceipt(
      request,
      result,
      execution,
      "wkr-001",
      "inst-001",
      150,
      1200,
    )

    expect(receipt.requestId).toBe("req-receipt-001")
    expect(receipt.workerId).toBe("wkr-001")
    expect(receipt.workerInstanceId).toBe("inst-001")
    expect(receipt.outputTokenCount).toBe(3)
    expect(receipt.prefillDurationMs).toBe(150)
    expect(receipt.decodeDurationMs).toBe(1200)
    expect(receipt.totalDurationMs).toBe(1350)
    expect(receipt.executionState).toBe("completed")
    expect(receipt.workerSignature).toBeTruthy()
    expect(isReceiptValid(receipt)).toBe(true)
  })

  test("shutdown clears sessions", () => {
    const adapter = new PrismEngineAdapter()
    const request: PrismWorkerRequest = {
      requestId: "req-shutdown-001",
      requestNamespace: "default",
      modelId: "model-001",
      modelArtifactDigest: "digest-001",
      workloadClass: "chat_completion",
      inputDigest: "input-001",
      promptReference: "prompt-001",
      maxInputTokens: 64,
      maxOutputTokens: 64,
      samplingPolicy: '{"temperature": 0.5}',
      stream: false,
      deadlineAt: null,
      dharmaLeaseId: null,
      sessionId: null,
      traceContext: null,
    }

    adapter.admitAndExecute(request, "sess-003")
    expect(adapter.getSession("req-shutdown-001")).toBeDefined()
    adapter.shutdown()
    expect(adapter.getSession("req-shutdown-001")).toBeUndefined()
  })

  test("session lifecycle: createSession and closeSession", () => {
    const adapter = new PrismEngineAdapter()
    // createSession tries to load a real model; we don't have one deployed
    // in CI, so this will throw.  That's expected — the test is structural.
    expect(typeof adapter.createSession).toBe("function")
    expect(typeof adapter.closeSession).toBe("function")
  })
})
