/**
 * Dharma Federation Runtime — Cryptographic Primitives
 *
 * Pure Ed25519 key management, signing, verification, hashing,
 * and private-key encryption using node:crypto.
 */

import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
} from "node:crypto"

// ── Types --------------------------------------------------------------------

export interface KeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export interface EncryptedKeyBundle {
  encrypted: Uint8Array
  iv: Uint8Array
  salt: Uint8Array
  authTag: Uint8Array
}

// ── Ed25519 Key Generation ---------------------------------------------------

/** Generate Ed25519 key pair */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  })
  return { publicKey: new Uint8Array(publicKey), privateKey: new Uint8Array(privateKey) }
}

// ── Sign / Verify ------------------------------------------------------------

/** Sign data with Ed25519 private key. Returns raw 64-byte signature. */
export function sign(privateKey: Uint8Array, data: Uint8Array): Uint8Array {
  const sig = nodeSign(null, data, {
    key: Buffer.from(privateKey),
    format: "der",
    type: "pkcs8",
  })
  return new Uint8Array(sig)
}

/** Verify Ed25519 signature. Returns true if valid. */
export function verify(publicKey: Uint8Array, data: Uint8Array, signature: Uint8Array): boolean {
  try {
    return nodeVerify(null, data, {
      key: Buffer.from(publicKey),
      format: "der",
      type: "spki",
    }, Buffer.from(signature))
  } catch {
    return false
  }
}

// ── Hashing ------------------------------------------------------------------

/** SHA-256 hash returning hex string */
export function sha256(data: Uint8Array | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data)
  return createHash("sha256").update(buf).digest("hex")
}

// ── Private Key Encryption ---------------------------------------------------

const KEY_ITERATIONS = 600_000
const KEY_LENGTH = 32
const ALGORITHM = "aes-256-gcm"

/** Serialize EncryptedKeyBundle to Uint8Array (JSON-safe) */
export function serializeEncryptedBundle(bundle: EncryptedKeyBundle): Uint8Array {
  const obj = {
    encrypted: Array.from(bundle.encrypted),
    iv: Array.from(bundle.iv),
    salt: Array.from(bundle.salt),
    authTag: Array.from(bundle.authTag),
  }
  return new TextEncoder().encode(JSON.stringify(obj))
}

/** Deserialize Uint8Array back to EncryptedKeyBundle */
export function deserializeEncryptedBundle(data: Uint8Array): EncryptedKeyBundle {
  const obj = JSON.parse(new TextDecoder().decode(data))
  return {
    encrypted: new Uint8Array(obj.encrypted),
    iv: new Uint8Array(obj.iv),
    salt: new Uint8Array(obj.salt),
    authTag: new Uint8Array(obj.authTag),
  }
}

/** Encrypt private key with AES-256-GCM using a passphrase-derived key (PBKDF2). */
export function encryptPrivateKey(
  privateKey: Uint8Array,
  passphrase: string,
): EncryptedKeyBundle {
  const salt = randomBytes(32)
  const iv = randomBytes(16)
  const key = pbkdf2Sync(passphrase, salt, KEY_ITERATIONS, KEY_LENGTH, "sha512")

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(privateKey)),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return {
    encrypted: new Uint8Array(encrypted),
    iv: new Uint8Array(iv),
    salt: new Uint8Array(salt),
    authTag: new Uint8Array(authTag),
  }
}

/** Decrypt a private key bundle with passphrase */
export function decryptPrivateKey(
  bundle: EncryptedKeyBundle,
  passphrase: string,
): Uint8Array {
  const key = pbkdf2Sync(passphrase, bundle.salt, KEY_ITERATIONS, KEY_LENGTH, "sha512")
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(bundle.iv))
  decipher.setAuthTag(Buffer.from(bundle.authTag))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(bundle.encrypted)),
    decipher.final(),
  ])
  return new Uint8Array(decrypted)
}
