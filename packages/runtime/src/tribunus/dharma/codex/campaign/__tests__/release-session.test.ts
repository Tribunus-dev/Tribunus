/**
 * Phase 2 — Multi-Factor Release Sessions — Tests
 *
 * Tests cover:
 *   - createExportSessionKey / isSessionExpired
 *   - createSessionBoundAuthorization / verifySessionBinding
 *   - createHardwareApproval / verifyHardwareApproval
 *   - Release session state machine: transitions, hasSessionTimedOut, completeSession
 *   - createLeaseWithSessionBinding with valid/invalid sessions
 */

import { describe, test, expect } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { generateKeyPair } from "../../../crypto"
import {
  createExportSessionKey,
  isSessionExpired,
  createSessionBoundAuthorization,
  verifySessionBinding,
  createHardwareApproval,
  verifyHardwareApproval,
  createReleaseSession,
  transitionSession,
  hasSessionTimedOut,
  completeSession,
  createLeaseWithSessionBinding,
  type ThresholdAuthorization,
  type ExportSessionKey,
  type ReleaseSession,
  type ReleaseSessionState,
  type SessionBoundAuthorization,
  type HardwareApproval,
} from "../release-session"
import { createLeaseAuthority } from "../../mls/lease-authority"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeThresholdAuth(overrides?: Partial<ThresholdAuthorization>): ThresholdAuthorization {
  return {
    authorizationId: "auth-001",
    manifestDigest: "abc123",
    signatures: [
      { signerIndex: 0, signatureHex: "sig0" },
      { signerIndex: 1, signatureHex: "sig1" },
    ],
    threshold: 2,
    totalSigners: 3,
    authorizedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    ...overrides,
  }
}

function makeDeviceKeypair(): { publicKey: Buffer; privateKey: Uint8Array } {
  const kp = generateKeyPair()
  return {
    publicKey: Buffer.from(kp.publicKey),
    privateKey: kp.privateKey,
  }
}

// ── Tests: createExportSessionKey / isSessionExpired ─────────────────────────

describe("createExportSessionKey", () => {
  test("generates a valid session key with hex public key", () => {
    const { sessionKey, privateKey } = createExportSessionKey(60_000)

    expect(sessionKey.sessionId).toBeTruthy()
    expect(sessionKey.sessionId.length).toBe(32) // 16 random bytes → hex
    expect(sessionKey.ephemeralPublicKey).toBeTruthy()
    expect(sessionKey.ephemeralPublicKey).toMatch(/^[0-9a-f]+$/)
    expect(sessionKey.createdAt).toBeTruthy()
    expect(sessionKey.expiresAt).toBeTruthy()
    expect(privateKey).toBeTruthy()
    expect(privateKey.length).toBe(48) // Ed25519 PKCS8 DER private key
  })

  test("uses the provided TTL", () => {
    const ttlMs = 120_000
    const { sessionKey } = createExportSessionKey(ttlMs)
    const created = new Date(sessionKey.createdAt).getTime()
    const expires = new Date(sessionKey.expiresAt).getTime()
    expect(expires - created).toBeCloseTo(ttlMs, -3) // within 1s
  })

  test("each call generates a unique session key", () => {
    const a = createExportSessionKey(60_000)
    const b = createExportSessionKey(60_000)
    expect(a.sessionKey.sessionId).not.toBe(b.sessionKey.sessionId)
    expect(a.sessionKey.ephemeralPublicKey).not.toBe(b.sessionKey.ephemeralPublicKey)
  })
})

describe("isSessionExpired", () => {
  test("returns false for a fresh session key", () => {
    const { sessionKey } = createExportSessionKey(60_000)
    expect(isSessionExpired(sessionKey)).toBe(false)
  })

  test("returns true for an expired session key", () => {
    const { sessionKey } = createExportSessionKey(-60_000) // expired 1 minute ago
    expect(isSessionExpired(sessionKey)).toBe(true)
  })

  test("returns true for a session key with past expiresAt", () => {
    const key: ExportSessionKey = {
      sessionId: "test",
      ephemeralPublicKey: "deadbeef",
      createdAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    }
    expect(isSessionExpired(key)).toBe(true)
  })
})

// ── Tests: createSessionBoundAuthorization / verifySessionBinding ────────────

describe("createSessionBoundAuthorization", () => {
  test("binds a threshold auth to a session key via SHA-256 commitment", () => {
    const { sessionKey } = createExportSessionKey(60_000)
    const auth = makeThresholdAuth()

    const bound = createSessionBoundAuthorization(auth, sessionKey)

    expect(bound.authorizationId).toBe(auth.authorizationId)
    expect(bound.manifestDigest).toBe(auth.manifestDigest)
    expect(bound.threshold).toBe(2)
    expect(bound.signatures).toHaveLength(2)

    // Verify the commitment is SHA-256 of the ephemeral public key
    const expectedCommitment = createHash("sha256")
      .update(Buffer.from(sessionKey.ephemeralPublicKey, "hex"))
      .digest("hex")
    expect(bound.sessionKeyCommitment).toBe(expectedCommitment)
  })
})

describe("verifySessionBinding", () => {
  test("returns true for a valid binding", () => {
    const { sessionKey } = createExportSessionKey(60_000)
    const auth = makeThresholdAuth()
    const bound = createSessionBoundAuthorization(auth, sessionKey)

    expect(verifySessionBinding(bound, sessionKey)).toBe(true)
  })

  test("returns false with a different session key (wrong commitment)", () => {
    const { sessionKey } = createExportSessionKey(60_000)
    const otherKey: ExportSessionKey = {
      sessionId: "other",
      ephemeralPublicKey: "ff".repeat(32), // different key
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    const auth = makeThresholdAuth()
    const bound = createSessionBoundAuthorization(auth, sessionKey)

    expect(verifySessionBinding(bound, otherKey)).toBe(false)
  })

  test("returns false when authorization has expired", () => {
    const { sessionKey } = createExportSessionKey(60_000)
    const auth = makeThresholdAuth({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })
    const bound = createSessionBoundAuthorization(auth, sessionKey)

    expect(verifySessionBinding(bound, sessionKey)).toBe(false)
  })

  test("returns false when signature count is below threshold", () => {
    const { sessionKey } = createExportSessionKey(60_000)
    const auth = makeThresholdAuth({
      threshold: 5,
      signatures: [{ signerIndex: 0, signatureHex: "sig0" }],
    })
    const bound = createSessionBoundAuthorization(auth, sessionKey)

    expect(verifySessionBinding(bound, sessionKey)).toBe(false)
  })
})

// ── Tests: createHardwareApproval / verifyHardwareApproval ───────────────────

describe("createHardwareApproval", () => {
  test("creates an approval with valid signature", () => {
    const device = makeDeviceKeypair()
    const approval = createHardwareApproval(
      "session-001",
      "yubikey-01",
      "yubikey_tap",
      device.privateKey,
    )

    expect(approval.sessionId).toBe("session-001")
    expect(approval.deviceId).toBe("yubikey-01")
    expect(approval.approvalType).toBe("yubikey_tap")
    expect(approval.approvedAt).toBeTruthy()
    expect(approval.signature).toBeTruthy()
    expect(approval.signature).toMatch(/^[0-9a-f]+$/)
  })

  test("supports all approval types", () => {
    const device = makeDeviceKeypair()
    const types = ["yubikey_tap", "second_device_confirm", "passphrase_entry"] as const

    for (const t of types) {
      const approval = createHardwareApproval("sess-1", "dev-1", t, device.privateKey)
      expect(approval.approvalType).toBe(t)
    }
  })
})

describe("verifyHardwareApproval", () => {
  test("returns true for a valid approval", () => {
    const device = makeDeviceKeypair()
    const approval = createHardwareApproval(
      "session-001",
      "yubikey-01",
      "yubikey_tap",
      device.privateKey,
    )

    expect(verifyHardwareApproval(approval, "session-001", device.publicKey)).toBe(true)
  })

  test("returns false for wrong session id", () => {
    const device = makeDeviceKeypair()
    const approval = createHardwareApproval(
      "session-001",
      "yubikey-01",
      "yubikey_tap",
      device.privateKey,
    )

    expect(verifyHardwareApproval(approval, "session-002", device.publicKey)).toBe(false)
  })

  test("returns false with wrong device key", () => {
    const device = makeDeviceKeypair()
    const otherDevice = makeDeviceKeypair()
    const approval = createHardwareApproval(
      "session-001",
      "yubikey-01",
      "yubikey_tap",
      device.privateKey,
    )

    expect(verifyHardwareApproval(approval, "session-001", otherDevice.publicKey)).toBe(false)
  })

  test("returns false with tampered signature", () => {
    const device = makeDeviceKeypair()
    const approval = createHardwareApproval(
      "session-001",
      "yubikey-01",
      "yubikey_tap",
      device.privateKey,
    )

    const tampered: HardwareApproval = {
      ...approval,
      signature: "ff".repeat(64),
    }

    expect(verifyHardwareApproval(tampered, "session-001", device.publicKey)).toBe(false)
  })
})

// ── Tests: Release Session State Machine ─────────────────────────────────────

describe("createReleaseSession", () => {
  test("creates a session in 'created' state", () => {
    const session = createReleaseSession(60_000)

    expect(session.sessionId).toBeTruthy()
    expect(session.state).toBe("created")
    expect(session.sessionKey).toBeTruthy()
    expect(session.authorization).toBeNull()
    expect(session.hardwareApproval).toBeNull()
    expect(session.leaseResponses).toEqual([])
    expect(session.startedAt).toBeTruthy()
    expect(session.lastActivityAt).toBeTruthy()
  })
})

describe("transitionSession", () => {
  const validPaths = [
    ["created", "authorizing"],
    ["authorizing", "approved"],
    ["approved", "decrypting"],
    ["decrypting", "encrypting"],
    ["encrypting", "completed"],
  ] as const

  for (const [from, to] of validPaths) {
    test(`allows ${from} → ${to}`, () => {
      const session = createReleaseSession(60_000)
      // Walk the session through all preceding states
      let s: ReleaseSession = session
      for (const step of validPaths) {
        if (step[0] === from) break
        s = transitionSession(s, step[1] as ReleaseSessionState)
      }
      const result = transitionSession(
        { ...s, state: from as ReleaseSessionState },
        to as ReleaseSessionState,
      )
      expect(result.state).toBe(to)
    })
  }

  const invalidPaths = [
    ["created", "completed"],
    ["created", "decrypting"],
    ["authorizing", "completed"],
    ["approved", "completed"],
    ["completed", "decrypting"],
    ["failed", "approved"],
    ["timed_out", "created"],
  ] as const

  for (const [from, to] of invalidPaths) {
    test(`rejects ${from} → ${to}`, () => {
      expect(() =>
        transitionSession(
          { ...createReleaseSession(60_000), state: from as ReleaseSessionState },
          to as ReleaseSessionState,
        ),
      ).toThrow("Invalid session state transition")
    })
  }

  test("terminal states cannot transition", () => {
    const session = createReleaseSession(60_000)
    let s = transitionSession(session, "failed")
    expect(() => transitionSession(s, "authorizing")).toThrow(
      "Invalid session state transition",
    )

    s = transitionSession(session, "timed_out")
    expect(() => transitionSession(s, "created")).toThrow(
      "Invalid session state transition",
    )

    // Walk to completed via valid path
    s = transitionSession(session, "authorizing")
    s = transitionSession(s, "approved")
    s = transitionSession(s, "decrypting")
    s = transitionSession(s, "encrypting")
    s = transitionSession(s, "completed")
    expect(s.state).toBe("completed")
    expect(() => transitionSession(s, "encrypting")).toThrow(
      "Invalid session state transition",
    )
  })

  test("updates lastActivityAt on transition", async () => {
    const session = createReleaseSession(60_000)
    const original = session.lastActivityAt

    await new Promise(r => setTimeout(r, 5))
    const result = transitionSession(session, "authorizing")
    expect(result.lastActivityAt).not.toBe(original)
  })
})

describe("hasSessionTimedOut", () => {
  test("returns false for a fresh session", () => {
    const session = createReleaseSession(60_000)
    expect(hasSessionTimedOut(session)).toBe(false)
  })

  test("returns true for a timed_out session", () => {
    const session = transitionSession(createReleaseSession(60_000), "timed_out")
    expect(hasSessionTimedOut(session)).toBe(true)
  })

  test("returns false for completed session", () => {
    const session = createReleaseSession(60_000)
    let s = transitionSession(session, "authorizing")
    s = transitionSession(s, "approved")
    s = transitionSession(s, "decrypting")
    s = transitionSession(s, "encrypting")
    s = transitionSession(s, "completed")
    expect(hasSessionTimedOut(s)).toBe(false)
  })

  test("returns false for failed session", () => {
    const session = transitionSession(createReleaseSession(60_000), "failed")
    expect(hasSessionTimedOut(session)).toBe(false)
  })

  test("returns true for session with expired TTL", () => {
    const session = createReleaseSession(-10_000) // expired 10s ago
    expect(hasSessionTimedOut(session)).toBe(true)
  })
})

describe("completeSession", () => {
  test("transitions a session to completed via valid path", () => {
    const session = createReleaseSession(60_000)
    let s = transitionSession(session, "authorizing")
    s = transitionSession(s, "approved")
    s = transitionSession(s, "decrypting")
    s = transitionSession(s, "encrypting")
    s = completeSession(s)
    expect(s.state).toBe("completed")
  })
})

// ── Tests: createLeaseWithSessionBinding ─────────────────────────────────────

function buildApprovedSession(): {
  session: ReleaseSession
  authority: ReturnType<typeof createLeaseAuthority>
  deviceKey: { publicKey: Buffer; privateKey: Uint8Array }
} {
  const session = createReleaseSession(120_000)
  const authority = createLeaseAuthority()
  const deviceKey = makeDeviceKeypair()

  // Add authorization to the session
  const auth = makeThresholdAuth()
  const bound = createSessionBoundAuthorization(auth, session.sessionKey)

  // Add hardware approval
  const approval = createHardwareApproval(
    session.sessionId,
    "yubikey-01",
    "yubikey_tap",
    deviceKey.privateKey,
  )

  // Walk session through to approved state
  let s = transitionSession(session, "authorizing")
  s = transitionSession(s, "approved")
  s = { ...s, authorization: bound, hardwareApproval: approval }

  return { session: s, authority, deviceKey }
}

describe("createLeaseWithSessionBinding", () => {
  test("issues a lease for a fully approved session", () => {
    const { session, authority } = buildApprovedSession()

    const lease = createLeaseWithSessionBinding(
      {
        packetId: "packet-001",
        leaseId: "lease-001",
        requestorIdentity: "user-alice",
        purpose: "export",
        maxOperations: 10,
      },
      session,
      authority,
    )

    expect(lease).not.toBeNull()
    expect(lease!.leaseId).toBe("lease-001")
    expect(lease!.packetId).toBe("packet-001")
    expect(lease!.requestorIdentity).toBe("user-alice")
    expect(lease!.purpose).toBe("export")
    expect(lease!.signature).toBeTruthy()
    expect(lease!.remainingOperations).toBe(10)
  })

  test("returns null when session has not been authorized", () => {
    const session = createReleaseSession(120_000)
    const authority = createLeaseAuthority()

    const lease = createLeaseWithSessionBinding(
      {
        packetId: "packet-001",
        leaseId: "lease-001",
        requestorIdentity: "user-alice",
        purpose: "export",
        maxOperations: 10,
      },
      session,
      authority,
    )

    expect(lease).toBeNull()
  })

  test("returns null when session is still authorizing", () => {
    const session = transitionSession(createReleaseSession(120_000), "authorizing")
    const authority = createLeaseAuthority()
    const { sessionKey } = createExportSessionKey(120_000)
    const auth = createSessionBoundAuthorization(makeThresholdAuth(), sessionKey)
    const deviceKey = makeDeviceKeypair()
    const approval = createHardwareApproval(
      session.sessionId,
      "dev-1",
      "yubikey_tap",
      deviceKey.privateKey,
    )
    const s: ReleaseSession = {
      ...session,
      authorization: auth,
      hardwareApproval: approval,
    }

    const lease = createLeaseWithSessionBinding(
      {
        packetId: "packet-001",
        leaseId: "lease-001",
        requestorIdentity: "user-alice",
        purpose: "export",
        maxOperations: 10,
      },
      s,
      authority,
    )

    expect(lease).toBeNull()
  })

  test("returns null when session binding verification fails (wrong key)", () => {
    const session = createReleaseSession(120_000)
    const authority = createLeaseAuthority()
    const deviceKey = makeDeviceKeypair()

    // Use a DIFFERENT session key's commitment than the session carries
    const otherKey = createExportSessionKey(120_000)
    const auth = createSessionBoundAuthorization(
      makeThresholdAuth(),
      otherKey.sessionKey,
    )
    const approval = createHardwareApproval(
      session.sessionId,
      "yubikey-01",
      "yubikey_tap",
      deviceKey.privateKey,
    )

    let s = transitionSession(session, "authorizing")
    s = transitionSession(s, "approved")
    s = { ...s, authorization: auth, hardwareApproval: approval }

    const lease = createLeaseWithSessionBinding(
      {
        packetId: "packet-001",
        leaseId: "lease-001",
        requestorIdentity: "user-alice",
        purpose: "export",
        maxOperations: 10,
      },
      s,
      authority,
    )

    expect(lease).toBeNull()
  })

  test("returns null when hardware approval is missing", () => {
    const { session, authority } = buildApprovedSession()
    const noHardware: ReleaseSession = { ...session, hardwareApproval: null }

    const lease = createLeaseWithSessionBinding(
      {
        packetId: "packet-001",
        leaseId: "lease-001",
        requestorIdentity: "user-alice",
        purpose: "export",
        maxOperations: 10,
      },
      noHardware,
      authority,
    )

    expect(lease).toBeNull()
  })

  test("returns null when session has timed out", () => {
    const { session, authority } = buildApprovedSession()
    const timedOut: ReleaseSession = {
      ...session,
      state: "timed_out",
      sessionKey: {
        ...session.sessionKey,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    }

    const lease = createLeaseWithSessionBinding(
      {
        packetId: "packet-001",
        leaseId: "lease-001",
        requestorIdentity: "user-alice",
        purpose: "export",
        maxOperations: 10,
      },
      timedOut,
      authority,
    )

    expect(lease).toBeNull()
  })

  test("returns null when session TTL has expired", () => {
    const expiredSession = createReleaseSession(-120_000) // already expired
    const authority = createLeaseAuthority()
    const deviceKey = makeDeviceKeypair()

    // Even with authorization, expired session = no lease
    const auth = createSessionBoundAuthorization(
      makeThresholdAuth(),
      expiredSession.sessionKey,
    )
    const approval = createHardwareApproval(
      expiredSession.sessionId,
      "yubikey-01",
      "yubikey_tap",
      deviceKey.privateKey,
    )

    const { sessionKey } = createExportSessionKey(120_000)
    // Use a valid session key for the session but the session itself is expired
    // Actually - createReleaseSession handles the TTL. The session object
    // has isSessionExpired true. Let's use that.
    // We need the session to be in "approved" state for the gate to reach TTL check
    let s = transitionSession(expiredSession, "authorizing")
    s = transitionSession(s, "approved")
    s = { ...s, authorization: auth, hardwareApproval: approval }

    const lease = createLeaseWithSessionBinding(
      {
        packetId: "packet-001",
        leaseId: "lease-001",
        requestorIdentity: "user-alice",
        purpose: "export",
        maxOperations: 10,
      },
      s,
      authority,
    )

    expect(lease).toBeNull()
  })

  test("returns null when authorization has expired", () => {
    const { sessionKey } = createExportSessionKey(120_000)
    const auth = createSessionBoundAuthorization(
      makeThresholdAuth({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      sessionKey,
    )

    const session = createReleaseSession(120_000)
    const authority = createLeaseAuthority()
    const deviceKey = makeDeviceKeypair()
    const approval = createHardwareApproval(
      session.sessionId,
      "yubikey-01",
      "yubikey_tap",
      deviceKey.privateKey,
    )

    // Put the expired auth into a session that otherwise looks OK
    let s = transitionSession(session, "authorizing")
    s = transitionSession(s, "approved")
    s = { ...s, authorization: auth, hardwareApproval: approval }

    const lease = createLeaseWithSessionBinding(
      {
        packetId: "packet-001",
        leaseId: "lease-001",
        requestorIdentity: "user-alice",
        purpose: "export",
        maxOperations: 10,
      },
      s,
      authority,
    )

    expect(lease).toBeNull()
  })
})
