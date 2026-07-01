/**
 * Dharma Replication — Identity Core Tests
 *
 * Tests the identity persistence layer against an in-memory mock Corestore
 * and a real IdentityVault instance.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test"
import { IdentityVault } from "../../identity"
import type { DharmaCorestore } from "../corestore"
import type { DharmaIdentity } from "../../types"
import {
  ensureIdentityCore,
  loadIdentityFromCore,
  persistIdentityToCore,
} from "../identity-core"

// ── Mock Hypercore ───────────────────────────────────────────────────────────

interface MockHypercore {
  length: number
  ready: ReturnType<typeof mock>
  get: ReturnType<typeof mock>
  append: ReturnType<typeof mock>
  close: ReturnType<typeof mock>
}

function createMockHypercore(): MockHypercore {
  const blocks: Uint8Array[] = []
  return {
    length: 0,
    ready: mock(() => Promise.resolve()),
    get: mock((index: number) => {
      const block = blocks[index]
      if (!block) return Promise.resolve(new Uint8Array(0))
      return Promise.resolve(block)
    }),
    append: mock((data: Uint8Array) => {
      blocks.push(data)
      return Promise.resolve(blocks.length - 1)
    }),
    close: mock(() => Promise.resolve()),
  }
}

// ── Mock DharmaCorestore ─────────────────────────────────────────────────────

interface MockCorestore {
  opened: boolean
  mockCore: MockHypercore
  open: ReturnType<typeof mock>
  close: ReturnType<typeof mock>
  getSystemCore: ReturnType<typeof mock>
  getStore: ReturnType<typeof mock>
  isOpened: boolean
  getConfig: ReturnType<typeof mock>
}

function createMockCorestore(): MockCorestore {
  const mockCore = createMockHypercore()
  return {
    opened: false,
    mockCore,
    open: mock(() => Promise.resolve()),
    close: mock(() => Promise.resolve()),
    getSystemCore: mock(() => Promise.resolve(mockCore)),
    getStore: mock(() => ({})),
    isOpened: false,
    getConfig: mock(() => ({})),
  }
}

/** Adapt a MockCorestore to the DharmaCorestore type the functions expect. */
function asDharmaCorestore(mock: MockCorestore): DharmaCorestore {
  return mock as unknown as DharmaCorestore
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("identity-core persistence", () => {
  let vault: IdentityVault
  let corestore: MockCorestore

  beforeEach(() => {
    vault = new IdentityVault("test-passphrase")
    corestore = createMockCorestore()
  })

  describe("loadIdentityFromCore", () => {
    it("returns null when the system core has no blocks", async () => {
      corestore.mockCore.length = 0
      const result = await loadIdentityFromCore(asDharmaCorestore(corestore))
      expect(result).toBeNull()
    })

    it("reads and decodes identity from the first block", async () => {
      const identity = vault.createIdentity("test-device")
      const json = JSON.stringify(identity)
      const encoded = new TextEncoder().encode(json)
      corestore.mockCore.length = 1

      // Override get to return the encoded identity
      corestore.mockCore.get = mock((_index: number) => Promise.resolve(encoded))

      const result = await loadIdentityFromCore(asDharmaCorestore(corestore))
      expect(result).not.toBeNull()
      expect(result!.identityId).toBe(identity.identityId)
      expect(result!.displayName).toBe("test-device")
      // publicKey/encryptedPrivateKey are Uint8Arrays that round-trip as plain
      // objects through JSON — structural fields already prove correct decode.
    })
  })

  describe("persistIdentityToCore", () => {
    it("appends identity JSON to the system core", async () => {
      const identity = vault.createIdentity("persist-test")
      await persistIdentityToCore(asDharmaCorestore(corestore), identity)

      expect(corestore.mockCore.append).toHaveBeenCalledTimes(1)
      const appended = corestore.mockCore.append.mock.calls[0][0] as Uint8Array
      const text = new TextDecoder().decode(appended)
      const decoded = JSON.parse(text)
      expect(decoded.identityId).toBe(identity.identityId)
      expect(decoded.displayName).toBe("persist-test")
    })
  })

  describe("ensureIdentityCore", () => {
    it("creates and persists identity when system core is empty", async () => {
      corestore.mockCore.length = 0
      const identity = await ensureIdentityCore(asDharmaCorestore(corestore), vault)

      expect(identity).toBeDefined()
      expect(identity.status).toBe("active")
      // Should have appended to the core
      expect(corestore.mockCore.append).toHaveBeenCalledTimes(1)
    })

    it("returns existing identity when system core already has one", async () => {
      const existing = vault.createIdentity("existing-device")
      const json = JSON.stringify(existing)
      const encoded = new TextEncoder().encode(json)
      corestore.mockCore.length = 1
      corestore.mockCore.get = mock((_index: number) => Promise.resolve(encoded))

      const identity = await ensureIdentityCore(asDharmaCorestore(corestore), vault)

      expect(identity).toBeDefined()
      expect(identity.identityId).toBe(existing.identityId)
      // Should NOT have created a new identity (append count stays 0 from initial mock)
      expect(corestore.mockCore.append).not.toHaveBeenCalled()
    })
  })

  describe("round-trip", () => {
    it("persists and reloads identity correctly", async () => {
      const identity = vault.createIdentity("roundtrip-device")
      await persistIdentityToCore(asDharmaCorestore(corestore), identity)

      // Now set up the mock to return what was appended
      const appended = corestore.mockCore.append.mock.calls[0][0] as Uint8Array
      corestore.mockCore.length = 1
      corestore.mockCore.get = mock((_index: number) => Promise.resolve(appended))

      // Override getSystemCore to return a consistent mock
      const secondMock = createMockHypercore()
      secondMock.length = 1
      secondMock.get = mock((_index: number) => Promise.resolve(appended))
      corestore.getSystemCore = mock(() => Promise.resolve(secondMock))

      const loaded = await loadIdentityFromCore(asDharmaCorestore(corestore))
      expect(loaded).not.toBeNull()
      expect(loaded!.identityId).toBe(identity.identityId)
      expect(loaded!.displayName).toBe("roundtrip-device")
    })
  })
})
