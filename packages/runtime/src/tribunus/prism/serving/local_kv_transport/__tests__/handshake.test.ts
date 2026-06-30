/**
 * Prism Local-Host KV Transport — Handshake Tests
 */

import { describe, it, expect } from "bun:test"
import {
  createHandshake,
  createHandshakeAcceptance,
  verifyHandshake,
  isNonceReplayed,
  isHandshakeExpired,
} from "../local-transport-handshake"
import type { HandshakeRejection, LocalKvTransportHandshake, LocalKvTransportHandshakeAcceptance } from "../local-transport-types"

// ── createHandshake ─────────────────────────────────────────────────────────

describe("createHandshake", () => {
  it("creates a handshake with the given identities", () => {
    const hs = createHandshake("worker-1", "inst-a", "host-x", "cap:digest-1", "pubkey-abc")
    expect(hs.protocolVersion).toBe(1)
    expect(hs.workerId).toBe("worker-1")
    expect(hs.workerInstanceId).toBe("inst-a")
    expect(hs.hostInstanceId).toBe("host-x")
    expect(hs.transportCapabilityDigest).toBe("cap:digest-1")
    expect(hs.ephemeralTransportPublicKey).toBe("pubkey-abc")
    expect(hs.nonce).toBeTruthy()
    expect(hs.timestamp).toBeTruthy()
    expect(hs.signature).toBeTruthy()
  })

  it("produces unique nonces across calls", () => {
    const hs1 = createHandshake("w", "i", "h", "c", "k")
    const hs2 = createHandshake("w", "i", "h", "c", "k")
    expect(hs1.nonce).not.toBe(hs2.nonce)
  })

  it("produces distinct signatures for different identities", () => {
    const hs1 = createHandshake("worker-1", "inst-a", "host-x", "cap", "key")
    const hs2 = createHandshake("worker-2", "inst-b", "host-y", "cap", "key")
    expect(hs1.signature).not.toBe(hs2.signature)
  })
})

// ── createHandshakeAcceptance ───────────────────────────────────────────────

describe("createHandshakeAcceptance", () => {
  it("echoes the original handshake nonce", () => {
    const hs = createHandshake("worker-1", "inst-a", "host-x", "cap", "key")
    const acc = createHandshakeAcceptance(hs, "worker-1", "inst-a", "host-x", "cap", "key")
    expect(acc.nonceEcho).toBe(hs.nonce)
    expect(acc.nonce).toBeTruthy()
    expect(acc.nonce).not.toBe(hs.nonce) // fresh nonce
  })

  it("produces a complete acceptance", () => {
    const hs = createHandshake("w", "i", "h", "c", "k")
    const acc = createHandshakeAcceptance(hs, "w", "i", "h", "c", "k")
    expect(acc.workerId).toBe("w")
    expect(acc.workerInstanceId).toBe("i")
    expect(acc.hostInstanceId).toBe("h")
    expect(acc.transportCapabilityDigest).toBe("c")
    expect(acc.ephemeralTransportPublicKey).toBe("k")
    expect(acc.signature).toBeTruthy()
  })
})

// ── verifyHandshake ─────────────────────────────────────────────────────────

describe("verifyHandshake", () => {
  function makeValidPair(): { hs: LocalKvTransportHandshake; acc: LocalKvTransportHandshakeAcceptance } {
    const hs = createHandshake("w", "i", "h", "c", "k")
    const acc = createHandshakeAcceptance(hs, "w", "i", "h", "c", "k")
    return { hs, acc }
  }

  it("accepts a valid handshake pair", () => {
    const { hs, acc } = makeValidPair()
    const result = verifyHandshake(hs, acc)
    expect(result.valid).toBe(true)
    expect(result.rejection).toBeNull()
    expect(result.reason).toBeNull()
  })

  const rejectionCases: { label: string; mutate: (hs: LocalKvTransportHandshake, acc: LocalKvTransportHandshakeAcceptance) => void; expected: HandshakeRejection }[] = [
    {
      label: "protocol version mismatch",
      mutate: (_hs, acc) => { acc.protocolVersion = 2 },
      expected: "protocol_version_mismatch",
    },
    {
      label: "nonce echo mismatch",
      mutate: (_hs, acc) => { acc.nonceEcho = "bogus-nonce" },
      expected: "replayed_nonce",
    },
    {
      label: "worker ID mismatch",
      mutate: (_hs, acc) => { acc.workerId = "different-worker" },
      expected: "unknown_worker",
    },
    {
      label: "host instance mismatch",
      mutate: (_hs, acc) => { acc.hostInstanceId = "different-host" },
      expected: "host_authority_mismatch",
    },
    {
      label: "worker instance mismatch",
      mutate: (hs, acc) => { acc.workerInstanceId = hs.workerInstanceId + "-different" },
      expected: "worker_instance_mismatch",
    },
    {
      label: "capability digest mismatch",
      mutate: (_hs, acc) => { acc.transportCapabilityDigest = "cap:different" },
      expected: "transport_capability_mismatch",
    },
    {
      label: "empty signature on handshake",
      mutate: (hs) => { hs.signature = "" },
      expected: "invalid_signature",
    },
    {
      label: "empty signature on acceptance",
      mutate: (_hs, acc) => { acc.signature = "" },
      expected: "invalid_signature",
    },
  ]

  for (const { label, mutate, expected } of rejectionCases) {
    it(`rejects with "${expected}" for ${label}`, () => {
      const { hs, acc } = makeValidPair()
      mutate(hs, acc)
      const result = verifyHandshake(hs, acc)
      expect(result.valid).toBe(false)
      expect(result.rejection).toBe(expected)
    })
  }
})

// ── isNonceReplayed ─────────────────────────────────────────────────────────

describe("isNonceReplayed", () => {
  it("returns false for an unseen nonce", () => {
    const seen = new Set(["existing-nonce"])
    expect(isNonceReplayed("fresh-nonce", seen)).toBe(false)
  })

  it("returns true for a seen nonce", () => {
    const seen = new Set(["seen-nonce"])
    expect(isNonceReplayed("seen-nonce", seen)).toBe(true)
  })

  it("works with an empty set", () => {
    expect(isNonceReplayed("anything", new Set())).toBe(false)
  })
})

// ── isHandshakeExpired ──────────────────────────────────────────────────────

describe("isHandshakeExpired", () => {
  it("returns false for a freshly created handshake", () => {
    const hs = createHandshake("w", "i", "h", "c", "k")
    expect(isHandshakeExpired(hs, 60_000)).toBe(false)
  })

  it("returns true when TTL has passed", () => {
    const hs = createHandshake("w", "i", "h", "c", "k")
    // Set the timestamp far in the past
    const past = new Date(Date.now() - 120_000).toISOString()
    hs.timestamp = past
    expect(isHandshakeExpired(hs, 60_000)).toBe(true)
  })

  it("returns true for an unparseable timestamp", () => {
    const hs = createHandshake("w", "i", "h", "c", "k")
    hs.timestamp = "not-a-date"
    expect(isHandshakeExpired(hs, 60_000)).toBe(true)
  })
})
