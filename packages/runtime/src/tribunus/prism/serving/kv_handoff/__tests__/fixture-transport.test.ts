/**
 * Prism KV Handoff — DeterministicFixtureKvTransportAdapter Tests
 */

import { expect, test, describe } from "bun:test"
import { DeterministicFixtureKvTransportAdapter } from "../fixture-transport"
import type { PrismKvExportManifest } from "../handoff-types"

// ── Fixtures ────────────────────────────────────────────────────────────────

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

function makeStore(): Map<string, { manifest: PrismKvExportManifest; payloadDigest: string }> {
  return new Map([
    ["ho-001", { manifest: FAKE_MANIFEST, payloadDigest: "digest_abc123" }],
  ])
}

// ── prepareTransfer ─────────────────────────────────────────────────────────

describe("prepareTransfer", () => {
  test("succeeds when fixture exists", async () => {
    const store = makeStore()
    const transport = new DeterministicFixtureKvTransportAdapter(store)

    const result = await transport.prepareTransfer("ho-001", FAKE_MANIFEST)
    expect(result.prepared).toBe(true)
    expect(result.reason).toBeNull()
  })

  test("accepts unregistered handoffId and registers it", async () => {
    const store = makeStore()
    const transport = new DeterministicFixtureKvTransportAdapter(store)

    const result = await transport.prepareTransfer("ho-999", FAKE_MANIFEST)
    expect(result.prepared).toBe(true)
    expect(result.reason).toBeNull()

    // Should now be registered in the store
    const fixture = store.get("ho-999")
    expect(fixture).toBeDefined()
    expect(fixture?.manifest.manifestId).toBe("m-001")
  })

  test("rejects with corruption injection", async () => {
    const transport = new DeterministicFixtureKvTransportAdapter(
      new Map(), 0, true,
    )
    const result = await transport.prepareTransfer("ho-001", FAKE_MANIFEST)
    expect(result.prepared).toBe(false)
    expect(result.reason).toBe("simulated corruption")
  })

  test("respects injectDelayMs", async () => {
    const store = makeStore()
    const transport = new DeterministicFixtureKvTransportAdapter(store, 50)

    const start = Date.now()
    const result = await transport.prepareTransfer("ho-001", FAKE_MANIFEST)
    const elapsed = Date.now() - start

    expect(result.prepared).toBe(true)
    expect(elapsed).toBeGreaterThanOrEqual(45) // allow small scheduling variance
  })
})

// ── transfer ────────────────────────────────────────────────────────────────

describe("transfer", () => {
  test("succeeds with existing fixture", async () => {
    const store = makeStore()
    const transport = new DeterministicFixtureKvTransportAdapter(store)

    const result = await transport.transfer("ho-001")
    expect(result.transferred).toBe(true)
    expect(result.payloadDigest).toBe("digest_abc123")
    expect(result.bytes).toBe(65536)
  })

  test("returns not transferred for unknown handoffId", async () => {
    const transport = new DeterministicFixtureKvTransportAdapter(makeStore())

    const result = await transport.transfer("ho-unknown")
    expect(result.transferred).toBe(false)
    expect(result.payloadDigest).toBe("")
    expect(result.bytes).toBe(0)
  })

  test("returns corrupted digest with corruption injection", async () => {
    const store = makeStore()
    const transport = new DeterministicFixtureKvTransportAdapter(store, 0, true)

    const result = await transport.transfer("ho-001")
    expect(result.transferred).toBe(true)
    expect(result.payloadDigest).toBe("CORRUPTED_digest_abc123")
    expect(result.bytes).toBe(65536)
  })

  test("throws on timeout injection", async () => {
    const transport = new DeterministicFixtureKvTransportAdapter(
      makeStore(), 0, false, true,
    )

    expect(transport.transfer("ho-001")).rejects.toThrow("transfer timeout")
  })
})

// ── acknowledgeImport ───────────────────────────────────────────────────────

describe("acknowledgeImport", () => {
  test("always succeeds", async () => {
    const transport = new DeterministicFixtureKvTransportAdapter(makeStore())

    const result = await transport.acknowledgeImport("ho-001")
    expect(result.acknowledged).toBe(true)
  })

  test("respects delay", async () => {
    const transport = new DeterministicFixtureKvTransportAdapter(makeStore(), 30)

    const start = Date.now()
    await transport.acknowledgeImport("ho-001")
    expect(Date.now() - start).toBeGreaterThanOrEqual(25)
  })
})

// ── abortTransfer ───────────────────────────────────────────────────────────

describe("abortTransfer", () => {
  test("completes without error", async () => {
    const transport = new DeterministicFixtureKvTransportAdapter(makeStore())
    await transport.abortTransfer("ho-001")
    // no throw = success
  })
})

// ── getTransferStatus ───────────────────────────────────────────────────────

describe("getTransferStatus", () => {
  test("returns completed for known handoffId", async () => {
    const transport = new DeterministicFixtureKvTransportAdapter(makeStore())
    const status = await transport.getTransferStatus("ho-001")
    expect(status.state).toBe("completed")
    expect(status.progressBytes).toBe(65536)
  })

  test("returns unknown for unknown handoffId", async () => {
    const transport = new DeterministicFixtureKvTransportAdapter(makeStore())
    const status = await transport.getTransferStatus("ho-unknown")
    expect(status.state).toBe("unknown")
    expect(status.progressBytes).toBe(0)
  })
})
