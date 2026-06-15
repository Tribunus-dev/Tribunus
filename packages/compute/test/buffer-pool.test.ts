import { describe, test, expect, afterEach, beforeEach } from "bun:test"
import { createBufferPool, type BufferPool } from "../src/buffer-pool.js"
import { createStorageHandle, isValidHandle, drainAllHandles } from "../src/storage-handle.js"

describe("BufferPool", () => {
  let pool: BufferPool

  beforeEach(() => {
    pool = createBufferPool({
      allocationClass: "device",
      backend: "cpu",
      maxPoolSize: 2, // Small max pool size for testing eviction
    })
  })

  afterEach(() => {
    pool.drain()
    drainAllHandles()
  })

  test("initial properties and stats", () => {
    expect(pool.allocationClass).toBe("device")
    expect(pool.backend).toBe("cpu")
    expect(pool.maxPoolSize).toBe(2)

    const stats = pool.stats()
    expect(stats.allocated).toBe(0)
    expect(stats.pooled).toBe(0)
    expect(stats.peak).toBe(0)
    expect(stats.totalPooledBytes).toBe(0)
  })

  test("acquire allocates new handle of bucketed size", () => {
    // 150 bytes should round up to the 256 byte bucket
    const h1 = pool.acquire(150)
    expect(h1.sizeBytes).toBe(256)
    expect(h1.allocationClass).toBe("device")
    expect(h1.backend).toBe("cpu")

    let stats = pool.stats()
    expect(stats.allocated).toBe(1)
    expect(stats.pooled).toBe(0)
    expect(stats.peak).toBe(1)

    // 5000 bytes should round up to 16384 byte bucket
    const h2 = pool.acquire(5000)
    expect(h2.sizeBytes).toBe(16384)

    stats = pool.stats()
    expect(stats.allocated).toBe(2)
    expect(stats.peak).toBe(2)

    // Above max bucket size, rounds to next KB
    const h3 = pool.acquire(67108865) // 64 MB + 1 byte
    expect(h3.sizeBytes).toBe(67109888) // Next KB

    h1.release()
    h2.release()
    h3.release()
  })

  test("release adds to pool and acquire reuses it", () => {
    const h1 = pool.acquire(100)
    const id1 = h1.id

    expect(pool.stats().allocated).toBe(1)

    // Release puts it in the pool
    pool.release(h1)

    let stats = pool.stats()
    expect(stats.allocated).toBe(0)
    expect(stats.pooled).toBe(1)
    expect(stats.totalPooledBytes).toBe(256)
    expect(isValidHandle(id1)).toBe(true)

    // Acquire should reuse the same handle
    const h2 = pool.acquire(200) // Also fits in 256 bucket
    expect(h2.id).toBe(id1)

    stats = pool.stats()
    expect(stats.allocated).toBe(1)
    expect(stats.pooled).toBe(0)
    expect(stats.totalPooledBytes).toBe(0)

    h2.release()
  })

  test("eviction on exceeding maxPoolSize", async () => {
    const pool = createBufferPool({
      allocationClass: "shared",
      backend: "metal",
      maxPoolSize: 2,
    })

    const h1 = pool.acquire(100) // 256
    const h2 = pool.acquire(200) // 256
    const h3 = pool.acquire(300) // 1024

    const id1 = h1.id
    const id2 = h2.id
    const id3 = h3.id

    pool.release(h1) // pooled: 1

    // We need to advance time or assume enqueuedAt relies on Date.now()
    // Since Date.now() can be fast, wait a bit
    await new Promise((resolve) => setTimeout(resolve, 2))

    pool.release(h2) // pooled: 2

    expect(pool.stats().pooled).toBe(2)
    expect(isValidHandle(id1)).toBe(true)
    expect(isValidHandle(id2)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 2))

    // Releasing h3 should exceed maxPoolSize (2)
    // h1 is the oldest and should be evicted
    pool.release(h3)

    expect(pool.stats().pooled).toBe(2) // Still 2
    expect(isValidHandle(id1)).toBe(false) // h1 was evicted and destroyed
    expect(isValidHandle(id2)).toBe(true)
    expect(isValidHandle(id3)).toBe(true)

    pool.drain()
  })

  test("drain releases all pooled handles", () => {
    const h1 = pool.acquire(100)
    const h2 = pool.acquire(1000)

    const id1 = h1.id
    const id2 = h2.id

    pool.release(h1)
    pool.release(h2)

    expect(pool.stats().pooled).toBe(2)
    expect(isValidHandle(id1)).toBe(true)
    expect(isValidHandle(id2)).toBe(true)

    pool.drain()

    expect(pool.stats().pooled).toBe(0)
    expect(isValidHandle(id1)).toBe(false)
    expect(isValidHandle(id2)).toBe(false)
  })

  test("releasing empty handle decrements allocated but is not pooled", () => {
    pool.acquire(100) // Increment peak and allocated to 1

    // Fake empty handle
    const emptyHandle = createStorageHandle({
      allocationClass: "device",
      backend: "cpu",
      sizeBytes: 0,
    })

    let stats = pool.stats()
    expect(stats.allocated).toBe(1)

    pool.release(emptyHandle)

    stats = pool.stats()
    expect(stats.allocated).toBe(0) // Should drop by 1
    expect(stats.pooled).toBe(0) // But not pooled

    emptyHandle.release()
  })
})
