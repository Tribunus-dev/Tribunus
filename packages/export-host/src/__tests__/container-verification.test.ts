/**
 * Container Verification Tests
 *
 * Phase 3 — Hardened Export Environment
 */

import { describe, test, expect } from "bun:test"
import { randomBytes, createHash } from "node:crypto"
import { generateKeyPair } from "@tribunus/runtime/tribunus/dharma/crypto"
import {
  verifyContainerImage,
  signContainerImage,
  verifyContainerSignature,
  computeImageDigest,
} from "../container-verification"
import type { ContainerSignature } from "../container-verification"

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a valid-looking SHA-256 hex digest */
function fakeDigest(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex")
}

describe("verifyContainerImage", () => {
  test("returns true for identical digests", () => {
    const digest = fakeDigest()
    expect(verifyContainerImage(digest, digest)).toBe(true)
  })

  test("returns true for case-insensitive matching (lowercase vs uppercase)", () => {
    const digest = fakeDigest()
    expect(verifyContainerImage(digest, digest.toUpperCase())).toBe(true)
  })

  test("returns false for different digests", () => {
    const a = fakeDigest()
    const b = fakeDigest()
    // Collision is astronomically unlikely with SHA-256
    if (a !== b) {
      expect(verifyContainerImage(a, b)).toBe(false)
    }
  })

  test("returns false for non-string inputs", () => {
    expect(verifyContainerImage(null as unknown as string, fakeDigest())).toBe(false)
    expect(verifyContainerImage(fakeDigest(), null as unknown as string)).toBe(false)
    expect(verifyContainerImage(undefined as unknown as string, fakeDigest())).toBe(false)
  })

  test("returns false for wrong-length digests", () => {
    expect(verifyContainerImage("abc", "abc")).toBe(false)
    expect(verifyContainerImage(fakeDigest(), "too-short")).toBe(false)
  })
})

describe("signContainerImage / verifyContainerSignature", () => {
  test("signs and verifies a valid digest round-trip", () => {
    const keyPair = generateKeyPair()
    const digest = fakeDigest()

    const sig = signContainerImage(digest, keyPair.privateKey)

    expect(sig.imageDigest).toBe(digest)
    expect(sig.signature).toHaveLength(128) // 64 bytes = 128 hex chars
    expect(sig.signerPublicKey).toBeTruthy()
    expect(sig.signedAt).toBeTruthy()
    expect(() => new Date(sig.signedAt).toISOString()).not.toThrow()

    const publicKeyDer = Buffer.from(keyPair.publicKey)
    const valid = verifyContainerSignature(sig, digest, publicKeyDer)
    expect(valid).toBe(true)
  })

  test("rejects signature for mismatched digest", () => {
    const keyPair = generateKeyPair()
    const originalDigest = fakeDigest()
    const wrongDigest = fakeDigest()

    // Ensure they're different
    if (originalDigest === wrongDigest) {
      return // Collision — skip (astronomically unlikely)
    }

    const sig = signContainerImage(originalDigest, keyPair.privateKey)
    const publicKeyDer = Buffer.from(keyPair.publicKey)

    expect(verifyContainerSignature(sig, wrongDigest, publicKeyDer)).toBe(false)
  })

  test("rejects signature with wrong public key", () => {
    const signerKeys = generateKeyPair()
    const wrongKeys = generateKeyPair()
    const digest = fakeDigest()

    const sig = signContainerImage(digest, signerKeys.privateKey)
    const wrongPublicKeyDer = Buffer.from(wrongKeys.publicKey)

    expect(verifyContainerSignature(sig, digest, wrongPublicKeyDer)).toBe(false)
  })

  test("rejects null/undefined signature", () => {
    const keyPair = generateKeyPair()
    const digest = fakeDigest()
    const publicKeyDer = Buffer.from(keyPair.publicKey)

    expect(verifyContainerSignature(null as unknown as ContainerSignature, digest, publicKeyDer)).toBe(false)
    expect(verifyContainerSignature(undefined as unknown as ContainerSignature, digest, publicKeyDer)).toBe(false)
  })

  test("rejects signature with malformed hex", () => {
    const keyPair = generateKeyPair()
    const digest = fakeDigest()
    const publicKeyDer = Buffer.from(keyPair.publicKey)

    const sig = signContainerImage(digest, keyPair.privateKey)
    sig.signature = "not-hex"
    expect(verifyContainerSignature(sig, digest, publicKeyDer)).toBe(false)
  })

  test("rejects signature with wrong length", () => {
    const keyPair = generateKeyPair()
    const digest = fakeDigest()
    const publicKeyDer = Buffer.from(keyPair.publicKey)

    const sig = signContainerImage(digest, keyPair.privateKey)
    sig.signature = "a".repeat(100) // wrong length
    expect(verifyContainerSignature(sig, digest, publicKeyDer)).toBe(false)
  })

  test("rejects signature with invalid signedAt date", () => {
    const keyPair = generateKeyPair()
    const digest = fakeDigest()
    const publicKeyDer = Buffer.from(keyPair.publicKey)

    const sig = signContainerImage(digest, keyPair.privateKey)
    sig.signedAt = "not-a-date"
    expect(verifyContainerSignature(sig, digest, publicKeyDer)).toBe(false)
  })
})

describe("signContainerImage validation", () => {
  test("throws on invalid digest length", () => {
    const keyPair = generateKeyPair()
    expect(() => signContainerImage("short", keyPair.privateKey)).toThrow()
    expect(() => signContainerImage("", keyPair.privateKey)).toThrow()
  })

  test("throws on empty private key", () => {
    const digest = fakeDigest()
    expect(() => signContainerImage(digest, new Uint8Array(0))).toThrow()
  })
})

describe("computeImageDigest", () => {
  test("returns consistent SHA-256 hex for same data", () => {
    const data = Buffer.from("hello container")
    const d1 = computeImageDigest(data)
    const d2 = computeImageDigest(data)
    expect(d1).toBe(d2)
    expect(d1).toHaveLength(64)
  })

  test("returns different digests for different data", () => {
    const a = computeImageDigest(Buffer.from("data-a"))
    const b = computeImageDigest(Buffer.from("data-b"))
    expect(a).not.toBe(b)
  })
})
