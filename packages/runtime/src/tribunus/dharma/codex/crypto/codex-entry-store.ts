/**
 * Codex — Encrypted Entry Store
 *
 * Encrypted storage for Codex entries. Entries are encrypted before writing
 * and decrypted on read. Each entry's DEK is wrapped with its domain key.
 *
 * Different visibility domains use different domain keys, providing
 * compartmentalized access control.
 */

import type { CodexEntry } from "../codex-types"
import type { EncryptedEntry } from "./codex-crypto"
import type { DomainKeyStore } from "./domain-keys"
import {
  encryptEntry,
  decryptEntry,
  generateDek,
  wrapDek,
  unwrapDek,
  computeContentDigest,
  buildAssociatedData,
} from "./codex-crypto"
import { getActiveDomainKey, visibilityToDomainId } from "./domain-keys"

// ── Types ────────────────────────────────────────────────────────────────────

export interface EncryptedCodexStore {
  /** Encrypt and store a CodexEntry. Returns the EncryptedEntry. */
  storeEntry(entry: CodexEntry, domainKeys: DomainKeyStore): EncryptedEntry

  /** Retrieve and decrypt an EncryptedEntry. Returns null on failure. */
  retrieveEntry(
    encrypted: EncryptedEntry,
    domainKeys: DomainKeyStore,
  ): CodexEntry | null

  /** List all stored entry IDs (no decryption needed). */
  listEntryIds(): string[]
}

// ── Implementation ───────────────────────────────────────────────────────────

/**
 * Create a new encrypted Codex entry store.
 *
 * The store keeps entries in memory, each encrypted with its own DEK
 * that is wrapped under the entry's domain wrapping key.
 */
export function createEncryptedStore(): EncryptedCodexStore {
  const st: EncryptedEntry[] = []

  return {
    storeEntry(entry: CodexEntry, domainKeys: DomainKeyStore): EncryptedEntry {
      const domainId = visibilityToDomainId(entry.visibilityClass)
      const domainKey = getActiveDomainKey(domainId, domainKeys)

      const dek = generateDek()
      const plaintext = Buffer.from(JSON.stringify(entry), "utf-8")
      const aad = buildAssociatedData(entry.codexEntryId, entry.visibilityClass, entry.schemaVersion)

      const { ciphertext, iv, authTag } = encryptEntry(plaintext, dek, aad)
      const wrapped = wrapDek(dek, domainKey.wrappingKey)

      const encrypted: EncryptedEntry = {
        entryId: entry.codexEntryId,
        domainId,
        visibilityClass: entry.visibilityClass,
        schemaVersion: entry.schemaVersion,
        iv,
        ciphertext,
        authTag,
        wrappedDek: wrapped.wrappedDek,
        wrapIv: wrapped.iv,
        wrapAuthTag: wrapped.authTag,
        contentDigest: computeContentDigest(plaintext),
      }

      st.push(encrypted)
      return encrypted
    },

    retrieveEntry(
      encrypted: EncryptedEntry,
      domainKeys: DomainKeyStore,
    ): CodexEntry | null {
      try {
        const domainKey = getActiveDomainKey(encrypted.domainId, domainKeys)
        const dek = unwrapDek(encrypted.wrappedDek, domainKey.wrappingKey, encrypted.wrapIv, encrypted.wrapAuthTag)
        const decrypted = decryptEntry(
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          dek,
          buildAssociatedData(encrypted.entryId, encrypted.visibilityClass, encrypted.schemaVersion),
        )
        const entry: CodexEntry = JSON.parse(decrypted.toString("utf-8"))
        if (entry.codexEntryId !== encrypted.entryId) return null
        return entry
      } catch {
        return null
      }
    },

    listEntryIds(): string[] {
      return st.map((e) => e.entryId)
    },
  }
}

// ── Serialization ────────────────────────────────────────────────────────────

/**
 * Serialize an EncryptedEntry to a JSON string for durable storage.
 *
 * All Buffer fields are base64-encoded.
 */
export function serializeEncryptedEntry(entry: EncryptedEntry): string {
  return JSON.stringify({
    entryId: entry.entryId,
    domainId: entry.domainId,
    visibilityClass: entry.visibilityClass,
    schemaVersion: entry.schemaVersion,
    iv: entry.iv.toString("base64"),
    ciphertext: entry.ciphertext.toString("base64"),
    authTag: entry.authTag.toString("base64"),
    wrappedDek: entry.wrappedDek.toString("base64"),
    wrapIv: entry.wrapIv.toString("base64"),
    wrapAuthTag: entry.wrapAuthTag.toString("base64"),
    contentDigest: entry.contentDigest,
  })
}

/**
 * Deserialize a JSON string back to an EncryptedEntry.
 *
 * Base64 fields are decoded back to Buffers.
 */
export function deserializeEncryptedEntry(data: string): EncryptedEntry {
  const parsed = JSON.parse(data)
  return {
    entryId: parsed.entryId,
    domainId: parsed.domainId,
    visibilityClass: parsed.visibilityClass,
    schemaVersion: parsed.schemaVersion,
    iv: Buffer.from(parsed.iv, "base64"),
    ciphertext: Buffer.from(parsed.ciphertext, "base64"),
    authTag: Buffer.from(parsed.authTag, "base64"),
    wrappedDek: Buffer.from(parsed.wrappedDek, "base64"),
    wrapIv: Buffer.from(parsed.wrapIv, "base64"),
    wrapAuthTag: Buffer.from(parsed.wrapAuthTag, "base64"),
    contentDigest: parsed.contentDigest,
  }
}
