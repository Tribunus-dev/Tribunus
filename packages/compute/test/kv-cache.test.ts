import { describe, test, expect, afterEach } from "bun:test"
import { SimpleKVCache } from "../src/kv-cache.js"
import type { TensorView } from "../src/tensor-view.js"

// Helper to create mock TensorView
function createMockTensorView(tokenCount: number = 1): TensorView {
  return {
    handle: {} as any,
    shape: [1, tokenCount], // Shape [1, tokenCount] ensures tokenCount is extracted correctly
    strides: [1, 1],
    dtype: "float32",
    offset: 0,
    numElements: tokenCount,
    byteSize: tokenCount * 4,
    validate: () => true,
    slice: () => ({}) as any,
    materialize: () => ({}) as any,
  }
}

describe("SimpleKVCache", () => {
  afterEach(() => {
    // reset mock if we mock Date.now later
  })

  describe("Basic Operations", () => {
    test("set and get", () => {
      const cache = new SimpleKVCache({ maxEntries: 10, policy: "fifo" })

      const k = createMockTensorView()
      const v = createMockTensorView()

      cache.set("key1", k, v)

      const entry = cache.get("key1")
      expect(entry).toBeDefined()
      expect(entry?.key).toBe("key1")
      expect(entry?.k).toBe(k)
      expect(entry?.v).toBe(v)
    })

    test("stats", () => {
      const cache = new SimpleKVCache({ maxEntries: 10, policy: "fifo" })

      expect(cache.stats()).toEqual({ size: 0, hits: 0, misses: 0 })

      cache.set("key1", createMockTensorView(), createMockTensorView())
      expect(cache.stats()).toEqual({ size: 1, hits: 0, misses: 0 })

      cache.get("key1") // hit
      expect(cache.stats()).toEqual({ size: 1, hits: 1, misses: 0 })

      cache.get("key2") // miss
      expect(cache.stats()).toEqual({ size: 1, hits: 1, misses: 1 })
    })

    test("capacity limit via set (makeRoom)", () => {
      const cache = new SimpleKVCache({ maxEntries: 3, policy: "fifo" })

      cache.set("1", createMockTensorView(), createMockTensorView())
      cache.set("2", createMockTensorView(), createMockTensorView())
      cache.set("3", createMockTensorView(), createMockTensorView())

      expect(cache.stats().size).toBe(3)

      // Inserting 4th should evict 1st (fifo)
      cache.set("4", createMockTensorView(), createMockTensorView())
      expect(cache.stats().size).toBe(3)

      expect(cache.get("1")).toBeUndefined()
      expect(cache.get("2")).toBeDefined()
      expect(cache.get("3")).toBeDefined()
      expect(cache.get("4")).toBeDefined()
    })
  })

  describe("Eviction Policy: FIFO", () => {
    test("evict() drops oldest inserted entries to reach 75% capacity", () => {
      const cache = new SimpleKVCache({ maxEntries: 4, policy: "fifo" })

      cache.set("1", createMockTensorView(), createMockTensorView())
      cache.set("2", createMockTensorView(), createMockTensorView())
      cache.set("3", createMockTensorView(), createMockTensorView())
      cache.set("4", createMockTensorView(), createMockTensorView())

      // Target capacity is max(1, floor(4 * 0.75)) = 3.
      // Current size = 4. Needs to evict 4 - 3 = 1 entry.
      const evictedCount = cache.evict()
      expect(evictedCount).toBe(1)
      expect(cache.stats().size).toBe(3)

      // "1" should be evicted because it was inserted first
      expect(cache.get("1")).toBeUndefined()
      expect(cache.get("2")).toBeDefined()
    })
  })

  describe("Eviction Policy: LRU", () => {
    test("evict() drops least recently accessed entries", async () => {
      const cache = new SimpleKVCache({ maxEntries: 4, policy: "lru" })

      cache.set("1", createMockTensorView(), createMockTensorView())
      await Bun.sleep(5)
      cache.set("2", createMockTensorView(), createMockTensorView())
      await Bun.sleep(5)
      cache.set("3", createMockTensorView(), createMockTensorView())
      await Bun.sleep(5)
      cache.set("4", createMockTensorView(), createMockTensorView())

      // Access "1" to make it most recently used
      cache.get("1")

      // Now "2" is the least recently accessed (inserted and never accessed again)
      // Evict will drop to 75% of 4 = 3 entries (1 entry evicted)
      const evictedCount = cache.evict()
      expect(evictedCount).toBe(1)

      expect(cache.get("2")).toBeUndefined()
      expect(cache.get("1")).toBeDefined()
      expect(cache.get("3")).toBeDefined()
      expect(cache.get("4")).toBeDefined()
    })

    test("makeRoom() respects LRU", async () => {
      const cache = new SimpleKVCache({ maxEntries: 3, policy: "lru" })

      cache.set("1", createMockTensorView(), createMockTensorView())
      await Bun.sleep(5)
      cache.set("2", createMockTensorView(), createMockTensorView())
      await Bun.sleep(5)
      cache.set("3", createMockTensorView(), createMockTensorView())

      // Access "1" to make it most recently used
      cache.get("1")

      // Insert "4", size exceeds max, so evict 1 entry.
      // "2" is least recently accessed.
      cache.set("4", createMockTensorView(), createMockTensorView())

      expect(cache.get("2")).toBeUndefined()
      expect(cache.get("1")).toBeDefined()
      expect(cache.get("3")).toBeDefined()
      expect(cache.get("4")).toBeDefined()
    })
  })

  describe("Eviction Policy: Sliding Window", () => {
    test("get() discards entries out of window", () => {
      const cache = new SimpleKVCache({ maxEntries: 10, policy: "sliding_window", windowSize: 10 })

      cache.set("token5", createMockTensorView(5), createMockTensorView(5))
      cache.set("token15", createMockTensorView(15), createMockTensorView(15))
      cache.set("token20", createMockTensorView(20), createMockTensorView(20))

      // Max position is 20. Window size is 10.
      // So valid range is [10, 20].
      // token5 should be discarded on get().

      const entry5 = cache.get("token5")
      expect(entry5).toBeUndefined()
      expect(cache.stats().misses).toBe(1) // gets counted as a miss

      // token15 is within window
      expect(cache.get("token15")).toBeDefined()
    })

    test("evict() drops entries farthest from most recent token position", () => {
      const cache = new SimpleKVCache({ maxEntries: 4, policy: "sliding_window", windowSize: 100 })

      // Add entries with token counts
      cache.set("t10", createMockTensorView(10), createMockTensorView(10))
      cache.set("t20", createMockTensorView(20), createMockTensorView(20))
      cache.set("t30", createMockTensorView(30), createMockTensorView(30))
      cache.set("t40", createMockTensorView(40), createMockTensorView(40))

      // Max pos is 40.
      // Distances:
      // t10: 30
      // t20: 20
      // t30: 10
      // t40: 0

      // Evict needs to remove 1 entry (4 - 3 = 1)
      const count = cache.evict()
      expect(count).toBe(1)

      // t10 is farthest, it should be evicted
      expect(cache.get("t10")).toBeUndefined()
      expect(cache.get("t20")).toBeDefined()
      expect(cache.get("t30")).toBeDefined()
      expect(cache.get("t40")).toBeDefined()
    })
  })
})
