/**
 * Dharma Corestore — Tests
 *
 * Tests the Corestore namespace management without real disk I/O.
 * The `corestore` module is mocked to avoid filesystem dependencies.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test"
import { DharmaCorestore, CoreName } from "../corestore"
import type { CorestoreConfig } from "../corestore"
import { DEFAULT_REPLICATION_LIMITS } from "../protocol"

// ── Mock Setup ---------------------------------------------------------------

/** Tracks every `store.get(name)` call made during a test. */
const getNameCalls: string[] = []

/** Shared mock Hypercore object used as the return value of store.get(). */
const mockCore = {
  ready: mock(() => Promise.resolve()),
  append: mock(() => Promise.resolve(0)),
  get: mock(() => Promise.resolve(new Uint8Array(0))),
  length: 0,
  key: null as Uint8Array | null,
  discoveryKey: null as Uint8Array | null,
  close: mock(() => Promise.resolve()),
}

/** Returns a fresh mock Corestore that resets the call tracker. */
function createMockCorestore() {
  getNameCalls.length = 0
  return {
    ready: mock(() => Promise.resolve()),
    get: mock((name: string) => {
      getNameCalls.push(name)
      // Return a new object each time so caching can be observed by identity
      return {
        ...mockCore,
        ready: mock(() => Promise.resolve()),
      }
    }),
    close: mock(() => Promise.resolve()),
  }
}

// Mock the corestore module before any imports from "../corestore"
// Note: bun's mock.module intercepts at import time.
let mockStoreInstance = createMockCorestore()

mock.module("corestore", () => ({
  default: mock(function MockCorestore(this: unknown, _path: string) {
    // Each construction returns the same shared instance so tests
    // can observe interactions through the singleton.
    return mockStoreInstance
  }),
}))

// ── Helpers ------------------------------------------------------------------

const TEST_CONFIG: CorestoreConfig = {
  storagePath: "/tmp/test-dharma-corestore/",
  limits: DEFAULT_REPLICATION_LIMITS,
}

// ── CoreName Helpers ---------------------------------------------------------

describe("CoreName helpers", () => {
  it("system returns a deterministic name", () => {
    expect(CoreName.system()).toBe("dharma/system")
  })

  it("writer produces correct path", () => {
    const name = CoreName.writer("fed-abc", "id-42")
    expect(name).toBe("dharma/federation/fed-abc/writer/id-42")
  })

  it("view produces correct path", () => {
    const name = CoreName.view("fed-abc")
    expect(name).toBe("dharma/federation/fed-abc/view")
  })

  it("checkpoint produces correct path", () => {
    const name = CoreName.checkpoint("fed-abc")
    expect(name).toBe("dharma/federation/fed-abc/checkpoint")
  })

  it("privateInbox produces correct path", () => {
    const name = CoreName.privateInbox("fed-abc")
    expect(name).toBe("dharma/federation/fed-abc/private-inbox")
  })

  it("different federation IDs produce different paths", () => {
    const a = CoreName.view("fed-1")
    const b = CoreName.view("fed-2")
    expect(a).not.toBe(b)
  })

  it("different identity IDs produce different writer paths", () => {
    const a = CoreName.writer("fed", "id-1")
    const b = CoreName.writer("fed", "id-2")
    expect(a).not.toBe(b)
  })
})

// ── Constructor --------------------------------------------------------------

describe("DharmaCorestore constructor", () => {
  it("creates a Corestore with the given storage path", () => {
    // Each test gets its own mock
    mockStoreInstance = createMockCorestore()

    const dc = new DharmaCorestore(TEST_CONFIG)
    const store = dc.getStore()

    // The store is what the mocked module returned
    expect(store).toBeDefined()
    expect(typeof store.ready).toBe("function")
    expect(typeof store.get).toBe("function")
    expect(typeof store.close).toBe("function")
  })

  it("exposes the config via getConfig()", () => {
    mockStoreInstance = createMockCorestore()
    const dc = new DharmaCorestore(TEST_CONFIG)
    expect(dc.getConfig()).toBe(TEST_CONFIG)
    expect(dc.getConfig().storagePath).toBe("/tmp/test-dharma-corestore/")
  })

  it("isOpened starts as false", () => {
    mockStoreInstance = createMockCorestore()
    const dc = new DharmaCorestore(TEST_CONFIG)
    expect(dc.isOpened).toBe(false)
  })

  it("open() transitions isOpened to true", async () => {
    mockStoreInstance = createMockCorestore()
    const dc = new DharmaCorestore(TEST_CONFIG)
    expect(dc.isOpened).toBe(false)
    await dc.open()
    expect(dc.isOpened).toBe(true)
  })

  it("close() transitions isOpened to false", async () => {
    mockStoreInstance = createMockCorestore()
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    expect(dc.isOpened).toBe(true)
    await dc.close()
    expect(dc.isOpened).toBe(false)
  })

  it("open() is idempotent", async () => {
    mockStoreInstance = createMockCorestore()
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.open() // second call should be no-op
    expect(mockStoreInstance.ready).toHaveBeenCalledTimes(1)
  })

  it("close() is idempotent", async () => {
    mockStoreInstance = createMockCorestore()
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.close() // never opened — should be no-op
    expect(dc.isOpened).toBe(false)
  })
})

// ── Core Access — Name Delegation -------------------------------------------

describe("DharmaCorestore core name delegation", () => {
  beforeEach(() => {
    mockStoreInstance = createMockCorestore()
  })

  it("getCore delegates to store.get() with the given name", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.getCore("my-custom-core")
    expect(mockStoreInstance.get).toHaveBeenCalledWith("my-custom-core")
  })

  it("getSystemCore delegates to store.get() with 'dharma/system'", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.getSystemCore()
    expect(mockStoreInstance.get).toHaveBeenCalledWith("dharma/system")
  })

  it("getWriterCore delegates with correct deterministic name", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.getWriterCore("fed-xyz", "id-99")
    expect(mockStoreInstance.get).toHaveBeenCalledWith(
      "dharma/federation/fed-xyz/writer/id-99",
    )
  })

  it("getViewCore delegates with correct deterministic name", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.getViewCore("fed-xyz")
    expect(mockStoreInstance.get).toHaveBeenCalledWith(
      "dharma/federation/fed-xyz/view",
    )
  })

  it("getCheckpointCore delegates with correct deterministic name", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.getCheckpointCore("fed-xyz")
    expect(mockStoreInstance.get).toHaveBeenCalledWith(
      "dharma/federation/fed-xyz/checkpoint",
    )
  })

  it("getPrivateInboxCore delegates with correct deterministic name", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.getPrivateInboxCore("fed-xyz")
    expect(mockStoreInstance.get).toHaveBeenCalledWith(
      "dharma/federation/fed-xyz/private-inbox",
    )
  })
})

// ── Caching ------------------------------------------------------------------

describe("DharmaCorestore caching", () => {
  beforeEach(() => {
    mockStoreInstance = createMockCorestore()
  })

  it("getCore returns the same instance for the same name", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    const first = await dc.getCore("my-core")
    const second = await dc.getCore("my-core")
    expect(first).toBe(second)
  })

  it("getCore only calls store.get() once per unique name", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.getCore("my-core")
    await dc.getCore("my-core") // should hit cache
    expect(mockStoreInstance.get).toHaveBeenCalledTimes(1)
  })

  it("different names produce different cached instances", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    const a = await dc.getCore("core-a")
    const b = await dc.getCore("core-b")
    expect(a).not.toBe(b)
    expect(mockStoreInstance.get).toHaveBeenCalledTimes(2)
  })

  it("hasCore returns true after getCore", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    expect(await dc.hasCore("test-core")).toBe(false)
    await dc.getCore("test-core")
    expect(await dc.hasCore("test-core")).toBe(true)
  })

  it("hasCore returns false for unknown cores", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    expect(await dc.hasCore("never-created")).toBe(false)
  })

  it("close() clears the cache", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.getCore("my-core")
    expect(await dc.hasCore("my-core")).toBe(true)
    await dc.close()
    expect(await dc.hasCore("my-core")).toBe(false)
  })
})

// ── Replication Cores --------------------------------------------------------

describe("getReplicationCores", () => {
  beforeEach(() => {
    mockStoreInstance = createMockCorestore()
  })

  it("returns only federation-prefixed cores", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.getSystemCore() // system — should NOT be included
    await dc.getViewCore("fed-1")
    await dc.getWriterCore("fed-1", "id-a")

    const replication = dc.getReplicationCores()
    expect(replication).toHaveLength(2)
  })

  it("returns empty array when no federation cores opened", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.getSystemCore()
    expect(dc.getReplicationCores()).toHaveLength(0)
  })

  it("returns cores from multiple federations", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.getViewCore("fed-1")
    await dc.getViewCore("fed-2")
    await dc.getCheckpointCore("fed-1")
    expect(dc.getReplicationCores()).toHaveLength(3)
  })

  it("identity of returned cores matches what was cached", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    const view1 = await dc.getViewCore("fed-1")
    const view2 = await dc.getViewCore("fed-2")
    const cores = dc.getReplicationCores()
    expect(cores).toContain(view1)
    expect(cores).toContain(view2)
  })
})

// ── Close behavior -----------------------------------------------------------

describe("close behavior", () => {
  beforeEach(() => {
    mockStoreInstance = createMockCorestore()
  })

  it("calls store.close()", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.close()
    expect(mockStoreInstance.close).toHaveBeenCalledTimes(1)
  })

  it("calling open after close restores the store", async () => {
    const dc = new DharmaCorestore(TEST_CONFIG)
    await dc.open()
    await dc.close()
    expect(dc.isOpened).toBe(false)

    await dc.open()
    expect(dc.isOpened).toBe(true)
    expect(mockStoreInstance.ready).toHaveBeenCalledTimes(2)
  })
})
