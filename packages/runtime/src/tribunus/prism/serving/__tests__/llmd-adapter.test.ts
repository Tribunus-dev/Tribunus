/**
 * Prism llm-d Worker — LlmDPrismAdapter Tests
 */

import { describe, it, expect } from "bun:test"
import { createDefaultAdapterStub } from "../llmd-adapter"

describe("createDefaultAdapterStub", () => {
  const stub = createDefaultAdapterStub("worker-001")

  it("reports healthy health state", () => {
    expect(stub.getHealth()).toBe("healthy")
  })

  it("reports not ready", () => {
    expect(stub.getReadiness()).toBe(false)
  })

  it("returns capabilities with expected values", () => {
    const caps = stub.getWorkerCapabilities()
    expect(caps.protocolVersion).toBe(1)
    expect(caps.supportedWorkloadClasses).toContain("chat_completion")
    expect(caps.supportedWorkloadClasses).toContain("completion")
    expect(caps.supportedStreamModes).toContain("sse")
    expect(caps.supportsCancellation).toBe(true)
    expect(caps.supportsStreaming).toBe(true)
    expect(caps.supportsDrain).toBe(true)
  })

  it("returns empty model inventory", () => {
    expect(stub.getModelInventory()).toEqual([])
  })

  it("rejects all requests with 'adapter not initialized'", () => {
    const request = {
      requestId: "req-001",
      requestNamespace: "test",
      modelId: "test-model",
      modelArtifactDigest: "abc",
      workloadClass: "chat_completion" as const,
      inputDigest: "xyz",
      promptReference: "",
      maxInputTokens: 4096,
      maxOutputTokens: 4096,
      samplingPolicy: "default",
      stream: false,
      deadlineAt: null,
      dharmaLeaseId: null,
      sessionId: null,
      traceContext: null,
    }
    const result = stub.routeRequest(request)
    expect(result.accepted).toBe(false)
    expect(result.error).toContain("adapter not initialized")
  })

  it("beginDrain is callable and does not throw", () => {
    expect(() => stub.beginDrain()).not.toThrow()
  })

  it("cancelRequest is callable and does not throw", () => {
    expect(() => stub.cancelRequest("req-001")).not.toThrow()
  })

  it("getMetricsEndpoint returns worker-prefixed path", () => {
    expect(stub.getMetricsEndpoint()).toBe("/worker/worker-001/metrics")
  })

  it("replayKvEvents returns empty array", () => {
    expect(stub.replayKvEvents(0)).toEqual([])
  })

  it("getUsageReceipt returns null", () => {
    expect(stub.getUsageReceipt("req-001")).toBeNull()
  })
})
