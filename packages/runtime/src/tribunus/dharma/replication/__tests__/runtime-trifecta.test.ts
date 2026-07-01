/**
 * Runtime Trifecta Tests
 *
 * Tests the createTrifectaAdapters factory and its integration with
 * DharmaReplicationRuntime's RuntimeConfig.
 *
 * Coverage:
 *  - createTrifectaAdapters returns nulls when no config supplied
 *  - createTrifectaAdapters initialises adapters when config provided
 *  - Guard helpers (hasPGlite, hasValkey, hasDuckDb) return correct booleans
 *  - Runtime accepts optional trifecta clients (type-check only, no Corestore)
 */

import { describe, test, expect } from "bun:test"
import { PGliteFederationStore } from "../trifecta/pglite-store"
import { ReplicationValkeyCache } from "../trifecta/valkey-cache"
import { ReplicationDuckDbLogger } from "../trifecta/duckdb-logger"
import {
  createTrifectaAdapters,
  hasPGlite,
  hasValkey,
  hasDuckDb,
} from "../trifecta/create-trifecta"
import type { TrifectaAdapters } from "../trifecta/create-trifecta"
import type { RuntimeConfig } from "../runtime"

// ── Mock Config Builder ─────────────────────────────────────────────────────
//
// RuntimeConfig requires identityVault. We supply a minimal mock for the
// methods that createTrifectaAdapters and the runtime use (getActiveIdentity).

function baseConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  const testIdentity = {
    identityId: "test-identity",
    publicKey: new Uint8Array(0),
    encryptedPrivateKey: new Uint8Array(0),
    displayName: "test",
    profileVersion: 1,
    createdAt: new Date().toISOString(),
    status: "active" as const,
    recoveryPolicy: null,
  }

  return {
    identityVault: {
      getActiveIdentity: () => testIdentity,
      listIdentities: () => [testIdentity],
      createIdentity: () => testIdentity,
      getIdentity: () => testIdentity,
      signWithIdentity: () => new Uint8Array(0),
      verifyIdentity: () => true,
      rotateIdentity: () => testIdentity,
      setStatus: () => {},
    },
    ...overrides,
  } as RuntimeConfig
}

// ── createTrifectaAdapters ───────────────────────────────────────────────────

describe("createTrifectaAdapters", () => {
  test("returns null for all adapters when no trifecta config is set", () => {
    const adapters = createTrifectaAdapters(baseConfig())

    expect(adapters.pgliteStore).toBeNull()
    expect(adapters.valkeyCache).toBeNull()
    expect(adapters.duckdbLogger).toBeNull()
  })

  test("returns null for all adapters when all trifecta fields are undefined", () => {
    const adapters = createTrifectaAdapters(
      baseConfig({ pglite: undefined, valkey: undefined, duckdb: undefined }),
    )

    expect(adapters.pgliteStore).toBeNull()
    expect(adapters.valkeyCache).toBeNull()
    expect(adapters.duckdbLogger).toBeNull()
  })

  test("creates ReplicationValkeyCache from ValkeyCacheConfig", () => {
    const adapters = createTrifectaAdapters(
      baseConfig({ valkey: { url: "redis://localhost:6379", prefix: "test:" } }),
    )

    expect(adapters.valkeyCache).not.toBeNull()
    expect(adapters.valkeyCache).toBeInstanceOf(ReplicationValkeyCache)
  })

  test("accepts a pre-initialized ReplicationValkeyCache instance", () => {
    const preExisting = new ReplicationValkeyCache({
      url: "redis://localhost:6379",
      prefix: "test:",
    })

    const adapters = createTrifectaAdapters(baseConfig({ valkey: preExisting }))

    expect(adapters.valkeyCache).toBe(preExisting)
    expect(adapters.valkeyCache).toBeInstanceOf(ReplicationValkeyCache)
  })
})

// ── Guard helpers ────────────────────────────────────────────────────────────

describe("guard helpers", () => {
  const nullAdapters: TrifectaAdapters = {
    pgliteStore: null,
    valkeyCache: null,
    duckdbLogger: null,
  }

  test("hasPGlite returns false when pgliteStore is null", () => {
    expect(hasPGlite(nullAdapters)).toBe(false)
  })

  test("hasValkey returns false when valkeyCache is null", () => {
    expect(hasValkey(nullAdapters)).toBe(false)
  })

  test("hasDuckDb returns false when duckdbLogger is null", () => {
    expect(hasDuckDb(nullAdapters)).toBe(false)
  })

  test("hasPGlite returns true when pgliteStore is set", () => {
    const adapters: TrifectaAdapters = {
      pgliteStore: {} as PGliteFederationStore,
      valkeyCache: null,
      duckdbLogger: null,
    }
    expect(hasPGlite(adapters)).toBe(true)
  })

  test("hasValkey returns true when valkeyCache is set", () => {
    const adapters: TrifectaAdapters = {
      pgliteStore: null,
      valkeyCache: new ReplicationValkeyCache({ url: "redis://localhost:6379" }),
      duckdbLogger: null,
    }
    expect(hasValkey(adapters)).toBe(true)
  })

  test("hasDuckDb returns true when duckdbLogger is set", () => {
    const adapters: TrifectaAdapters = {
      pgliteStore: null,
      valkeyCache: null,
      duckdbLogger: {} as ReplicationDuckDbLogger,
    }
    expect(hasDuckDb(adapters)).toBe(true)
  })
})

// ── Runtime Config Integration ───────────────────────────────────────────────

describe("DharmaReplicationRuntime config accepts optional trifecta fields", () => {
  test("RuntimeConfig type accepts config without trifecta fields", () => {
    const config = baseConfig()
    expect(config.identityVault.getActiveIdentity()).toBeDefined()
    // Type-check: config.pglite is undefined (optional field)
    expect(config.pglite).toBeUndefined()
  })

  test("RuntimeConfig type accepts config with trifecta fields", () => {
    const config = baseConfig({
      valkey: new ReplicationValkeyCache({ url: "redis://localhost:6379" }),
    })

    expect(config.valkey).toBeDefined()
  })

  test("createTrifectaAdapters returns valkeyCache when valkey is provided", () => {
    const cache = new ReplicationValkeyCache({ url: "redis://localhost:6379" })
    const adapters = createTrifectaAdapters(baseConfig({ valkey: cache }))

    expect(adapters.valkeyCache).toBe(cache)
    expect(hasValkey(adapters)).toBe(true)
    expect(hasPGlite(adapters)).toBe(false)
    expect(hasDuckDb(adapters)).toBe(false)
  })
})
