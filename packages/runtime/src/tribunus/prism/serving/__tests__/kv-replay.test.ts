/**
 * Tests — KV Event Replay Buffer
 */

import { describe, it, expect } from "bun:test"
import { addToReplayBuffer, getEventsAfter, getLatestSequence, detectGap } from "../kv-event-replay"
import type { PrismKvEventBatch, PrismKvEvent } from "../worker-types"

function makeBatch(workerId: string, seq: number, count: number = 1): PrismKvEventBatch {
  const events: PrismKvEvent[] = Array.from({ length: count }, (_, i) => ({
    eventId: `evt-${seq}-${i}`,
    eventVersion: 1,
    workerId,
    workerInstanceId: "inst-001",
    modelArtifactDigest: "mdl",
    tokenizerDigest: "tok",
    requestNamespace: "ns",
    prefixDigest: `pfx-${seq}`,
    kvNamespaceId: `ns::pfx-${seq}`,
    localityKey: `${workerId}:inst-001:pfx-${seq}`,
    residencyLocation: "device_local",
    residencyTier: "fast",
    byteCount: 1024,
    tokenCount: 128,
    state: "stored",
    emittedAt: new Date().toISOString(),
  }))
  return { workerId, sequenceNumber: seq, emittedAt: new Date().toISOString(), events }
}

describe("addToReplayBuffer", () => {
  it("adds first batch with sequence 1", () => {
    const batch = makeBatch("w1", 0)
    const buf = addToReplayBuffer([], batch, 100)
    expect(buf).toHaveLength(1)
    expect(buf[0]!.sequenceNumber).toBe(1)
  })

  it("increments sequence for subsequent batches", () => {
    const b1 = makeBatch("w1", 0)
    const buf1 = addToReplayBuffer([], b1, 100)
    const b2 = makeBatch("w1", 0)
    const buf2 = addToReplayBuffer(buf1, b2, 100)
    expect(buf2).toHaveLength(2)
    expect(buf2[0]!.sequenceNumber).toBe(1)
    expect(buf2[1]!.sequenceNumber).toBe(2)
  })

  it("drops oldest when exceeding maxSize", () => {
    const b1 = makeBatch("w1", 0)
    const buf1 = addToReplayBuffer([], b1, 3)
    const buf2 = addToReplayBuffer(buf1, makeBatch("w1", 0), 3)
    const buf3 = addToReplayBuffer(buf2, makeBatch("w1", 0), 3)
    expect(buf3).toHaveLength(3)
    const buf4 = addToReplayBuffer(buf3, makeBatch("w1", 0), 3)
    expect(buf4).toHaveLength(3)
    expect(buf4[0]!.sequenceNumber).toBe(2)
    expect(buf4[1]!.sequenceNumber).toBe(3)
    expect(buf4[2]!.sequenceNumber).toBe(4)
  })
})

describe("getEventsAfter", () => {
  it("returns batches after given sequence", () => {
    const buf1 = addToReplayBuffer([], makeBatch("w1", 0), 10)
    const buf2 = addToReplayBuffer(buf1, makeBatch("w1", 0), 10)
    const buf3 = addToReplayBuffer(buf2, makeBatch("w1", 0), 10)

    const after = getEventsAfter(buf3, 1)
    expect(after).toHaveLength(2)
    expect(after[0]!.sequenceNumber).toBe(2)
    expect(after[1]!.sequenceNumber).toBe(3)
  })

  it("returns empty array when no events after sequence", () => {
    const buf = addToReplayBuffer([], makeBatch("w1", 0), 10)
    expect(getEventsAfter(buf, 5)).toEqual([])
  })
})

describe("getLatestSequence", () => {
  it("returns 0 for empty buffer", () => {
    expect(getLatestSequence([])).toBe(0)
  })

  it("returns last sequence number", () => {
    const buf1 = addToReplayBuffer([], makeBatch("w1", 0), 10)
    const buf2 = addToReplayBuffer(buf1, makeBatch("w1", 0), 10)
    expect(getLatestSequence(buf2)).toBe(2)
  })
})

describe("detectGap", () => {
  it("detects no gap when sequence is present", () => {
    const buf = addToReplayBuffer([], makeBatch("w1", 0), 10)
    expect(detectGap(buf, 1)).toEqual({ hasGap: false, missingSequences: [] })
  })

  it("detects gap when buffer is empty", () => {
    expect(detectGap([], 5)).toEqual({ hasGap: true, missingSequences: [5] })
  })

  it("detects gap when expected is before earliest", () => {
    const buf1 = addToReplayBuffer([], makeBatch("w1", 0), 10)
    const buf2 = addToReplayBuffer(buf1, makeBatch("w1", 0), 10)
    // sequence on buf2: [1, 2]
    const result = detectGap(buf2, 0)
    expect(result.hasGap).toBe(true)
    expect(result.missingSequences).toEqual([0])
  })

  it("detects gap when expected is after latest", () => {
    const buf = addToReplayBuffer([], makeBatch("w1", 0), 10)
    expect(detectGap(buf, 5)).toEqual({ hasGap: true, missingSequences: [5] })
  })

  it("detects missing interior sequences", () => {
    // Build buffer with sequences 1 and 3 (skip 2)
    const b1 = makeBatch("w1", 0)
    let buf = addToReplayBuffer([], b1, 10)    // seq 1
    buf = addToReplayBuffer(buf, makeBatch("w1", 0), 10) // seq 2
    buf = addToReplayBuffer(buf, makeBatch("w1", 0), 10) // seq 3
    // Manually remove seq 2 to create a hole
    const holey = buf.filter((b) => b.sequenceNumber !== 2)

    const result = detectGap(holey, 1)
    expect(result.hasGap).toBe(true)
    expect(result.missingSequences).toEqual([2])
  })
})
