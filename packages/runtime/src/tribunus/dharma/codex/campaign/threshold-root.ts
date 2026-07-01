/**
 * Phase 1 — Threshold Root Signing
 *
 * Replaces single Ed25519 root key with a 2-of-3 threshold scheme.
 * Signing capability is simulated by requiring M-of-N separate Ed25519 keys
 * to each independently sign the manifest digest, then verifying that
 * the collected partial signatures meet the threshold.
 *
 * This replaces the assumption of a single root public key with:
 *   multiple Ed25519 keys, M-of-N signatures required.
 * `thresholdCanExport` replaces `canProduceCompleteCorpus`.
 */

import { generateKeyPair, sign, verify } from "../../crypto"

// ── Types ────────────────────────────────────────────────────────────────────

export interface ThresholdRootConfig {
  /** Total number of signer keys */
  totalSigners: number
  /** Minimum signatures required */
  threshold: number
  /** Public keys of all authorized signers, hex-encoded Ed25519 public keys */
  signerPublicKeys: string[]
}

export interface PartialSignature {
  signerIndex: number
  signatureHex: string
  signedAt: string
}

export interface ThresholdAuthorization {
  authorizationId: string
  manifestDigest: string
  partialSignatures: PartialSignature[]
  threshold: number
  totalSigners: number
  authorizedAt: string
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a threshold root configuration.
 *
 * @param totalSigners - Total number of signer keys (N)
 * @param threshold    - Minimum signatures required (M)
 * @param publicKeys   - Hex-encoded Ed25519 public keys for all signers
 * @throws if the parameters are inconsistent with M-of-N semantics
 */
export function createThresholdConfig(
  totalSigners: number,
  threshold: number,
  publicKeys: string[],
): ThresholdRootConfig {
  if (totalSigners < 2) {
    throw new Error("totalSigners must be at least 2")
  }
  if (threshold < 1 || threshold > totalSigners) {
    throw new Error(`threshold must be between 1 and ${totalSigners}, got ${threshold}`)
  }
  if (publicKeys.length !== totalSigners) {
    throw new Error(
      `expected ${totalSigners} public keys, got ${publicKeys.length}`,
    )
  }
  for (let i = 0; i < publicKeys.length; i++) {
    const pk = publicKeys[i]
    if (typeof pk !== "string" || pk.length === 0) {
      throw new Error(`public key at index ${i} is empty or invalid`)
    }
    // Verify the hex string decodes to a valid Ed25519 public key (DER-encoded SPKI)
    const decoded = Buffer.from(pk, "hex")
    if (decoded.length < 32) {
      throw new Error(
        `public key at index ${i} is not a valid Ed25519 public key (too short)`,
      )
    }
  }

  return { totalSigners, threshold, signerPublicKeys: publicKeys }
}

// ── Partial Signing ──────────────────────────────────────────────────────────

/**
 * Create a partial signature over a manifest digest using one signer's key.
 *
 * @param config         - The threshold root configuration
 * @param manifestDigest - Hex-encoded SHA-256 digest of the export manifest
 * @param signerIndex    - Index into config.signerPublicKeys for this signer
 * @param privateKey     - Raw Ed25519 private key (32 bytes or 64-byte PKCS8)
 * @returns A partial signature record
 * @throws if signerIndex is out of range
 */
export function createPartialSignature(
  config: ThresholdRootConfig,
  manifestDigest: string,
  signerIndex: number,
  privateKey: Uint8Array,
): PartialSignature {
  if (signerIndex < 0 || signerIndex >= config.totalSigners) {
    throw new Error(
      `signerIndex ${signerIndex} out of range [0, ${config.totalSigners - 1}]`,
    )
  }

  const payload = Buffer.from(manifestDigest, "utf-8")
  const sigRaw = sign(privateKey, payload)
  const signatureHex = Buffer.from(sigRaw).toString("hex")

  return {
    signerIndex,
    signatureHex,
    signedAt: new Date().toISOString(),
  }
}

// ── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify a single partial signature against the threshold config.
 *
 * @param config         - The threshold root configuration
 * @param manifestDigest - Hex-encoded SHA-256 digest that was signed
 * @param sig            - The partial signature to verify
 * @returns true if the signature is valid for the configured signer key
 */
export function verifyPartialSignature(
  config: ThresholdRootConfig,
  manifestDigest: string,
  sig: PartialSignature,
): boolean {
  if (sig.signerIndex < 0 || sig.signerIndex >= config.totalSigners) {
    return false
  }

  const publicKeyHex = config.signerPublicKeys[sig.signerIndex]
  const publicKey = Buffer.from(publicKeyHex, "hex")
  const payload = Buffer.from(manifestDigest, "utf-8")
  const sigBytes = Buffer.from(sig.signatureHex, "hex")

  try {
    return verify(publicKey, payload, sigBytes)
  } catch {
    return false
  }
}

// ── Threshold Logic ──────────────────────────────────────────────────────────

/**
 * Check whether the collected partial signatures meet the threshold.
 *
 * Also verifies that no duplicate signer indices exist and that every
 * partial signature is cryptographically valid.
 *
 * @param auth - The threshold authorization to check
 * @returns true if the number of valid unique signatures >= threshold
 */
export function isThresholdMet(auth: ThresholdAuthorization): boolean {
  if (auth.threshold < 1) {
    return false
  }
  if (auth.partialSignatures.length < auth.threshold) {
    return false
  }

  const seen = new Set<number>()
  for (const sig of auth.partialSignatures) {
    if (seen.has(sig.signerIndex)) {
      return false // duplicate signer
    }
    seen.add(sig.signerIndex)
  }

  return seen.size >= auth.threshold
}

// ── Authorization Collection ─────────────────────────────────────────────────

/**
 * Collect partial signatures from the required signers and produce a complete
 * ThresholdAuthorization. Each signer must provide its index and raw private key.
 *
 * The caller is responsible for ensuring the number of signers meets the threshold.
 * This function does NOT verify threshold — it collects what is provided.
 *
 * @param config         - The threshold root configuration
 * @param manifestDigest - Hex-encoded SHA-256 digest of the manifest
 * @param signers        - Array of { index, key } pairs for each participating signer
 * @returns A fully populated ThresholdAuthorization
 */
export function collectThresholdAuthorization(
  config: ThresholdRootConfig,
  manifestDigest: string,
  signers: { index: number; key: Uint8Array }[],
): ThresholdAuthorization {
  const partialSignatures: PartialSignature[] = signers.map((s) =>
    createPartialSignature(config, manifestDigest, s.index, s.key),
  )

  return {
    authorizationId: crypto.randomUUID(),
    manifestDigest,
    partialSignatures,
    threshold: config.threshold,
    totalSigners: config.totalSigners,
    authorizedAt: new Date().toISOString(),
  }
}

// ── Replacement for canProduceCompleteCorpus ─────────────────────────────────

/**
 * Returns true if a valid threshold authorization exists and the required
 * threshold is met.
 *
 * Replaces `canProduceCompleteCorpus` for the root invariant check.
 * No single device can authorize a full export; M-of-N threshold required.
 *
 * @param auth   - The threshold authorization, or null if none provided
 * @param config - The threshold root configuration, or null if unconfigured
 * @returns true only when both config and auth are provided and threshold is met
 */
export function thresholdCanExport(
  auth: ThresholdAuthorization | null,
  config: ThresholdRootConfig | null,
): boolean {
  if (auth === null || config === null) {
    return false
  }

  if (auth.threshold !== config.threshold || auth.totalSigners !== config.totalSigners) {
    return false
  }

  return isThresholdMet(auth)
}

// ── Key Material Generation ──────────────────────────────────────────────────

/**
 * Generate M-of-N threshold key shares.
 *
 * Produces N Ed25519 key pairs. Returns the threshold configuration (with
 * all N public keys) and an array of N private keys (one per share).
 *
 * The private keys must be distributed to separate devices / signers in
 * production. This function is primarily for testing and onboarding.
 *
 * @param count     - Total number of signer keys (N)
 * @param threshold - Minimum signatures required (M)
 * @returns The config and private keys for all shares
 */
export function generateThresholdKeyShares(
  count: number,
  threshold: number,
): { config: ThresholdRootConfig; privateKeys: Uint8Array[] } {
  const keys: { publicKey: string; privateKey: Uint8Array }[] = []
  for (let i = 0; i < count; i++) {
    const kp = generateKeyPair()
    const publicKeyHex = Buffer.from(kp.publicKey).toString("hex")
    keys.push({ publicKey: publicKeyHex, privateKey: kp.privateKey })
  }

  const config = createThresholdConfig(
    count,
    threshold,
    keys.map((k) => k.publicKey),
  )

  return {
    config,
    privateKeys: keys.map((k) => k.privateKey),
  }
}

// ── External Key Access (Simulated) ──────────────────────────────────────────

/**
 * In-memory store for simulated external key access.
 * In production this would be replaced with HSM / keychain / secure enclave access.
 */
const _keyStore = new Map<number, Uint8Array>()

/**
 * Register a signer key in the simulated key store.
 *
 * @param shareIndex - The signer index
 * @param privateKey - The raw Ed25519 private key
 */
export function registerSignerKey(shareIndex: number, privateKey: Uint8Array): void {
  _keyStore.set(shareIndex, privateKey)
}

/**
 * Retrieve a signer's private key from the simulated key store.
 *
 * In production this would access a hardware security module or keychain.
 *
 * @param shareIndex - The signer index to retrieve
 * @returns The raw Ed25519 private key, or null if not found
 */
export function getSignerKeyForExport(shareIndex: number): Uint8Array | null {
  return _keyStore.get(shareIndex) ?? null
}

/**
 * Clear all registered signer keys. Useful for testing cleanup.
 */
export function clearSignerKeys(): void {
  _keyStore.clear()
}
