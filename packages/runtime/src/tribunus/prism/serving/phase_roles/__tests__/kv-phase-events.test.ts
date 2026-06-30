/**
 * Tests — Phase-specific KV Events
 */

import { describe, it, expect } from "bun:test"
import { createPhaseKvEvent, getKvEventPhase, canDecodeAttach } from "../phase-kv-events"

describe("createPhaseKvEvent", () => {
  it("creates a phase KV event with all fields", () => {
    const event = createPhaseKvEvent(
      "worker-a",
      "inst-001",
      "sha256-model-aaa",
      "prefix-xyz",
      "ns-main",
      "prefill",
      "stored",
    )
    expect(event.eventId).toBeTruthy()
    expect(event.eventVersion).toBe(2)
    expect(event.workerId).toBe("worker-a")
    expect(event.workerInstanceId).toBe("inst-001")
    expect(event.modelArtifactDigest).toBe("sha256-model-aaa")
    expect(event.prefixDigest).toBe("prefix-xyz")
    expect(event.kvNamespaceId).toBe("ns-main::prefix-xyz")
    expect(event.phase).toBe("prefill")
    expect(event.state).toBe("stored")
    expect(event.emittedAt).toBeTruthy()
    expect(() => new Date(event.emittedAt as string)).not.toThrow()
  })

  it("tags events with decode phase when provided", () => {
    const event = createPhaseKvEvent("w", "i", "m", "p", "ns", "decode", "reused")
    expect(event.phase).toBe("decode")
    expect(event.state).toBe("reused")
  })
})

describe("getKvEventPhase", () => {
  it("returns the phase from a KV event", () => {
    const event = createPhaseKvEvent("w", "i", "m", "p", "ns", "prefill", "stored")
    expect(getKvEventPhase(event)).toBe("prefill")
  })

  it("returns null when phase is missing", () => {
    expect(getKvEventPhase({})).toBeNull()
  })

  it("returns null when phase is not a string", () => {
    expect(getKvEventPhase({ phase: 42 })).toBeNull()
  })

  it("returns null when phase is empty string", () => {
    expect(getKvEventPhase({ phase: "" })).toBeNull()
  })
})

describe("canDecodeAttach", () => {
  describe("same_worker_required", () => {
    it("allows decode attach when event phase is prefill", () => {
      expect(canDecodeAttach("prefill", "same_worker_required")).toBe(true)
    })

    it("denies decode attach when event phase is decode", () => {
      expect(canDecodeAttach("decode", "same_worker_required")).toBe(false)
    })

    it("denies decode attach when event phase is anything else", () => {
      expect(canDecodeAttach("evict", "same_worker_required")).toBe(false)
    })
  })

  describe("future_transfer_capable", () => {
    it("allows decode attach regardless of event phase", () => {
      expect(canDecodeAttach("prefill", "future_transfer_capable")).toBe(true)
      expect(canDecodeAttach("decode", "future_transfer_capable")).toBe(true)
      expect(canDecodeAttach("evict", "future_transfer_capable")).toBe(true)
    })
  })

  describe("not_supported", () => {
    it("denies decode attach", () => {
      expect(canDecodeAttach("prefill", "not_supported")).toBe(false)
      expect(canDecodeAttach("decode", "not_supported")).toBe(false)
    })
  })

  it("denies decode attach for unrecognised co-location policy", () => {
    expect(canDecodeAttach("prefill", "unknown_policy")).toBe(false)
  })
})
