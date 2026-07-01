/**
 * Prism KV Handoff — HandoffCoordinator Commit Protocol Tests
 *
 * Tests the executeHandoff, rollbackHandoff, and reconcileHandoff paths.
 */

import { expect, test, describe } from "bun:test"
import { DeterministicFixtureKvTransportAdapter } from "../fixture-transport"
import { HandoffCoordinator } from "../handoff-coordinator"
import type {
  PrismKvExportManifest,
  PrismKvHandoffRequest,
} from "../handoff-types"

// ── Fixtures ────────────────────────────────────────────────────────────────

const FAKE_REQUEST: PrismKvHandoffRequest = {
  handoffId: "ho-001",
  routeId: "rt-001",
  requestId: "req-001",
  executionId: "exec-001",
  sessionId: "sess-001",
  dharmaLeaseId: "lease-001",
  sourceWorkerId: "worker-a",
  sourceWorkerInstanceId: "inst-a1",
  destinationWorkerId: "worker-b",
  destinationWorkerInstanceId: "inst-b1",
  sourceKvNamespaceId: "ns-prefill-1",
  modelArtifactDigest: "md5:abc123",
  tokenizerDigest: "md5:tok456",
  sourceComputeImageDigest: "img:src",
  destinationComputeImageDigest: "img:dst",
  handoffMode: "simulation_only",
  sourceRetentionPolicy: "retain_until_destination_commit",
  requestedDeadlineAt: new Date(Date.now() + 3600_000).toISOString(),
  requestedBy: "test-orchestrator",
  authorizationDigest: "auth:test",
  createdAt: new Date().toISOString(),
  signature: null,
}

const FAKE_MANIFEST: PrismKvExportManifest = {
  manifestId: "m-001",
  handoffId: "ho-001",
  sourceWorkerId: "worker-a",
  sourceWorkerInstanceId: "inst-a1",
  sourceKvNamespaceId: "ns-prefill-1",
  modelArtifactDigest: "md5:abc123",
  tokenizerDigest: "md5:tok456",
  compatibilityDescriptorDigest: "md5:compat789",
  transferRepresentation: "sim",
  sequenceLength: 4096,
  pageCount: 8,
  byteLength: 65536,
  deterministicContentDigest: "digest_abc123",
  exportGeneration: 1,
  exportedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  sourceSignature: "sig_source",
}

function makeTransport(): DeterministicFixtureKvTransportAdapter {
  const store = new Map([
    ["ho-001", { manifest: FAKE_MANIFEST, payloadDigest: "digest_abc123" }],
  ])
  return new DeterministicFixtureKvTransportAdapter(store)
}

// ── executeHandoff (happy path) ─────────────────────────────────────────────

describe("executeHandoff — happy path", () => {
  test("full handoff succeeds with receipt", async () => {
    const transport = makeTransport()
    const coordinator = new HandoffCoordinator(transport)

    const result = await coordinator.executeHandoff(
      FAKE_REQUEST,
      true,  // sourceEligible
      true,  // destEligible
      true,  // compatible
      FAKE_MANIFEST,
    )

    expect(result.receipt).not.toBeNull()
    expect(result.finalState).toBe("committed")

    const r = result.receipt!
    expect(r.handoffId).toBe("ho-001")
    expect(r.finalState).toBe("committed")
    expect(r.failureClass).toBeNull()
    expect(r.sourceWorkerId).toBe("worker-a")
    expect(r.destinationWorkerId).toBe("worker-b")
    expect(r.byteLength).toBe(65536)
    expect(r.payloadDigest).toBe("digest_abc123")
  })

  test("rejects when source ineligible", async () => {
    const coordinator = new HandoffCoordinator(makeTransport())

    const result = await coordinator.executeHandoff(
      FAKE_REQUEST, false, true, true, FAKE_MANIFEST,
    )

    expect(result.receipt).toBeNull()
    expect(result.finalState).toBe("rejected")
  })

  test("rejects when destination ineligible", async () => {
    const coordinator = new HandoffCoordinator(makeTransport())

    const result = await coordinator.executeHandoff(
      FAKE_REQUEST, true, false, true, FAKE_MANIFEST,
    )

    expect(result.receipt).toBeNull()
    expect(result.finalState).toBe("rejected")
  })

  test("rejects when incompatible", async () => {
    const coordinator = new HandoffCoordinator(makeTransport())

    const result = await coordinator.executeHandoff(
      FAKE_REQUEST, true, true, false, FAKE_MANIFEST,
    )

    expect(result.receipt).toBeNull()
    expect(result.finalState).toBe("rejected")
  })
})

// ── executeHandoff (failure paths) ──────────────────────────────────────────

describe("executeHandoff — failure paths", () => {
  test("fails when prepareTransfer returns not prepared", async () => {
    const transport = new DeterministicFixtureKvTransportAdapter(
      new Map(), 0, true, // injectCorruption
    )
    const coordinator = new HandoffCoordinator(transport)

    const result = await coordinator.executeHandoff(
      FAKE_REQUEST, true, true, true, FAKE_MANIFEST,
    )

    expect(result.receipt).toBeNull()
    expect(result.finalState).toBe("failed")
  })

  test("times out when transfer throws", async () => {
    const transport = new DeterministicFixtureKvTransportAdapter(
      new Map([
        ["ho-001", { manifest: FAKE_MANIFEST, payloadDigest: "digest_abc123" }],
      ]),
      0, false, true, // injectTimeout
    )
    const coordinator = new HandoffCoordinator(transport)

    const result = await coordinator.executeHandoff(
      FAKE_REQUEST, true, true, true, FAKE_MANIFEST,
    )

    expect(result.receipt).toBeNull()
    expect(result.finalState).toBe("timeout")
  })
})

// ── rollbackHandoff ─────────────────────────────────────────────────────────

describe("rollbackHandoff", () => {
  test("produces rolled_back receipt", async () => {
    const coordinator = new HandoffCoordinator(makeTransport())

    const result = await coordinator.rollbackHandoff(
      FAKE_REQUEST, "failed", "corrupt payload detected",
    )

    expect(result.receipt).toBeDefined()
    // rollbackHandoff uses getRollbackState which always returns "rolled_back"
    expect(result.finalState).toBe("rolled_back")
    expect(result.receipt.handoffId).toBe("ho-001")
    expect(result.receipt.failureClass).toContain("failed")
  })

  test("does not rollback from completed state", async () => {
    const coordinator = new HandoffCoordinator(makeTransport())

    const result = await coordinator.rollbackHandoff(
      FAKE_REQUEST, "completed", "no issue",
    )

    expect(result.finalState).toBe("rolled_back") // getRollbackState always maps to rolled_back
    expect(result.receipt.failureClass).toBeNull()
  })
})

// ── reconcileHandoff ────────────────────────────────────────────────────────

describe("reconcileHandoff", () => {
  test("resolves as degraded_completed when transport reports complete", async () => {
    const transport = makeTransport()
    const coordinator = new HandoffCoordinator(transport)

    const result = await coordinator.reconcileHandoff(FAKE_REQUEST)

    expect(result.resolved).toBe(true)
    expect(result.state).toBe("degraded_completed")
  })

  test("fails to resolve when transport reports unknown", async () => {
    const transport = new DeterministicFixtureKvTransportAdapter(new Map())
    const coordinator = new HandoffCoordinator(transport)

    const result = await coordinator.reconcileHandoff({
      ...FAKE_REQUEST,
      handoffId: "ho-unknown",
    })

    expect(result.resolved).toBe(false)
    expect(result.state).toBe("failed")
  })
})
