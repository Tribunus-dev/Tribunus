/**
 * Tests for Dharma crypto primitives
 */

import { describe, it, expect } from "bun:test"
import {
  generateKeyPair,
  sign,
  verify,
  sha256,
  encryptPrivateKey,
  decryptPrivateKey,
} from "../crypto"

describe("generateKeyPair", () => {
  it("produces 32-byte public key and 64-byte private key (Ed25519 DER)", () => {
    const kp = generateKeyPair()
    // Ed25519 SPKI DER public key is 44 bytes at minimum; key material is 32 bytes
    expect(kp.publicKey).toBeInstanceOf(Uint8Array)
    expect(kp.publicKey.length).toBeGreaterThanOrEqual(32)

    // PKCS8 DER private key is ~80 bytes; Ed25519 seed is 32 bytes, expanded to 64
    expect(kp.privateKey).toBeInstanceOf(Uint8Array)
    expect(kp.privateKey.length).toBeGreaterThan(32)
  })

  it("generates unique key pairs each call", () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    expect(Buffer.from(a.publicKey).equals(Buffer.from(b.publicKey))).toBe(false)
    expect(Buffer.from(a.privateKey).equals(Buffer.from(b.privateKey))).toBe(false)
  })
})

describe("sign + verify", () => {
  it("roundtrip succeeds", () => {
    const kp = generateKeyPair()
    const data = new TextEncoder().encode("hello world")
    const sig = sign(kp.privateKey, data)
    expect(sig).toBeInstanceOf(Uint8Array)
    expect(sig.length).toBe(64)
    expect(verify(kp.publicKey, data, sig)).toBe(true)
  })

  it("signs empty data", () => {
    const kp = generateKeyPair()
    const data = new Uint8Array(0)
    const sig = sign(kp.privateKey, data)
    expect(sig.length).toBe(64)
    expect(verify(kp.publicKey, data, sig)).toBe(true)
  })

  it("rejects signature from wrong key", () => {
    const kp = generateKeyPair()
    const wrongKp = generateKeyPair()
    const data = new TextEncoder().encode("hello")
    const sig = sign(kp.privateKey, data)
    expect(verify(wrongKp.publicKey, data, sig)).toBe(false)
  })

  it("rejects corrupted signature", () => {
    const kp = generateKeyPair()
    const data = new TextEncoder().encode("hello")
    const sig = sign(kp.privateKey, data)
    sig[0] ^= 0xff
    expect(verify(kp.publicKey, data, sig)).toBe(false)
  })

  it("rejects corrupted data", () => {
    const kp = generateKeyPair()
    const data = new TextEncoder().encode("hello")
    const sig = sign(kp.privateKey, data)
    const corrupted = new TextEncoder().encode("HELLO")
    expect(verify(kp.publicKey, corrupted, sig)).toBe(false)
  })

  it("verify with invalid data does not throw", () => {
    const kp = generateKeyPair()
    const sig = new Uint8Array(64)
    expect(verify(kp.publicKey, new Uint8Array(0), sig)).toBe(false)
  })
})

describe("sha256", () => {
  it("produces correct hex", () => {
    const input = new TextEncoder().encode("hello")
    const result = sha256(input)
    expect(result).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    )
  })

  it("accepts string input", () => {
    const result = sha256("hello")
    expect(result).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    )
  })
})

describe("encryptPrivateKey + decryptPrivateKey", () => {
  it("encrypts and decrypts a private key", () => {
    const kp = generateKeyPair()
    const passphrase = "test-passphrase-42"
    const bundle = encryptPrivateKey(kp.privateKey, passphrase)

    expect(bundle.encrypted).toBeInstanceOf(Uint8Array)
    expect(bundle.iv.length).toBe(16)
    expect(bundle.salt.length).toBe(32)
    expect(bundle.authTag.length).toBe(16)

    const decrypted = decryptPrivateKey(bundle, passphrase)
    expect(Buffer.from(decrypted).equals(Buffer.from(kp.privateKey))).toBe(true)
  })

  it("decrypt with wrong passphrase throws", () => {
    const kp = generateKeyPair()
    const bundle = encryptPrivateKey(kp.privateKey, "correct-passphrase")
    expect(() => decryptPrivateKey(bundle, "wrong-passphrase")).toThrow()
  })

  it("roundtrip preserves ability to sign", () => {
    const kp = generateKeyPair()
    const passphrase = "sign-test"
    const bundle = encryptPrivateKey(kp.privateKey, passphrase)
    const restored = decryptPrivateKey(bundle, passphrase)

    const data = new TextEncoder().encode("test data")
    const sig = sign(restored, data)
    expect(verify(kp.publicKey, data, sig)).toBe(true)
  })
})
