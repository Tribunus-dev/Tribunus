/**
 * Tests for Phase 1 — Threshold Root Signing
 *
 * Verifies that no single device can authorize a full export;
 * 2-of-3 threshold is required.
 */

import { describe, test, expect, beforeEach } from "bun:test"

import {
  createThresholdConfig,
  createPartialSignature,
  verifyPartialSignature,
  isThresholdMet,
  collectThresholdAuthorization,
  thresholdCanExport,
  generateThresholdKeyShares,
  getSignerKeyForExport,
  registerSignerKey,
  clearSignerKeys,
  type ThresholdRootConfig,
  type ThresholdAuthorization,
} from "../threshold-root"
import { generateKeyPair } from "../../../crypto"

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_MANIFEST_DIGEST =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

let _shares: { config: ThresholdRootConfig; privateKeys: Uint8Array[] }

beforeEach(() => {
  clearSignerKeys()
  _shares = generateThresholdKeyShares(3, 2)
})

function makeTestPublicKey(): string {
  return Buffer.from(generateKeyPair().publicKey).toString("hex")
}

function makeAuth(overrides?: Partial<ThresholdAuthorization>): ThresholdAuthorization {
  const sigs = _shares.privateKeys.slice(0, 2).map((key, i) =>
    createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, i, key),
  )
  return {
    authorizationId: crypto.randomUUID(),
    manifestDigest: TEST_MANIFEST_DIGEST,
    partialSignatures: sigs,
    threshold: _shares.config.threshold,
    totalSigners: _shares.config.totalSigners,
    authorizedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe("Threshold Root Signing", () => {
  describe("createThresholdConfig", () => {
    const key1 = makeTestPublicKey()
    const key2 = makeTestPublicKey()
    const key3 = makeTestPublicKey()

    test("validates minimum totalSigners", () => {
      expect(() => createThresholdConfig(1, 1, [key1])).toThrow(
        "totalSigners must be at least 2",
      )
    })

    test("validates threshold upper bound", () => {
      const keys = [key1, key2]
      expect(() => createThresholdConfig(2, 3, keys)).toThrow(
        "threshold must be between 1 and 2",
      )
    })

    test("validates threshold lower bound", () => {
      const keys = [key1, key2]
      expect(() => createThresholdConfig(2, 0, keys)).toThrow(
        "threshold must be between 1 and 2",
      )
    })

    test("validates public keys count matches totalSigners", () => {
      const keys = [key1]
      expect(() => createThresholdConfig(2, 1, keys)).toThrow(
        "expected 2 public keys, got 1",
      )
    })

    test("validates each public key is a 32-byte hex string", () => {
      const keys = [key1, "short"]
      expect(() => createThresholdConfig(2, 1, keys)).toThrow(
        "not a valid Ed25519 public key (too short)",
      )
    })

    test("validates public keys are not empty", () => {
      const keys = [key1, ""]
      expect(() => createThresholdConfig(2, 1, keys)).toThrow(
        "public key at index 1 is empty or invalid",
      )
    })

    test("creates valid config with 3 signers, threshold 2", () => {
      const keys = [key1, key2, key3]
      const config = createThresholdConfig(3, 2, keys)
      expect(config.totalSigners).toBe(3)
      expect(config.threshold).toBe(2)
      expect(config.signerPublicKeys).toEqual(keys)
    })
  })

  describe("createPartialSignature", () => {
    test("produces a valid partial signature", () => {
      const sig = createPartialSignature(
        _shares.config,
        TEST_MANIFEST_DIGEST,
        0,
        _shares.privateKeys[0],
      )

      expect(sig.signerIndex).toBe(0)
      expect(sig.signatureHex).toMatch(/^[0-9a-f]{128}$/i)
      expect(sig.signedAt).toBeTruthy()
    })

    test("throws for out-of-range signerIndex", () => {
      expect(() =>
        createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 99, _shares.privateKeys[0]),
      ).toThrow("signerIndex 99 out of range")
    })

    test("different signers produce different signatures", () => {
      const sig0 = createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 0, _shares.privateKeys[0])
      const sig1 = createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 1, _shares.privateKeys[1])
      expect(sig0.signatureHex).not.toBe(sig1.signatureHex)
    })

    test("different manifests produce different signatures", () => {
      const sigA = createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 0, _shares.privateKeys[0])
      const sigB = createPartialSignature(_shares.config, "different-digest", 0, _shares.privateKeys[0])
      expect(sigA.signatureHex).not.toBe(sigB.signatureHex)
    })
  })

  describe("verifyPartialSignature", () => {
    test("returns true for valid signature", () => {
      const sig = createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 0, _shares.privateKeys[0])
      expect(verifyPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, sig)).toBe(true)
    })

    test("returns false for tampered signature hex", () => {
      const sig = createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 0, _shares.privateKeys[0])
      sig.signatureHex = "00" + sig.signatureHex.slice(2)
      expect(verifyPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, sig)).toBe(false)
    })

    test("returns false for out-of-range signerIndex", () => {
      const sig = createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 0, _shares.privateKeys[0])
      sig.signerIndex = 99
      expect(verifyPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, sig)).toBe(false)
    })

    test("returns false when verified against wrong manifest digest", () => {
      const sig = createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 0, _shares.privateKeys[0])
      expect(verifyPartialSignature(_shares.config, "wrong-digest", sig)).toBe(false)
    })

    test("returns false when signature was created by a different key", () => {
      // Sign with a completely unrelated key not in the config's public keys
      const unrelatedKp = generateKeyPair()
      const sig = createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 0, unrelatedKp.privateKey)
      // The public key at index 0 doesn't match the signing key, so verify fails
      expect(verifyPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, sig)).toBe(false)
    })
  })

  describe("isThresholdMet", () => {
    test("returns true with 2 of 3 signatures", () => {
      const auth = makeAuth()
      expect(isThresholdMet(auth)).toBe(true)
    })

    test("returns false with 1 of 3 signatures", () => {
      const sig0 = createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 0, _shares.privateKeys[0])
      const auth = makeAuth({
        partialSignatures: [sig0],
        threshold: 2,
      })
      expect(isThresholdMet(auth)).toBe(false)
    })

    test("returns false with duplicate signer indices", () => {
      const sig0 = createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 0, _shares.privateKeys[0])
      const sig0dup = createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 0, _shares.privateKeys[0])
      const auth = makeAuth({
        partialSignatures: [sig0, sig0dup],
        threshold: 2,
      })
      expect(isThresholdMet(auth)).toBe(false)
    })

    test("returns false when threshold is 0 (treated as unmet)", () => {
      const auth = makeAuth({ threshold: 0, partialSignatures: [] })
      expect(isThresholdMet(auth)).toBe(false)
    })

    test("returns true when threshold equals totalSigners (3 of 3)", () => {
      // Generate a 3-of-3 config
      const shares = generateThresholdKeyShares(3, 3)
      const sigs = shares.privateKeys.map((key, i) =>
        createPartialSignature(shares.config, TEST_MANIFEST_DIGEST, i, key),
      )
      const auth = makeAuth({
        partialSignatures: sigs,
        threshold: 3,
        totalSigners: 3,
      })
      expect(isThresholdMet(auth)).toBe(true)
    })
  })

  describe("collectThresholdAuthorization", () => {
    test("produces a valid authorization with 2 of 3 signers", () => {
      const signers = [
        { index: 0, key: _shares.privateKeys[0] },
        { index: 1, key: _shares.privateKeys[1] },
      ]

      const auth = collectThresholdAuthorization(
        _shares.config,
        TEST_MANIFEST_DIGEST,
        signers,
      )

      expect(auth.authorizationId).toBeTruthy()
      expect(auth.manifestDigest).toBe(TEST_MANIFEST_DIGEST)
      expect(auth.partialSignatures).toHaveLength(2)
      expect(auth.threshold).toBe(2)
      expect(auth.totalSigners).toBe(3)

      // Each partial signature should verify
      for (const sig of auth.partialSignatures) {
        expect(
          verifyPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, sig),
        ).toBe(true)
      }

      // Threshold should be met
      expect(isThresholdMet(auth)).toBe(true)
    })

    test("allows full 3 of 3 collection", () => {
      const signers = _shares.privateKeys.map((key, i) => ({ index: i, key }))
      const auth = collectThresholdAuthorization(
        _shares.config,
        TEST_MANIFEST_DIGEST,
        signers,
      )
      expect(auth.partialSignatures).toHaveLength(3)
      expect(isThresholdMet(auth)).toBe(true)
    })
  })

  describe("thresholdCanExport", () => {
    test("returns true when valid auth and config are provided and threshold met", () => {
      const auth = makeAuth()
      expect(thresholdCanExport(auth, _shares.config)).toBe(true)
    })

    test("returns false when auth is null", () => {
      expect(thresholdCanExport(null, _shares.config)).toBe(false)
    })

    test("returns false when config is null", () => {
      const auth = makeAuth()
      expect(thresholdCanExport(auth, null)).toBe(false)
    })

    test("returns false when both are null", () => {
      expect(thresholdCanExport(null, null)).toBe(false)
    })

    test("returns false when threshold mismatch", () => {
      const auth = makeAuth({ threshold: 1 })
      expect(thresholdCanExport(auth, _shares.config)).toBe(false)
    })

    test("returns false when totalSigners mismatch", () => {
      const auth = makeAuth({ totalSigners: 2 })
      expect(thresholdCanExport(auth, _shares.config)).toBe(false)
    })

    test("returns false when threshold not met (1 of 3 signatures)", () => {
      const sig0 = createPartialSignature(_shares.config, TEST_MANIFEST_DIGEST, 0, _shares.privateKeys[0])
      const auth = makeAuth({ partialSignatures: [sig0], threshold: 2 })
      expect(thresholdCanExport(auth, _shares.config)).toBe(false)
    })
  })

  describe("generateThresholdKeyShares", () => {
    test("produces valid config and private keys for 3 signers, threshold 2", () => {
      const { config, privateKeys } = generateThresholdKeyShares(3, 2)

      expect(config.totalSigners).toBe(3)
      expect(config.threshold).toBe(2)
      expect(config.signerPublicKeys).toHaveLength(3)
      expect(privateKeys).toHaveLength(3)

      // Each private key should produce a valid signature
      for (let i = 0; i < 3; i++) {
        const sig = createPartialSignature(config, TEST_MANIFEST_DIGEST, i, privateKeys[i])
        expect(verifyPartialSignature(config, TEST_MANIFEST_DIGEST, sig)).toBe(true)
      }
    })
  })

  describe("getSignerKeyForExport / registerSignerKey", () => {
    test("returns null for unknown index", () => {
      expect(getSignerKeyForExport(0)).toBeNull()
    })

    test("returns registered key", () => {
      registerSignerKey(0, _shares.privateKeys[0])
      const retrieved = getSignerKeyForExport(0)
      expect(retrieved).toEqual(_shares.privateKeys[0])
    })

    test("clearSignerKeys empties the store", () => {
      registerSignerKey(0, _shares.privateKeys[0])
      clearSignerKeys()
      expect(getSignerKeyForExport(0)).toBeNull()
    })
  })
})
