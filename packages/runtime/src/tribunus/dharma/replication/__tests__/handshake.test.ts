/**
 * Dharma Replication — Handshake Tests
 */

import { describe, test, expect } from "bun:test"
import { generateKeyPairSync, randomBytes } from "node:crypto"

import {
  createHello,
  respondToHello,
  verifyWelcome,
  createHandshakeResult,
  isProtocolCompatible,
  isFederationAccepted,
} from "../handshake"
import type { HandshakeConfig } from "../handshake"
import { DHARMA_REPLICATION_PROTOCOL_VERSION } from "../protocol"
import { HandshakeError } from "../errors"

// ── Helpers -------------------------------------------------------------------

interface TestKeys {
  seed: Uint8Array
  devicePublicKey: string
}

function generateTestKeys(): TestKeys {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")

  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" })
  const seed = pkcs8.subarray(-32)

  const spki = publicKey.export({ format: "der", type: "spki" })
  const rawPub = spki.subarray(-32)
  const devicePublicKey = Buffer.from(rawPub).toString("hex")

  return { seed, devicePublicKey }
}

function makeConfig(overrides?: Partial<HandshakeConfig>): HandshakeConfig {
  const keys = generateTestKeys()
  return {
    nodeInstanceId: "test-node-001",
    supportedSchemaVersions: [1],
    devicePublicKey: keys.devicePublicKey,
    signingKey: keys.seed,
    ...overrides,
  }
}

// ── Tests ---------------------------------------------------------------------

describe("createHello", () => {
  test("produces a valid message with all fields", () => {
    const config = makeConfig()
    const hello = createHello(config, ["fed-1", "fed-2"], "identity-pub-123")

    expect(hello.protocolVersion).toBe(DHARMA_REPLICATION_PROTOCOL_VERSION)
    expect(hello.nodeInstanceId).toBe("test-node-001")
    expect(hello.supportedSchemaVersions).toEqual([1])
    expect(hello.supportedFederations).toEqual(["fed-1", "fed-2"])
    expect(hello.identityPublicKey).toBe("identity-pub-123")
    expect(hello.devicePublicKey).toBe(config.devicePublicKey)
    expect(hello.timestamp).toBeTruthy()
    expect(hello.nonce).toBeTruthy()
    expect(hello.nonce.length).toBe(8)
    expect(hello.signature).toBeTruthy()
    expect(hello.signature.length).toBe(64)
  })

  test("includes a nonce (8 bytes)", () => {
    const config = makeConfig()
    const hello = createHello(config, [], null)

    expect(hello.nonce).toBeTruthy()
    expect(hello.nonce.byteLength).toBe(8)
  })

  test("supports null identity public key", () => {
    const config = makeConfig()
    const hello = createHello(config, [], null)

    expect(hello.identityPublicKey).toBeNull()
  })
})

describe("respondToHello", () => {
  test("produces a welcome for compatible protocol", async () => {
    const serverConfig = makeConfig()
    const clientConfig = makeConfig()

    const hello = createHello(clientConfig, ["fed-1"], null)
    const welcome = await respondToHello(hello, serverConfig, ["fed-1", "fed-2"])

    expect(welcome.protocolVersion).toBe(DHARMA_REPLICATION_PROTOCOL_VERSION)
    expect(welcome.acceptedFederations).toEqual(["fed-1"])
    expect(welcome.rejectedFederations).toEqual(["fed-2"])
    expect(welcome.maxEventsPerMinute).toBeGreaterThan(0)
    expect(welcome.maxEventBlockBytes).toBeGreaterThan(0)
    expect(welcome.serverTime).toBeTruthy()
    expect(welcome.nonceEcho).toBeTruthy()
    expect(welcome.nonceEcho.byteLength).toBe(8)
    expect(welcome.nonce).toBeTruthy()
    expect(welcome.nonce.byteLength).toBe(8)
    expect(welcome.signature).toBeTruthy()
    expect(welcome.signature.byteLength).toBe(64)

    // nonceEcho must match the original hello's nonce
    expect(welcome.nonceEcho).toEqual(hello.nonce)
  })

  test("rejects incompatible protocol version", async () => {
    const serverConfig = makeConfig()
    const clientConfig = makeConfig()

    const hello = createHello(clientConfig, ["fed-1"], null)
    // Mutate the protocol version to an unsupported one
    const badHello = { ...hello, protocolVersion: 99 }

    await expect(
      respondToHello(badHello, serverConfig, ["fed-1"]),
    ).rejects.toThrow(HandshakeError)
  })

  test("rejects invalid hello signature", async () => {
    const serverConfig = makeConfig()
    const clientConfig = makeConfig()

    const hello = createHello(clientConfig, ["fed-1"], null)
    // Tamper with the signature
    const tampered = { ...hello, signature: randomBytes(64) }

    await expect(
      respondToHello(tampered, serverConfig, ["fed-1"]),
    ).rejects.toThrow(HandshakeError)
  })

  test("rejects all federations when none match", async () => {
    const serverConfig = makeConfig()
    const clientConfig = makeConfig()

    const hello = createHello(clientConfig, ["fed-alpha"], null)
    const welcome = await respondToHello(hello, serverConfig, ["fed-beta"])

    expect(welcome.acceptedFederations).toEqual([])
    expect(welcome.rejectedFederations).toEqual(["fed-beta"])
  })
})

describe("verifyWelcome", () => {
  test("passes with matching nonces and valid signature", async () => {
    const serverConfig = makeConfig()
    const clientConfig = makeConfig()

    const hello = createHello(clientConfig, ["fed-1"], null)
    const welcome = await respondToHello(hello, serverConfig, ["fed-1"])

    const result = verifyWelcome(welcome, hello.nonce, serverConfig.devicePublicKey)
    expect(result).toBe(true)
  })

  test("fails with wrong nonce", async () => {
    const serverConfig = makeConfig()
    const clientConfig = makeConfig()

    const hello = createHello(clientConfig, ["fed-1"], null)
    const welcome = await respondToHello(hello, serverConfig, ["fed-1"])

    const wrongNonce = randomBytes(8)
    const result = verifyWelcome(welcome, wrongNonce, serverConfig.devicePublicKey)
    expect(result).toBe(false)
  })

  test("fails with wrong public key", async () => {
    const serverConfig = makeConfig()
    const clientConfig = makeConfig()
    const imposterConfig = makeConfig()

    const hello = createHello(clientConfig, ["fed-1"], null)
    const welcome = await respondToHello(hello, serverConfig, ["fed-1"])

    const result = verifyWelcome(welcome, hello.nonce, imposterConfig.devicePublicKey)
    expect(result).toBe(false)
  })

  test("fails with tampered signature", async () => {
    const serverConfig = makeConfig()
    const clientConfig = makeConfig()

    const hello = createHello(clientConfig, ["fed-1"], null)
    const welcome = await respondToHello(hello, serverConfig, ["fed-1"])
    const tampered = { ...welcome, signature: randomBytes(64) }

    const result = verifyWelcome(tampered, hello.nonce, serverConfig.devicePublicKey)
    expect(result).toBe(false)
  })
})

describe("createHandshakeResult", () => {
  test("returns accepted result for accepted federations", async () => {
    const serverConfig = makeConfig()
    const clientConfig = makeConfig()

    const hello = createHello(clientConfig, ["fed-1"], null)
    const welcome = await respondToHello(hello, serverConfig, ["fed-1"])
    const result = createHandshakeResult(welcome)

    expect(result.accepted).toBe(true)
    expect(result.acceptedFederations).toEqual(["fed-1"])
    expect(result.limits).toBeTruthy()
    expect(result.limits.maxEventsPerMinute).toBeGreaterThan(0)
    expect(result.limits.maxEventBlockBytes).toBeGreaterThan(0)
    expect(result.peerId).toBeTruthy()
    expect(result.serverTime).toBe(welcome.serverTime)
  })

  test("returns rejected result for no accepted federations", async () => {
    const serverConfig = makeConfig()
    const clientConfig = makeConfig()

    const hello = createHello(clientConfig, ["fed-alpha"], null)
    const welcome = await respondToHello(hello, serverConfig, ["fed-beta"])
    const result = createHandshakeResult(welcome)

    expect(result.accepted).toBe(false)
    expect(result.acceptedFederations).toEqual([])
  })
})

describe("isProtocolCompatible", () => {
  test("returns true for version 1", () => {
    expect(isProtocolCompatible(1)).toBe(true)
  })

  test("returns false for version 99", () => {
    expect(isProtocolCompatible(99)).toBe(false)
  })
})

describe("isFederationAccepted", () => {
  test("returns true for matching federation", () => {
    expect(isFederationAccepted("fed-1", ["fed-1", "fed-2"])).toBe(true)
  })

  test("returns false for non-matching federation", () => {
    expect(isFederationAccepted("fed-3", ["fed-1", "fed-2"])).toBe(false)
  })
})
