/**
 * Tests for trusted-lan-transport.ts — Handshake protocol, frames
 */

import { describe, it, expect } from "bun:test"
import {
  createHandshake,
  createHandshakeAcceptance,
  verifyHandshakeNonce,
  createOutputFrame,
} from "../trusted-lan-transport.ts"
import type { LanComputeHandshake, LanComputeHandshakeAcceptance, LanComputeOutputFrame } from "../trusted-lan-types"
import { HandshakeError, TransportError } from "../trusted-lan-errors"

// ── Helper Values -----------------------------------------------------------

const VALID_HS_CONFIG = {
  requesterKey: "pk-requester-alice",
  requesterDeviceKey: "dk-alice-laptop",
  providerKey: "pk-provider-bob",
  sessionId: "session-42",
  membershipId: "mem-group-7",
  epoch: 3,
  leaseDigest: "sha256:lease-digest-abc",
}

// ── createHandshake ---------------------------------------------------------

describe("createHandshake", () => {
  it("creates a handshake with expected fields and a fresh nonce", () => {
    const hs = createHandshake(VALID_HS_CONFIG)

    expect(hs.protocolVersion).toBe(1)
    expect(hs.requesterIdentityPublicKey).toBe("pk-requester-alice")
    expect(hs.requesterDevicePublicKey).toBe("dk-alice-laptop")
    expect(hs.providerIdentityPublicKey).toBe("pk-provider-bob")
    expect(hs.providerDevicePublicKey).toBeNull()
    expect(hs.sessionId).toBe("session-42")
    expect(hs.membershipId).toBe("mem-group-7")
    expect(hs.sessionKeyEpoch).toBe(3)
    expect(hs.leaseRequestDigest).toBe("sha256:lease-digest-abc")
    expect(hs.nonce).toBeTruthy()
    expect(typeof hs.nonce).toBe("string")
    expect(hs.nonce.length).toBeGreaterThanOrEqual(16)
    expect(hs.timestamp).toBeTruthy()
    expect(hs.signature).toBeTruthy()
  })

  it("generates a different nonce for each handshake", () => {
    const hs1 = createHandshake(VALID_HS_CONFIG)
    const hs2 = createHandshake(VALID_HS_CONFIG)
    expect(hs1.nonce).not.toBe(hs2.nonce)
  })

  it("throws HandshakeError when requesterKey is empty", () => {
    expect(() => createHandshake({ ...VALID_HS_CONFIG, requesterKey: "" })).toThrow(HandshakeError)
  })

  it("throws HandshakeError when requesterDeviceKey is empty", () => {
    expect(() => createHandshake({ ...VALID_HS_CONFIG, requesterDeviceKey: "" })).toThrow(HandshakeError)
  })

  it("throws HandshakeError when providerKey is empty", () => {
    expect(() => createHandshake({ ...VALID_HS_CONFIG, providerKey: "" })).toThrow(HandshakeError)
  })

  it("throws HandshakeError when sessionId is empty", () => {
    expect(() => createHandshake({ ...VALID_HS_CONFIG, sessionId: "" })).toThrow(HandshakeError)
  })

  it("throws HandshakeError when membershipId is empty", () => {
    expect(() => createHandshake({ ...VALID_HS_CONFIG, membershipId: "" })).toThrow(HandshakeError)
  })

  it("throws HandshakeError when epoch is negative", () => {
    expect(() => createHandshake({ ...VALID_HS_CONFIG, epoch: -1 })).toThrow(HandshakeError)
  })

  it("throws HandshakeError when leaseDigest is empty", () => {
    expect(() => createHandshake({ ...VALID_HS_CONFIG, leaseDigest: "" })).toThrow(HandshakeError)
  })
})

// ── createHandshakeAcceptance -----------------------------------------------

describe("createHandshakeAcceptance", () => {
  it("creates an acceptance echoing the handshake nonce", () => {
    const hs = createHandshake(VALID_HS_CONFIG)
    const acc = createHandshakeAcceptance(hs, "pk-provider-bob", "dk-bob-server", "ad-digest-xyz")

    expect(acc.protocolVersion).toBe(1)
    expect(acc.providerIdentityPublicKey).toBe("pk-provider-bob")
    expect(acc.providerDevicePublicKey).toBe("dk-bob-server")
    expect(acc.providerAdvertisementDigest).toBe("ad-digest-xyz")
    expect(acc.nonceEcho).toBe(hs.nonce)
    expect(acc.nonce).toBeTruthy()
    expect(acc.nonce).not.toBe(hs.nonce) // fresh nonce
    expect(acc.timestamp).toBeTruthy()
    expect(acc.signature).toBeTruthy()
  })

  it("sets containmentCapabilityDigest to empty and negotiatedTransportLimits to {}", () => {
    const hs = createHandshake(VALID_HS_CONFIG)
    const acc = createHandshakeAcceptance(hs, "pk-provider-bob", "dk-bob-server", "ad-digest-xyz")

    expect(acc.containmentCapabilityDigest).toBe("")
    expect(acc.negotiatedTransportLimits).toBe("{}")
  })

  it("throws HandshakeError when handshake is null", () => {
    expect(() => createHandshakeAcceptance(null as unknown as LanComputeHandshake, "pk", "dk", "ad")).toThrow(HandshakeError)
  })

  it("throws HandshakeError when providerKey is empty", () => {
    const hs = createHandshake(VALID_HS_CONFIG)
    expect(() => createHandshakeAcceptance(hs, "", "dk", "ad")).toThrow(HandshakeError)
  })

  it("throws HandshakeError when providerDeviceKey is empty", () => {
    const hs = createHandshake(VALID_HS_CONFIG)
    expect(() => createHandshakeAcceptance(hs, "pk", "", "ad")).toThrow(HandshakeError)
  })

  it("throws HandshakeError when adDigest is empty", () => {
    const hs = createHandshake(VALID_HS_CONFIG)
    expect(() => createHandshakeAcceptance(hs, "pk", "dk", "")).toThrow(HandshakeError)
  })
})

// ── verifyHandshakeNonce ----------------------------------------------------

describe("verifyHandshakeNonce", () => {
  it("returns true when nonceEcho matches the original nonce", () => {
    const hs = createHandshake(VALID_HS_CONFIG)
    const acc = createHandshakeAcceptance(hs, "pk-provider-bob", "dk-bob-server", "ad-digest-xyz")

    expect(verifyHandshakeNonce(acc, hs.nonce)).toBeTrue()
  })

  it("returns false when nonceEcho does not match", () => {
    const hs = createHandshake(VALID_HS_CONFIG)
    const acc = createHandshakeAcceptance(hs, "pk-provider-bob", "dk-bob-server", "ad-digest-xyz")

    expect(verifyHandshakeNonce(acc, "wrong-nonce")).toBeFalse()
  })

  it("throws HandshakeError when acceptance is null", () => {
    expect(() => verifyHandshakeNonce(null as unknown as LanComputeHandshakeAcceptance, "nonce")).toThrow(HandshakeError)
  })

  it("throws HandshakeError when originalNonce is empty", () => {
    const hs = createHandshake(VALID_HS_CONFIG)
    const acc = createHandshakeAcceptance(hs, "pk-provider-bob", "dk-bob-server", "ad-digest-xyz")
    expect(() => verifyHandshakeNonce(acc, "")).toThrow(HandshakeError)
  })
})

// ── createOutputFrame -------------------------------------------------------

describe("createOutputFrame", () => {
  it("creates an output frame with correct fields", () => {
    const frame = createOutputFrame("lease-1", 0, "token_delta", "Hello, world!", false)

    expect(frame.leaseId).toBe("lease-1")
    expect(frame.sequenceNumber).toBe(0)
    expect(frame.frameKind).toBe("token_delta")
    expect(frame.payload).toBe("Hello, world!")
    expect(frame.payloadDigest).toBeTruthy()
    expect(frame.bytes).toBe(13)
    expect(frame.final).toBeFalse()
    expect(frame.signature).toBeTruthy()
  })

  it("marks the final frame correctly", () => {
    const frame = createOutputFrame("lease-1", 99, "final_receipt_reference", null, true)
    expect(frame.final).toBeTrue()
    expect(frame.frameKind).toBe("final_receipt_reference")
  })

  it("sets bytes to 0 and payloadDigest to empty when payload is null", () => {
    const frame = createOutputFrame("lease-1", 1, "status", null, false)
    expect(frame.bytes).toBe(0)
    expect(frame.payloadDigest).toBe("")
    expect(frame.payload).toBeNull()
  })

  it("increments sequence numbers across frames", () => {
    const f0 = createOutputFrame("lease-1", 0, "token_delta", "a", false)
    const f1 = createOutputFrame("lease-1", 1, "token_delta", "b", false)
    expect(f0.sequenceNumber).toBe(0)
    expect(f1.sequenceNumber).toBe(1)
  })

  it("supports all FrameKind values", () => {
    const kinds = ["token_delta", "structured_chunk", "embedding_chunk", "status", "error", "final_receipt_reference"] as const
    for (const k of kinds) {
      const f = createOutputFrame("lease-1", 0, k, null, false)
      expect(f.frameKind).toBe(k)
    }
  })

  it("throws TransportError when leaseId is empty", () => {
    expect(() => createOutputFrame("", 0, "status", null, false)).toThrow(TransportError)
  })

  it("throws TransportError when sequence is negative", () => {
    expect(() => createOutputFrame("lease-1", -1, "status", null, false)).toThrow(TransportError)
  })

  it("throws TransportError when frameKind is empty", () => {
    expect(() => createOutputFrame("lease-1", 0, "" as unknown as "status", null, false)).toThrow(TransportError)
  })
})
