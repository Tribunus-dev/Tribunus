/**
 * Prism Local-Host KV Transport — Capability Tests
 */

import { describe, it, expect } from "bun:test"
import {
  createLinuxCapability,
  createMacOSUnsupportedCapability,
  isBackendSupported,
  checkSameHostAuthority,
  areCapabilitiesCompatible,
  getPlatformFamily,
} from "../local-transport-capability"
import type { LocalHostAuthorityDomain } from "../local-transport-types"

// ── createLinuxCapability ───────────────────────────────────────────────────

describe("createLinuxCapability", () => {
  it("creates a supported Linux capability with the given params", () => {
    const cap = createLinuxCapability(64 * 1024 * 1024, 4, ["fp32", "fp16"])
    expect(cap.backendKind).toBe("linux_unix_socket_shared_memory")
    expect(cap.supported).toBe(true)
    expect(cap.protocolVersion).toBe(1)
    expect(cap.maximumSegmentBytes).toBe(64 * 1024 * 1024)
    expect(cap.maximumConcurrentSegments).toBe(4)
    expect(cap.supportedTransferRepresentations).toEqual(["fp32", "fp16"])
    expect(cap.supportsFdPassing).toBe(true)
    expect(cap.supportsOrphanRecovery).toBe(true)
  })

  it("produces a stable platformCapabilityDigest", () => {
    const a = createLinuxCapability(1024, 2, ["rep1"])
    const b = createLinuxCapability(1024, 2, ["rep1"])
    expect(a.platformCapabilityDigest).toBe(b.platformCapabilityDigest)
  })

  it("produces distinct digests for differing params", () => {
    const a = createLinuxCapability(1024, 2, ["rep1"])
    const b = createLinuxCapability(2048, 2, ["rep1"])
    expect(a.platformCapabilityDigest).not.toBe(b.platformCapabilityDigest)
  })
})

// ── createMacOSUnsupportedCapability ────────────────────────────────────────

describe("createMacOSUnsupportedCapability", () => {
  it("creates an unsupported macOS capability", () => {
    const cap = createMacOSUnsupportedCapability()
    expect(cap.backendKind).toBe("macos_future_transport")
    expect(cap.supported).toBe(false)
    expect(cap.maximumSegmentBytes).toBe(0)
    expect(cap.maximumConcurrentSegments).toBe(0)
    expect(cap.supportedTransferRepresentations).toEqual([])
  })
})

// ── isBackendSupported ──────────────────────────────────────────────────────

describe("isBackendSupported", () => {
  it("returns true for Linux backend", () => {
    const cap = createLinuxCapability(1024, 1, [])
    expect(isBackendSupported(cap)).toBe(true)
  })

  it("returns false for macOS backend", () => {
    const cap = createMacOSUnsupportedCapability()
    expect(isBackendSupported(cap)).toBe(false)
  })

  it("returns false for a Linux capability marked unsupported", () => {
    const cap = createLinuxCapability(1024, 1, [])
    cap.supported = false
    expect(isBackendSupported(cap)).toBe(false)
  })
})

// ── checkSameHostAuthority ──────────────────────────────────────────────────

describe("checkSameHostAuthority", () => {
  const baseDomain: LocalHostAuthorityDomain = {
    hostInstanceId: "host-a",
    operatingSystemFamily: "linux",
    localTransportBackend: "linux_unix_socket_shared_memory",
    runtimeUserScope: "tribunus-1",
    transportNamespaceDigest: "ns:abc123",
  }

  it("returns sameHost=true when all fields match", () => {
    const result = checkSameHostAuthority(baseDomain, { ...baseDomain })
    expect(result.sameHost).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("returns sameHost=false when hostInstanceId differs", () => {
    const dest = { ...baseDomain, hostInstanceId: "host-b" }
    const result = checkSameHostAuthority(baseDomain, dest)
    expect(result.sameHost).toBe(false)
    expect(result.reason).toContain("Host instance mismatch")
  })

  it("returns sameHost=false when runtimeUserScope differs", () => {
    const dest = { ...baseDomain, runtimeUserScope: "tribunus-2" }
    const result = checkSameHostAuthority(baseDomain, dest)
    expect(result.sameHost).toBe(false)
    expect(result.reason).toContain("Runtime user scope mismatch")
  })

  it("returns sameHost=false when transportNamespaceDigest differs", () => {
    const dest = { ...baseDomain, transportNamespaceDigest: "ns:xyz789" }
    const result = checkSameHostAuthority(baseDomain, dest)
    expect(result.sameHost).toBe(false)
    expect(result.reason).toContain("Transport namespace digest mismatch")
  })
})

// ── areCapabilitiesCompatible ───────────────────────────────────────────────

describe("areCapabilitiesCompatible", () => {
  it("returns true for matching Linux capabilities", () => {
    const src = createLinuxCapability(1024, 1, ["fp32"])
    const dest = createLinuxCapability(1024, 1, ["fp32"])
    expect(areCapabilitiesCompatible(src, dest)).toBe(true)
  })

  it("returns false when backends differ", () => {
    const src = createLinuxCapability(1024, 1, ["fp32"])
    const dest = createMacOSUnsupportedCapability()
    expect(areCapabilitiesCompatible(src, dest)).toBe(false)
  })

  it("returns false when one is unsupported", () => {
    const src = createLinuxCapability(1024, 1, ["fp32"])
    const dest = createLinuxCapability(1024, 1, ["fp32"])
    dest.supported = false
    expect(areCapabilitiesCompatible(src, dest)).toBe(false)
  })

  it("returns false when protocol versions differ", () => {
    const src = createLinuxCapability(1024, 1, ["fp32"])
    const dest = createLinuxCapability(1024, 1, ["fp32"])
    dest.protocolVersion = 2
    expect(areCapabilitiesCompatible(src, dest)).toBe(false)
  })
})

// ── getPlatformFamily ───────────────────────────────────────────────────────

describe("getPlatformFamily", () => {
  it("returns a non-empty string", () => {
    const family = getPlatformFamily()
    expect(family.length).toBeGreaterThan(0)
  })
})
