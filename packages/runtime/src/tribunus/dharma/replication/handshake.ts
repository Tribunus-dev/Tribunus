/**
 * Dharma Replication — Peer Handshake
 *
 * Dharma-specific peer handshake protocol: peers exchange signed
 * Hello/Welcome messages to establish identity, federation membership,
 * and replication limits before beginning data sync.
 *
 * @module
 */

import { randomBytes, sign, verify, createPrivateKey, createPublicKey } from "node:crypto"
import type { KeyObject } from "node:crypto"
import { DHARMA_REPLICATION_PROTOCOL_VERSION, DEFAULT_REPLICATION_LIMITS } from "./protocol"
import type { DharmaPeerHello, DharmaPeerWelcome, PeerHandshakeResult, ReplicationLimits } from "./protocol"
import { HandshakeError } from "./errors"
import { sha256Hex, canonicalJson } from "../types"

// ── Key helpers ---------------------------------------------------------------

/** Ed25519 PKCS#8 DER prefix for wrapping a raw 32-byte seed. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex")

/** Ed25519 SPKI DER prefix for wrapping a raw 32-byte public key. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

/** Wrap a raw 32-byte ed25519 seed in PKCS#8 DER and return a KeyObject. */
function rawSeedToPrivateKey(seed: Uint8Array): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  })
}

/** Wrap a hex-encoded 32-byte ed25519 public key in SPKI DER and return a KeyObject. */
function hexToPublicKey(hex: string): KeyObject {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, "hex")]),
    format: "der",
    type: "spki",
  })
}

// ── Signing payload helpers ---------------------------------------------------

function helloSignPayload(hello: Omit<DharmaPeerHello, "signature">): string {
  return canonicalJson({
    protocolVersion: hello.protocolVersion,
    nodeInstanceId: hello.nodeInstanceId,
    supportedSchemaVersions: hello.supportedSchemaVersions,
    supportedFederations: hello.supportedFederations,
    identityPublicKey: hello.identityPublicKey,
    devicePublicKey: hello.devicePublicKey,
    timestamp: hello.timestamp,
    nonce: hello.nonce,
  })
}

function welcomeSignPayload(welcome: Omit<DharmaPeerWelcome, "signature">): string {
  return canonicalJson({
    protocolVersion: welcome.protocolVersion,
    acceptedFederations: welcome.acceptedFederations,
    rejectedFederations: welcome.rejectedFederations,
    maxEventsPerMinute: welcome.maxEventsPerMinute,
    maxEventBlockBytes: welcome.maxEventBlockBytes,
    serverTime: welcome.serverTime,
    nonceEcho: welcome.nonceEcho,
    nonce: welcome.nonce,
  })
}

// ── Public API ----------------------------------------------------------------

export interface HandshakeConfig {
  nodeInstanceId: string
  supportedSchemaVersions: number[]
  devicePublicKey: string
  signingKey: Uint8Array
  limits?: ReplicationLimits
}

/** Create a DharmaPeerHello message with a random nonce and signature. */
export function createHello(
  config: HandshakeConfig,
  supportedFederations: string[],
  identityPublicKey: string | null,
): DharmaPeerHello {
  const nonce = randomBytes(8)
  const timestamp = new Date().toISOString()

  const hello: Omit<DharmaPeerHello, "signature"> = {
    protocolVersion: DHARMA_REPLICATION_PROTOCOL_VERSION,
    nodeInstanceId: config.nodeInstanceId,
    supportedSchemaVersions: config.supportedSchemaVersions,
    supportedFederations,
    identityPublicKey,
    devicePublicKey: config.devicePublicKey,
    timestamp,
    nonce,
  }

  const payload = helloSignPayload(hello)
  const privateKey = rawSeedToPrivateKey(config.signingKey)
  const signature = sign(null, Buffer.from(payload, "utf-8"), privateKey)

  return { ...hello, signature }
}

/** Verify a received hello and create a signed welcome response. */
export async function respondToHello(
  hello: DharmaPeerHello,
  config: HandshakeConfig,
  ourFederations: string[],
): Promise<DharmaPeerWelcome> {
  if (!isProtocolCompatible(hello.protocolVersion)) {
    throw new HandshakeError(
      `Incompatible protocol version: ${hello.protocolVersion}`,
    )
  }

  // Verify the incoming hello's signature
  const { signature: sig, ...helloPayload } = hello
  const payload = helloSignPayload(helloPayload)
  const publicKey = hexToPublicKey(hello.devicePublicKey)
  const isValid = verify(
    null,
    Buffer.from(payload, "utf-8"),
    publicKey,
    Buffer.from(sig),
  )

  if (!isValid) {
    throw new HandshakeError("Invalid hello signature")
  }

  // Partition our federations into those the peer supports and those it does not
  const acceptedFederations = ourFederations.filter((f) =>
    hello.supportedFederations.includes(f),
  )
  const rejectedFederations = ourFederations.filter(
    (f) => !hello.supportedFederations.includes(f),
  )

  const limits = config.limits ?? DEFAULT_REPLICATION_LIMITS
  const nonceEcho = Uint8Array.from(hello.nonce)
  const nonce = randomBytes(8)
  const serverTime = new Date().toISOString()

  const welcome: Omit<DharmaPeerWelcome, "signature"> = {
    protocolVersion: DHARMA_REPLICATION_PROTOCOL_VERSION,
    acceptedFederations,
    rejectedFederations,
    maxEventsPerMinute: limits.maxEventsPerMinute,
    maxEventBlockBytes: limits.maxEventBlockBytes,
    serverTime,
    nonceEcho,
    nonce,
  }

  const welcomePayload = welcomeSignPayload(welcome)
  const privateKey = rawSeedToPrivateKey(config.signingKey)
  const signature = sign(
    null,
    Buffer.from(welcomePayload, "utf-8"),
    privateKey,
  )

  return { ...welcome, signature }
}

/** Verify a welcome message against the original hello nonce and expected public key. */
export function verifyWelcome(
  welcome: DharmaPeerWelcome,
  originalNonce: Uint8Array,
  expectedPublicKey: string,
): boolean {
  if (
    welcome.nonceEcho.length !== originalNonce.length ||
    !Buffer.from(welcome.nonceEcho).equals(Buffer.from(originalNonce))
  ) {
    return false
  }

  const { signature: sig, ...welcomePayload } = welcome
  const payload = welcomeSignPayload(welcomePayload)
  const publicKey = hexToPublicKey(expectedPublicKey)
  return verify(
    null,
    Buffer.from(payload, "utf-8"),
    publicKey,
    Buffer.from(sig),
  )
}

/** Process a completed handshake into a typed result. */
export function createHandshakeResult(
  welcome: DharmaPeerWelcome,
): PeerHandshakeResult {
  const { acceptedFederations, maxEventsPerMinute, maxEventBlockBytes, serverTime } = welcome

  return {
    accepted: acceptedFederations.length > 0,
    acceptedFederations,
    limits: {
      maxPeersPerFederation: 8,
      maxGlobalPeers: 24,
      maxInboundStreams: 16,
      maxOutboundStreams: 16,
      maxHandshakeDurationMs: 10_000,
      maxEventBlockBytes,
      maxEventsPerMinute,
    },
    peerId: sha256Hex(
      canonicalJson({ nonce: welcome.nonce, nonceEcho: welcome.nonceEcho }),
    ),
    serverTime,
  }
}

/** Check if the remote protocol version matches ours. */
export function isProtocolCompatible(version: number): boolean {
  return version === DHARMA_REPLICATION_PROTOCOL_VERSION
}

/** Check whether a federation is present in the accepted list. */
export function isFederationAccepted(
  federationId: string,
  acceptedFederations: string[],
): boolean {
  return acceptedFederations.includes(federationId)
}
