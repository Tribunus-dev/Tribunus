/**
 * Compute KV Namespace Tests
 *
 * Tests for the KV namespace state machine and factory.
 * Tests cover state transition validation, namespace creation, and edge cases.
 */

import { describe, test, expect } from "bun:test"
import type { KvNamespaceState, LocalKvNamespace } from "../compute-types"
import {
  VALID_KV_TRANSITIONS,
  createKvNamespace,
  applyKvAction,
  type KvAction,
} from "../compute-kv"

// ── VALID_KV_TRANSITIONS shape ----------------------------------------------

describe("VALID_KV_TRANSITIONS", () => {
  test("is a complete record over all KvNamespaceState values", () => {
    const allStates: KvNamespaceState[] = [
      "allocated",
      "primed",
      "decoding",
      "synchronized",
      "invalidated",
      "released",
    ]

    for (const state of allStates) {
      expect(VALID_KV_TRANSITIONS[state]).toBeDefined()
      expect(Array.isArray(VALID_KV_TRANSITIONS[state])).toBe(true)
    }
  })

  test("released is terminal (no onward transitions)", () => {
    expect(VALID_KV_TRANSITIONS.released).toEqual([])
  })
})

// ── applyKvAction State Machine ---------------------------------------------

describe("applyKvAction", () => {
  const VALID: Array<[KvNamespaceState, KvAction, KvNamespaceState]> = [
    ["allocated",    "prime",      "primed"],
    ["primed",       "decode",     "decoding"],
    ["decoding",     "sync",       "synchronized"],
    ["synchronized", "decode",     "decoding"],
    ["synchronized", "invalidate", "invalidated"],
    ["decoding",     "invalidate", "invalidated"],
    ["invalidated",  "release",    "released"],
    ["allocated",    "release",    "released"],
    ["primed",       "release",    "released"],
    ["decoding",     "release",    "released"],
    ["synchronized", "release",    "released"],
  ]

  for (const [from, action, expected] of VALID) {
    test(`${from} —"${action}"→ ${expected}`, () => {
      expect(applyKvAction(from, action)).toBe(expected)
    })
  }

  const INVALID: Array<[KvNamespaceState, KvAction]> = [
    ["allocated", "decode"],
    ["allocated", "sync"],
    ["allocated", "invalidate"],
    ["primed", "prime"],
    ["primed", "sync"],
    ["decoding", "prime"],
    ["decoding", "decode"],
    ["synchronized", "prime"],
    ["synchronized", "sync"],
    ["invalidated", "prime"],
    ["invalidated", "decode"],
    ["invalidated", "sync"],
    ["invalidated", "invalidate"],
    ["released", "prime"],
    ["released", "decode"],
    ["released", "sync"],
    ["released", "invalidate"],
    ["released", "release"],
  ]

  for (const [from, action] of INVALID) {
    test(`rejects ${from} —"${action}"→ (invalid)`, () => {
      expect(() => applyKvAction(from, action)).toThrow("not allowed")
    })
  }

  test("invalidate cycle validated from decoding", () => {
    expect(applyKvAction("decoding", "invalidate")).toBe("invalidated")
  })

  test("re-decode cycle from synchronized", () => {
    expect(applyKvAction("synchronized", "decode")).toBe("decoding")
  })

  test("invalidated only accepts release", () => {
    expect(applyKvAction("invalidated", "release")).toBe("released")
  })
})

// ── createKvNamespace -------------------------------------------------------

describe("createKvNamespace", () => {
  test("creates a namespace with allocated state and expected fields", () => {
    const ns = createKvNamespace({
      sessionId: "session-1",
      leaseId: "lease-1",
      modelDigest: "model-digest-abc",
      ownerIdentity: "owner-key-1",
      prefixDigest: "prefix-digest-xyz",
    })

    expect(ns.namespaceId).toBeTypeOf("string")
    expect(ns.namespaceId.length).toBeGreaterThan(0)
    expect(ns.sessionId).toBe("session-1")
    expect(ns.leaseId).toBe("lease-1")
    expect(ns.modelArtifactDigest).toBe("model-digest-abc")
    expect(ns.ownerIdentityPublicKey).toBe("owner-key-1")
    expect(ns.prefixDigest).toBe("prefix-digest-xyz")
    expect(ns.residencyTier).toBe("local")
    expect(ns.state).toBe("allocated")
    expect(ns.expiresAt).toBeNull()
  })

  test("creates namespace with ISO timestamp", () => {
    const ns = createKvNamespace({
      sessionId: "s1",
      leaseId: "l1",
      modelDigest: "m1",
      ownerIdentity: "k1",
      prefixDigest: "p1",
    })

    expect(ns.createdAt).toBeTypeOf("string")
    expect(() => new Date(ns.createdAt)).not.toThrow()
  })

  test("each call produces a unique namespaceId", () => {
    const a = createKvNamespace({
      sessionId: "s1", leaseId: "l1", modelDigest: "m1",
      ownerIdentity: "k1", prefixDigest: "p1",
    })
    const b = createKvNamespace({
      sessionId: "s1", leaseId: "l1", modelDigest: "m1",
      ownerIdentity: "k1", prefixDigest: "p1",
    })

    expect(a.namespaceId).not.toBe(b.namespaceId)
  })
})
