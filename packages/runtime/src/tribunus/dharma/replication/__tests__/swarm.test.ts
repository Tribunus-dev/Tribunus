/**
 * Dharma Swarm — Tests
 *
 * Covers DHT bootstrap configuration, default vs. custom bootstrap servers,
 * and the withDefaultBootstrap helper.
 *
 * @module
 */

import { describe, it, expect, mock, beforeEach } from "bun:test"
import {
  DharmaSwarm,
  DEFAULT_HYPERSWARM_BOOTSTRAP,
  withDefaultBootstrap,
} from "../swarm"
import type { SwarmConfig } from "../swarm"
import { DEFAULT_REPLICATION_LIMITS } from "../protocol"

// ── Mock Setup ---------------------------------------------------------------

interface HyperswarmOpts {
  bootstrap?: string[]
  preferIPv6?: boolean
  keyPair?: { publicKey: Buffer; secretKey: Buffer }
}

/** Captured constructor arguments for inspection. */
let lastSwarmConstructorOpts: HyperswarmOpts | undefined
let mockFlushResolve: () => void

/** Returns a mock Hyperswarm instance. */
function createMockHyperswarm() {
  // User-facing methods
  const discovery = {
    flushed: mock(() => new Promise<void>((resolve) => { mockFlushResolve = resolve })),
    destroy: mock(() => Promise.resolve()),
    suspend: mock(() => Promise.resolve()),
    resume: mock(() => {}),
  }

  const swarm = {
    join: mock(() => discovery),
    on: mock(() => {}),
    destroy: mock(() => Promise.resolve()),
  }

  return { swarm, discovery }
}

let mockHyperswarm = createMockHyperswarm()

mock.module("hyperswarm", () => ({
  default: mock(function MockHyperswarm(this: unknown, opts?: HyperswarmOpts) {
    lastSwarmConstructorOpts = opts
    const fresh = createMockHyperswarm()
    mockHyperswarm = fresh
    return fresh.swarm
  }),
}))

// ── Helpers ------------------------------------------------------------------

function makeMinimalConfig(overrides?: Partial<SwarmConfig>): SwarmConfig {
  return {
    federationId: "test-fed-001",
    autobaseDiscoveryKey: Buffer.from("test-autobase-key").toString("hex"),
    limits: DEFAULT_REPLICATION_LIMITS,
    keyPair: null,
    onConnection: mock(() => {}),
    ...overrides,
  }
}

// ── Bootstrapping ---------------------------------------------------------------

describe("DEFAULT_HYPERSWARM_BOOTSTRAP", () => {
  it("contains exactly 3 servers", () => {
    expect(DEFAULT_HYPERSWARM_BOOTSTRAP).toHaveLength(3)
  })

  it("contains the known public bootstrap servers", () => {
    expect(DEFAULT_HYPERSWARM_BOOTSTRAP).toContain("bootstrap1.hyperswarm.org:49737")
    expect(DEFAULT_HYPERSWARM_BOOTSTRAP).toContain("bootstrap2.hyperswarm.org:49737")
    expect(DEFAULT_HYPERSWARM_BOOTSTRAP).toContain("bootstrap3.hyperswarm.org:49737")
  })

  it("is frozen (immutable)", () => {
    expect(Object.isFrozen(DEFAULT_HYPERSWARM_BOOTSTRAP)).toBe(true)
  })
})

// ── SwarmConfig bootstrap ----------------------------------------------------

describe("SwarmConfig bootstrap", () => {
  beforeEach(() => {
    lastSwarmConstructorOpts = undefined
    mockHyperswarm = createMockHyperswarm()
    mockFlushResolve = () => {}
  })

  it("uses default 3 bootstrap servers when bootstrap is not provided", async () => {
    const config = makeMinimalConfig()
    const swarm = new DharmaSwarm(config)

    const startPromise = swarm.start()
    // Resolve the flush so start() completes
    mockFlushResolve()
    await startPromise

    expect(lastSwarmConstructorOpts).toBeDefined()
    expect(lastSwarmConstructorOpts!.bootstrap).toHaveLength(3)
    expect(lastSwarmConstructorOpts!.bootstrap).toContain("bootstrap1.hyperswarm.org:49737")

    await swarm.stop()
  })

  it("uses custom bootstrap servers when provided", async () => {
    const customBootstrap = ["my-bootstrap.example.com:49737"]
    const config = makeMinimalConfig({ bootstrap: customBootstrap })
    const swarm = new DharmaSwarm(config)

    const startPromise = swarm.start()
    mockFlushResolve()
    await startPromise

    expect(lastSwarmConstructorOpts).toBeDefined()
    expect(lastSwarmConstructorOpts!.bootstrap).toEqual(customBootstrap)
    expect(lastSwarmConstructorOpts!.bootstrap).not.toContain("bootstrap1.hyperswarm.org")

    await swarm.stop()
  })

  it("passes preferIPv6 when set to true", async () => {
    const config = makeMinimalConfig({ preferIPv6: true })
    const swarm = new DharmaSwarm(config)

    const startPromise = swarm.start()
    mockFlushResolve()
    await startPromise

    expect(lastSwarmConstructorOpts).toBeDefined()
    expect((lastSwarmConstructorOpts as Record<string, unknown>).preferIPv6).toBe(true)

    await swarm.stop()
  })

  it("does not set preferIPv6 when not provided", async () => {
    const config = makeMinimalConfig()
    const swarm = new DharmaSwarm(config)

    const startPromise = swarm.start()
    mockFlushResolve()
    await startPromise

    expect(lastSwarmConstructorOpts).toBeDefined()
    expect((lastSwarmConstructorOpts as Record<string, unknown>).preferIPv6).toBeUndefined()

    await swarm.stop()
  })
})

// ── withDefaultBootstrap -----------------------------------------------------

describe("withDefaultBootstrap", () => {
  it("fills in the three default bootstrap servers", () => {
    const partial = makeMinimalConfig()
    const { bootstrap, ...required } = partial
    const config = withDefaultBootstrap(required)

    expect(config.bootstrap).toHaveLength(3)
    expect(config.bootstrap).toContain("bootstrap1.hyperswarm.org:49737")
    expect(config.bootstrap).toContain("bootstrap2.hyperswarm.org:49737")
    expect(config.bootstrap).toContain("bootstrap3.hyperswarm.org:49737")
  })

  it("preserves all other config fields", () => {
    const partial = makeMinimalConfig()
    const { bootstrap, ...required } = partial
    const config = withDefaultBootstrap(required)

    expect(config.federationId).toBe(partial.federationId)
    expect(config.autobaseDiscoveryKey).toBe(partial.autobaseDiscoveryKey)
    expect(config.limits).toBe(partial.limits)
    expect(config.keyPair).toBe(partial.keyPair)
    expect(config.onConnection).toBe(partial.onConnection)
  })

  it("returns a fresh array each time", () => {
    const partial = makeMinimalConfig()
    const { bootstrap, ...required } = partial
    const a = withDefaultBootstrap(required)
    const b = withDefaultBootstrap(required)

    expect(a.bootstrap).toEqual(b.bootstrap)
    expect(a.bootstrap).not.toBe(b.bootstrap)
  })
})
