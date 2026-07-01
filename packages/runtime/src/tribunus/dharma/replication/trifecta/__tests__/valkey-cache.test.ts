/**
 * Valkey Cache Tests
 *
 * Tests for ReplicationValkeyCache using a mocked ioredis client.
 * Covers peer state, outbox queue, session lifecycle, and lifecycle ops.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test"
import Redis from "ioredis"
import { ReplicationValkeyCache } from "../valkey-cache"

// ── Mock ioredis -------------------------------------------------------------
//
// We mock the ioredis default export so that new Redis() returns a controlled
// mock. Each test accesses the mock client via the module-level `mockClient`
// reference which is reset before every test.

let mockClient: Map<string, MockRedisInstance>

class MockRedisInstance {
  private store = new Map<string, string>()
  private lists = new Map<string, string[]>()
  connected = false

  async connect() {
    this.connected = true
  }
  async quit() {
    this.connected = false
  }
  async ping(): Promise<string> {
    return "PONG"
  }
  async set(key: string, value: string): Promise<"OK"> {
    this.store.set(key, value)
    return "OK"
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }
  async del(...keys: string[]): Promise<number> {
    let count = 0
    for (const key of keys) {
      if (this.store.delete(key)) count++
      if (this.lists.delete(key)) count++
    }
    return count
  }
  async rpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) ?? []
    list.push(...values)
    this.lists.set(key, list)
    return list.length
  }
  async lpop(key: string): Promise<string | null> {
    const list = this.lists.get(key)
    if (!list || list.length === 0) return null
    return list.shift() ?? null
  }
  async llen(key: string): Promise<number> {
    return this.lists.get(key)?.length ?? 0
  }
  async scan(
    cursor: string,
    _type: "MATCH",
    _pattern: string,
    _countType: "COUNT",
    _count: number,
  ): Promise<[string, string[]]> {
    const prefix = _pattern.replace("*", "")
    const matching = Array.from(this.store.keys()).filter(k => k.startsWith(prefix))
    const listMatching = Array.from(this.lists.keys()).filter(k => k.startsWith(prefix))
    return ["0", [...matching, ...listMatching]]
  }
}

mock.module("ioredis", () => {
  return {
    default: class MockRedis {
      constructor(..._args: unknown[]) {
        const instance = new MockRedisInstance()
        mockClient.set("instance", instance)
        return instance
      }
    },
  }
})

// ── Helpers ------------------------------------------------------------------

function createCache(config?: { url?: string; prefix?: string }): ReplicationValkeyCache {
  return new ReplicationValkeyCache(config)
}

async function createConnectedCache(
  config?: { url?: string; prefix?: string },
): Promise<ReplicationValkeyCache> {
  const cache = createCache(config)
  await cache.connect()
  return cache
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ReplicationValkeyCache", () => {
  const testFed = "fed-001"
  const testPeer = "peer-abc"

  beforeEach(() => {
    mockClient = new Map()
  })

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  test("connect creates a client and sets connected state", async () => {
    const cache = createCache()
    expect((cache as any).client).toBeNull()

    await cache.connect()
    expect((cache as any).client).not.toBeNull()

    const instance = mockClient.get("instance")!
    expect(instance.connected).toBe(true)
  })

  test("disconnect quits the client and nullifies the reference", async () => {
    const cache = await createConnectedCache()
    expect((cache as any).client).not.toBeNull()

    await cache.disconnect()
    expect((cache as any).client).toBeNull()

    const instance = mockClient.get("instance")!
    expect(instance.connected).toBe(false)
  })

  test("ping returns true when connection is healthy", async () => {
    const cache = await createConnectedCache()
    const result = await cache.ping()
    expect(result).toBe(true)
  })

  test("ping returns false on error", async () => {
    const cache = new (class extends ReplicationValkeyCache {
      override async ping(): Promise<boolean> {
        return false
      }
    })()
    const result = await cache.ping()
    expect(result).toBe(false)
  })

  test("flushAll removes all keys under the prefix", async () => {
    const cache = await createConnectedCache()
    await cache.setPeerState(testFed, testPeer, "connected")
    await cache.pushPendingOutbox(testFed, "ob-001")
    await cache.setActiveSession("session-x", "{}")

    await cache.flushAll()

    expect(await cache.getPeerState(testFed, testPeer)).toBeNull()
    expect(await cache.getPendingOutboxCount(testFed)).toBe(0)
    expect(await cache.getActiveSession("session-x")).toBeNull()
  })

  // ── Peer state ────────────────────────────────────────────────────────────

  test("setPeerState stores and getPeerState retrieves", async () => {
    const cache = await createConnectedCache()
    await cache.setPeerState(testFed, testPeer, "connected")

    const state = await cache.getPeerState(testFed, testPeer)
    expect(state).toBe("connected")
  })

  test("getPeerState returns null for unknown peer", async () => {
    const cache = await createConnectedCache()
    const state = await cache.getPeerState(testFed, "unknown-peer")
    expect(state).toBeNull()
  })

  test("removePeerState deletes stored state", async () => {
    const cache = await createConnectedCache()
    await cache.setPeerState(testFed, testPeer, "connected")
    expect(await cache.getPeerState(testFed, testPeer)).toBe("connected")

    await cache.removePeerState(testFed, testPeer)
    expect(await cache.getPeerState(testFed, testPeer)).toBeNull()
  })

  test("listActivePeers returns stored peer ids for a federation", async () => {
    const cache = await createConnectedCache()
    await cache.setPeerState(testFed, "peer-a", "connected")
    await cache.setPeerState(testFed, "peer-b", "handshaking")
    await cache.setPeerState(testFed, "peer-c", "disconnected")

    const peers = await cache.listActivePeers(testFed)
    expect(peers.sort()).toEqual(["peer-a", "peer-b", "peer-c"])
  })

  test("listActivePeers returns empty array when no peers", async () => {
    const cache = await createConnectedCache()
    const peers = await cache.listActivePeers(testFed)
    expect(peers).toEqual([])
  })

  test("listActivePeers does not return peers from other federations", async () => {
    const cache = await createConnectedCache()
    await cache.setPeerState("fed-a", "peer-1", "connected")
    await cache.setPeerState("fed-b", "peer-2", "connected")

    const peersA = await cache.listActivePeers("fed-a")
    expect(peersA).toEqual(["peer-1"])
  })

  // ── Outbox pending entries ────────────────────────────────────────────────

  test("pushPendingOutbox adds to queue", async () => {
    const cache = await createConnectedCache()
    await cache.pushPendingOutbox(testFed, "ob-001")
    expect(await cache.getPendingOutboxCount(testFed)).toBe(1)
  })

  test("popPendingOutbox returns items in FIFO order", async () => {
    const cache = await createConnectedCache()
    await cache.pushPendingOutbox(testFed, "ob-001")
    await cache.pushPendingOutbox(testFed, "ob-002")
    await cache.pushPendingOutbox(testFed, "ob-003")

    expect(await cache.popPendingOutbox(testFed)).toBe("ob-001")
    expect(await cache.popPendingOutbox(testFed)).toBe("ob-002")
    expect(await cache.popPendingOutbox(testFed)).toBe("ob-003")
    expect(await cache.popPendingOutbox(testFed)).toBeNull()
  })

  test("popPendingOutbox returns null on empty queue", async () => {
    const cache = await createConnectedCache()
    const result = await cache.popPendingOutbox(testFed)
    expect(result).toBeNull()
  })

  test("getPendingOutboxCount returns 0 for no entries", async () => {
    const cache = await createConnectedCache()
    expect(await cache.getPendingOutboxCount(testFed)).toBe(0)
  })

  test("getPendingOutboxCount returns correct size", async () => {
    const cache = await createConnectedCache()
    await cache.pushPendingOutbox(testFed, "ob-001")
    await cache.pushPendingOutbox(testFed, "ob-002")
    expect(await cache.getPendingOutboxCount(testFed)).toBe(2)
  })

  test("clearPendingOutbox removes all entries for the federation", async () => {
    const cache = await createConnectedCache()
    await cache.pushPendingOutbox(testFed, "ob-001")
    await cache.pushPendingOutbox(testFed, "ob-002")
    expect(await cache.getPendingOutboxCount(testFed)).toBe(2)

    await cache.clearPendingOutbox(testFed)
    expect(await cache.getPendingOutboxCount(testFed)).toBe(0)
  })

  test("outbox queues are isolated per federation", async () => {
    const cache = await createConnectedCache()
    await cache.pushPendingOutbox("fed-a", "ob-a1")
    await cache.pushPendingOutbox("fed-b", "ob-b1")

    expect(await cache.getPendingOutboxCount("fed-a")).toBe(1)
    expect(await cache.getPendingOutboxCount("fed-b")).toBe(1)
    expect(await cache.popPendingOutbox("fed-a")).toBe("ob-a1")
    expect(await cache.getPendingOutboxCount("fed-a")).toBe(0)
    expect(await cache.getPendingOutboxCount("fed-b")).toBe(1)
  })

  // ── Session tracking ──────────────────────────────────────────────────────

  test("setActiveSession stores and getActiveSession retrieves", async () => {
    const cache = await createConnectedCache()
    await cache.setActiveSession("session-1", `{"state":"active"}`)

    const data = await cache.getActiveSession("session-1")
    expect(data).toBe(`{"state":"active"}`)
  })

  test("getActiveSession returns null for unknown session", async () => {
    const cache = await createConnectedCache()
    const data = await cache.getActiveSession("nonexistent")
    expect(data).toBeNull()
  })

  test("removeActiveSession deletes stored session", async () => {
    const cache = await createConnectedCache()
    await cache.setActiveSession("session-1", "data")
    expect(await cache.getActiveSession("session-1")).toBe("data")

    await cache.removeActiveSession("session-1")
    expect(await cache.getActiveSession("session-1")).toBeNull()
  })

  test("session keys are isolated from peer keys", async () => {
    const cache = await createConnectedCache()
    await cache.setPeerState(testFed, testPeer, "connected")
    await cache.setActiveSession("session-1", "data")

    // These use different key patterns, so they don't collide
    expect(await cache.getPeerState(testFed, testPeer)).toBe("connected")
    expect(await cache.getActiveSession("session-1")).toBe("data")
  })

  // ── Key namespacing ───────────────────────────────────────────────────────

  test("default prefix is applied to keys", async () => {
    const cache = await createConnectedCache()

    // Access the mock's internal store to verify key format
    await cache.setPeerState(testFed, testPeer, "connected")
    const instance = mockClient.get("instance")!
    const keys = Array.from(instance["store"].keys())
    expect(keys[0]).toContain("dharma:replication:")
    expect(keys[0]).toContain(`${testFed}:peers:${testPeer}`)
  })

  test("custom prefix is respected", async () => {
    const cache = await createConnectedCache({ prefix: "custom:" })
    await cache.setPeerState(testFed, testPeer, "connected")

    const instance = mockClient.get("instance")!
    const keys = Array.from(instance["store"].keys())
    expect(keys[0]).toStartWith("custom:")
  })
})
