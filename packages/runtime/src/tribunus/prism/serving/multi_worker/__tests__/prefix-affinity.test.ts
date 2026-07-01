import { describe, test, expect } from "bun:test"
import type { RouterKvIndexEntry, PrefixAffinityResult } from "../router-types"
import { DEFAULT_SELECTION_WEIGHTS } from "../router-types"
import { computePrefixAffinity, getBestAffinity, computeAffinityScore } from "../prefix-affinity"
import { PrefixAffinityError } from "../router-errors"

function makeEntry(overrides: Partial<RouterKvIndexEntry> = {}): RouterKvIndexEntry {
  return {
    workerId: "worker-a",
    prefixDigest: "prefix-123",
    sequenceNumber: 1,
    state: "stored",
    timestamp: "2026-06-30T12:00:00Z",
    ...overrides,
  }
}

describe("computePrefixAffinity", () => {
  test("returns result with affinity score for a single entry", () => {
    const kvIndex = [makeEntry()]
    const result = computePrefixAffinity("worker-a", "prefix-123", kvIndex, DEFAULT_SELECTION_WEIGHTS)
    expect(result.workerId).toBe("worker-a")
    expect(result.matchedPrefixBlocks).toBe(1)
    expect(result.affinityScore).toBeGreaterThan(0)
  })

  test("throws PrefixAffinityError when no entries match", () => {
    const kvIndex: RouterKvIndexEntry[] = []
    expect(() =>
      computePrefixAffinity("worker-a", "prefix-999", kvIndex, DEFAULT_SELECTION_WEIGHTS),
    ).toThrow(PrefixAffinityError)
  })

  test("computes longer consecutive runs with adjacent sequence numbers", () => {
    const kvIndex = [
      makeEntry({ workerId: "worker-a", prefixDigest: "p1", sequenceNumber: 1, state: "stored" }),
      makeEntry({ workerId: "worker-a", prefixDigest: "p1", sequenceNumber: 2, state: "stored" }),
      makeEntry({ workerId: "worker-a", prefixDigest: "p1", sequenceNumber: 3, state: "stored" }),
    ]
    const result = computePrefixAffinity("worker-a", "p1", kvIndex, DEFAULT_SELECTION_WEIGHTS)
    expect(result.longestConsecutivePrefixBlocks).toBe(3)
    expect(result.matchedPrefixBlocks).toBe(3)
  })

  test("higher residency weight for 'reused' vs 'evicted'", () => {
    const kvReused = [makeEntry({ state: "reused" })]
    const kvEvicted = [makeEntry({ state: "evicted" })]
    const reusedResult = computePrefixAffinity("worker-a", "prefix-123", kvReused, DEFAULT_SELECTION_WEIGHTS)
    const evictedResult = computePrefixAffinity("worker-a", "prefix-123", kvEvicted, DEFAULT_SELECTION_WEIGHTS)
    expect(reusedResult.residencyWeight).toBeGreaterThan(evictedResult.residencyWeight)
  })

  test("eventFreshness is set from the latest timestamp", () => {
    const kvIndex = [
      makeEntry({ timestamp: "2026-01-01T00:00:00Z" }),
      makeEntry({ timestamp: "2026-06-30T00:00:00Z" }),
    ]
    const result = computePrefixAffinity("worker-a", "prefix-123", kvIndex, DEFAULT_SELECTION_WEIGHTS)
    expect(result.eventFreshness).toBe("2026-06-30T00:00:00Z")
  })
})

describe("getBestAffinity", () => {
  test("returns the best affinity among eligible workers", () => {
    const kvIndex = [
      makeEntry({ workerId: "a", prefixDigest: "p1", sequenceNumber: 1 }),
      makeEntry({ workerId: "b", prefixDigest: "p1", sequenceNumber: 2, state: "reused" }),
    ]
    const result = getBestAffinity("p1", kvIndex, ["a", "b"], DEFAULT_SELECTION_WEIGHTS)
    expect(result).not.toBeNull()
    expect(result!.workerId).toBe("b") // reused state gives higher affinity
    expect(result!.affinityScore).toBeGreaterThan(0)
  })

  test("returns null when no entries match", () => {
    const kvIndex: RouterKvIndexEntry[] = []
    const result = getBestAffinity("p1", kvIndex, ["a"], DEFAULT_SELECTION_WEIGHTS)
    expect(result).toBeNull()
  })

  test("returns null when eligible workers have no entries", () => {
    const kvIndex = [makeEntry({ workerId: "c", prefixDigest: "p1" })]
    const result = getBestAffinity("p1", kvIndex, ["a", "b"], DEFAULT_SELECTION_WEIGHTS)
    expect(result).toBeNull()
  })
})

describe("computeAffinityScore", () => {
  test("returns positive score for a result", () => {
    const result: PrefixAffinityResult = {
      workerId: "a",
      matchedPrefixTokens: 256,
      matchedPrefixBlocks: 2,
      longestConsecutivePrefixBlocks: 2,
      residencyWeight: 0.8,
      affinityScore: 0.6,
      eventFreshness: "2026-06-30T12:00:00Z",
    }
    const score = computeAffinityScore(result, DEFAULT_SELECTION_WEIGHTS)
    expect(score).toBeGreaterThan(0)
  })

  test("returns zero for a result with no blocks", () => {
    const result: PrefixAffinityResult = {
      workerId: "a",
      matchedPrefixTokens: 0,
      matchedPrefixBlocks: 0,
      longestConsecutivePrefixBlocks: 0,
      residencyWeight: 0,
      affinityScore: 0,
      eventFreshness: null,
    }
    const score = computeAffinityScore(result, DEFAULT_SELECTION_WEIGHTS)
    expect(score).toBe(0)
  })
})
