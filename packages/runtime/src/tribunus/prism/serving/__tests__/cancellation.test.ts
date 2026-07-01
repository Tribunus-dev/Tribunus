/**
 * Prism llm-d Worker — Cancellation Tests
 */

import { describe, it, expect } from "bun:test"
import { cancelRequest, isCancellationIdempotent } from "../worker-cancellation"
import type { PrismRequestExecution } from "../worker-types"

const baseExecution: PrismRequestExecution = {
  executionId: "exec-001",
  requestId: "req-001",
  modelArtifactDigest: "abc123",
  computeImageDigest: "def456",
  targetCapabilitySignature: "sig-v1",
  prefillState: "pending",
  decodeState: "pending",
  kvNamespaceId: null,
  admissionTime: "2025-01-01T00:00:00.000Z",
  startedAt: "2025-01-01T00:00:01.000Z",
  completedAt: null,
}

const terminalStates = ["completed", "failed", "cancelled"] as const

describe("cancelRequest", () => {
  it("cancels a pending execution", () => {
    const result = cancelRequest(baseExecution)
    expect(result.prefillState).toBe("cancelled")
    expect(result.decodeState).toBe("cancelled")
    expect(result.completedAt).not.toBeNull()
  })

  it("sets completedAt on cancellation", () => {
    const result = cancelRequest(baseExecution)
    expect(result.completedAt).toBeTruthy()
    expect(() => new Date(result.completedAt!).toISOString()).not.toThrow()
  })

  it("sets reason as a marker (observability)", () => {
    const result = cancelRequest(baseExecution, "user requested")
    expect(result.prefillState).toBe("cancelled")
  })

  it("preserves existing execution fields", () => {
    const result = cancelRequest(baseExecution)
    expect(result.executionId).toBe(baseExecution.executionId)
    expect(result.requestId).toBe(baseExecution.requestId)
    expect(result.modelArtifactDigest).toBe(baseExecution.modelArtifactDigest)
  })

  for (const terminal of terminalStates) {
    it(`does not modify prefillState when already ${terminal}`, () => {
      const exec: PrismRequestExecution = { ...baseExecution, prefillState: terminal }
      const result = cancelRequest(exec)
      expect(result.prefillState).toBe(terminal)
    })

    it(`does not modify decodeState when already ${terminal}`, () => {
      const exec: PrismRequestExecution = { ...baseExecution, decodeState: terminal }
      const result = cancelRequest(exec)
      expect(result.decodeState).toBe(terminal)
    })
  }

  it("cancels an already cancelled execution idempotently (completedAt stays)", () => {
    const once = cancelRequest(baseExecution)
    const twice = cancelRequest(once)
    expect(twice.prefillState).toBe("cancelled")
    expect(twice.decodeState).toBe("cancelled")
    expect(twice.completedAt).toEqual(once.completedAt)
  })
})

describe("isCancellationIdempotent", () => {
  it("returns false for a pending execution", () => {
    expect(isCancellationIdempotent(baseExecution)).toBe(false)
  })

  for (const terminal of terminalStates) {
    it(`returns true when prefillState is ${terminal}`, () => {
      const exec: PrismRequestExecution = { ...baseExecution, prefillState: terminal }
      expect(isCancellationIdempotent(exec)).toBe(true)
    })

    it(`returns true when decodeState is ${terminal}`, () => {
      const exec: PrismRequestExecution = { ...baseExecution, decodeState: terminal }
      expect(isCancellationIdempotent(exec)).toBe(true)
    })
  }

  it("returns true when both states are already terminal", () => {
    const exec: PrismRequestExecution = {
      ...baseExecution,
      prefillState: "cancelled",
      decodeState: "cancelled",
    }
    expect(isCancellationIdempotent(exec)).toBe(true)
  })
})
