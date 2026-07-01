/**
 * Dharma Replication — Writer Admission Tests
 *
 * Covers the full admission lifecycle: createPendingAdmission,
 * admit/reject/revoke transitions, request/response signing and
 * verification, and FederationBase.admitWriter integration.
 */

import { describe, test, expect } from "bun:test"
import { generateKeyPairSync, randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"

import {
  createPendingAdmission,
  admitWriter,
  rejectWriter,
  revokeWriter,
  isWriterAdmitted,
  createAdmissionRequest,
  verifyAdmissionRequest,
  createAdmissionResponse,
  verifyAdmissionResponse,
} from "../writer-admission"
import type {
  PendingAdmission,
  AdmissionState,
  WriterAdmissionRequest,
  WriterAdmissionResponse,
} from "../writer-admission"
import { FederationBase } from "../federation-base"
import type { WriterAdmission } from "../protocol"
import type { PeerHandshakeResult } from "../protocol"
import { canonicalJson, sha256Hex } from "../../types"

// ── Key Helpers ---------------------------------------------------------------

interface TestKeyPair {
  seed: Uint8Array
  publicKeyHex: string
}

function generateTestKeyPair(): TestKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" })
  const seed = pkcs8.subarray(-32)
  const spki = publicKey.export({ format: "der", type: "spki" })
  const rawPub = spki.subarray(-32)
  return { seed, publicKeyHex: Buffer.from(rawPub).toString("hex") }
}

// ── Test Fixtures -------------------------------------------------------------

const FEDERATION_ID = "test-fed-001"
const PEER_ID = "peer-abc-123"
const IDENTITY_ID = "identity-def-456"
const WRITER_KEY = "writer-key-789"

function makeHandshakeResult(
  overrides?: Partial<PeerHandshakeResult>,
): PeerHandshakeResult {
  return {
    accepted: true,
    acceptedFederations: [FEDERATION_ID],
    limits: {
      maxPeersPerFederation: 8,
      maxGlobalPeers: 24,
      maxInboundStreams: 16,
      maxOutboundStreams: 16,
      maxHandshakeDurationMs: 10_000,
      maxEventBlockBytes: 262144,
      maxEventsPerMinute: 120,
    },
    peerId: PEER_ID,
    serverTime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function makePendingAdmission(
  overrides?: Partial<PendingAdmission>,
): PendingAdmission {
  return {
    peerId: PEER_ID,
    identityId: IDENTITY_ID,
    handshakeResult: makeHandshakeResult(),
    writerKey: WRITER_KEY,
    state: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    admittedAt: null,
    ...overrides,
  }
}

// ── Mock FederationBase -------------------------------------------------------

/** Minimal FakeFederationBase that stub-admits writers into an in-memory map. */
class FakeFederationBase {
  private _federationId: string
  private _autobaseKey: string
  opened: boolean
  writers: Map<string, WriterAdmission> = new Map()

  constructor(
    federationId: string,
    autobaseKey: string,
    opened: boolean = true,
  ) {
    this._federationId = federationId
    this._autobaseKey = autobaseKey
    this.opened = opened
  }

  async admitWriter(writerKey: string): Promise<WriterAdmission> {
    if (!this.opened) {
      throw new Error("Autobase is not open")
    }
    const admittedAt = new Date().toISOString()
    const admissionSigPayload = canonicalJson({
      federationId: this._federationId,
      writerCorePublicKey: writerKey,
      admittedAt,
    })
    const admission: WriterAdmission = {
      federationId: this._federationId,
      writerCorePublicKey: writerKey,
      dharmaIdentityPublicKey: writerKey,
      membershipEventId: `direct:${this._federationId}:${writerKey}:${admittedAt}`,
      admittedBy: this._autobaseKey,
      admittedAt,
      admissionSignature: sha256Hex(admissionSigPayload),
    }
    this.writers.set(writerKey, admission)
    return admission
  }

  getFederationId(): string {
    return this._federationId
  }
}

// ── Tests ---------------------------------------------------------------------

// ── createPendingAdmission ────────────────────────────────────────────────────

describe("createPendingAdmission", () => {
  test("creates a pending admission with all fields", () => {
    const handshake = makeHandshakeResult()
    const admission = createPendingAdmission(PEER_ID, IDENTITY_ID, handshake, WRITER_KEY)

    expect(admission.peerId).toBe(PEER_ID)
    expect(admission.identityId).toBe(IDENTITY_ID)
    expect(admission.handshakeResult).toBe(handshake)
    expect(admission.writerKey).toBe(WRITER_KEY)
    expect(admission.state).toBe("pending")
    expect(admission.admittedAt).toBeNull()
    expect(typeof admission.createdAt).toBe("string")
    expect(admission.createdAt.length).toBeGreaterThan(0)
  })

  test("handshake result is stored by reference", () => {
    const handshake = makeHandshakeResult({ accepted: true })
    const admission = createPendingAdmission(PEER_ID, IDENTITY_ID, handshake, WRITER_KEY)
    // Mutating the original must not affect the stored reference or vice versa
    expect(admission.handshakeResult.accepted).toBe(true)
  })

  test("generates an ISO string createdAt", () => {
    const admission = createPendingAdmission(
      PEER_ID,
      IDENTITY_ID,
      makeHandshakeResult(),
      WRITER_KEY,
    )
    // Should parse as valid ISO date
    const parsed = new Date(admission.createdAt)
    expect(parsed.getTime()).not.toBeNaN()
  })
})

// ── admitWriter ───────────────────────────────────────────────────────────────

describe("admitWriter", () => {
  test("transitions pending → admitted", async () => {
    const base = new FakeFederationBase(FEDERATION_ID, "local-key")
    const admission = makePendingAdmission()

    const result = await admitWriter(admission, base as unknown as FederationBase)

    expect(result.admission.state).toBe("admitted")
    expect(result.admission.admittedAt).not.toBeNull()
    expect(result.writerAdmission.writerCorePublicKey).toBe(WRITER_KEY)
    expect(result.writerAdmission.federationId).toBe(FEDERATION_ID)
  })

  test("sets admittedAt to a valid ISO timestamp", async () => {
    const base = new FakeFederationBase(FEDERATION_ID, "local-key")
    const admission = makePendingAdmission()

    const result = await admitWriter(admission, base as unknown as FederationBase)

    const parsed = new Date(result.admission.admittedAt!)
    expect(parsed.getTime()).not.toBeNaN()
  })

  test("returns WriterAdmission with correct writerKey", async () => {
    const base = new FakeFederationBase(FEDERATION_ID, "local-key")
    const admission = makePendingAdmission()

    const result = await admitWriter(admission, base as unknown as FederationBase)

    expect(result.writerAdmission.writerCorePublicKey).toBe(WRITER_KEY)
    expect(result.writerAdmission.admissionSignature).toBeDefined()
    expect(result.writerAdmission.admissionSignature.length).toBeGreaterThan(0)
  })

  test("persists WriterAdmission in the base's writers map", async () => {
    const base = new FakeFederationBase(FEDERATION_ID, "local-key")
    const admission = makePendingAdmission()

    await admitWriter(admission, base as unknown as FederationBase)

    const stored = base.writers.get(WRITER_KEY)
    expect(stored).toBeDefined()
    expect(stored!.writerCorePublicKey).toBe(WRITER_KEY)
  })

  test("throws if admission is already in admitted state", async () => {
    const base = new FakeFederationBase(FEDERATION_ID, "local-key")
    const admission = makePendingAdmission({ state: "admitted" })

    await expect(
      admitWriter(admission, base as unknown as FederationBase),
    ).rejects.toThrow(/Cannot admit writer in state "admitted"/)
  })

  test("throws if admission is rejected (not pending)", async () => {
    const base = new FakeFederationBase(FEDERATION_ID, "local-key")
    const admission = makePendingAdmission({ state: "rejected" })

    await expect(
      admitWriter(admission, base as unknown as FederationBase),
    ).rejects.toThrow(/Cannot admit writer in state "rejected"/)
  })

  test("does not mutate the original admission object", async () => {
    const base = new FakeFederationBase(FEDERATION_ID, "local-key")
    const admission = makePendingAdmission()

    const result = await admitWriter(admission, base as unknown as FederationBase)

    expect(admission.state).toBe("pending")
    expect(result.admission.state).toBe("admitted")
    // Original should be unchanged
    expect(admission.admittedAt).toBeNull()
  })

  test("throws if FederationBase is not open", async () => {
    const base = new FakeFederationBase(FEDERATION_ID, "local-key", false)
    const admission = makePendingAdmission()

    await expect(
      admitWriter(admission, base as unknown as FederationBase),
    ).rejects.toThrow("Autobase is not open")
  })
})

// ── rejectWriter ─────────────────────────────────────────────────────────────

describe("rejectWriter", () => {
  test("transitions pending → rejected", () => {
    const admission = makePendingAdmission()
    const result = rejectWriter(admission)
    expect(result.state).toBe("rejected")
  })

  test("throws if already revoked", () => {
    const admission = makePendingAdmission({ state: "revoked" })
    expect(() => rejectWriter(admission)).toThrow(
      /Cannot reject writer in state "revoked"/,
    )
  })

  test("can reject an already admitted writer", () => {
    const admission = makePendingAdmission({
      state: "admitted",
      admittedAt: "2026-01-01T00:00:00.000Z",
    })
    const result = rejectWriter(admission)
    expect(result.state).toBe("rejected")
  })

  test("preserves all other fields when rejecting", () => {
    const admission = makePendingAdmission()
    const result = rejectWriter(admission)

    expect(result.peerId).toBe(PEER_ID)
    expect(result.identityId).toBe(IDENTITY_ID)
    expect(result.writerKey).toBe(WRITER_KEY)
    expect(result.createdAt).toBe(admission.createdAt)
    expect(result.admittedAt).toBeNull()
  })

  test("does not mutate the original object", () => {
    const admission = makePendingAdmission()
    rejectWriter(admission)
    expect(admission.state).toBe("pending")
  })
})

// ── revokeWriter ─────────────────────────────────────────────────────────────

describe("revokeWriter", () => {
  test("transitions admitted → revoked", () => {
    const admission = makePendingAdmission({
      state: "admitted",
      admittedAt: "2026-01-01T00:00:00.000Z",
    })
    const result = revokeWriter(admission)
    expect(result.state).toBe("revoked")
  })

  test("throws if state is pending", () => {
    const admission = makePendingAdmission()
    expect(() => revokeWriter(admission)).toThrow(
      /Cannot revoke writer in state "pending"/,
    )
  })

  test("throws if state is rejected", () => {
    const admission = makePendingAdmission({ state: "rejected" })
    expect(() => revokeWriter(admission)).toThrow(
      /Cannot revoke writer in state "rejected"/,
    )
  })

  test("preserves admittedAt when revoking", () => {
    const admittedAt = "2026-06-15T12:00:00.000Z"
    const admission = makePendingAdmission({
      state: "admitted",
      admittedAt,
    })
    const result = revokeWriter(admission)
    expect(result.admittedAt).toBe(admittedAt)
  })

  test("preserves other fields when revoking", () => {
    const admission = makePendingAdmission({
      state: "admitted",
      admittedAt: "2026-01-01T00:00:00.000Z",
    })
    const result = revokeWriter(admission)
    expect(result.peerId).toBe(PEER_ID)
    expect(result.identityId).toBe(IDENTITY_ID)
    expect(result.writerKey).toBe(WRITER_KEY)
  })
})

// ── isWriterAdmitted ─────────────────────────────────────────────────────────

describe("isWriterAdmitted", () => {
  test("returns true for admitted state", () => {
    const admission = makePendingAdmission({ state: "admitted" })
    expect(isWriterAdmitted(admission)).toBe(true)
  })

  test("returns false for pending state", () => {
    const admission = makePendingAdmission({ state: "pending" })
    expect(isWriterAdmitted(admission)).toBe(false)
  })

  test("returns false for rejected state", () => {
    const admission = makePendingAdmission({ state: "rejected" })
    expect(isWriterAdmitted(admission)).toBe(false)
  })

  test("returns false for revoked state", () => {
    const admission = makePendingAdmission({ state: "revoked" })
    expect(isWriterAdmitted(admission)).toBe(false)
  })
})

// ── Full state machine lifecycle ─────────────────────────────────────────────

describe("full admission lifecycle", () => {
  test("pending → admit → revoke sequence", async () => {
    const base = new FakeFederationBase(FEDERATION_ID, "local-key")
    const handshake = makeHandshakeResult()
    const pending = createPendingAdmission(PEER_ID, IDENTITY_ID, handshake, WRITER_KEY)

    expect(pending.state).toBe("pending")
    expect(isWriterAdmitted(pending)).toBe(false)

    const { admission: admitted } = await admitWriter(
      pending,
      base as unknown as FederationBase,
    )
    expect(admitted.state).toBe("admitted")
    expect(isWriterAdmitted(admitted)).toBe(true)

    const revoked = revokeWriter(admitted)
    expect(revoked.state).toBe("revoked")
    expect(isWriterAdmitted(revoked)).toBe(false)
  })

  test("pending → reject (never admitted)", () => {
    const pending = makePendingAdmission()

    const rejected = rejectWriter(pending)
    expect(rejected.state).toBe("rejected")
    expect(isWriterAdmitted(rejected)).toBe(false)

    // Rejected cannot be revoked
    expect(() => revokeWriter(rejected)).toThrow()
  })

  test("cannot admit after rejection", async () => {
    const base = new FakeFederationBase(FEDERATION_ID, "local-key")
    const pending = makePendingAdmission()

    const rejected = rejectWriter(pending)
    await expect(
      admitWriter(rejected, base as unknown as FederationBase),
    ).rejects.toThrow(/Cannot admit writer in state "rejected"/)
  })

  test("cannot admit after revocation", async () => {
    const base = new FakeFederationBase(FEDERATION_ID, "local-key")
    const pending = makePendingAdmission()

    const { admission: admitted } = await admitWriter(
      pending,
      base as unknown as FederationBase,
    )
    const revoked = revokeWriter(admitted)
    await expect(
      admitWriter(revoked, base as unknown as FederationBase),
    ).rejects.toThrow(/Cannot admit writer in state "revoked"/)
  })
})

// ── WriterAdmissionRequest ───────────────────────────────────────────────────

describe("createAdmissionRequest", () => {
  test("produces a request with all required fields", () => {
    const keys = generateTestKeyPair()
    const request = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      keys.publicKeyHex,
      WRITER_KEY,
      keys.seed,
    )

    expect(request.federationId).toBe(FEDERATION_ID)
    expect(request.peerId).toBe(PEER_ID)
    expect(request.identityId).toBe(keys.publicKeyHex)
    expect(request.writerPublicKey).toBe(WRITER_KEY)
    expect(request.signature).toBeDefined()
    expect(typeof request.signature).toBe("string")
    expect(request.signature.length).toBeGreaterThan(0)
    expect(request.timestamp).toBeDefined()
  })

  test("generates a valid hex signature", () => {
    const keys = generateTestKeyPair()
    const request = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      keys.publicKeyHex,
      WRITER_KEY,
      keys.seed,
    )

    // Signature should be hex-encoded (64 bytes = 128 hex chars for ed25519)
    expect(/^[0-9a-f]+$/i.test(request.signature)).toBe(true)
  })

  test("different keys produce different signatures", () => {
    const keysA = generateTestKeyPair()
    const keysB = generateTestKeyPair()
    const reqA = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      keysA.publicKeyHex,
      WRITER_KEY,
      keysA.seed,
    )
    const reqB = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      keysA.publicKeyHex,
      WRITER_KEY,
      keysB.seed,
    )

    expect(reqA.signature).not.toBe(reqB.signature)
  })
})

// ── verifyAdmissionRequest ───────────────────────────────────────────────────

describe("verifyAdmissionRequest", () => {
  test("returns true for a validly signed request", () => {
    const keys = generateTestKeyPair()
    const request = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      keys.publicKeyHex,
      WRITER_KEY,
      keys.seed,
    )

    expect(verifyAdmissionRequest(request)).toBe(true)
  })

  test("returns false when signature does not match", () => {
    const keys = generateTestKeyPair()
    const request = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      keys.publicKeyHex,
      WRITER_KEY,
      keys.seed,
    )

    // Tamper with the signature
    const tampered: WriterAdmissionRequest = {
      ...request,
      signature: "deadbeef" + request.signature.slice(8),
    }
    expect(verifyAdmissionRequest(tampered)).toBe(false)
  })

  test("returns false when identityId does not match signer", () => {
    const signerKeys = generateTestKeyPair()
    const otherKeys = generateTestKeyPair()
    const request = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      otherKeys.publicKeyHex, // claims to be otherKeys but signed with signerKeys
      WRITER_KEY,
      signerKeys.seed,
    )

    expect(verifyAdmissionRequest(request)).toBe(false)
  })

  test("returns false for empty signature", () => {
    const keys = generateTestKeyPair()
    const request = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      keys.publicKeyHex,
      WRITER_KEY,
      keys.seed,
    )

    const tampered: WriterAdmissionRequest = {
      ...request,
      signature: "",
    }
    expect(verifyAdmissionRequest(tampered)).toBe(false)
  })

  test("returns false when payload fields are tampered", () => {
    const keys = generateTestKeyPair()
    const request = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      keys.publicKeyHex,
      WRITER_KEY,
      keys.seed,
    )

    // Tamper with the writerPublicKey after signing
    const tampered: WriterAdmissionRequest = {
      ...request,
      writerPublicKey: "different-writer-key",
    }
    expect(verifyAdmissionRequest(tampered)).toBe(false)
  })
})

// ── WriterAdmissionResponse ──────────────────────────────────────────────────

describe("createAdmissionResponse", () => {
  const responderKeys = generateTestKeyPair()

  test("produces accepted response with admission data", () => {
    const request = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      generateTestKeyPair().publicKeyHex,
      WRITER_KEY,
      generateTestKeyPair().seed,
    )

    const admissionData: WriterAdmission = {
      federationId: FEDERATION_ID,
      writerCorePublicKey: WRITER_KEY,
      dharmaIdentityPublicKey: IDENTITY_ID,
      membershipEventId: "evt-001",
      admittedBy: "authority-key",
      admittedAt: "2026-01-01T00:00:00.000Z",
      admissionSignature: "sig-123",
    }

    const response = createAdmissionResponse(
      request,
      true,
      responderKeys.seed,
      admissionData,
    )

    expect(response.federationId).toBe(FEDERATION_ID)
    expect(response.peerId).toBe(PEER_ID)
    expect(response.admitted).toBe(true)
    expect(response.writerAdmission).toEqual(admissionData)
    expect(response.rejectionReason).toBeNull()
    expect(response.signature).toBeDefined()
  })

  test("produces rejected response with rejection reason", () => {
    const request = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      generateTestKeyPair().publicKeyHex,
      WRITER_KEY,
      generateTestKeyPair().seed,
    )

    const response = createAdmissionResponse(
      request,
      false,
      responderKeys.seed,
      undefined,
      "Writer key already registered",
    )

    expect(response.admitted).toBe(false)
    expect(response.writerAdmission).toBeNull()
    expect(response.rejectionReason).toBe("Writer key already registered")
  })

  test("produces rejected response without explicit reason", () => {
    const request = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      generateTestKeyPair().publicKeyHex,
      WRITER_KEY,
      generateTestKeyPair().seed,
    )

    const response = createAdmissionResponse(request, false, responderKeys.seed)

    expect(response.admitted).toBe(false)
    expect(response.writerAdmission).toBeNull()
    expect(response.rejectionReason).toBeNull()
  })

  test("generates a valid hex signature", () => {
    const request = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      generateTestKeyPair().publicKeyHex,
      WRITER_KEY,
      generateTestKeyPair().seed,
    )

    const response = createAdmissionResponse(request, true, responderKeys.seed, {
      federationId: FEDERATION_ID,
      writerCorePublicKey: WRITER_KEY,
      dharmaIdentityPublicKey: IDENTITY_ID,
      membershipEventId: "evt-001",
      admittedBy: "authority-key",
      admittedAt: "2026-01-01T00:00:00.000Z",
      admissionSignature: "sig-123",
    })

    expect(/^[0-9a-f]+$/i.test(response.signature)).toBe(true)
  })
})

// ── verifyAdmissionResponse ──────────────────────────────────────────────────

describe("verifyAdmissionResponse", () => {
  test("returns true for a response with a non-empty signature", () => {
    const responderKeys = generateTestKeyPair()
    const requesterKeys = generateTestKeyPair()

    const request = createAdmissionRequest(
      FEDERATION_ID,
      PEER_ID,
      requesterKeys.publicKeyHex,
      WRITER_KEY,
      requesterKeys.seed,
    )

    const response = createAdmissionResponse(request, true, responderKeys.seed, {
      federationId: FEDERATION_ID,
      writerCorePublicKey: WRITER_KEY,
      dharmaIdentityPublicKey: IDENTITY_ID,
      membershipEventId: "evt-001",
      admittedBy: "authority-key",
      admittedAt: "2026-01-01T00:00:00.000Z",
      admissionSignature: "sig-123",
    })

    expect(verifyAdmissionResponse(response)).toBe(true)
  })

  test("returns false when signature field is empty", () => {
    const response: WriterAdmissionResponse = {
      federationId: FEDERATION_ID,
      peerId: PEER_ID,
      admitted: false,
      writerAdmission: null,
      rejectionReason: "Denied",
      signature: "",
      timestamp: "2026-01-01T00:00:00.000Z",
    }

    expect(verifyAdmissionResponse(response)).toBe(false)
  })

  test("returns false when signature is missing (empty string)", () => {
    const response: WriterAdmissionResponse = {
      federationId: FEDERATION_ID,
      peerId: PEER_ID,
      admitted: true,
      writerAdmission: null,
      rejectionReason: null,
      signature: "",
      timestamp: "2026-01-01T00:00:00.000Z",
    }

    expect(verifyAdmissionResponse(response)).toBe(false)
  })
})
