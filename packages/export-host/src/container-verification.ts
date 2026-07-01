/**
 * Container Image Verification
 *
 * Provides cryptographic verification of container image digests and
 * Ed25519 signatures. Ensures that only authorized export-host images
 * are launched in production environments.
 *
 * Phase 3 — Hardened Export Environment
 */

import { createHash, timingSafeEqual } from "node:crypto"
import { sign, verify } from "@tribunus/runtime/tribunus/dharma/crypto"

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContainerSignature {
  /** Hex-encoded SHA-256 digest of the container image manifest */
  imageDigest: string
  /** Base64-encoded Ed25519 public key of the signer */
  signerPublicKey: string
  /** Hex-encoded raw Ed25519 signature (64 bytes = 128 hex chars) */
  signature: string
  /** ISO-8601 timestamp of when the signature was produced */
  signedAt: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const SHA256_HEX_LENGTH = 64
const ED25519_SIGNATURE_HEX_LENGTH = 128

// ── Digest Verification ──────────────────────────────────────────────────────

/**
 * Compare the computed SHA-256 digest of a container image manifest
 * against the expected digest.
 *
 * Uses timing-safe comparison to prevent timing side-channel attacks.
 *
 * @param imageDigest — SHA-256 hex string derived from the actual image
 * @param expectedDigest — trusted SHA-256 hex string to compare against
 * @returns true if the digests match
 */
export function verifyContainerImage(imageDigest: string, expectedDigest: string): boolean {
  if (typeof imageDigest !== "string" || typeof expectedDigest !== "string") {
    return false
  }

  const a = imageDigest.toLowerCase()
  const b = expectedDigest.toLowerCase()

  if (a.length !== SHA256_HEX_LENGTH || b.length !== SHA256_HEX_LENGTH) {
    return false
  }

  const aBuf = Buffer.from(a, "utf-8")
  const bBuf = Buffer.from(b, "utf-8")

  try {
    return timingSafeEqual(aBuf, bBuf)
  } catch {
    return false
  }
}

// ── Signature Creation ──────────────────────────────────────────────────────

/**
 * Sign a container image digest with the given Ed25519 signing key.
 *
 * The signature is over the canonical form: `sha256:<digest>` string,
 * which prevents ambiguity between different digest schemes.
 *
 * @param imageDigest — SHA-256 hex string identifying the container image
 * @param signingKey — Ed25519 private key (PKCS#8 DER) as Uint8Array
 * @returns ContainerSignature containing the signed digest, public key, and metadata
 */
export function signContainerImage(
  imageDigest: string,
  signingKey: Uint8Array,
): ContainerSignature {
  if (!imageDigest || imageDigest.length !== SHA256_HEX_LENGTH) {
    throw new Error(`signContainerImage: invalid digest length (expected ${SHA256_HEX_LENGTH} hex chars)`)
  }

  // Canonical signing payload
  const payload = `sha256:${imageDigest}`
  const signatureBytes = sign(signingKey, Buffer.from(payload, "utf-8"))

  // Derive the public key from the private key via verification round-trip
  // (we use the raw signature bytes; public key is embedded in the PKCS#8 private key)
  const publicKeyDer = extractPublicFromPrivateKey(signingKey)

  return {
    imageDigest,
    signerPublicKey: Buffer.from(publicKeyDer).toString("base64"),
    signature: Buffer.from(signatureBytes).toString("hex"),
    signedAt: new Date().toISOString(),
  }
}

// ── Signature Verification ──────────────────────────────────────────────────

/**
 * Verify an Ed25519 signature over a container image digest.
 *
 * Reconstructs the canonical payload (`sha256:<digest>`) and checks
 * the signature against the provided public key.
 *
 * @param sig — the ContainerSignature to verify
 * @param expectedDigest — the trusted image digest
 * @param publicKey — Ed25519 public key (SPKI DER) as Buffer
 * @returns true if the signature is valid and matches the expected digest
 */
export function verifyContainerSignature(
  sig: ContainerSignature,
  expectedDigest: string,
  publicKey: Buffer,
): boolean {
  if (!sig || typeof sig.imageDigest !== "string" || typeof sig.signature !== "string") {
    return false
  }

  // Check digest match first
  if (!verifyContainerImage(sig.imageDigest, expectedDigest)) {
    return false
  }

  // Validate signature hex length
  if (sig.signature.length !== ED25519_SIGNATURE_HEX_LENGTH) {
    return false
  }

  // Validate signed at is a reasonable ISO string
  if (typeof sig.signedAt !== "string" || Number.isNaN(Date.parse(sig.signedAt))) {
    return false
  }

  const payload = `sha256:${expectedDigest}`
  const signatureBytes = Buffer.from(sig.signature, "hex")

  return verify(publicKey, Buffer.from(payload, "utf-8"), signatureBytes)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the Ed25519 public key from a PKCS#8 DER-encoded private key.
 *
 * PKCS#8 Ed25519 structure (offset approach):
 *   - Byte 0..4: 30 2E 02 01 00 — algorithm identifier wrapper
 *   - Byte 5..6:   30 05        — algorithm sequence
 *   - Byte 7..11:   06 03 2B 65 70 — OID 1.3.101.112 (id-ed25519)
 *   - Byte 12:       A1 22       — explicit tag + length (34 bytes)
 *   - Byte 13:         04 20    — octet string + length (32 bytes)
 *   - Byte 14..15:     ?? ??    — private key
 *   - Byte 16..47:     key bytes — the actual 32-byte key
 *
 * The public key is NOT in raw PKCS#8 Ed25519 private keys by spec
 * (it's only in the "v2" format with attributes). For a raw key,
 * we derive the public key from the private key deterministically.
 *
 * In Node.js/Bun, generateKeyPairSync("ed25519") returns PKCS#8 private
 * and SPKI public keys in DER format. We need to accept the public key
 * as a separate parameter for verification, which is the proper API anyway.
 * For signContainerImage, we derive the public key from the raw seed.
 *
 * However, Node's crypto doesn't expose raw key derivation. The practical
 * approach: the caller passes the full keypair or we accept the public key
 * parameter directly. For simplicity, signContainerImage uses the PKCS#8
 * structure to extract the 32-byte seed, then recomputes the public key
 * using Node's createPublicKey derivation.
 */

import { createPrivateKey, createPublicKey } from "node:crypto"
import type { KeyPair } from "@tribunus/runtime/tribunus/dharma/crypto"

/**
 * Derive the SPKI DER public key from a PKCS#8 DER private key.
 *
 * Node.js's createPublicKey can derive the Ed25519 public key from
 * the private key deterministically.
 */
function extractPublicFromPrivateKey(privateKeyDer: Uint8Array): Uint8Array {
  const privateKeyObject = createPrivateKey({
    key: Buffer.from(privateKeyDer),
    format: "der",
    type: "pkcs8",
  })
  const publicKeyObject = createPublicKey(privateKeyObject)
  const spkiDer = publicKeyObject.export({
    format: "der",
    type: "spki",
  })
  return new Uint8Array(spkiDer)
}

// ── Compute Container Digest ─────────────────────────────────────────────────

/**
 * Compute the SHA-256 digest of a container image tarball or manifest JSON.
 *
 * @param data — raw bytes of the image manifest or image tarball
 * @returns lowercase hex SHA-256 digest string
 */
export function computeImageDigest(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}
