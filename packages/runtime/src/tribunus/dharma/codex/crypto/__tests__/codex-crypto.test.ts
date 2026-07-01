/**
 * Tests for Codex cryptographic encryption layer.
 *
 * Covers:
 * - AEAD encrypt/decrypt round-trip
 * - Wrong key fails authentication
 * - Wrong AAD fails authentication
 * - Tampered ciphertext fails authentication
 * - DEK wrap/unwrap round-trip
 * - DEK wrap with wrong key fails
 * - Entry encrypt/decrypt round-trip
 * - Content digest computation
 * - Associated data construction
 * - Key derivation from passphrase
 */

import { describe, it, expect } from "bun:test"
import { randomBytes } from "node:crypto"
import {
  DEK_LENGTH,
  IV_LENGTH,
  TAG_LENGTH,
  generateDek,
  aeadEncrypt,
  aeadDecrypt,
  encryptEntry,
  decryptEntry,
  wrapDek,
  unwrapDek,
  computeContentDigest,
  buildAssociatedData,
  deriveKeyFromPassphrase,
} from "../codex-crypto"

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_PLAINTEXT = Buffer.from("The quick brown fox jumps over the lazy dog", "utf-8")

// ── Constants ────────────────────────────────────────────────────────────────

describe("constants", () => {
  it("DEK_LENGTH is 32 bytes (256 bits)", () => {
    expect(DEK_LENGTH).toBe(32)
  })

  it("IV_LENGTH is 12 bytes (96 bits)", () => {
    expect(IV_LENGTH).toBe(12)
  })

  it("TAG_LENGTH is 16 bytes (128 bits)", () => {
    expect(TAG_LENGTH).toBe(16)
  })
})

// ── Low-Level AEAD ──────────────────────────────────────────────────────────

describe("aeadEncrypt + aeadDecrypt", () => {
  it("encrypt/decrypt round-trip succeeds with empty AAD", () => {
    const key = randomBytes(32)
    const nonce = randomBytes(12)
    const aad = Buffer.alloc(0)

    const { ciphertext, tag } = aeadEncrypt(TEST_PLAINTEXT, key, nonce, aad)
    expect(ciphertext).toBeInstanceOf(Buffer)
    expect(ciphertext.length).toBe(TEST_PLAINTEXT.length) // GCM preserves length
    expect(tag).toBeInstanceOf(Buffer)
    expect(tag.length).toBe(16)

    const decrypted = aeadDecrypt(ciphertext, key, nonce, aad, tag)
    expect(decrypted.equals(TEST_PLAINTEXT)).toBe(true)
  })

  it("encrypt/decrypt round-trip succeeds with AAD", () => {
    const key = randomBytes(32)
    const nonce = randomBytes(12)
    const aad = Buffer.from("entry-metadata", "utf-8")

    const { ciphertext, tag } = aeadEncrypt(TEST_PLAINTEXT, key, nonce, aad)
    const decrypted = aeadDecrypt(ciphertext, key, nonce, aad, tag)
    expect(decrypted.equals(TEST_PLAINTEXT)).toBe(true)
  })

  it("decrypt with wrong key throws", () => {
    const key = randomBytes(32)
    const wrongKey = randomBytes(32)
    const nonce = randomBytes(12)
    const aad = Buffer.alloc(0)

    if (key.equals(wrongKey)) return // astronomically unlikely

    const { ciphertext, tag } = aeadEncrypt(TEST_PLAINTEXT, key, nonce, aad)
    expect(() => aeadDecrypt(ciphertext, wrongKey, nonce, aad, tag)).toThrow()
  })

  it("decrypt with wrong AAD throws", () => {
    const key = randomBytes(32)
    const nonce = randomBytes(12)
    const aad = Buffer.from("original-metadata", "utf-8")
    const wrongAad = Buffer.from("tampered-metadata", "utf-8")

    const { ciphertext, tag } = aeadEncrypt(TEST_PLAINTEXT, key, nonce, aad)
    expect(() => aeadDecrypt(ciphertext, key, nonce, wrongAad, tag)).toThrow()
  })

  it("decrypt with tampered ciphertext throws", () => {
    const key = randomBytes(32)
    const nonce = randomBytes(12)
    const aad = Buffer.alloc(0)

    const { ciphertext, tag } = aeadEncrypt(TEST_PLAINTEXT, key, nonce, aad)
    const tampered = Buffer.from(ciphertext)
    tampered[0] ^= 0xff // Flip one bit

    expect(() => aeadDecrypt(tampered, key, nonce, aad, tag)).toThrow()
  })

  it("decrypt with tampered auth tag throws", () => {
    const key = randomBytes(32)
    const nonce = randomBytes(12)
    const aad = Buffer.alloc(0)

    const { ciphertext, tag } = aeadEncrypt(TEST_PLAINTEXT, key, nonce, aad)
    const tamperedTag = Buffer.from(tag)
    tamperedTag[0] ^= 0xff

    expect(() => aeadDecrypt(ciphertext, key, nonce, aad, tamperedTag)).toThrow()
  })

  it("produces different ciphertext with different nonce", () => {
    const key = randomBytes(32)
    const aad = Buffer.alloc(0)

    const nonce1 = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    const nonce2 = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2])

    const r1 = aeadEncrypt(TEST_PLAINTEXT, key, nonce1, aad)
    const r2 = aeadEncrypt(TEST_PLAINTEXT, key, nonce2, aad)
    expect(r1.ciphertext.equals(r2.ciphertext)).toBe(false)

    expect(aeadDecrypt(r1.ciphertext, key, nonce1, aad, r1.tag).equals(TEST_PLAINTEXT)).toBe(true)
    expect(aeadDecrypt(r2.ciphertext, key, nonce2, aad, r2.tag).equals(TEST_PLAINTEXT)).toBe(true)
  })

  it("encrypt and decrypt empty plaintext", () => {
    const key = randomBytes(32)
    const nonce = randomBytes(12)
    const aad = Buffer.alloc(0)
    const empty = Buffer.alloc(0)

    const { ciphertext, tag } = aeadEncrypt(empty, key, nonce, aad)
    const decrypted = aeadDecrypt(ciphertext, key, nonce, aad, tag)
    expect(decrypted.length).toBe(0)
  })

  it("decrypt with wrong nonce throws", () => {
    const key = randomBytes(32)
    const nonce = randomBytes(12)
    const wrongNonce = randomBytes(12)
    const aad = Buffer.alloc(0)

    if (nonce.equals(wrongNonce)) return

    const { ciphertext, tag } = aeadEncrypt(TEST_PLAINTEXT, key, nonce, aad)
    expect(() => aeadDecrypt(ciphertext, key, wrongNonce, aad, tag)).toThrow()
  })
})

// ── DEK Generation ──────────────────────────────────────────────────────────

describe("generateDek", () => {
  it("produces a 32-byte buffer", () => {
    const dek = generateDek()
    expect(dek).toBeInstanceOf(Buffer)
    expect(dek.length).toBe(32)
  })

  it("produces unique keys each call", () => {
    const a = generateDek()
    const b = generateDek()
    expect(a.equals(b)).toBe(false)
  })
})

// ── DEK Wrapping ────────────────────────────────────────────────────────────

describe("wrapDek + unwrapDek", () => {
  it("wrap/unwrap round-trip succeeds", () => {
    const dek = generateDek()
    const domainKey = randomBytes(32)

    const wrapped = wrapDek(dek, domainKey)
    expect(wrapped.wrappedDek).toBeInstanceOf(Buffer)
    expect(wrapped.wrappedDek.length).toBe(32) // GCM preserves plaintext length
    expect(wrapped.iv).toBeInstanceOf(Buffer)
    expect(wrapped.iv.length).toBe(12)
    expect(wrapped.authTag).toBeInstanceOf(Buffer)
    expect(wrapped.authTag.length).toBe(16)

    const unwrapped = unwrapDek(wrapped.wrappedDek, domainKey, wrapped.iv, wrapped.authTag)
    expect(unwrapped.equals(dek)).toBe(true)
  })

  it("unwrap with wrong domain key throws", () => {
    const dek = generateDek()
    const domainKey = randomBytes(32)
    const wrongKey = randomBytes(32)

    if (domainKey.equals(wrongKey)) return

    const wrapped = wrapDek(dek, domainKey)
    expect(() => unwrapDek(wrapped.wrappedDek, wrongKey, wrapped.iv, wrapped.authTag)).toThrow()
  })

  it("produces different wrapped DEK each time (random IV)", () => {
    const dek = generateDek()
    const domainKey = randomBytes(32)

    const a = wrapDek(dek, domainKey)
    const b = wrapDek(dek, domainKey)
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false)
    expect(a.iv.equals(b.iv)).toBe(false)
  })
})

// ── Per-Entry Encryption ────────────────────────────────────────────────────

describe("encryptEntry + decryptEntry", () => {
  it("encrypt/decrypt round-trip succeeds", () => {
    const dek = generateDek()
    const aad = buildAssociatedData("entry-001", "session", 1)

    const encrypted = encryptEntry(TEST_PLAINTEXT, dek, aad)
    expect(encrypted.ciphertext).toBeInstanceOf(Buffer)
    expect(encrypted.ciphertext.length).toBe(TEST_PLAINTEXT.length)
    expect(encrypted.iv).toBeInstanceOf(Buffer)
    expect(encrypted.iv.length).toBe(12)
    expect(encrypted.authTag).toBeInstanceOf(Buffer)
    expect(encrypted.authTag.length).toBe(16)

    const decrypted = decryptEntry(
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      dek,
      aad,
    )
    expect(decrypted.equals(TEST_PLAINTEXT)).toBe(true)
  })

  it("decrypt with wrong DEK throws", () => {
    const dek = generateDek()
    const wrongDek = generateDek()
    const aad = buildAssociatedData("entry-001", "session", 1)

    if (dek.equals(wrongDek)) return

    const encrypted = encryptEntry(TEST_PLAINTEXT, dek, aad)
    expect(() =>
      decryptEntry(encrypted.ciphertext, encrypted.iv, encrypted.authTag, wrongDek, aad),
    ).toThrow()
  })

  it("decrypt with wrong AAD throws", () => {
    const dek = generateDek()
    const aad = buildAssociatedData("entry-001", "session", 1)
    const wrongAad = buildAssociatedData("entry-001", "public", 1)

    const encrypted = encryptEntry(TEST_PLAINTEXT, dek, aad)
    expect(() =>
      decryptEntry(encrypted.ciphertext, encrypted.iv, encrypted.authTag, dek, wrongAad),
    ).toThrow()
  })

  it("decrypt with tampered ciphertext throws", () => {
    const dek = generateDek()
    const aad = buildAssociatedData("entry-001", "session", 1)

    const encrypted = encryptEntry(TEST_PLAINTEXT, dek, aad)
    const tampered = Buffer.from(encrypted.ciphertext)
    tampered[tampered.length - 1] ^= 0x01

    expect(() => decryptEntry(tampered, encrypted.iv, encrypted.authTag, dek, aad)).toThrow()
  })

  it("produces different ciphertext each time (random IV)", () => {
    const dek = generateDek()
    const aad = buildAssociatedData("entry-001", "session", 1)

    const a = encryptEntry(TEST_PLAINTEXT, dek, aad)
    const b = encryptEntry(TEST_PLAINTEXT, dek, aad)
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false)
    expect(a.iv.equals(b.iv)).toBe(false)
  })

  it("encrypt and decrypt empty plaintext", () => {
    const dek = generateDek()
    const aad = buildAssociatedData("entry-001", "session", 1)
    const empty = Buffer.alloc(0)

    const encrypted = encryptEntry(empty, dek, aad)
    const decrypted = decryptEntry(encrypted.ciphertext, encrypted.iv, encrypted.authTag, dek, aad)
    expect(decrypted.length).toBe(0)
  })
})

// ── Content Digest ──────────────────────────────────────────────────────────

describe("computeContentDigest", () => {
  it("produces a 64-character hex string (SHA-256)", () => {
    const digest = computeContentDigest(TEST_PLAINTEXT)
    expect(typeof digest).toBe("string")
    expect(digest.length).toBe(64)
    expect(/^[0-9a-f]{64}$/.test(digest)).toBe(true)
  })

  it("is deterministic for the same input", () => {
    const a = computeContentDigest(TEST_PLAINTEXT)
    const b = computeContentDigest(TEST_PLAINTEXT)
    expect(a).toBe(b)
  })

  it("differs for different inputs", () => {
    const a = computeContentDigest(Buffer.from("hello", "utf-8"))
    const b = computeContentDigest(Buffer.from("world", "utf-8"))
    expect(a).not.toBe(b)
  })

  it("produces correct known value", () => {
    const input = Buffer.from("hello", "utf-8")
    const digest = computeContentDigest(input)
    expect(digest).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
  })
})

// ── Associated Data ──────────────────────────────────────────────────────────

describe("buildAssociatedData", () => {
  it("produces a deterministic buffer", () => {
    const a = buildAssociatedData("entry-001", "session", 1)
    const b = buildAssociatedData("entry-001", "session", 1)
    expect(a.equals(b)).toBe(true)
  })

  it("differs when entryId changes", () => {
    const a = buildAssociatedData("entry-001", "session", 1)
    const b = buildAssociatedData("entry-002", "session", 1)
    expect(a.equals(b)).toBe(false)
  })

  it("differs when visibilityClass changes", () => {
    const a = buildAssociatedData("entry-001", "session", 1)
    const b = buildAssociatedData("entry-001", "public", 1)
    expect(a.equals(b)).toBe(false)
  })

  it("differs when schemaVersion changes", () => {
    const a = buildAssociatedData("entry-001", "session", 1)
    const b = buildAssociatedData("entry-001", "session", 2)
    expect(a.equals(b)).toBe(false)
  })

  it("produces valid JSON", () => {
    const buf = buildAssociatedData("e-1", "contributor", 3)
    const parsed = JSON.parse(buf.toString("utf-8"))
    expect(parsed).toEqual({ entryId: "e-1", visibilityClass: "contributor", schemaVersion: 3 })
  })
})

// ── Key Derivation ──────────────────────────────────────────────────────────

describe("deriveKeyFromPassphrase", () => {
  it("produces a 32-byte key", () => {
    const salt = randomBytes(32)
    const key = deriveKeyFromPassphrase("hunter2", salt)
    expect(key).toBeInstanceOf(Buffer)
    expect(key.length).toBe(32)
  })

  it("is deterministic with same passphrase and salt", () => {
    const salt = randomBytes(32)
    const a = deriveKeyFromPassphrase("hunter2", salt)
    const b = deriveKeyFromPassphrase("hunter2", salt)
    expect(a.equals(b)).toBe(true)
  })

  it("differs with different passphrase", () => {
    const salt = randomBytes(32)
    const a = deriveKeyFromPassphrase("hunter2", salt)
    const b = deriveKeyFromPassphrase("hunter3", salt)
    expect(a.equals(b)).toBe(false)
  })

  it("differs with different salt", () => {
    const saltA = randomBytes(32)
    const saltB = randomBytes(32)
    if (saltA.equals(saltB)) return

    const a = deriveKeyFromPassphrase("hunter2", saltA)
    const b = deriveKeyFromPassphrase("hunter2", saltB)
    expect(a.equals(b)).toBe(false)
  })
})

// ── End-to-End: Entry Encryption with DEK Wrapping ──────────────────────────

describe("end-to-end: encrypt entry with wrapped DEK", () => {
  it("full round-trip succeeds", () => {
    const entryId = "codex-entry-42"
    const visibilityClass = "contributor"
    const schemaVersion = 2
    const domainKey = randomBytes(32)

    // Build AAD from entry metadata
    const aad = buildAssociatedData(entryId, visibilityClass, schemaVersion)

    // Generate a per-entry DEK
    const dek = generateDek()

    // Encrypt entry plaintext under the DEK
    const plaintext = Buffer.from("Codex knowledge entry content", "utf-8")
    const contentDigest = computeContentDigest(plaintext)
    const encrypted = encryptEntry(plaintext, dek, aad)

    // Wrap the DEK under the domain key (separate IV from the entry encryption)
    const wrapped = wrapDek(dek, domainKey)

    // Simulate recipient side: unwrap the DEK, then decrypt the entry
    const recoveredDek = unwrapDek(wrapped.wrappedDek, domainKey, wrapped.iv, wrapped.authTag)
    const recoveredContent = decryptEntry(
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      recoveredDek,
      aad,
    )

    expect(recoveredContent.equals(plaintext)).toBe(true)
    expect(computeContentDigest(recoveredContent)).toBe(contentDigest)
  })

  it("fails with wrong domain key in DEK wrapping", () => {
    const dek = generateDek()
    const domainKey = randomBytes(32)
    const wrongDomainKey = randomBytes(32)

    if (domainKey.equals(wrongDomainKey)) return

    const wrapped = wrapDek(dek, domainKey)
    expect(() => unwrapDek(wrapped.wrappedDek, wrongDomainKey, wrapped.iv, wrapped.authTag)).toThrow()
  })

  it("entry decrypt fails after AAD tampering in transit", () => {
    const dek = generateDek()
    const aad = buildAssociatedData("entry-001", "session", 1)
    const tamperedAad = buildAssociatedData("entry-001", "public", 1)

    const plaintext = Buffer.from("sensitive knowledge", "utf-8")
    const encrypted = encryptEntry(plaintext, dek, aad)

    expect(() => decryptEntry(
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      dek,
      tamperedAad,
    )).toThrow()
  })
})
