/**
 * Tests — KV Locality Event Creation + Validation
 */

import { describe, it, expect } from "bun:test"
import { createKvEvent, createKvEventBatch, isKvEventValid } from "../kv-events"
import type { KvEventState, ResidencyLocation } from "../worker-types"

const baseConfig = {
  workerId: "worker-abc",
  instanceId: "inst-001",
  modelDigest: "sha256-model-aaa",
  tokenizerDigest: "sha256-tokenizer-bbb",
  prefixDigest: "prefix-xyz",
  namespaceId: "ns-main",
  location: "device_local" as ResidencyLocation,
  tier: "fast",
  bytes: 4096,
  tokens: 512,
  state: "stored" as KvEventState,
}

describe("createKvEvent", () => {
  it("creates a valid event with all fields", () => {
    const event = createKvEvent(baseConfig)
    expect(event.eventId).toBeTruthy()
    expect(event.eventVersion).toBe(1)
    expect(event.workerId).toBe("worker-abc")
    expect(event.workerInstanceId).toBe("inst-001")
    expect(event.modelArtifactDigest).toBe("sha256-model-aaa")
    expect(event.tokenizerDigest).toBe("sha256-tokenizer-bbb")
    expect(event.requestNamespace).toBe("ns-main")
    expect(event.prefixDigest).toBe("prefix-xyz")
    expect(event.kvNamespaceId).toBe("ns-main::prefix-xyz")
    expect(event.localityKey).toBe("worker-abc:inst-001:prefix-xyz")
    expect(event.residencyLocation).toBe("device_local")
    expect(event.residencyTier).toBe("fast")
    expect(event.byteCount).toBe(4096)
    expect(event.tokenCount).toBe(512)
    expect(event.state).toBe("stored")
    expect(event.emittedAt).toBeTruthy()
    expect(() => new Date(event.emittedAt)).not.toThrow()
  })

  it("allows null tokens", () => {
    const cfg = { ...baseConfig, tokens: undefined }
    const event = createKvEvent(cfg)
    expect(event.tokenCount).toBeNull()
  })

  it("generates unique event ids", () => {
    const a = createKvEvent(baseConfig)
    const b = createKvEvent(baseConfig)
    expect(a.eventId).not.toBe(b.eventId)
  })

  it("accepts every event state", () => {
    const states: KvEventState[] = ["stored", "touched", "reused", "evicted", "invalidated", "released"]
    for (const state of states) {
      const event = createKvEvent({ ...baseConfig, state })
      expect(event.state).toBe(state)
    }
  })

  it("accepts every residency location", () => {
    const locs: ResidencyLocation[] = ["device_local", "unified_memory", "host_memory", "durable_local_cache"]
    for (const loc of locs) {
      const event = createKvEvent({ ...baseConfig, location: loc })
      expect(event.residencyLocation).toBe(loc)
    }
  })
})

describe("createKvEventBatch", () => {
  it("creates an empty batch", () => {
    const batch = createKvEventBatch("worker-abc", [])
    expect(batch.workerId).toBe("worker-abc")
    expect(batch.sequenceNumber).toBe(0)
    expect(batch.events).toEqual([])
    expect(batch.emittedAt).toBeTruthy()
  })

  it("creates a batch with events", () => {
    const evt = createKvEvent(baseConfig)
    const batch = createKvEventBatch("worker-abc", [evt])
    expect(batch.events).toHaveLength(1)
    expect(batch.events[0]!.eventId).toBe(evt.eventId)
  })
})

describe("isKvEventValid", () => {
  it("returns true for a well-formed event", () => {
    const event = createKvEvent(baseConfig)
    expect(isKvEventValid(event)).toBe(true)
  })

  it("returns false when eventId is missing", () => {
    const event = createKvEvent(baseConfig)
    expect(isKvEventValid({ ...event, eventId: "" })).toBe(false)
  })

  it("returns false when state is invalid", () => {
    const event = createKvEvent(baseConfig)
    expect(isKvEventValid({ ...event, state: "bogus" as KvEventState })).toBe(false)
  })

  it("returns false when residencyLocation is invalid", () => {
    const event = createKvEvent(baseConfig)
    expect(isKvEventValid({ ...event, residencyLocation: "mars" as ResidencyLocation })).toBe(false)
  })

  it("returns false when byteCount is negative", () => {
    const event = createKvEvent(baseConfig)
    expect(isKvEventValid({ ...event, byteCount: -1 })).toBe(false)
  })

  it("returns false when tokenCount is negative", () => {
    const event = createKvEvent(baseConfig)
    expect(isKvEventValid({ ...event, tokenCount: -5 })).toBe(false)
  })

  it("returns false when eventVersion is 0", () => {
    const event = createKvEvent(baseConfig)
    expect(isKvEventValid({ ...event, eventVersion: 0 })).toBe(false)
  })

  it("returns false when workerId is empty", () => {
    const event = createKvEvent(baseConfig)
    expect(isKvEventValid({ ...event, workerId: "" })).toBe(false)
  })

  it("returns false when localityKey is empty", () => {
    const event = createKvEvent(baseConfig)
    expect(isKvEventValid({ ...event, localityKey: "" })).toBe(false)
  })
})
