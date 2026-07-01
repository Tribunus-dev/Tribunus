/**
 * Tests — KV Index for Multi-Worker Router
 */

import { describe, it, expect } from "bun:test"
import {
  createKvIndexEntry,
  addToIndex,
  getEntriesForWorker,
  getLatestEntryForWorker,
  invalidateWorkerEntries,
} from "../kv-index"

describe("createKvIndexEntry", () => {
  it("creates an entry with the given workerId, prefixDigest, and state", () => {
    const entry = createKvIndexEntry("worker-a", "abc123", "stored")
    expect(entry.workerId).toBe("worker-a")
    expect(entry.prefixDigest).toBe("abc123")
    expect(entry.state).toBe("stored")
  })

  it("assigns a numeric sequenceNumber", () => {
    const entry = createKvIndexEntry("worker-b", "def456", "touched")
    expect(typeof entry.sequenceNumber).toBe("number")
    expect(entry.sequenceNumber).toBeGreaterThan(0)
  })

  it("assigns an ISO-8601 timestamp string", () => {
    const entry = createKvIndexEntry("worker-c", "789ghi", "reused")
    expect(() => new Date(entry.timestamp).toISOString()).not.toThrow()
  })
})

describe("addToIndex", () => {
  it("appends a new entry to the index", () => {
    const entry = createKvIndexEntry("w1", "aaa", "stored")
    const result = addToIndex([], entry, 10)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(entry)
  })

  it("drops the oldest entry when exceeding maxSize", () => {
    const e1 = createKvIndexEntry("w1", "aaa", "stored")
    const e2 = createKvIndexEntry("w2", "bbb", "stored")
    const e3 = createKvIndexEntry("w3", "ccc", "stored")

    // maxSize = 2: only the last 2 should survive
    const result = addToIndex(addToIndex([e1], e2, 2), e3, 2)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(e2)
    expect(result[1]).toBe(e3)
  })

  it("retains all entries when under maxSize", () => {
    const e1 = createKvIndexEntry("w1", "aaa", "stored")
    const e2 = createKvIndexEntry("w2", "bbb", "stored")
    const result = addToIndex(addToIndex([], e1, 10), e2, 10)
    expect(result).toHaveLength(2)
  })

  it("returns a new array (immutable)", () => {
    const original: import("../router-types").RouterKvIndexEntry[] = []
    const entry = createKvIndexEntry("w1", "aaa", "stored")
    const result = addToIndex(original, entry, 10)
    expect(result).not.toBe(original)
  })
})

describe("getEntriesForWorker", () => {
  it("returns all entries for the given workerId", () => {
    const e1 = createKvIndexEntry("w1", "aaa", "stored")
    const e2 = createKvIndexEntry("w1", "bbb", "stored")
    const e3 = createKvIndexEntry("w2", "ccc", "stored")
    const index = [e1, e2, e3]

    const result = getEntriesForWorker(index, "w1")
    expect(result).toHaveLength(2)
    expect(result).toContain(e1)
    expect(result).toContain(e2)
  })

  it("returns empty array when worker has no entries", () => {
    const result = getEntriesForWorker([], "w1")
    expect(result).toEqual([])
  })
})

describe("getLatestEntryForWorker", () => {
  it("returns the entry with the highest sequenceNumber for a worker", () => {
    const e1 = createKvIndexEntry("w1", "aaa", "stored")
    const e2 = createKvIndexEntry("w1", "bbb", "stored")
    // Manually override sequence to ensure ordering
    e1.sequenceNumber = 1
    e2.sequenceNumber = 2
    const index = [e1, e2]

    const result = getLatestEntryForWorker(index, "w1")
    expect(result).toBe(e2)
  })

  it("returns undefined when worker has no entries", () => {
    const result = getLatestEntryForWorker([], "w1")
    expect(result).toBeUndefined()
  })
})

describe("invalidateWorkerEntries", () => {
  it("marks all worker entries as evicted", () => {
    const e1 = createKvIndexEntry("w1", "aaa", "stored")
    const e2 = createKvIndexEntry("w1", "bbb", "touched")
    const e3 = createKvIndexEntry("w2", "ccc", "stored")
    const index = [e1, e2, e3]

    const result = invalidateWorkerEntries(index, "w1")
    expect(result).toHaveLength(3)

    // w1 entries are now evicted
    expect(result[0]!.state).toBe("evicted")
    expect(result[1]!.state).toBe("evicted")

    // w2 entry is unchanged
    expect(result[2]!.state).toBe("stored")
  })

  it("does not modify the original array", () => {
    const e1 = createKvIndexEntry("w1", "aaa", "stored")
    const index = [e1]

    invalidateWorkerEntries(index, "w1")
    expect(index[0]!.state).toBe("stored")
  })

  it("returns the same index if worker not found", () => {
    const e1 = createKvIndexEntry("w1", "aaa", "stored")
    const index = [e1]

    const result = invalidateWorkerEntries(index, "nonexistent")
    expect(result).toHaveLength(1)
    expect(result[0]!.state).toBe("stored")
  })
})
