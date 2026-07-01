/**
 * Runtime Initialization Tests
 *
 * Tests for initializeRuntime — the comprehensive startup sequence that
 * creates the runtime, wires identity, discovers stored federations,
 * and runs checkpoint + outbox recovery.
 *
 * Uses bun.mock.module to intercept the NAPI-dependent modules
 * (corestore, hypercore, autobase, hyperbee) at import time so
 * the test suite runs without native addon crashes.
 */

import { describe, test, expect, mock } from "bun:test"
import { IdentityVault } from "../../identity"

// ── Mock NAPI modules at import time ─────────────────────────────────────────
// Corestore, Hypercore, Autobase, Hyperbee are Node NAPI addons that crash
// Bun (https://github.com/oven-sh/bun/issues/18546). We mock them here
// before any test code loads files from ../runtime or ../corestore.

mock.module("corestore", () => {
  return {
    default: class MockCorestorePackage {
      private cores = new Map<string, unknown>()
      async ready() {}
      async close() {}
      get(name: string) {
        const existing = this.cores.get(name)
        if (existing) return existing
        const core = makeMockHypercore()
        this.cores.set(name, core)
        return core
      }
    },
  }
})

mock.module("hypercore", () => {
  return {
    default: makeMockHypercore,
  }
})

mock.module("autobase", () => {
  return {
    default: class MockAutobasePackage {
      constructor() {}
      async ready() {}
      async close() {}
      async append() {}
      view = { length: 0 }
    },
  }
})

mock.module("hyperbee", () => {
  return {
    default: class MockHyperbeePackage {
      constructor() {}
      async ready() {}
      async close() {}
    },
  }
})

// ── Mock Hypercore factory ───────────────────────────────────────────────────

function makeMockHypercore() {
  const blocks: Uint8Array[] = []
  return {
    key: Buffer.from("mock-key"),
    discoveryKey: Buffer.from("mock-dk"),
    writable: true,
    readable: true,
    length: 0,
    async ready() {},
    async close() {},
    async get(index: number) {
      return blocks[index] ?? null
    },
    async append(data: Uint8Array) {
      blocks.push(data)
      this.length = blocks.length
      return this.length - 1
    },
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(): import("../runtime").RuntimeConfig {
  const vault = new IdentityVault("test-passphrase")
  vault.createIdentity("test-device")
  return {
    storageRoot: "/tmp/dharma-mock-test",
    identityVault: vault,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("initializeRuntime", () => {
  test("loads initializeRuntime module without error", async () => {
    const mod = await import("../runtime-init")
    expect(typeof mod.initializeRuntime).toBe("function")
  })

  test("creates runtime and returns RuntimeInitResult", async () => {
    const { initializeRuntime } = await import("../runtime-init")
    const config = makeConfig()
    const result = await initializeRuntime(config)

    expect(result).toBeDefined()
    expect(typeof result.runtime).toBe("object")
    expect(typeof result.started).toBe("boolean")
    expect(typeof result.identityCoreCreated).toBe("boolean")
    expect(typeof result.federationsRecovered).toBe("number")
    expect(Array.isArray(result.checkpointResults)).toBe(true)
    expect(Array.isArray(result.outboxResults)).toBe(true)
  })

  test("succeeds with valid identity vault", async () => {
    const { initializeRuntime } = await import("../runtime-init")
    const result = await initializeRuntime(makeConfig())

    expect(result.started).toBe(true)
    expect(result.error).toBeNull()
  })

  test("returns partial result when vault has no active identity", async () => {
    const { initializeRuntime } = await import("../runtime-init")
    const vault = new IdentityVault("test-passphrase")
    // No identity created — getActiveIdentity returns undefined

    const config: import("../runtime").RuntimeConfig = {
      identityVault: vault,
    }

    const result = await initializeRuntime(config)

    expect(result.started).toBe(false)
    expect(result.error).not.toBeNull()
    expect(typeof result.error).toBe("string")
    expect(result.federationsRecovered).toBe(0)
  })

  test("returns empty recovery results on fresh start", async () => {
    const { initializeRuntime } = await import("../runtime-init")
    const result = await initializeRuntime(makeConfig())

    expect(result.federationsRecovered).toBe(0)
    expect(result.checkpointResults).toEqual([])
    expect(result.outboxResults).toEqual([])
  })

  test("identityCoreCreated is true when no prior federation data", async () => {
    const { initializeRuntime } = await import("../runtime-init")
    const result = await initializeRuntime(makeConfig())

    expect(result.identityCoreCreated).toBe(true)
    expect(result.federationsRecovered).toBe(0)
  })

  test("RuntimeInitResult has all required fields", async () => {
    const { initializeRuntime } = await import("../runtime-init")
    const result = await initializeRuntime(makeConfig())

    const keys: Array<keyof import("../runtime-init").RuntimeInitResult> = [
      "runtime",
      "started",
      "identityCoreCreated",
      "federationsRecovered",
      "checkpointResults",
      "outboxResults",
      "error",
    ]

    for (const key of keys) {
      expect(key in result).toBe(true)
    }
  })
})
