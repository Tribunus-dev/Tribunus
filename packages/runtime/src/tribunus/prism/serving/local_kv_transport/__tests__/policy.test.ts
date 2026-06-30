/**
 * Tests — Local Transport Dharma Policy
 */

import { describe, it, expect } from "bun:test"
import type { DharmaLocalTransportPolicy } from "../local-transport-types"
import {
  createDefaultLocalTransportPolicy,
  createPermissiveLocalTransportPolicy,
  isRealTransportPermitted,
  isHandoffWithinPolicy,
} from "../dharma-local-transport-policy"

describe("createDefaultLocalTransportPolicy", () => {
  const policy = createDefaultLocalTransportPolicy()

  it("allows simulated handoff", () => {
    expect(policy.allowSimulatedHandoff).toBe(true)
  })

  it("denies real local-host transport", () => {
    expect(policy.allowLocalHostRealTransport).toBe(false)
  })

  it("denies future network transport", () => {
    expect(policy.allowFutureNetworkTransport).toBe(false)
  })

  it("has empty allowed backends", () => {
    expect(policy.allowedTransportBackends).toEqual([])
  })

  it("has zero budgets", () => {
    expect(policy.maximumHandoffBytes).toBe(0)
    expect(policy.maximumHandoffDurationMs).toBe(0)
    expect(policy.maximumConcurrentHandoffs).toBe(0)
  })
})

describe("createPermissiveLocalTransportPolicy", () => {
  const policy = createPermissiveLocalTransportPolicy()

  it("allows real local-host transport", () => {
    expect(policy.allowLocalHostRealTransport).toBe(true)
  })

  it("allows linux_unix_socket_shared_memory backend", () => {
    expect(policy.allowedTransportBackends).toContain("linux_unix_socket_shared_memory")
  })

  it("sets non-zero budgets", () => {
    expect(policy.maximumHandoffBytes).toBeGreaterThan(0)
    expect(policy.maximumHandoffDurationMs).toBeGreaterThan(0)
    expect(policy.maximumConcurrentHandoffs).toBeGreaterThan(0)
  })
})

describe("isRealTransportPermitted", () => {
  it("returns false for default policy", () => {
    expect(isRealTransportPermitted(createDefaultLocalTransportPolicy())).toBe(false)
  })

  it("returns true for permissive policy", () => {
    expect(isRealTransportPermitted(createPermissiveLocalTransportPolicy())).toBe(true)
  })

  it("returns false when allowedTransportBackends is empty even if flag is set", () => {
    const policy: DharmaLocalTransportPolicy = createPermissiveLocalTransportPolicy()
    policy.allowedTransportBackends = []
    expect(isRealTransportPermitted(policy)).toBe(false)
  })
})

describe("isHandoffWithinPolicy", () => {
  it("allows a handoff within budgets", () => {
    const policy = createPermissiveLocalTransportPolicy()
    const result = isHandoffWithinPolicy(policy, 1024, 5_000, 1)
    expect(result).toEqual({ allowed: true, reason: null })
  })

  it("denies when bytes exceed maximum", () => {
    const policy = createPermissiveLocalTransportPolicy()
    const result = isHandoffWithinPolicy(policy, 999_999_999_999, 5_000, 1)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("exceed")
  })

  it("denies when duration exceeds maximum", () => {
    const policy = createPermissiveLocalTransportPolicy()
    const result = isHandoffWithinPolicy(policy, 1024, 999_999_999, 1)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("duration")
  })

  it("denies when concurrent exceeds maximum", () => {
    const policy = createPermissiveLocalTransportPolicy()
    const result = isHandoffWithinPolicy(policy, 1024, 5_000, 999)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("concurrent")
  })

  it("denies everything under default policy (zero budgets)", () => {
    const policy = createDefaultLocalTransportPolicy()
    expect(isHandoffWithinPolicy(policy, 1, 1, 1).allowed).toBe(false)
    expect(isHandoffWithinPolicy(policy, 0, 0, 0).allowed).toBe(true) // exactly at zero budget
  })
})
