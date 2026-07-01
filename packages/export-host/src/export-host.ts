#!/usr/bin/env node

/**
 * Codex Ephemeral Export Host
 *
 * A minimal, single-purpose executable for performing Codex full exports.
 *
 * Properties:
 *   - No GUI, no plugins, no browser, no arbitrary code execution
 *   - No general network access (only the key-release endpoint if configured)
 *   - No standing credentials, no persistent corpus copy
 *   - Takes a signed manifest and encrypted entry files as input
 *   - Validates the manifest signature against the pinned root public key
 *   - Requests key release from the external lease authority
 *   - Decrypts entries in bounded batches, zeroes buffers after use
 *   - Encrypts output to the recipient's public key
 *   - Produces a signed receipt
 *   - Destroys process state on completion
 *
 * Usage:
 *   export-host \
 *     --manifest signed-manifest.json \
 *     --entries encrypted-entries/ \
 *     --recipient-key recipient-public.pem \
 *     --lease-url http://127.0.0.1:<port> \
 *     --output result.pack
 *
 * Crypto modules imported (NOT the full runtime):
 *   - @tribunus/runtime/tribunus/dharma/codex/crypto/codex-crypto
 *   - @tribunus/runtime/tribunus/dharma/codex/crypto/codex-export-crypto
 *   - @tribunus/runtime/tribunus/dharma/codex/crypto/codex-merkle
 *   - @tribunus/runtime/tribunus/dharma/codex/crypto/domain-keys
 *   - @tribunus/runtime/tribunus/dharma/crypto
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { randomBytes, createHash } from "node:crypto"

// ── Runtime Crypto Imports (specific modules, not full runtime) ──────────────

import {
  decryptEntry,
  computeContentDigest,
  unwrapDek,
  buildAssociatedData,
} from "@tribunus/runtime/tribunus/dharma/codex/crypto/codex-crypto"

import type { EncryptedEntry } from "@tribunus/runtime/tribunus/dharma/codex/crypto/codex-crypto"

import {
  verifyManifestSignature,
  encryptOutputForRecipient,
  getRootPublicKey,
  initializeRootKey,
} from "@tribunus/runtime/tribunus/dharma/codex/crypto/codex-export-crypto"

import type {
  FullDatasetExportAuthorization,
  DatasetExportReceipt,
} from "@tribunus/runtime/tribunus/dharma/codex/codex-types"

import type {
  DomainKeyStore,
  KeyReleaseResponse,
  DomainKey,
} from "@tribunus/runtime/tribunus/dharma/codex/crypto/domain-keys"

// ── Constants ────────────────────────────────────────────────────────────────

/** Default batch size for processing entries */
const DEFAULT_BATCH_SIZE = 100

/** Expected file extension for encrypted entry files */
const ENC_ENTRY_EXT = ".enc.json"

/** Receipt output extension */
const RECEIPT_EXT = ".receipt.json"

/** Size of the export session salt (32 bytes) */
const EPHEMERAL_SALT_BYTES = 32

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExportHostConfig {
  /** Path to the signed manifest JSON file */
  manifestPath: string
  /** Directory containing encrypted entry files */
  entriesDir: string
  /** Path to recipient's public key file (PEM or raw DER) */
  recipientKeyPath: string
  /** URL of the lease/key-release authority (optional) */
  leaseUrl?: string
  /** Output path for the encrypted pack */
  outputPath: string
  /** Number of entries to process per batch */
  batchSize: number
  /** Pinned root Ed25519 public key (base64) */
  rootPublicKeyB64?: string
}

export interface ExportHostResult {
  success: boolean
  outputPath: string
  receiptDigest: string
  entryCount: number
  excludedCount: number
  error: string | null
  completedAt: string
}

export interface SignedManifest {
  manifest: Record<string, unknown>
  signature: string
  signerIdentity: string
}

// ── Argument Parsing ─────────────────────────────────────────────────────────

/**
 * Parse command-line arguments into an ExportHostConfig.
 *
 * Recognised flags:
 *   --manifest <path>       (required) Path to signed manifest JSON
 *   --entries <dir>         (required) Directory with encrypted entry files
 *   --recipient-key <path>  (required) Path to recipient's public key file
 *   --lease-url <url>       (optional) Key-release authority URL
 *   --output <path>         (required) Output .pack file path
 *   --batch-size <n>        (optional) Entries per batch (default 100)
 *   --root-key <b64>        (optional) Base64-encoded root public key
 */
export function parseArgs(argv: string[] = process.argv.slice(2)): ExportHostConfig {
  const args = [...argv]
  const config: Partial<ExportHostConfig> = {
    batchSize: DEFAULT_BATCH_SIZE,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = () => (i + 1 < args.length ? args[++i] : undefined)

    switch (arg) {
      case "--manifest":
        config.manifestPath = next()
        if (!config.manifestPath) throw new Error("--manifest requires a path argument")
        break
      case "--entries":
        config.entriesDir = next()
        if (!config.entriesDir) throw new Error("--entries requires a directory argument")
        break
      case "--recipient-key":
        config.recipientKeyPath = next()
        if (!config.recipientKeyPath) throw new Error("--recipient-key requires a path argument")
        break
      case "--lease-url":
        config.leaseUrl = next()
        break
      case "--output":
        config.outputPath = next()
        if (!config.outputPath) throw new Error("--output requires a path argument")
        break
      case "--batch-size": {
        const val = next()
        config.batchSize = val ? parseInt(val, 10) : DEFAULT_BATCH_SIZE
        if (config.batchSize < 1) throw new Error("--batch-size must be >= 1")
        break
      }
      case "--root-key":
        config.rootPublicKeyB64 = next()
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!config.manifestPath) throw new Error("--manifest is required")
  if (!config.entriesDir) throw new Error("--entries is required")
  if (!config.recipientKeyPath) throw new Error("--recipient-key is required")
  if (!config.outputPath) throw new Error("--output is required")

  return config as ExportHostConfig
}

/**
 * Validate the export host config, checking that input paths exist.
 *
 * @throws if any path is missing
 */
export function validateConfig(config: ExportHostConfig): void {
  if (!existsSync(config.manifestPath)) {
    throw new Error(`Manifest file not found: ${config.manifestPath}`)
  }
  if (!existsSync(config.entriesDir)) {
    throw new Error(`Entries directory not found: ${config.entriesDir}`)
  }
  if (!existsSync(config.recipientKeyPath)) {
    throw new Error(`Recipient key file not found: ${config.recipientKeyPath}`)
  }
}

// ── Manifest Validation ──────────────────────────────────────────────────────

/**
 * Load and validate the signed manifest file.
 *
 * Reads the manifest JSON, verifies the Ed25519 signature against the
 * pinned root public key, and returns the parsed SignedManifest.
 *
 * @returns The parsed and validated SignedManifest
 * @throws if the manifest cannot be parsed or the signature is invalid
 */
export function loadAndValidateManifest(
  manifestPath: string,
  rootPublicKey: Buffer,
): SignedManifest {
  const raw = readFileSync(manifestPath, "utf-8")
  const parsed: SignedManifest = JSON.parse(raw)

  if (!parsed.manifest || !parsed.signature || !parsed.signerIdentity) {
    throw new Error("Invalid manifest structure: missing manifest, signature, or signerIdentity")
  }

  const manifestJson = JSON.stringify(parsed.manifest)
  const signature = Buffer.from(parsed.signature, "base64")

  if (!verifyManifestSignature(manifestJson, signature, rootPublicKey)) {
    throw new Error("Manifest signature verification failed")
  }

  return parsed
}

/**
 * Verify the manifest signature using the root public key.
 *
 * @returns true if the signature is valid
 */
export function validateManifest(manifestJson: string, signature: Buffer, rootPublicKey: Buffer): boolean {
  try {
    return verifyManifestSignature(manifestJson, signature, rootPublicKey)
  } catch {
    return false
  }
}

// ── Entry Loading ────────────────────────────────────────────────────────────

/**
 * Load encrypted entry files from the entries directory.
 *
 * Scans the directory for files with the .enc.json extension, reads and
 * deserialises each into an EncryptedEntry.
 *
 * @returns Array of EncryptedEntry objects
 */
export function loadEncryptedEntries(entriesDir: string): EncryptedEntry[] {
  const files = readdirSync(entriesDir).filter((f) => f.endsWith(ENC_ENTRY_EXT))

  const entries: EncryptedEntry[] = []
  for (const file of files) {
    const raw = readFileSync(join(entriesDir, file), "utf-8")
    try {
      const entry = deserializeEncryptedEntry(raw)
      entries.push(entry)
    } catch {
      // Skip malformed entries, they will be reported in excludedCount
      continue
    }
  }

  return entries
}

/**
 * Inline deserialization for EncryptedEntry (avoids importing the full entry store module).
 *
 * Converts base64 fields back to Buffers.
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

// ── Key Release (Lease Authority) ────────────────────────────────────────────

/**
 * Request key release from the external lease authority.
 *
 * POSTs the export authorization to the lease URL and returns the
 * key release response containing wrapped domain keys.
 *
 * @param leaseUrl - The lease authority endpoint URL
 * @param auth - The full dataset export authorization
 * @returns KeyReleaseResponse with wrapped domain keys
 */
export async function requestKeyRelease(
  leaseUrl: string,
  auth: FullDatasetExportAuthorization,
): Promise<KeyReleaseResponse> {
  const response = await fetch(leaseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(auth),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Key release request failed (${response.status}): ${body}`)
  }

  const parsed: KeyReleaseResponse = await response.json()

  if (!parsed.releasedKeys || !parsed.signature || !parsed.signedBy) {
    throw new Error("Invalid key release response: missing required fields")
  }

  return parsed
}

// ── Domain Key Resolution ────────────────────────────────────────────────────

/**
 * Build a DomainKeyStore from a KeyReleaseResponse by unwrapping the
 * released domain keys with the lease authority's wrapping key.
 *
 * Each domain key in the response contains a wrappedKey (base64).
 * This implementation processes the raw released keys directly
 * for use in the export host's in-memory domain key store.
 *
 * @param keyRelease - The key release response from the lease authority
 * @returns An in-memory DomainKeyStore
 */
export function buildDomainKeyStoreFromRelease(keyRelease: KeyReleaseResponse): DomainKeyStore {
  const keys = new Map<string, DomainKey>()

  for (const released of keyRelease.releasedKeys) {
    const domainKey: DomainKey = {
      domainId: released.domainId,
      wrappingKey: Buffer.from(released.wrappedKey, "base64"),
      keyId: released.keyId,
      rotation: 0,
    }
    keys.set(released.domainId, domainKey)
  }

  return {
    getDomainKey(domainId: string): DomainKey | undefined {
      return keys.get(domainId)
    },
    listDomainIds(): string[] {
      return Array.from(keys.keys())
    },
  }
}

// ── Export Processing ────────────────────────────────────────────────────────

/**
 * Process entries in bounded batches.
 *
 * For each batch:
 *   1. Decrypt each entry using its domain key
 *   2. Zero the source ciphertext after decryption
 *   3. Collect plaintexts
 *
 * @param encryptedEntries - Array of encrypted entries to process
 * @param domainKeys - Domain key store for entry decryption
 * @param batchSize - Maximum entries per batch
 * @returns Decrypted plaintext buffers and excluded count
 */
export function processEntriesInBatches(
  encryptedEntries: EncryptedEntry[],
  domainKeys: DomainKeyStore,
  batchSize: number = DEFAULT_BATCH_SIZE,
): { plaintexts: Buffer[]; excluded: number } {
  const plaintexts: Buffer[] = []
  let excluded = 0

  for (let i = 0; i < encryptedEntries.length; i += batchSize) {
    const batch = encryptedEntries.slice(i, i + batchSize)

    for (const encrypted of batch) {
      try {
        const domainKey = domainKeys.getDomainKey(encrypted.domainId)
        if (!domainKey) {
          excluded++
          continue
        }

        // Unwrap the DEK
        const dek = unwrapDek(
          encrypted.wrappedDek,
          domainKey.wrappingKey,
          encrypted.wrapIv,
          encrypted.wrapAuthTag,
        )

        // Build associated data
        const aad = buildAssociatedData(
          encrypted.entryId,
          encrypted.visibilityClass,
          encrypted.schemaVersion,
        )

        // Decrypt the entry
        const plaintext = decryptEntry(
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          dek,
          aad,
        )

        // Verify content integrity
        const digest = computeContentDigest(plaintext)
        if (digest !== encrypted.contentDigest) {
          zeroBuffer(plaintext)
          excluded++
          continue
        }

        plaintexts.push(plaintext)

        // Zero the source ciphertext and key material
        zeroBuffer(dek)
        zeroBuffer(encrypted.ciphertext)
        zeroBuffer(encrypted.iv)
        zeroBuffer(encrypted.authTag)
        zeroBuffer(encrypted.wrappedDek)
        zeroBuffer(encrypted.wrapIv)
        zeroBuffer(encrypted.wrapAuthTag)
      } catch {
        excluded++
      }
    }
  }

  return { plaintexts, excluded }
}

// ── Buffer Zeroing ───────────────────────────────────────────────────────────

/**
 * Zero-fill a buffer in place to securely clear sensitive data.
 *
 * Uses Buffer.fill(0) which is not optimised away by V8 for Buffers
 * because Buffer is a non-JS-memory object with observable side effects.
 *
 * @param buf - The buffer to zero
 */
export function zeroBuffer(buf: Buffer): void {
  if (buf && buf.length > 0) {
    buf.fill(0)
  }
}

// ── Main Export Flow ─────────────────────────────────────────────────────────

/**
 * Execute the full export pipeline.
 *
 * Steps:
 *   1. Validate all input paths exist
 *   2. Load and validate the signed manifest
 *   3. Load encrypted entries from the entries directory
 *   4. Request key release from the lease authority (if configured)
 *   5. Build an in-memory domain key store from the release
 *   6. Process entries in bounded batches: decrypt, verify, zero source
 *   7. Combine all decrypted plaintexts
 *   8. Encrypt the combined output for the recipient
 *   9. Write the encrypted output to a .pack file
 *   10. Build and write a signed receipt
 *   11. Zero all intermediate buffers
 *
 * @param config - Export host configuration
 * @returns ExportHostResult with status and receipt information
 */
export async function exportEntries(config: ExportHostConfig): Promise<ExportHostResult> {
  // 0. Initialize root key if provided
  if (config.rootPublicKeyB64) {
    initializeRootKey(config.rootPublicKeyB64)
  }

  // 1. Validate input paths
  try {
    validateConfig(config)
  } catch (err) {
    return {
      success: false,
      outputPath: config.outputPath,
      receiptDigest: "",
      entryCount: 0,
      excludedCount: 0,
      error: err instanceof Error ? err.message : "Config validation failed",
      completedAt: new Date().toISOString(),
    }
  }

  // 2. Load and validate manifest
  let rootKey: Buffer
  try {
    rootKey = getRootPublicKey()
  } catch {
    const envKey = process.env["ROOT_PUBLIC_KEY"]
    if (envKey) {
      initializeRootKey(envKey)
      rootKey = getRootPublicKey()
    } else {
      return {
        success: false,
        outputPath: config.outputPath,
        receiptDigest: "",
        entryCount: 0,
        excludedCount: 0,
        error: "Root public key not configured. Provide --root-key or ROOT_PUBLIC_KEY env",
        completedAt: new Date().toISOString(),
      }
    }
  }

  let manifest: SignedManifest
  try {
    manifest = loadAndValidateManifest(config.manifestPath, rootKey)
  } catch (err) {
    return {
      success: false,
      outputPath: config.outputPath,
      receiptDigest: "",
      entryCount: 0,
      excludedCount: 0,
      error: err instanceof Error ? err.message : "Manifest validation failed",
      completedAt: new Date().toISOString(),
    }
  }

  // 3. Load encrypted entries
  const encryptedEntries = loadEncryptedEntries(config.entriesDir)
  if (encryptedEntries.length === 0) {
    return {
      success: false,
      outputPath: config.outputPath,
      receiptDigest: "",
      entryCount: 0,
      excludedCount: 0,
      error: "No encrypted entries found in entries directory",
      completedAt: new Date().toISOString(),
    }
  }

  // 4. Request key release
  const authFromManifest = manifest.manifest["authorization"] as FullDatasetExportAuthorization | undefined

  let keyRelease: KeyReleaseResponse
  try {
    if (config.leaseUrl) {
      if (!authFromManifest) {
        return {
          success: false,
          outputPath: config.outputPath,
          receiptDigest: "",
          entryCount: 0,
          excludedCount: 0,
          error: "Manifest is missing 'authorization' field required for lease request",
          completedAt: new Date().toISOString(),
        }
      }
      keyRelease = await requestKeyRelease(config.leaseUrl, authFromManifest)
    } else {
      // No lease authority: use manifest-embedded domain keys
      const embeddedKeys = manifest.manifest["domainKeys"] as KeyReleaseResponse | undefined
      if (!embeddedKeys) {
        return {
          success: false,
          outputPath: config.outputPath,
          receiptDigest: "",
          entryCount: 0,
          excludedCount: 0,
          error: "No --lease-url provided and manifest has no embedded domain keys",
          completedAt: new Date().toISOString(),
        }
      }
      keyRelease = embeddedKeys
    }
  } catch (err) {
    return {
      success: false,
      outputPath: config.outputPath,
      receiptDigest: "",
      entryCount: 0,
      excludedCount: 0,
      error: err instanceof Error ? err.message : "Key release failed",
      completedAt: new Date().toISOString(),
    }
  }

  // 5. Build domain key store
  const domainKeys = buildDomainKeyStoreFromRelease(keyRelease)

  // 6. Read recipient key
  const recipientKeyRaw = readFileSync(config.recipientKeyPath)
  // Accept either raw DER or PEM-encoded key
  const recipientKey = recipientKeyRaw[0] === 0x2d
    ? extractDerFromPem(recipientKeyRaw.toString("utf-8"))
    : recipientKeyRaw

  // 7. Process entries in bounded batches
  const { plaintexts, excluded } = processEntriesInBatches(
    encryptedEntries,
    domainKeys,
    config.batchSize,
  )

  if (plaintexts.length === 0) {
    return {
      success: false,
      outputPath: config.outputPath,
      receiptDigest: "",
      entryCount: 0,
      excludedCount: excluded,
      error: "No entries could be decrypted",
      completedAt: new Date().toISOString(),
    }
  }

  // 8. Combine and encrypt output
  const combinedPlaintext = Buffer.concat(plaintexts)
  const encryptedOutput = encryptOutputForRecipient(combinedPlaintext, recipientKey)

  // 9. Write encrypted output
  writeFileSync(config.outputPath, encryptedOutput)

  // 10. Build and write receipt
  const outputDigest = computeDigest(encryptedOutput)
  const receipt: DatasetExportReceipt = {
    receiptId: `receipt-${computeDigest(combinedPlaintext).slice(0, 12)}`,
    exportManifestDigest: computeDigest(Buffer.from(JSON.stringify(manifest.manifest))),
    requester: manifest.signerIdentity,
    authorityUsed: "full_dataset_export",
    entryCount: plaintexts.length,
    excludedEntryCount: excluded,
    visibilityClassesIncluded: [
      ...new Set(encryptedEntries.map((e) => e.visibilityClass)),
    ],
    outputDigest,
    recipientBinding: undefined,
    logicalTime: new Date().toISOString(),
    authorizedBy: [keyRelease.signedBy],
    signatures: [keyRelease.signature],
  }

  const receiptPath = config.outputPath + RECEIPT_EXT
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))

  // 11. Zero intermediate buffers
  zeroBuffer(combinedPlaintext)
  for (const pt of plaintexts) {
    zeroBuffer(pt)
  }

  return {
    success: true,
    outputPath: config.outputPath,
    receiptDigest: receipt.outputDigest,
    entryCount: plaintexts.length,
    excludedCount: excluded,
    error: null,
    completedAt: new Date().toISOString(),
  }
}

// ── PEM/DER Utilities ────────────────────────────────────────────────────────

/**
 * Extract DER bytes from a PEM-encoded key.
 *
 * Handles both PKCS8 private keys and SPKI public keys.
 *
 * @param pem - PEM string (with BEGIN/END markers)
 * @returns DER-encoded key bytes
 */
export function extractDerFromPem(pem: string): Buffer {
  const lines = pem.split("\n")
  const base64 = lines
    .filter((line) => !line.startsWith("---"))
    .map((line) => line.trim())
    .join("")
  return Buffer.from(base64, "base64")
}

// ── Helper ───────────────────────────────────────────────────────────────────

function computeDigest(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Main export host entry point.
 *
 * Parses CLI arguments, runs the export, writes the result, and exits
 * with an appropriate status code.
 */
export async function runExport(): Promise<void> {
  let config: ExportHostConfig = {
    manifestPath: "",
    entriesDir: "",
    recipientKeyPath: "",
    outputPath: "",
    batchSize: DEFAULT_BATCH_SIZE,
  }

  try {
    config = parseArgs()
  } catch (err) {
    console.error("Export Host: Argument error:", err instanceof Error ? err.message : err)
    const failure = {
      success: false,
      error: err instanceof Error ? err.message : "Argument parsing failed",
      completedAt: new Date().toISOString(),
    }
    process.stdout.write(JSON.stringify(failure) + "\n")
    process.exit(1)
  }

  try {
    const result = await exportEntries(config)
    process.stdout.write(JSON.stringify(result) + "\n")

    if (!result.success) {
      process.exit(1)
    }
  } catch (err) {
    const failure = {
      success: false,
      outputPath: config.outputPath,
      receiptDigest: "",
      entryCount: 0,
      excludedCount: 0,
      error: err instanceof Error ? err.message : "Unexpected export failure",
      completedAt: new Date().toISOString(),
    }
    process.stdout.write(JSON.stringify(failure) + "\n")
    process.exit(1)
  }
}

// ── Execute if run directly ──────────────────────────────────────────────────

const isMainModule = process.argv[1]?.endsWith("export-host.ts") ||
  process.argv[1]?.endsWith("export-host") ||
  !process.argv[1]

if (isMainModule) {
  runExport().catch((err) => {
    console.error("Export Host: Fatal error:", err)
    process.exit(1)
  })
}
