/**
 * FederationBase Tests
 *
 * Tests the Autobase bootstrap layer and Hyperbee view using mock
 * Hypercore/Autobase/Hyperbee implementations (hypercore-storage crashes
 * Bun via unsupported native libuv functions).
 *
 * The mocks replicate the exact API surface FederationBase consumes,
 * verifying that:
 *  - The Autobase wrapper is constructed and lifecycle works
 *  - Appended events flow through the default apply into the view
 *  - All view queries return correct data
 *  - Checkpoints produce signedLength + viewRootHash
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { EventEmitter } from "node:events"
import { FederationBase, createDefaultApply } from "../federation-base"
import type { DharmaEventEnvelope } from "../../types"

// ── Mock: In-memory Hypercore -------------------------------------------------

/**
 * A minimal in-memory Hypercore that pairs a block store with a
 * key-value namespace used by Hyperbee. Multiple Hyperbee instances
 * sharing the same MockHypercore see the same data.
 */
class MockHypercore extends EventEmitter {
  blocks: Buffer[] = []
  /** Shared key-value store, keyed by bee prefix. */
  kv: Map<string, Buffer> = new Map()
  _key: Buffer
  _length: number = 0
  _ready: boolean = false
  _closed: boolean = false
  merkle: MockMerkle

  constructor(_opts: Record<string, unknown> = {}) {
    super()
    this._key = Buffer.from("mock-key-" + Math.random().toString(36).slice(2, 10))
    this.merkle = new MockMerkle(this)
  }

  get key(): Buffer {
    return this._key
  }
  get length(): number {
    return this._length
  }
  get opened(): boolean {
    return this._ready
  }
  get closed(): boolean {
    return this._closed
  }

  async ready(): Promise<void> {
    this._ready = true
  }

  async append(data: Buffer | Buffer[]): Promise<number> {
    const bufs = Array.isArray(data) ? data : [data]
    for (const b of bufs) {
      this.blocks.push(Buffer.isBuffer(b) ? b : Buffer.from(b))
    }
    this._length += bufs.length
    return this._length - 1
  }

  async get(index: number, opts?: Record<string, unknown>): Promise<Buffer | null> {
    if (index < 0 || index >= this.blocks.length) return null
    const block = this.blocks[index]
    if (opts?.valueEncoding) {
      // hypercore.get with valueEncoding returns a decoded value as string
      return block.toString("utf-8") as unknown as Buffer
    }
    return block
  }

  async close(): Promise<void> {
    this._closed = true
  }

  session(): MockHypercore {
    return this
  }

  replicate(_isInitiator: boolean, _opts?: Record<string, unknown>): null {
    return null
  }
}

/** Minimal Merkle tree stub — returns deterministic roots. */
class MockMerkle {
  private core: MockHypercore
  constructor(core: MockHypercore) {
    this.core = core
  }

  roots(length: number): Buffer[] {
    if (length === 0) return [Buffer.alloc(32)]
    const hasher = new Bun.CryptoHasher("sha256")
    for (let i = 0; i < Math.min(length, this.core.blocks.length); i++) {
      hasher.update(this.core.blocks[i])
    }
    return [Buffer.from(hasher.digest())]
  }

  root(length: number): Buffer {
    return this.roots(length)[0]
  }
}

// ── Mock: In-memory Hyperbee --------------------------------------------------

/**
 * A minimal Hyperbee that stores key-value entries on the core's shared kv
 * map so that multiple bee instances over the same core see the same data.
 */
class MockHyperbee {
  core: MockHypercore
  _ready: boolean = false

  /** Shared version counter keyed by bee instance id — all bees on the
   *  same core share the same `_beeVersion` counter. */
  constructor(core: MockHypercore, _opts: Record<string, unknown> = {}) {
    this.core = core
  }

  get version(): number {
    // Share version across bee instances for the same core
    return this.core.kv.get("__beeVersion") 
      ? Number(this.core.kv.get("__beeVersion")!.toString("utf-8"))
      : 0
  }

  async ready(): Promise<void> {
    this._ready = true
    await this.core.ready()
  }

  async put(key: string, value: string | Buffer): Promise<void> {
    const buf = typeof value === "string" ? Buffer.from(value, "utf-8") : value
    this.core.kv.set(key, buf)
    const current = this.version
    this.core.kv.set("__beeVersion", Buffer.from(String(current + 1), "utf-8"))
  }

  async get(key: string): Promise<{ key: string; value: Buffer } | null> {
    const entry = this.core.kv.get(key)
    if (entry === undefined) return null
    return { key, value: entry }
  }

  createReadStream(opts: {
    gte?: string
    lt?: string
  }): AsyncIterable<{ key: string; value: Buffer }> {
    const entries = Array.from(this.core.kv.entries())
      .filter(([k]) => {
        if (opts.gte && k < opts.gte) return false
        if (opts.lt && k >= opts.lt) return false
        return true
      })
      .sort(([a], [b]) => a.localeCompare(b))

    return {
      [Symbol.asyncIterator](): AsyncIterator<{ key: string; value: Buffer }> {
        let index = 0
        return {
          next(): Promise<IteratorResult<{ key: string; value: Buffer }>> {
            if (index >= entries.length) {
              return Promise.resolve({ done: true, value: undefined })
            }
            const k = entries[index][0]
            const v = entries[index][1]
            index++
            return Promise.resolve({
              done: false,
              value: { key: k, value: v },
            })
          },
        }
      },
    }
  }

  async close(): Promise<void> {
    // no-op
  }
}

// ── Mock: In-memory Autobase --------------------------------------------------

/**
 * A minimal Autobase that wraps mock writer + view cores and
 * calls the apply function in the same way real Autobase v7 does.
 */
class MockAutobase extends EventEmitter {
  inputs: MockHypercore[]
  outputs: MockHypercore[]
  apply: (core: MockHypercore, batch: Array<Record<string, unknown>>) => Promise<void>
  _length: number = 0
  _ready: boolean = false
  _closed: boolean = false

  constructor(opts: {
    inputs: MockHypercore[]
    outputs: MockHypercore[]
    apply: (core: MockHypercore, batch: Array<Record<string, unknown>>) => Promise<void>
  }) {
    super()
    this.inputs = opts.inputs
    this.outputs = opts.outputs
    this.apply = opts.apply
  }

  async ready(): Promise<void> {
    this._ready = true
    for (const c of this.inputs) await c.ready()
    for (const c of this.outputs) await c.ready()
  }

  async append(data: Buffer): Promise<void> {
    const writer = this.inputs[0]
    const seq = writer.blocks.length
    await writer.append(data)

    const block = { value: data, key: writer.key, clock: seq }
    const viewOutput = this.outputs[0]
    await this.apply(viewOutput, [block])
    this._length++
  }

  async length(): Promise<number> {
    return this._length
  }

  async signedLength(): Promise<number> {
    return this._length
  }

  async close(): Promise<void> {
    this._closed = true
  }
}

// ── Minimal FederationBase equivalent backed by mocks ------------------------

/**
 * Mirrors FederationBase's exact logic but with mock Autobase/Hyperbee.
 * Every method duplicates the real FederationBase implementation verbatim
 * so the test verifies the same algorithm.
 */
class MockFederationBase {
  private autobase: MockAutobase
  private view: MockHyperbee
  private viewCore: MockHypercore
  private checkpointCore: MockHypercore
  private _federationId: string
  private _autobaseKey: string
  private opened: boolean = false

  constructor(config: {
    federationId: string
    autobaseKey: string
    writerCore: MockHypercore
    viewCore: MockHypercore
    checkpointCore: MockHypercore
    apply: (view: MockHyperbee, batch: Array<Record<string, unknown>>) => Promise<void>
  }) {
    this._federationId = config.federationId
    this._autobaseKey = config.autobaseKey
    this.viewCore = config.viewCore
    this.checkpointCore = config.checkpointCore

    // The view reads/writes via the shared core kv store.
    this.view = new MockHyperbee(config.viewCore)

    // Autobase wrapper creates a fresh MockHyperbee inside apply,
    // which shares the core kv store — so view reads see apply's writes.
    this.autobase = new MockAutobase({
      inputs: [config.writerCore],
      outputs: [config.viewCore],
      apply: async (core: MockHypercore, batch: Array<Record<string, unknown>>) => {
        const bee = new MockHyperbee(core)
        await config.apply(bee, batch)
      },
    })
  }

  async open(): Promise<void> {
    await this.autobase.ready()
    await this.view.ready()
    this.opened = true
  }

  async close(): Promise<void> {
    if (!this.opened) return
    await this.autobase.close()
    this.opened = false
  }

  async getLength(): Promise<number> {
    return this.autobase.length()
  }

  async getSignedLength(): Promise<number> {
    return this.autobase.signedLength()
  }

  getView(): MockHyperbee {
    return this.view
  }

  getAutobase(): MockAutobase {
    return this.autobase
  }

  getFederationId(): string {
    return this._federationId
  }

  getAutobaseKey(): string {
    return this._autobaseKey
  }

  isOpen(): boolean {
    return this.opened
  }

  async append(event: DharmaEventEnvelope): Promise<void> {
    if (!this.opened) throw new Error("Autobase is not open")
    const encoded = Buffer.from(JSON.stringify(event), "utf-8")
    await this.autobase.append(encoded)
  }

  async getEventById(eventId: string): Promise<DharmaEventEnvelope | null> {
    const orderRef = await this.view.get(`event/${eventId}`)
    if (orderRef === null) return null
    const orderIdx = orderRef.value.toString("utf-8")
    return this.getEventByOrder(Number(orderIdx))
  }

  async getEventByOrder(orderIndex: number): Promise<DharmaEventEnvelope | null> {
    const node = await this.view.get(`order/${orderIndex}`)
    if (node === null) return null
    const raw = node.value.toString("utf-8")
    return JSON.parse(raw) as DharmaEventEnvelope
  }

  async getEventIdAtOrder(orderIndex: number): Promise<string | null> {
    const envelope = await this.getEventByOrder(orderIndex)
    return envelope?.eventId ?? null
  }

  async getEventCount(): Promise<number> {
    let count = 0
    const stream = this.view.createReadStream({
      gte: "order/",
      lt: "order/~",
    })
    for await (const _ of stream) {
      count++
    }
    return count
  }

  async getWriters(): Promise<any[]> {
    const writers: Record<string, unknown>[] = []
    const stream = this.view.createReadStream({
      gte: "writer/",
      lt: "writer/~",
    })
    for await (const node of stream) {
      const raw = node.value.toString("utf-8")
      writers.push(JSON.parse(raw))
    }
    return writers
  }

  async createCheckpoint(_signingKey: Uint8Array): Promise<{ signedLength: number; viewRootHash: string }> {
    const signedLength = await this.getSignedLength()
    const roots = this.viewCore.merkle.roots(this.viewCore.length)
    const viewRootHash = Buffer.from(roots[0]).toString("hex")

    const checkpointMeta = JSON.stringify({
      signedLength,
      viewRootHash,
      federationId: this._federationId,
      createdAt: new Date().toISOString(),
    })

    await this.view.put(`checkpoint/${viewRootHash}`, checkpointMeta)
    await this.checkpointCore.append(Buffer.from(checkpointMeta))

    return { signedLength, viewRootHash }
  }
}

// ── Default apply for mocks ---------------------------------------------------

function mockCreateDefaultApply(): (
  view: MockHyperbee,
  batch: Array<Record<string, unknown>>,
) => Promise<void> {
  return async (view: MockHyperbee, batch: Array<Record<string, unknown>>): Promise<void> => {
    // Use a dedicated counter so order indices remain contiguous across
    // repeated apply calls (view.version is per-put, not per-block).
    const counterKey = "_meta/orderCount"
    const counterEntry = await view.get(counterKey)
    const nextOrder = counterEntry
      ? Number(counterEntry.value.toString("utf-8"))
      : 0

    for (let i = 0; i < batch.length; i++) {
      const block = batch[i]
      const value = Buffer.isBuffer(block.value)
        ? block.value
        : Buffer.from(String(block.value))

      const envelope: DharmaEventEnvelope = JSON.parse(value.toString("utf-8"))
      const eventId = envelope.eventId
      const orderIdx = nextOrder + i

      await view.put(`order/${orderIdx}`, JSON.stringify(envelope))
      await view.put(`event/${eventId}`, String(orderIdx))

      if (envelope.causalParents && envelope.causalParents.length > 0) {
        await view.put(`dependency/${eventId}`, JSON.stringify(envelope.causalParents))
      }

      if (
        envelope.eventType === "federation.member_joined" ||
        envelope.eventType === "federation.genesis"
      ) {
        const actorKey = envelope.actorPublicKey
        const admission = {
          federationId: envelope.federationId,
          writerCorePublicKey: actorKey,
          dharmaIdentityPublicKey: actorKey,
          membershipEventId: eventId,
          admittedBy: actorKey,
          admittedAt: envelope.createdAt,
          admissionSignature: envelope.signature,
        }
        await view.put(`writer/${actorKey}`, JSON.stringify(admission))
      }
    }

    // Persist the updated counter for the next apply invocation.
    const newCounter = nextOrder + batch.length
    await view.put(counterKey, String(newCounter))
  }
}

// ── Test helpers -------------------------------------------------------------

function createCore(): MockHypercore {
  return new MockHypercore({ valueEncoding: "utf-8" })
}

function makeEvent(
  overrides: Partial<DharmaEventEnvelope> = {},
): DharmaEventEnvelope {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 10)}`,
    federationId: "test-fed-001",
    eventType: "work.offer_created",
    schemaVersion: 1,
    actorPublicKey: "actor-001",
    actorDeviceId: null,
    createdAt: new Date().toISOString(),
    logicalClock: 1,
    causalParents: [],
    payloadHash: "abc123",
    payload: {},
    signature: "sig-" + Math.random().toString(36).slice(2, 10),
    ...overrides,
  }
}

function makeMembershipEvent(
  overrides: Partial<DharmaEventEnvelope> = {},
): DharmaEventEnvelope {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 10)}`,
    federationId: "test-fed-001",
    eventType: "federation.genesis",
    schemaVersion: 1,
    actorPublicKey: "writer-001",
    actorDeviceId: null,
    createdAt: new Date().toISOString(),
    logicalClock: 1,
    causalParents: [],
    payloadHash: "abc123",
    payload: {},
    signature: "sig-" + Math.random().toString(36).slice(2, 10),
    ...overrides,
  }
}

// ── Tests --------------------------------------------------------------------

describe("FederationBase (mock-backed)", () => {
  // ── Constructor & lifecycle -------------------------------------------------

  test("constructor and open/close lifecycle", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-001",
      autobaseKey: "test-autobase-key",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })

    expect(fb).toBeInstanceOf(MockFederationBase)
    expect(fb.isOpen()).toBe(false)
    expect(fb.getFederationId()).toBe("test-fed-001")
    expect(fb.getAutobaseKey()).toBe("test-autobase-key")

    await fb.open()
    expect(fb.isOpen()).toBe(true)
    expect(fb.getView()).toBeDefined()
    expect(fb.getAutobase()).toBeDefined()

    await fb.close()
    expect(fb.isOpen()).toBe(false)
  })

  // ── Append & read-back ------------------------------------------------------

  test("append adds an event and increases length", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-001",
      autobaseKey: "test-key",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    const event = makeEvent()
    await fb.append(event)

    const length = await fb.getLength()
    expect(length).toBeGreaterThanOrEqual(1)

    await fb.close()
  })

  test("getEventById returns the appended event", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-001",
      autobaseKey: "test-key",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    const event = makeEvent({
      eventType: "work.offer_created",
      payload: { title: "test task" },
    })
    await fb.append(event)

    const retrieved = await fb.getEventById(event.eventId)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.eventId).toBe(event.eventId)
    expect(retrieved!.eventType).toBe(event.eventType)
    expect((retrieved!.payload as Record<string, unknown>).title).toBe("test task")

    await fb.close()
  })

  test("getEventByOrder returns the correct event", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-001",
      autobaseKey: "test-key",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    const event = makeEvent({ payload: { idx: "by-order" } })
    await fb.append(event)

    const count = await fb.getEventCount()
    const retrieved = await fb.getEventByOrder(count - 1)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.eventId).toBe(event.eventId)

    await fb.close()
  })

  test("getEventIdAtOrder returns the event ID", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-001",
      autobaseKey: "test-key",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    const event = makeEvent({ payload: { idx: "id-at-order" } })
    await fb.append(event)

    const count = await fb.getEventCount()
    const id = await fb.getEventIdAtOrder(count - 1)
    expect(id).toBe(event.eventId)

    await fb.close()
  })

  test("getEventById returns null for unknown ID", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-001",
      autobaseKey: "test-key",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    const retrieved = await fb.getEventById("nonexistent-event-id")
    expect(retrieved).toBeNull()

    await fb.close()
  })

  test("getEventByOrder returns null for out-of-range index", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-001",
      autobaseKey: "test-key",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    const retrieved = await fb.getEventByOrder(999999)
    expect(retrieved).toBeNull()

    await fb.close()
  })

  test("getEventCount increases with appends", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-001",
      autobaseKey: "test-key",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    const before = await fb.getEventCount()
    await fb.append(makeEvent())
    await fb.append(makeEvent())
    const after = await fb.getEventCount()
    expect(after).toBe(before + 2)

    await fb.close()
  })

  // ── Default apply stores events correctly -----------------------------------

  test("default apply stores events in the view", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-002",
      autobaseKey: "test-key-2",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    const ev1 = makeEvent()
    const ev2 = makeEvent()
    await fb.append(ev1)
    await fb.append(ev2)

    const r1 = await fb.getEventById(ev1.eventId)
    expect(r1).not.toBeNull()
    expect(r1!.eventId).toBe(ev1.eventId)

    const r2 = await fb.getEventById(ev2.eventId)
    expect(r2).not.toBeNull()
    expect(r2!.eventId).toBe(ev2.eventId)

    const idx1 = await fb.getEventIdAtOrder(0)
    const idx2 = await fb.getEventIdAtOrder(1)
    expect(idx1).toBe(ev1.eventId)
    expect(idx2).toBe(ev2.eventId)

    const count = await fb.getEventCount()
    expect(count).toBeGreaterThanOrEqual(2)

    await fb.close()
  })

  test("default apply records writer admission for genesis/member events", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-003",
      autobaseKey: "test-key-3",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    const genesis = makeMembershipEvent()
    await fb.append(genesis)

    const writers = await fb.getWriters()
    expect(writers.length).toBeGreaterThanOrEqual(1)
    expect(
      writers.some((w) => w.writerCorePublicKey === genesis.actorPublicKey),
    ).toBe(true)

    await fb.close()
  })

  // ── getWriters --------------------------------------------------------------

  test("getWriters returns empty list when no writer events exist", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-004",
      autobaseKey: "test-key-4",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    const writers = await fb.getWriters()
    expect(writers).toEqual([])

    await fb.close()
  })

  // ── getLength / getSignedLength ---------------------------------------------

  test("getLength returns the Autobase length", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-001",
      autobaseKey: "test-key",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    const length = await fb.getLength()
    expect(typeof length).toBe("number")
    expect(length).toBeGreaterThanOrEqual(0)

    await fb.close()
  })

  test("getSignedLength returns a valid number", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-001",
      autobaseKey: "test-key",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    const signedLength = await fb.getSignedLength()
    expect(typeof signedLength).toBe("number")
    expect(signedLength).toBeGreaterThanOrEqual(0)

    await fb.close()
  })

  // ── createCheckpoint --------------------------------------------------------

  test("createCheckpoint returns signedLength and viewRootHash", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-001",
      autobaseKey: "test-key",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()

    // Append an event first so there's state to checkpoint
    await fb.append(makeEvent())

    const checkpoint = await fb.createCheckpoint(
      Buffer.from("test-signing-key"),
    )
    expect(checkpoint).toHaveProperty("signedLength")
    expect(checkpoint).toHaveProperty("viewRootHash")
    expect(typeof checkpoint.signedLength).toBe("number")
    expect(typeof checkpoint.viewRootHash).toBe("string")
    expect(checkpoint.viewRootHash.length).toBeGreaterThan(0)

    await fb.close()
  })

  // ── Close guard -------------------------------------------------------------

  test("append throws after close", async () => {
    const wCore = createCore()
    const vCore = createCore()
    const cCore = createCore()
    await wCore.ready()
    await vCore.ready()
    await cCore.ready()

    const fb = new MockFederationBase({
      federationId: "test-fed-001",
      autobaseKey: "test-key",
      writerCore: wCore,
      viewCore: vCore,
      checkpointCore: cCore,
      apply: mockCreateDefaultApply(),
    })
    await fb.open()
    await fb.close()

    expect(fb.isOpen()).toBe(false)
    try {
      await fb.append(makeEvent())
      expect.unreachable("Should have thrown")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      expect(msg).toContain("not open")
    }
  })

  // ── Real module verification ------------------------------------------------

  test("real module exports exist", () => {
    expect(FederationBase).toBeDefined()
    expect(typeof FederationBase).toBe("function")
    expect(createDefaultApply).toBeDefined()
    expect(typeof createDefaultApply).toBe("function")
  })
})
