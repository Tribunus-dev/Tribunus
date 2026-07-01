import { describe, it, expect } from "bun:test"
import {
  createPhaseCapability,
  createCompatibilityEnvelopeV2,
  isWorkerEligibleForRequest,
  isRoleRoutableForEndToEnd,
  canWorkerServeEndToEnd,
} from "../phase-capability"
import { isPrefillBudgetSufficient, getPromptLengthBand } from "../prefill-profile"
import { isDecodeBudgetSufficient, getGenerationLengthBand } from "../decode-profile"
import type { PrismPhaseCapability, PrismWorkerRole, PhaseCoLocationPolicy } from "../phase-role-types"

// ── Fixtures ────────────────────────────────────────────────────────────────

function enabledCap(overrides?: Partial<PrismPhaseCapability>): PrismPhaseCapability {
  return {
    ...createPhaseCapability(true, true, 4, 8_192, 4_294_967_296),
    ...overrides,
  }
}

function disabledCap(): PrismPhaseCapability {
  return createPhaseCapability(true, false, 0, 0, 0)
}

function unsupportedCap(): PrismPhaseCapability {
  return createPhaseCapability(false, false, 0, 0, 0)
}

// ── createPhaseCapability ───────────────────────────────────────────────────

describe("createPhaseCapability", () => {
  it("produces a capability with the given core values", () => {
    const cap = createPhaseCapability(true, true, 8, 16_384, 8_589_934_592)

    expect(cap.supported).toBe(true)
    expect(cap.enabled).toBe(true)
    expect(cap.maximumConcurrentOperations).toBe(8)
    expect(cap.maximumInputTokens).toBe(16_384)
    expect(cap.maximumMemoryBytes).toBe(8_589_934_592)
  })

  it("sets admissionState to open when enabled", () => {
    const cap = createPhaseCapability(true, true, 1, 1, 1)
    expect(cap.admissionState).toBe("open")
  })

  it("sets admissionState to closed when not enabled", () => {
    const cap = createPhaseCapability(true, false, 1, 1, 1)
    expect(cap.admissionState).toBe("closed")
  })

  it("sets maximumOutputTokens to null", () => {
    const cap = createPhaseCapability(true, true, 1, 1, 1)
    expect(cap.maximumOutputTokens).toBeNull()
  })

  it("sets a default maximumRuntimeMs of 300_000", () => {
    const cap = createPhaseCapability(true, true, 1, 1, 1)
    expect(cap.maximumRuntimeMs).toBe(300_000)
  })
})

// ── createCompatibilityEnvelopeV2 ───────────────────────────────────────────

describe("createCompatibilityEnvelopeV2", () => {
  const prefillCap = enabledCap()
  const decodeCap = enabledCap({ maximumOutputTokens: 4_096 })
  const roles: PrismWorkerRole[] = ["unified"]
  const coLocation: PhaseCoLocationPolicy = "same_worker_required"

  it("creates a valid envelope with the given identifiers", () => {
    const env = createCompatibilityEnvelopeV2(
      "worker-abc",
      "inst-001",
      roles,
      prefillCap,
      decodeCap,
      coLocation,
    )

    expect(env.workerId).toBe("worker-abc")
    expect(env.workerInstanceId).toBe("inst-001")
    expect(env.workerRoles).toEqual(["unified"])
    expect(env.phaseCoLocationPolicy).toBe("same_worker_required")
  })

  it("copies prefillCapability and decodeCapability", () => {
    const env = createCompatibilityEnvelopeV2(
      "w", "i", roles, prefillCap, decodeCap, coLocation,
    )

    expect(env.prefillCapability).toBe(prefillCap)
    expect(env.decodeCapability).toBe(decodeCap)
  })

  it("derives maximumContextLength from prefill cap", () => {
    const narrowCap = enabledCap({ maximumInputTokens: 1_024 })
    const env = createCompatibilityEnvelopeV2(
      "w", "i", roles, narrowCap, decodeCap, coLocation,
    )

    expect(env.maximumContextLength).toBe(1_024)
  })

  it("derives capacity counters from enabled caps", () => {
    const env = createCompatibilityEnvelopeV2(
      "w", "i", roles, enabledCap(), enabledCap({ maximumOutputTokens: 4_096 }), coLocation,
    )

    expect(env.prefillCapacity).toBe(1)
    expect(env.decodeCapacity).toBe(1)
  })

  it("sets capacity to 0 when a phase is not enabled", () => {
    const env = createCompatibilityEnvelopeV2(
      "w", "i", roles, disabledCap(), enabledCap({ maximumOutputTokens: 4_096 }), coLocation,
    )

    expect(env.prefillCapacity).toBe(0)
    expect(env.decodeCapacity).toBe(1)
  })

  it("includes prefill and decode profiles with sane shape", () => {
    const env = createCompatibilityEnvelopeV2(
      "w", "i", roles, prefillCap, decodeCap, coLocation,
    )

    expect(env.prefillProfile).toBeDefined()
    expect(env.prefillProfile.maximumContextTokens).toBeGreaterThan(0)
    expect(env.decodeProfile).toBeDefined()
    expect(env.decodeProfile.maximumOutputTokens).toBeGreaterThan(0)
  })
})

// ── isWorkerEligibleForRequest ──────────────────────────────────────────────

describe("isWorkerEligibleForRequest", () => {
  it("returns eligible when worker has both phases and request needs none", () => {
    const env = createCompatibilityEnvelopeV2(
      "w", "i", ["unified"], enabledCap(), enabledCap({ maximumOutputTokens: 4_096 }), "same_worker_required",
    )
    const result = isWorkerEligibleForRequest(env, false, false)
    expect(result.eligible).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("returns eligible when unified worker handles prefill+decode", () => {
    const env = createCompatibilityEnvelopeV2(
      "w", "i", ["unified"], enabledCap(), enabledCap({ maximumOutputTokens: 4_096 }), "same_worker_required",
    )
    const result = isWorkerEligibleForRequest(env, true, true)
    expect(result.eligible).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("returns eligible when prefill_preferred worker handles prefill only", () => {
    const env = createCompatibilityEnvelopeV2(
      "w", "i", ["prefill_preferred"], enabledCap(), enabledCap({ maximumOutputTokens: 4_096 }), "future_transfer_capable",
    )
    const result = isWorkerEligibleForRequest(env, true, false)
    expect(result.eligible).toBe(true)
  })

  it("returns eligible when decode_preferred worker handles decode only", () => {
    const env = createCompatibilityEnvelopeV2(
      "w", "i", ["decode_preferred"], enabledCap(), enabledCap({ maximumOutputTokens: 4_096 }), "future_transfer_capable",
    )
    const result = isWorkerEligibleForRequest(env, false, true)
    expect(result.eligible).toBe(true)
  })

  it("returns not eligible when prefill requested but worker has no prefill role", () => {
    const env = createCompatibilityEnvelopeV2(
      "w", "i", ["decode_only"], enabledCap(), enabledCap({ maximumOutputTokens: 4_096 }), "not_supported",
    )
    const result = isWorkerEligibleForRequest(env, true, false)
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain("prefill")
  })

  it("returns not eligible when decode requested but worker has no decode role", () => {
    const env = createCompatibilityEnvelopeV2(
      "w", "i", ["prefill_only"], enabledCap(), enabledCap({ maximumOutputTokens: 4_096 }), "not_supported",
    )
    const result = isWorkerEligibleForRequest(env, false, true)
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain("decode")
  })

  it("returns not eligible when prefill capability is not enabled", () => {
    const env = createCompatibilityEnvelopeV2(
      "w", "i", ["unified"], disabledCap(), enabledCap({ maximumOutputTokens: 4_096 }), "same_worker_required",
    )
    const result = isWorkerEligibleForRequest(env, true, true)
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain("prefill capability")
  })

  it("returns not eligible when decode capability is not enabled", () => {
    const env = createCompatibilityEnvelopeV2(
      "w", "i", ["unified"], enabledCap(), disabledCap(), "same_worker_required",
    )
    const result = isWorkerEligibleForRequest(env, false, true)
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain("decode capability")
  })
})

// ── isRoleRoutableForEndToEnd / canWorkerServeEndToEnd ──────────────────────

describe("isRoleRoutableForEndToEnd", () => {
  it("returns true for unified role", () => {
    expect(isRoleRoutableForEndToEnd("unified")).toBe(true)
  })

  it("returns false for prefill_only role", () => {
    expect(isRoleRoutableForEndToEnd("prefill_only")).toBe(false)
  })

  it("returns false for decode_only role", () => {
    expect(isRoleRoutableForEndToEnd("decode_only")).toBe(false)
  })

  it("returns true for prefill_preferred role", () => {
    expect(isRoleRoutableForEndToEnd("prefill_preferred")).toBe(true)
  })

  it("returns true for decode_preferred role", () => {
    expect(isRoleRoutableForEndToEnd("decode_preferred")).toBe(true)
  })
})

describe("canWorkerServeEndToEnd", () => {
  function envWithRoles(roles: PrismWorkerRole[]) {
    return createCompatibilityEnvelopeV2(
      "w", "i", roles, enabledCap(), enabledCap({ maximumOutputTokens: 4_096 }), "same_worker_required",
    )
  }

  it("returns true for unified worker", () => {
    expect(canWorkerServeEndToEnd(envWithRoles(["unified"]))).toBe(true)
  })

  it("returns true for prefill_preferred worker", () => {
    expect(canWorkerServeEndToEnd(envWithRoles(["prefill_preferred"]))).toBe(true)
  })

  it("returns true for decode_preferred worker", () => {
    expect(canWorkerServeEndToEnd(envWithRoles(["decode_preferred"]))).toBe(true)
  })

  it("returns false for prefill_only worker", () => {
    expect(canWorkerServeEndToEnd(envWithRoles(["prefill_only"]))).toBe(false)
  })

  it("returns false for decode_only worker", () => {
    expect(canWorkerServeEndToEnd(envWithRoles(["decode_only"]))).toBe(false)
  })

  it("returns true when any role is end-to-end capable (mixed roles)", () => {
    expect(canWorkerServeEndToEnd(envWithRoles(["prefill_only", "decode_preferred"]))).toBe(true)
  })

  it("returns false when no role is end-to-end capable", () => {
    expect(canWorkerServeEndToEnd(envWithRoles(["prefill_only", "decode_only"]))).toBe(false)
  })
})

// ── Prefill Profile ─────────────────────────────────────────────────────────

describe("isPrefillBudgetSufficient", () => {
  const profile = createCompatibilityEnvelopeV2(
    "w", "i", ["unified"],
    enabledCap({ maximumInputTokens: 8_192, maximumMemoryBytes: 1_073_741_824 }),
    enabledCap({ maximumOutputTokens: 4_096 }),
    "same_worker_required",
  ).prefillProfile

  it("returns true when within budget", () => {
    expect(isPrefillBudgetSufficient(profile, 4_000, 500_000_000)).toBe(true)
  })

  it("returns false when tokens exceed budget", () => {
    expect(isPrefillBudgetSufficient(profile, 9_000, 500_000_000)).toBe(false)
  })

  it("returns false when memory exceeds budget", () => {
    expect(isPrefillBudgetSufficient(profile, 4_000, 2_000_000_000)).toBe(false)
  })

  it("returns false when both exceed budget", () => {
    expect(isPrefillBudgetSufficient(profile, 9_000, 2_000_000_000)).toBe(false)
  })

  it("returns true when exactly at budget boundary", () => {
    expect(isPrefillBudgetSufficient(profile, 8_192, 1_073_741_824)).toBe(true)
  })
})

describe("getPromptLengthBand", () => {
  it("returns short for 0 tokens", () => {
    expect(getPromptLengthBand(0)).toBe("short")
  })

  it("returns short for 1023 tokens", () => {
    expect(getPromptLengthBand(1023)).toBe("short")
  })

  it("returns medium at 1024 tokens", () => {
    expect(getPromptLengthBand(1024)).toBe("medium")
  })

  it("returns medium for 4095 tokens", () => {
    expect(getPromptLengthBand(4095)).toBe("medium")
  })

  it("returns long at 4096 tokens", () => {
    expect(getPromptLengthBand(4096)).toBe("long")
  })

  it("returns long for 16383 tokens", () => {
    expect(getPromptLengthBand(16383)).toBe("long")
  })

  it("returns very_long at 16384 tokens", () => {
    expect(getPromptLengthBand(16384)).toBe("very_long")
  })

  it("returns very_long for very large values", () => {
    expect(getPromptLengthBand(100_000)).toBe("very_long")
  })
})

// ── Decode Profile ──────────────────────────────────────────────────────────

describe("isDecodeBudgetSufficient", () => {
  const profile = createCompatibilityEnvelopeV2(
    "w", "i", ["unified"],
    enabledCap(),
    enabledCap({ maximumOutputTokens: 2_048 }),
    "same_worker_required",
  ).decodeProfile

  // Override max KV namespaces since the envelope default is 0
  const testProfile = { ...profile, maximumActiveKvNamespaces: 8 }

  it("returns true when within budget", () => {
    expect(isDecodeBudgetSufficient(testProfile, 1_000, 4)).toBe(true)
  })

  it("returns false when tokens exceed budget", () => {
    expect(isDecodeBudgetSufficient(testProfile, 3_000, 4)).toBe(false)
  })

  it("returns false when KV namespaces exceed budget", () => {
    expect(isDecodeBudgetSufficient(testProfile, 1_000, 10)).toBe(false)
  })

  it("returns false when both exceed budget", () => {
    expect(isDecodeBudgetSufficient(testProfile, 3_000, 10)).toBe(false)
  })

  it("returns true when exactly at budget boundary", () => {
    expect(isDecodeBudgetSufficient(testProfile, 2_048, 8)).toBe(true)
  })
})

describe("getGenerationLengthBand", () => {
  it("returns short for 0 tokens", () => {
    expect(getGenerationLengthBand(0)).toBe("short")
  })

  it("returns short for 255 tokens", () => {
    expect(getGenerationLengthBand(255)).toBe("short")
  })

  it("returns medium at 256 tokens", () => {
    expect(getGenerationLengthBand(256)).toBe("medium")
  })

  it("returns medium for 1023 tokens", () => {
    expect(getGenerationLengthBand(1023)).toBe("medium")
  })

  it("returns long at 1024 tokens", () => {
    expect(getGenerationLengthBand(1024)).toBe("long")
  })

  it("returns long for large values", () => {
    expect(getGenerationLengthBand(100_000)).toBe("long")
  })
})
