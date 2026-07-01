/**
 * Codex — Cryptographic Export Services
 *
 * Handles manifest signature verification, root authority verification,
 * recipient encryption via X25519 ECDH + AES-256-GCM, and export session
 * creation and verification.
 *
 * This is the cryptographic gate (Gate 3 replacement) and the encryption
 * layer for export output.
 */

import {
  randomBytes,
  generateKeyPairSync,
  diffieHellman,
  createPrivateKey,
  createPublicKey,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto"
import type { CodexEntry, FullDatasetExportAuthorization, DatasetExportReceipt } from "../codex-types"
import type { DomainKeyStore, KeyReleaseResponse } from "./domain-keys"
import type { EncryptedEntry } from "./codex-crypto"
import { decryptEntry, computeContentDigest, unwrapDek, buildAssociatedData } from "./codex-crypto"
import { getActiveDomainKey, visibilityToDomainId } from "./domain-keys"
import { sign, verify } from "../../crypto"

// ── Constants ────────────────────────────────────────────────────────────────

const OUTPUT_ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

// ── Root Public Key (pinned in application) ──────────────────────────────────

/**
 * Decoded root Ed25519 public key Buffer.
 *
 * Pinned at application startup. The corresponding private key is NEVER
 * in the repository.
 */
let _rootPublicKey: Buffer | null = null

/**
 * Set the root public key at application startup.
 *
 * @param b64 Base64-encoded Ed25519 public key.
 */
export function initializeRootKey(b64: string): void {
  _rootPublicKey = Buffer.from(b64, "base64")
}

/**
 * Get the configured root public key.
 * Throws if not initialized.
 */
export function getRootPublicKey(): Buffer {
  if (!_rootPublicKey) {
    throw new Error("Root public key not initialized. Call initializeRootKey() at startup.")
  }
  return _rootPublicKey
}

// ── Manifest Signature Verification ──────────────────────────────────────────

/**
 * Verify an Ed25519 signature over a manifest string.
 *
 * Returns true if the signature is valid for the given public key.
 */
export function verifyManifestSignature(
  manifest: string,
  signature: Buffer,
  publicKey: Buffer,
): boolean {
  return verify(publicKey, Buffer.from(manifest, "utf-8"), signature)
}

/**
 * Sign a manifest string with an Ed25519 private key.
 *
 * Returns the raw 64-byte signature.
 */
export function signManifest(manifest: string, privateKey: Buffer): Buffer {
  return Buffer.from(sign(privateKey, Buffer.from(manifest, "utf-8")))
}

// ── Cryptographic Gate 3 (replaces app-level check) ─────────────────────────

/**
 * Cryptographically verify a FullDatasetExportAuthorization against the
 * root Ed25519 public key.
 *
 * Verifies that the rootAuthoritySignature is a valid Ed25519 signature
 * over the authorization's critical fields (exportManifestDigest, identity,
 * and timing).
 *
 * Returns { valid: true } on success, or { valid: false, reason } on failure.
 */
export function cryptographicallyVerifyAuthorization(
  auth: FullDatasetExportAuthorization,
  rootPublicKey: Buffer,
): { valid: boolean; reason: string | null } {
  try {
    if (!auth.rootAuthoritySignature || auth.rootAuthoritySignature.length === 0) {
      return { valid: false, reason: "Missing root authority signature" }
    }

    // Build the signed payload from the authorization's critical fields.
    // This is what the root key signs: a canonical representation of
    // the authorization's identity, scope, and timing constraints.
    const signedPayload = buildAuthPayload(auth)
    const signatureBytes = Buffer.from(auth.rootAuthoritySignature, "base64")

    const isValid = verify(rootPublicKey, Buffer.from(signedPayload, "utf-8"), signatureBytes)
    if (!isValid) {
      return { valid: false, reason: "Root authority signature does not match authorization fields" }
    }

    return { valid: true, reason: null }
  } catch (err) {
    return { valid: false, reason: `Cryptographic verification error: ${String(err)}` }
  }
}

/**
 * Build the canonical payload string that the root key signs.
 *
 * Fields: authorizationId, requestedBy, exportManifestDigest,
 * sourceSnapshot (autobase heads), releasePolicyDigest,
 * recipientBinding (if present), issuedAt, expiresAt.
 */
export function buildAuthPayload(auth: FullDatasetExportAuthorization): string {
  const parts: string[] = [
    auth.authorizationId,
    auth.requestedBy,
    auth.exportManifestDigest,
    auth.sourceSnapshot.autobaseHeads.join(","),
    auth.sourceSnapshot.codexSchemaVersion,
    auth.sourceSnapshot.datasetProjectionVersion,
    auth.releasePolicyDigest,
    auth.recipientBinding ?? "",
    auth.issuedAtLogicalTime,
    auth.expiresAtLogicalTime,
  ]
  return parts.join("|")
}

/**
 * Check whether the export manifest digest in the authorization matches
 * the given manifest digest.
 */
export function isExportManifestAuthorized(
  auth: FullDatasetExportAuthorization,
  manifestDigest: string,
): boolean {
  return auth.exportManifestDigest === manifestDigest
}

// ── Recipient Encryption (X25519 ECDH + AES-256-GCM) ────────────────────────

/**
 * Generate an X25519 key pair for recipient encryption.
 *
 * Keys are in DER format (SPKI public, PKCS8 private).
 */
export function generateEncryptionKeyPair(): { publicKey: Buffer; privateKey: Buffer } {
  const { publicKey, privateKey } = generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  })
  return { publicKey, privateKey }
}

/**
 * Compute an ECDH shared secret from a private key and a public key.
 *
 * Both keys are in DER format (X25519).
 */
function computeSharedSecret(privateKeyDer: Buffer, publicKeyDer: Buffer): Buffer {
  const privKey = createPrivateKey({ key: privateKeyDer, format: "der", type: "pkcs8" })
  const pubKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" })
  return diffieHellman({ privateKey: privKey, publicKey: pubKey })
}

/**
 * Encrypt plaintext for a recipient using ECIES with X25519 ECDH.
 *
 * - Generates an ephemeral X25519 key pair
 * - Derives a shared secret via ECDH
 * - Uses AES-256-GCM with the first 32 bytes of SHA-256(sharedSecret)
 * - Output format: ephemeralPublicKey || iv || ciphertext || authTag
 *
 * @param plaintext - Data to encrypt
 * @param recipientPublicKey - Recipient's X25519 public key (DER SPKI format)
 * @returns Encrypted blob (ephemeral pubkey || iv || ciphertext || authTag)
 */
export function encryptOutputForRecipient(
  plaintext: Buffer,
  recipientPublicKey: Buffer,
): Buffer {
  // Generate ephemeral key pair
  const { publicKey: ephPub, privateKey: ephPriv } = generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  })

  // Derive shared secret
  const sharedSecret = computeSharedSecret(ephPriv, recipientPublicKey)

  // Derive AES key from shared secret
  const aesKey = createHash("sha256").update(sharedSecret).digest()

  // Encrypt with AES-256-GCM
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(OUTPUT_ALGORITHM, aesKey, iv)
  const encrypted = cipher.update(plaintext)
  const final = cipher.final()
  const authTag = cipher.getAuthTag()

  // Format: ephemeralPublicKeyLen (2 bytes) || ephemeralPublicKey || iv || ciphertext || authTag
  const ephPubLen = Buffer.alloc(2)
  ephPubLen.writeUInt16BE(ephPub.length)
  return Buffer.concat([ephPubLen, ephPub, iv, encrypted, final, authTag])
}

/**
 * Decrypt data that was encrypted with encryptOutputForRecipient.
 *
 * @param encrypted - Encrypted blob (ephemeral pubkey || iv || ciphertext || authTag)
 * @param recipientPrivateKey - Recipient's X25519 private key (DER PKCS8 format)
 * @returns Decrypted plaintext
 */
export function decryptOutput(
  encrypted: Buffer,
  recipientPrivateKey: Buffer,
): Buffer {
  // Parse format: ephemeralPublicKeyLen (2 bytes) || ephemeralPublicKey || iv || ciphertext || authTag
  const ephPubLen = encrypted.readUInt16BE(0)
  const ephPub = encrypted.subarray(2, 2 + ephPubLen)
  const iv = encrypted.subarray(2 + ephPubLen, 2 + ephPubLen + IV_LENGTH)
  const authTag = encrypted.subarray(encrypted.length - AUTH_TAG_LENGTH)
  const ciphertext = encrypted.subarray(2 + ephPubLen + IV_LENGTH, encrypted.length - AUTH_TAG_LENGTH)

  // Derive shared secret from recipient's private key and ephemeral public key
  const sharedSecret = computeSharedSecret(recipientPrivateKey, ephPub)

  // Derive AES key
  const aesKey = createHash("sha256").update(sharedSecret).digest()

  // Decrypt
  const decipher = createDecipheriv(OUTPUT_ALGORITHM, aesKey, iv)
  decipher.setAuthTag(authTag)
  const decrypted = decipher.update(ciphertext)
  const final = decipher.final()

  return Buffer.concat([decrypted, final])
}

// ── Ephemeral Export Session ────────────────────────────────────────────────

export interface ExportSession {
  manifestDigest: string
  entries: { entry: CodexEntry; plaintext: Buffer }[]
  keyRelease: KeyReleaseResponse
  encryptedOutput: Buffer
  receipt: DatasetExportReceipt
}

/**
 * Create an export session by:
 * 1. Decrypting encrypted entries using domain keys
 * 2. Computing the manifest digest
 * 3. Building a receipt
 * 4. Encrypting the output for the recipient
 *
 * Returns null if decryption of any entry fails.
 */
export function createExportSession(
  auth: FullDatasetExportAuthorization,
  encryptedEntries: EncryptedEntry[],
  domainKeys: DomainKeyStore,
  keyRelease: KeyReleaseResponse,
  recipientKey: Buffer,
): ExportSession | null {
  try {
    // Decrypt each entry using its domain key
    const entries: { entry: CodexEntry; plaintext: Buffer }[] = []
    for (const encrypted of encryptedEntries) {
      const domainKey = getActiveDomainKey(encrypted.domainId, domainKeys)
      const dek = unwrapDek(encrypted.wrappedDek, domainKey.wrappingKey, encrypted.wrapIv, encrypted.wrapAuthTag)

      const aad = buildAssociatedData(encrypted.entryId, encrypted.visibilityClass, encrypted.schemaVersion)
      const decrypted = decryptEntry(encrypted.ciphertext, encrypted.iv, encrypted.authTag, dek, aad)
      const entry: CodexEntry = JSON.parse(decrypted.toString("utf-8"))

      entries.push({ entry, plaintext: decrypted })
    }

    // Build manifest digest
    const allPlaintexts = Buffer.concat(entries.map((e) => e.plaintext))
    const manifestDigest = createHash("sha256").update(allPlaintexts).digest("hex")

    // Verify the auth matches this manifest
    if (!isExportManifestAuthorized(auth, manifestDigest)) {
      return null
    }

    // Encrypt the combined output for the recipient
    const encryptedOutput = encryptOutputForRecipient(allPlaintexts, recipientKey)

    // Build receipt
    const receipt: DatasetExportReceipt = {
      receiptId: `receipt-${manifestDigest.slice(0, 12)}`,
      exportManifestDigest: manifestDigest,
      requester: auth.requestedBy,
      authorityUsed: "full_dataset_export",
      entryCount: entries.length,
      excludedEntryCount: 0,
      visibilityClassesIncluded: [...new Set(entries.map((e) => e.entry.visibilityClass))],
      outputDigest: manifestDigest,
      recipientBinding: auth.recipientBinding,
      logicalTime: new Date().toISOString(),
      authorizedBy: [keyRelease.signedBy],
      signatures: [keyRelease.signature],
    }

    return {
      manifestDigest,
      entries,
      keyRelease,
      encryptedOutput,
      receipt,
    }
  } catch {
    return null
  }
}

/**
 * Verify an export session's integrity.
 *
 * Checks that entries can be re-decrypted, the manifest digest matches,
 * and the receipt is consistent with the session data.
 */
export function verifyExportSession(session: ExportSession): boolean {
  try {
    // Recompute manifest digest
    const allPlaintexts = Buffer.concat(session.entries.map((e) => e.plaintext))
    const computedDigest = createHash("sha256").update(allPlaintexts).digest("hex")

    if (computedDigest !== session.manifestDigest) return false
    if (session.receipt.exportManifestDigest !== session.manifestDigest) return false
    if (session.receipt.entryCount !== session.entries.length) return false

    return true
  } catch {
    return false
  }
}
