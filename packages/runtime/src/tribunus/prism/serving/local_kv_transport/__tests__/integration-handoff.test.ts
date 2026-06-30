/**
 * Tests — Integration Handoff (Coordinator Bridge End-to-End Flow)
 *
 * Simulates the full handoff flow from capability negotiation through
 * policy enforcement to backend selection.
 */

import { describe, it, expect } from "bun:test"
import type { PrismLocalHostKvTransportCapability, DharmaLocalTransportPolicy } from "../local-transport-types"
import { selectTransportBackend, canProceedWithRealTransport } from "../transport-coordinator-bridge"
import { isRealTransportPermitted, isHandoffWithinPolicy, createPermissiveLocalTransportPolicy } from "../dharma-local-transport-policy"
import { createLocalTransportReceipt } from "../transport-receipts"

function makeCapability(overrides: Partial<PrismLocalHostKvTransportCapability> = {}): PrismLocalHostKvTransportCapability {
  return {
    backendKind: "linux_unix_socket_shared_memory",
    supported: true,
    protocolVersion: 1,
    maximumSegmentBytes: 256 * 1024 * 1024,
    maximumConcurrentSegments: 16,
    supportedTransferRepresentations: ["raw"],
    supportsReadOnlyDestinationMapping: true,
    supportsFdPassing: true,
    supportsIntegrityTrailer: true,
    supportsCancellation: true,
    supportsOrphanRecovery: true,
    platformCapabilityDigest: "digest-v1",
    ...overrides,
  }
}

describe("integration: policy → backend selection", () => {
  it("permissive policy + matching caps → selects linux real backend", () => {
    const policy = createPermissiveLocalTransportPolicy()

    // Policy check
    expect(isRealTransportPermitted(policy)).toBe(true)

    // Budget check
    const withinBudget = isHandoffWithinPolicy(policy, 64 * 1024, 30_000, 2)
    expect(withinBudget.allowed).toBe(true)

    // Backend selection
    const cap = makeCapability()
    const sel = selectTransportBackend(cap, cap, true)
    expect(sel.backend).toBe("linux_unix_socket_shared_memory")
    expect(sel.reason).toBeNull()

    // Proceed check
    expect(canProceedWithRealTransport(true, true, true, true)).toBe(true)
  })

  it("permissive policy + dest unsupported → falls back", () => {
    const policy = createPermissiveLocalTransportPolicy()
    expect(isRealTransportPermitted(policy)).toBe(true)

    const capSource = makeCapability()
    const capDest = makeCapability({ supported: false })

    const sel = selectTransportBackend(capSource, capDest, true)
    expect(sel.backend).toBeNull()
    expect(sel.reason).toContain("does not support")
  })

  it("permissive policy + mismatched backend kind → no selection", () => {
    const capSource = makeCapability({ backendKind: "linux_unix_socket_shared_memory" })
    const capDest = makeCapability({ backendKind: "test_fixture_transport" })

    const sel = selectTransportBackend(capSource, capDest, true)
    expect(sel.backend).toBeNull()
    expect(sel.reason).toContain("do not match")
  })

  it("permissive policy + lease disallows → no real transport", () => {
    const cap = makeCapability()
    const sel = selectTransportBackend(cap, cap, false)
    expect(sel.backend).toBeNull()
    expect(sel.reason).toContain("lease")
  })

  it("canProceedWithRealTransport requires all four flags", () => {
    // Only when sourceCap, destCap, sameHost, and leaseAllows are all true
    const cases: [boolean, boolean, boolean, boolean, boolean][] = [
      [true,  true,  true,  true,  true],
      [true,  true,  true,  false, false],
      [true,  true,  false, true,  false],
      [true,  false, true,  true,  false],
      [false, true,  true,  true,  false],
      [false, false, true,  true,  false],
    ]
    for (const [src, dst, host, lease, expected] of cases) {
      expect(canProceedWithRealTransport(src, dst, host, lease)).toBe(expected)
    }
  })
})

describe("integration: receipt after handoff flow", () => {
  it("creates a receipt with transport metadata", () => {
    const receipt = createLocalTransportReceipt(
      { requestId: "req-1", handoffId: "ho-1" },
      "active",
      "linux_unix_socket_shared_memory",
    )
    expect(receipt.requestId).toBe("req-1")
    expect(receipt.localTransportState).toBe("active")
    expect(receipt.localTransportBackend).toBe("linux_unix_socket_shared_memory")
    expect(typeof receipt.localTransportReceiptCreatedAt).toBe("string")
  })
})
