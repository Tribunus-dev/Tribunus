/**
 * Codex — Encrypted Entry Store Tests
 *
 * Covers: entry encrypt/decrypt round-trip, wrong domain key failure,
 * tampered ciphertext detection, serialization round-trip.
 */

import { describe, test, expect } from "bun:test"
import { randomBytes } from "node:crypto"
import type { CodexEntry } from "../../codex-types"
import type { DomainKey, DomainKeyStore } from "../domain-keys"
import { createEncryptedStore, serializeEncryptedEntry, deserializeEncryptedEntry } from "../codex-entry-store"
import { createDomainKeyStore } from "../domain-keys"
import { generateDek, wrapDek, unwrapDek } from "../codex-crypto"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<CodexEntry> = {}): CodexEntry {
  return {
    codexEntryId: "entry-test-1",
    schemaVersion: 1,
    status: "published",
    visibilityClass: "contributor",
    knowledgeClass: "implementation_pattern",
    title: "Test Entry",
    abstract: "A test entry for crypto verification",
    claims: [],
    canonicalContentDigest: "test-digest",
    sourceContributionIds: [],
    sourceArtifactRefs: [],
    evidenceRefs: [],
    provenance: {
      createdFromReceiptIds: [],
      derivationPolicyVersion: "1.0",
      ingestionMode: "curator_approved",
      authoredBy: ["user-1"],
      approvedBy: ["admin-1"],
      createdAtLogicalTime: "2025-01-01T00:00:00.000Z",
    },
    quality: {
      evidenceQuality: "high",
      corroborationCount: 1,
      reproducibilityStatus: "reproduced",
      confidence: 0.9,
    },
    semanticIndex: {
      embeddingModelDigest: "",
      embeddingVectorRef: "",
      lexicalTerms: [],
      entityRefs: [],
    },
    lineage: {
      supersedes: null,
      supersededBy: null,
      relatedEntryIds: [],
    },
    policy: {
      queryEligibility: "all",
      derivativeUsePolicy: "research_only",
      benefitPolicyId: "",
    },
    signatures: [],
    ...overrides,
  }
}

function makeDomainKeys(): DomainKeyStore {
  const keys: DomainKey[] = ["session", "contributor", "public"].map((vc) => ({
    domainId: `domain-${vc}`,
    wrappingKey: randomBytes(32),
    keyId: `key-${vc}-1`,
    rotation: 1,
  }))
  return createDomainKeyStore(keys)
}

// ── Tests: Store & Retrieve ──────────────────────────────────────────────────

describe("createEncryptedStore", () => {
  test("store and retrieve entry round-trip", () => {
    const store = createEncryptedStore()
    const domainKeys = makeDomainKeys()
    const entry = makeEntry()

    const stored = store.storeEntry(entry, domainKeys)
    expect(stored.entryId).toBe(entry.codexEntryId)
    expect(stored.domainId).toBe("domain-contributor")
    expect(stored.contentDigest).toBeTruthy()
    expect(typeof stored.contentDigest).toBe("string")

    const retrieved = store.retrieveEntry(stored, domainKeys)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.codexEntryId).toBe(entry.codexEntryId)
    expect(retrieved!.title).toBe(entry.title)
    expect(retrieved!.visibilityClass).toBe(entry.visibilityClass)
    expect(retrieved!.abstract).toBe(entry.abstract)
    expect(retrieved!.schemaVersion).toBe(1)
  })

  test("different visibility domain keys produce different encrypted output", () => {
    const store = createEncryptedStore()
    const sessionEntry = makeEntry({ visibilityClass: "session", codexEntryId: "entry-session" })
    const publicEntry = makeEntry({ visibilityClass: "public", codexEntryId: "entry-public" })
    const domainKeys = makeDomainKeys()

    const storedSession = store.storeEntry(sessionEntry, domainKeys)
    const storedPublic = store.storeEntry(publicEntry, domainKeys)

    expect(storedSession.ciphertext.equals(storedPublic.ciphertext)).toBe(false)
    expect(storedSession.wrappedDek.equals(storedPublic.wrappedDek)).toBe(false)
  })

  test("retrieveEntry returns null for wrong domain key", () => {
    const store = createEncryptedStore()
    const goodKeys = makeDomainKeys()
    const entry = makeEntry()

    const stored = store.storeEntry(entry, goodKeys)

    const badKeys = makeDomainKeys()
    const retrieved = store.retrieveEntry(stored, badKeys)
    expect(retrieved).toBeNull()
  })

  test("retrieveEntry returns null when domain key is missing", () => {
    const store = createEncryptedStore()
    const goodKeys = makeDomainKeys()
    const entry = makeEntry()

    const stored = store.storeEntry(entry, goodKeys)

    const emptyStore = createDomainKeyStore([])
    const retrieved = store.retrieveEntry(stored, emptyStore)
    expect(retrieved).toBeNull()
  })

  test("tampered ciphertext fails decryption", () => {
    const store = createEncryptedStore()
    const domainKeys = makeDomainKeys()
    const entry = makeEntry()

    const stored = store.storeEntry(entry, domainKeys)

    const tampered = {
      ...stored,
      ciphertext: Buffer.concat([stored.ciphertext.subarray(0, -1), Buffer.from([0xff])]),
    }

    const retrieved = store.retrieveEntry(tampered, domainKeys)
    expect(retrieved).toBeNull()
  })

  test("tampered auth tag fails decryption", () => {
    const store = createEncryptedStore()
    const domainKeys = makeDomainKeys()
    const entry = makeEntry()

    const stored = store.storeEntry(entry, domainKeys)

    const tampered = {
      ...stored,
      authTag: Buffer.from(stored.authTag).fill(0),
    }

    const retrieved = store.retrieveEntry(tampered, domainKeys)
    expect(retrieved).toBeNull()
  })

  test("tampered entryId fails decryption (AAD mismatch)", () => {
    const store = createEncryptedStore()
    const domainKeys = makeDomainKeys()
    const entry = makeEntry()

    const stored = store.storeEntry(entry, domainKeys)

    const tampered = { ...stored, entryId: "different-id" }

    const retrieved = store.retrieveEntry(tampered, domainKeys)
    expect(retrieved).toBeNull()
  })

  test("listEntryIds returns stored IDs", () => {
    const store = createEncryptedStore()
    const domainKeys = makeDomainKeys()

    const entry1 = makeEntry({ codexEntryId: "entry-1" })
    const entry2 = makeEntry({ codexEntryId: "entry-2", visibilityClass: "public" })
    const entry3 = makeEntry({ codexEntryId: "entry-3", visibilityClass: "session" })

    store.storeEntry(entry1, domainKeys)
    store.storeEntry(entry2, domainKeys)
    store.storeEntry(entry3, domainKeys)

    const ids = store.listEntryIds()
    expect(ids).toHaveLength(3)
    expect(ids).toContain("entry-1")
    expect(ids).toContain("entry-2")
    expect(ids).toContain("entry-3")
  })
})

// ── Tests: Serialization ─────────────────────────────────────────────────────

describe("serializeEncryptedEntry / deserializeEncryptedEntry", () => {
  test("serialize and deserialize round-trip", () => {
    const store = createEncryptedStore()
    const domainKeys = makeDomainKeys()
    const entry = makeEntry()

    const stored = store.storeEntry(entry, domainKeys)
    const serialized = serializeEncryptedEntry(stored)
    const deserialized = deserializeEncryptedEntry(serialized)

    expect(deserialized.entryId).toBe(stored.entryId)
    expect(deserialized.domainId).toBe(stored.domainId)
    expect(deserialized.visibilityClass).toBe(stored.visibilityClass)
    expect(deserialized.schemaVersion).toBe(stored.schemaVersion)
    expect(deserialized.iv.equals(stored.iv)).toBe(true)
    expect(deserialized.ciphertext.equals(stored.ciphertext)).toBe(true)
    expect(deserialized.authTag.equals(stored.authTag)).toBe(true)
    expect(deserialized.wrappedDek.equals(stored.wrappedDek)).toBe(true)
    expect(deserialized.wrapIv.equals(stored.wrapIv)).toBe(true)
    expect(deserialized.wrapAuthTag.equals(stored.wrapAuthTag)).toBe(true)
    expect(deserialized.contentDigest).toBe(stored.contentDigest)
  })

  test("serialized entry can be decrypted after deserialization", () => {
    const store = createEncryptedStore()
    const domainKeys = makeDomainKeys()
    const entry = makeEntry()

    const stored = store.storeEntry(entry, domainKeys)
    const serialized = serializeEncryptedEntry(stored)
    const deserialized = deserializeEncryptedEntry(serialized)

    const retrieved = store.retrieveEntry(deserialized, domainKeys)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.codexEntryId).toBe(entry.codexEntryId)
  })

  test("malformed JSON throws on deserialize", () => {
    expect(() => deserializeEncryptedEntry("not-json")).toThrow()
  })
})

// ── Tests: Low-level crypto primitives ───────────────────────────────────────

describe("wrapDek / unwrapDek", () => {
  test("wrap and unwrap round-trip", () => {
    const dek = generateDek()
    const domainKey = randomBytes(32)

    const wrapped = wrapDek(dek, domainKey)
    expect(wrapped.wrappedDek.length).toBeGreaterThan(0)
    expect(wrapped.iv.length).toBe(12)
    expect(wrapped.authTag.length).toBe(16)

    const unwrapped = unwrapDek(wrapped.wrappedDek, domainKey, wrapped.iv, wrapped.authTag)
    expect(unwrapped.equals(dek)).toBe(true)
  })

  test("unwrap with wrong key throws", () => {
    const dek = generateDek()
    const domainKey = randomBytes(32)
    const wrongKey = randomBytes(32)

    const wrapped = wrapDek(dek, domainKey)
    expect(() => unwrapDek(wrapped.wrappedDek, wrongKey, wrapped.iv, wrapped.authTag)).toThrow()
  })

  test("unwrap tampered wrapped key throws", () => {
    const dek = generateDek()
    const domainKey = randomBytes(32)

    const wrapped = wrapDek(dek, domainKey)
    const tamperedDek = Buffer.from(wrapped.wrappedDek)
    tamperedDek[0] ^= 0xff

    expect(() => unwrapDek(tamperedDek, domainKey, wrapped.iv, wrapped.authTag)).toThrow()
  })
})
