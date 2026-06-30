/**
 * Tests — KV Index Replay for Multi-Worker Router
 */

import { describe, it, expect } from "bun:test"
import {
  getEntriesSince,
  detectIndexGap,
  getReplayStatus,
} from "../kv-index-replay"
import type { RouterKvIndexEntry } from "../router-types"

function makeEntry(
  workerId: string,
  seq: number,
  state: string = "stored",
  prefixDigest: string = "abc",
): RouterKvIndexEntry {
  return {
    workerId,
    prefixDigest,
    sequenceNumber: seq,
    state,
    timestamp: new Date(Date.now() - (999 - seq)).toISOString(),
  }
}

describe("getEntriesSince", () => {
  it("returns entries with sequenceNumber greater than the given value", () => {
    const index = [
      makeEntry("w1", 1),
      makeEntry("w1", 2),
      makeEntry("w1", 3),
      makeEntry("w1", 4),
    ]

    const result = getEntriesSince(index, 2)
    expect(result).toHaveLength(2)
    expect(result[0]!.sequenceNumber).toBe(3)
    expect(result[1]!.sequenceNumber).toBe(4)
  })

  it("returns empty array when no entries are after the sequence", () => {
    const index = [makeEntry("w1", 1)]
    expect(getEntriesSince(index, 5)).toEqual([])
  })

  it("returns all entries when sequence is 0", () => {
    const index = [makeEntry("w1", 1), makeEntry("w2", 2)]
    expect(getEntriesSince(index, 0)).toHaveLength(2)
  })

  it("returns empty array for empty index", () => {
    expect(getEntriesSince([], 0)).toEqual([])
  })
})

describe("detectIndexGap", () => {
  it("returns no gap when all expected sequences are present", () => {
    const index = [makeEntry("w1", 1), makeEntry("w1", 2), makeEntry("w1", 3)]
    const result = detectIndexGap(index, [1, 2, 3])
    expect(result.hasGap).toBe(false)
    expect(result.missing).toEqual([])
  })

  it("detects gap when a sequence is missing", () => {
    const index = [makeEntry("w1", 1), makeEntry("w1", 2), makeEntry("w1", 4)]
    const result = detectIndexGap(index, [1, 2, 3, 4])
    expect(result.hasGap).toBe(true)
    expect(result.missing).toEqual([3])
  })

  it("detects gap with multiple missing sequences", () => {
    const index = [makeEntry("w1", 1), makeEntry("w1", 5)]
    const result = detectIndexGap(index, [1, 2, 3, 4, 5])
    expect(result.hasGap).toBe(true)
    expect(result.missing).toEqual([2, 3, 4])
  })

  it("returns no gap for empty expected", () => {
    const index = [makeEntry("w1", 1)]
    const result = detectIndexGap(index, [])
    expect(result.hasGap).toBe(false)
    expect(result.missing).toEqual([])
  })
})

describe("getReplayStatus", () => {
  it("returns zeros and null for empty index", () => {
    const status = getReplayStatus([])
    expect(status).toEqual({ total: 0, latestSequence: 0, oldestTimestamp: null })
  })

  it("computes total, latestSequence, and oldestTimestamp", () => {
    const e1 = makeEntry("w1", 1, "stored")
    const e2 = makeEntry("w1", 2, "stored")
    const index = [e1, e2]

    const status = getReplayStatus(index)
    expect(status.total).toBe(2)
    expect(status.latestSequence).toBe(2)
    expect(status.oldestTimestamp).toBe(e1.timestamp)
  })

  it("handles out-of-order entries by sorting on sequenceNumber", () => {
    const e3 = makeEntry("w1", 3)
    const e1 = makeEntry("w1", 1)
    const e2 = makeEntry("w1", 2)
    const index = [e3, e1, e2]

    const status = getReplayStatus(index)
    expect(status.total).toBe(3)
    expect(status.latestSequence).toBe(3)
    expect(status.oldestTimestamp).toBe(e1.timestamp)
  })
})
