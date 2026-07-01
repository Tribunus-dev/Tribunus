/**
 * Codex — Cryptographic Entry Protection Layer
 *
 * Per-entry AEAD encryption using AES-256-GCM with envelope encryption.
 * Each entry gets a unique 32-byte Data Encryption Key (DEK).
 * The plaintext is encrypted with that DEK, then the DEK itself is
 * wrapped (encrypted) under a domain key. This compartmentalizes
 * key material so domain keys never directly encrypt entry payloads.
 *
 * Associated Data (AAD) binds ciphertext to entry metadata without
 * encrypting that metadata — enabling integrity verification across
 * the plaintext/metadata boundary.
 */
import { randomBytes, createCipheriv, createDecipheriv, createHash, pbkdf2Sync } from "node:crypto"

// ── Constants ─────────────────────────────────────────────────────────────────

/** 256-bit data encryption key */
export const DEK_LENGTH = 32

/** 96-bit nonce for AES-256-GCM */
export const IV_LENGTH = 12

/** 128-bit GCM authentication tag */
export const TAG_LENGTH = 16

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A Codex entry encrypted with its own DEK, which is then wrapped
 * under a domain wrapping key.
 *
 * All fields are stored alongside each other (e.g. in a JSON blob)
 * and reconstructed before decryption.
 */
export interface EncryptedEntry {
  entryId: string
  domainId: string
  visibilityClass: string
  schemaVersion: number
  iv: Buffer               /** AES-GCM IV for the entry ciphertext */
  ciphertext: Buffer       /** AES-GCM ciphertext of the serialized entry JSON */
  authTag: Buffer          /** AES-GCM authentication tag for the entry ciphertext */
  wrappedDek: Buffer       /** DEK ciphertext encrypted under the domain key */
  wrapIv: Buffer           /** AES-GCM IV for the DEK wrapping */
  wrapAuthTag: Buffer      /** AES-GCM authentication tag for the DEK wrapping */
  contentDigest: string    /** SHA-256 of the entry plaintext */
}

// ── Low-Level AEAD ──────────────────────────────────────────────────────────

/**
 * AES-256-GCM encrypt with associated data.
 * The AAD is authenticated but NOT encrypted — it binds the ciphertext
 * to metadata that remains visible to policy evaluation.
 *
 * @param plaintext - data to encrypt
 * @param key - 32-byte AES-256 key
 * @param nonce - 12-byte IV
 * @param aad - associated data (authenticated, not encrypted)
 * @returns ciphertext and 16-byte GCM authentication tag
 */
export function aeadEncrypt(
  plaintext: Buffer,
  key: Buffer,
  nonce: Buffer,
  aad: Buffer,
): { ciphertext: Buffer; tag: Buffer } {
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return { ciphertext, tag }
}

/**
 * AES-256-GCM decrypt with associated data verification.
 *
 * @param ciphertext - encrypted data
 * @param key - 32-byte AES-256 key
 * @param nonce - 12-byte IV
 * @param aad - associated data (must match encrypt)
 * @param tag - 16-byte GCM authentication tag
 * @returns decrypted plaintext
 * @throws if authentication fails (wrong key, tampered data, mismatched AAD)
 */
export function aeadDecrypt(
  ciphertext: Buffer,
  key: Buffer,
  nonce: Buffer,
  aad: Buffer,
  tag: Buffer,
): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, nonce)
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

// ── DEK Management ──────────────────────────────────────────────────────────

/**
 * Generate a fresh 32-byte Data Encryption Key.
 */
export function generateDek(): Buffer {
  return randomBytes(DEK_LENGTH)
}

// ── Per-Entry Encryption ────────────────────────────────────────────────────

/**
 * Encrypt entry plaintext under a DEK with associated data.
 * Generates a fresh random IV each call.
 */
export function encryptEntry(
  plaintext: Buffer,
  dek: Buffer,
  aad: Buffer,
): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(IV_LENGTH)
  const { ciphertext, tag } = aeadEncrypt(plaintext, dek, iv, aad)
  return { ciphertext, iv, authTag: tag }
}

/**
 * Decrypt entry ciphertext under a DEK with associated data verification.
 *
 * @throws if authentication fails
 */
export function decryptEntry(
  ciphertext: Buffer,
  iv: Buffer,
  authTag: Buffer,
  dek: Buffer,
  aad: Buffer,
): Buffer {
  return aeadDecrypt(ciphertext, dek, iv, aad, authTag)
}

// ── DEK Wrapping ────────────────────────────────────────────────────────────

/**
 * Wrap (encrypt) a DEK under a domain key using AES-256-GCM.
 * The DEK is the plaintext; the domain key is the encryption key.
 * Generates a fresh random IV each call.
 *
 * Returns the wrapped DEK components separately so they can be stored
 * alongside the encrypted entry without structural assumptions.
 */
export function wrapDek(
  dek: Buffer,
  domainKey: Buffer,
): { wrappedDek: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(IV_LENGTH)
  const { ciphertext, tag } = aeadEncrypt(dek, domainKey, iv, Buffer.alloc(0))
  return { wrappedDek: ciphertext, iv, authTag: tag }
}

/**
 * Unwrap (decrypt) a DEK from under a domain key.
 *
 * @throws if authentication fails (wrong domain key or tampered wrapping)
 */
export function unwrapDek(
  wrappedDek: Buffer,
  domainKey: Buffer,
  iv: Buffer,
  authTag: Buffer,
): Buffer {
  return aeadDecrypt(wrappedDek, domainKey, iv, Buffer.alloc(0), authTag)
}

// ── Integrity ───────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 content digest of entry plaintext.
 * Used as a pre-encryption integrity anchor alongside the AEAD tag.
 */
export function computeContentDigest(plaintext: Buffer): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

// ── Associated Data Construction ────────────────────────────────────────────

/**
 * Build deterministic associated data from entry metadata.
 * The AAD is authenticated by the AEAD cipher but remains in the clear,
 * binding each ciphertext to its logical entry identity.
 *
 * Format: UTF-8 encoded JSON of { entryId, visibilityClass, schemaVersion }.
 * This MUST be stable across runtimes and platforms so that downstream
 * consumers can reconstruct it for decryption.
 */
export function buildAssociatedData(
  entryId: string,
  visibilityClass: string,
  schemaVersion: number,
): Buffer {
  return Buffer.from(
    JSON.stringify({ entryId, visibilityClass, schemaVersion }),
    "utf-8",
  )
}

// ── Key Derivation ──────────────────────────────────────────────────────────

/**
 * Derive an AES-256 key from a passphrase using PBKDF2-SHA512 with
 * 600,000 iterations.
 *
 * @param passphrase - user or operator passphrase
 * @param salt - 32-byte random salt
 * @returns 32-byte derived key suitable for use as a domain key or DEK
 */
export function deriveKeyFromPassphrase(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, 600_000, DEK_LENGTH, "sha512")
}
