/**
 * Tests — Two-Worker Role Routing
 *
 * Verifies that prefill_preferred and decode_preferred roles are correctly
 * selected when routing requests between two workers with different phase
 * role profiles.
 */

import { describe, it, expect } from "bun:test"
import { getDeploymentProfile, isProfileRoutable, getRoutableProfiles } from "../deployment-profiles"
import { DEPLOYMENT_PROFILES } from "../phase-role-types"

describe("deployment profiles", () => {
  it("provides unified profile", () => {
    const p = getDeploymentProfile("unified")
    expect(p).toBeDefined()
    expect(p!.roles).toContain("unified")
    expect(p!.prefillEnabled).toBe(true)
    expect(p!.decodeEnabled).toBe(true)
    expect(p!.routableForEndToEndRequests).toBe(true)
  })

  it("provides prefill_optimized_unified profile", () => {
    const p = getDeploymentProfile("prefill_optimized_unified")
    expect(p).toBeDefined()
    expect(p!.roles).toContain("prefill_preferred")
    expect(p!.roles).toContain("unified")
    expect(p!.routableForEndToEndRequests).toBe(true)
  })

  it("provides decode_optimized_unified profile", () => {
    const p = getDeploymentProfile("decode_optimized_unified")
    expect(p).toBeDefined()
    expect(p!.roles).toContain("decode_preferred")
    expect(p!.roles).toContain("unified")
    expect(p!.routableForEndToEndRequests).toBe(true)
  })

  it("provides future_prefill_only profile (not routable)", () => {
    const p = getDeploymentProfile("future_prefill_only")
    expect(p).toBeDefined()
    expect(p!.roles).toEqual(["prefill_only"])
    expect(p!.prefillEnabled).toBe(true)
    expect(p!.decodeEnabled).toBe(false)
    expect(p!.routableForEndToEndRequests).toBe(false)
  })

  it("provides future_decode_only profile (not routable)", () => {
    const p = getDeploymentProfile("future_decode_only")
    expect(p).toBeDefined()
    expect(p!.roles).toEqual(["decode_only"])
    expect(p!.prefillEnabled).toBe(false)
    expect(p!.decodeEnabled).toBe(true)
    expect(p!.routableForEndToEndRequests).toBe(false)
  })

  it("returns undefined for unknown profile", () => {
    expect(getDeploymentProfile("nonexistent")).toBeUndefined()
  })
})

describe("isProfileRoutable", () => {
  it("returns true for unified profiles", () => {
    expect(isProfileRoutable(DEPLOYMENT_PROFILES.unified)).toBe(true)
    expect(isProfileRoutable(DEPLOYMENT_PROFILES.prefill_optimized_unified)).toBe(true)
    expect(isProfileRoutable(DEPLOYMENT_PROFILES.decode_optimized_unified)).toBe(true)
  })

  it("returns false for future_* profiles", () => {
    expect(isProfileRoutable(DEPLOYMENT_PROFILES.future_prefill_only)).toBe(false)
    expect(isProfileRoutable(DEPLOYMENT_PROFILES.future_decode_only)).toBe(false)
  })
})

describe("getRoutableProfiles", () => {
  it("returns only routable profiles", () => {
    const profiles = getRoutableProfiles()
    expect(profiles).toHaveLength(3)
    const names = profiles.map((p) => p.profileName).sort()
    expect(names).toEqual([
      "decode_optimized_unified",
      "prefill_optimized_unified",
      "unified",
    ])
  })
})

describe("prefill_preferred vs decode_preferred selection", () => {
  it("prefill_preferred profile has prefillEnabled", () => {
    const pp = DEPLOYMENT_PROFILES.prefill_optimized_unified
    expect(pp.roles).toContain("prefill_preferred")
    expect(pp.prefillEnabled).toBe(true)
    expect(pp.decodeEnabled).toBe(true)
  })

  it("decode_preferred profile has decodeEnabled", () => {
    const dp = DEPLOYMENT_PROFILES.decode_optimized_unified
    expect(dp.roles).toContain("decode_preferred")
    expect(dp.decodeEnabled).toBe(true)
    expect(dp.prefillEnabled).toBe(true)
  })

  it("both preferred profiles are routable for end-to-end requests", () => {
    const profiles = [DEPLOYMENT_PROFILES.prefill_optimized_unified, DEPLOYMENT_PROFILES.decode_optimized_unified]
    for (const p of profiles) {
      expect(p.routableForEndToEndRequests).toBe(true)
    }
  })

  it("unified worker role is present in all routable profiles", () => {
    const routable = getRoutableProfiles()
    for (const p of routable) {
      expect(p.roles).toContain("unified")
    }
  })
})
