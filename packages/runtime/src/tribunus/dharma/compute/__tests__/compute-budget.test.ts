/**
 * Tests for compute-budget.ts — budget computation and enforcement.
 */

import { describe, it, expect } from "bun:test"
import {
  getDefaultComputeBudget,
  computeEffectiveBudget,
  checkBudget,
} from "../compute-budget.ts"
import { createLease } from "../compute-lease.ts"
import type { ComputeBudget, ComputeImagePolicy, LocalPrismComputeLease } from "../compute-types.ts"

// ── Fixtures ----------------------------------------------------------------

function makeLease(overrides?: Partial<LocalPrismComputeLease>): LocalPrismComputeLease {
  return {
    ...createLease({
      sessionId: "s-1",
      requester: "pk-1",
      membershipId: "m-1",
      grantId: "g-1",
      workloadClass: "chat_completion",
      modelArtifactDigest: "sha256:a",
      inputDigest: "sha256:b",
    }),
    ...overrides,
  }
}

function makePolicy(overrides?: Partial<ComputeImagePolicy>): ComputeImagePolicy {
  return {
    policyDigest: "pol-1",
    allowedTargets: ["cpu"],
    requiredDeterminismClass: "deterministic",
    allowedPrecisionModes: ["fp16"],
    allowedMemoryTiers: ["ram"],
    maxCompileTimeMs: 30_000,
    maxModelLoadTimeMs: 10_000,
    allowCacheReuse: true,
    allowCompiledArtifactReuse: true,
    requireArtifactSealing: false,
    requireExecutionReceipts: false,
    ...overrides,
  }
}

// ── getDefaultComputeBudget -------------------------------------------------

describe("getDefaultComputeBudget", () => {
  it("returns a complete ComputeBudget with all fields", () => {
    const b = getDefaultComputeBudget()
    expect(b.maximumRuntimeSeconds).toBeGreaterThan(0)
    expect(b.maximumPrefillMs).toBeGreaterThan(0)
    expect(b.maximumDecodeMs).toBeGreaterThan(0)
    expect(b.maximumTokens).toBeGreaterThan(0)
    expect(b.maximumInputTokens).toBeGreaterThan(0)
    expect(b.maximumOutputTokens).toBeGreaterThan(0)
    expect(b.maximumMemoryBytes).toBeGreaterThan(0)
    expect(b.maximumGpuTimeMs).toBeNull()
    expect(b.maximumCpuTimeMs).toBeNull()
    expect(b.maximumOutputBytes).toBeGreaterThan(0)
    expect(b.maximumCompileTimeMs).toBeGreaterThan(0)
  })
})

// ── computeEffectiveBudget --------------------------------------------------

describe("computeEffectiveBudget", () => {
  it("uses host override when no lease/policy constraints", () => {
    const lease = makeLease({ requestedMaxRuntimeSeconds: 600 })
    const policy = makePolicy()
    const host: Partial<ComputeBudget> = { maximumRuntimeSeconds: 120 }
    const result = computeEffectiveBudget(lease, policy, host)
    // lease wants 600, host says 120, lease wins because lease < host
    expect(result.maximumRuntimeSeconds).toBe(120)
  })

  it("lease request can tighten host override", () => {
    const lease = makeLease({ requestedMaxRuntimeSeconds: 60 })
    const policy = makePolicy()
    const host: Partial<ComputeBudget> = { maximumRuntimeSeconds: 120 }
    const result = computeEffectiveBudget(lease, policy, host)
    expect(result.maximumRuntimeSeconds).toBe(60)
  })

  it("policy can tighten compile time", () => {
    const lease = makeLease()
    const policy = makePolicy({ maxCompileTimeMs: 5_000 })
    const result = computeEffectiveBudget(lease, policy, {})
    expect(result.maximumCompileTimeMs).toBe(5_000)
  })

  it("lease requestedMaxTokens can tighten host default", () => {
    const lease = makeLease({ requestedMaxTokens: 1024 })
    const result = computeEffectiveBudget(lease, makePolicy(), {})
    expect(result.maximumTokens).toBe(1024)
  })

  it("lease requestedMaxGpuTimeMs overrides null host", () => {
    const lease = makeLease({ requestedMaxGpuTimeMs: 10_000 })
    const result = computeEffectiveBudget(lease, makePolicy(), {})
    expect(result.maximumGpuTimeMs).toBe(10_000)
  })

  it("lease requestedMaxMemoryBytes takes precedence", () => {
    const lease = makeLease({ requestedMaxMemoryBytes: 512 * 1024 * 1024 })
    const result = computeEffectiveBudget(lease, makePolicy(), { maximumMemoryBytes: 1024 * 1024 * 1024 })
    expect(result.maximumMemoryBytes).toBe(512 * 1024 * 1024)
  })

  it("fills missing host overrides from defaults", () => {
    const result = computeEffectiveBudget(makeLease(), makePolicy(), {})
    expect(result.maximumRuntimeSeconds).toBe(300)
    expect(result.maximumPrefillMs).toBe(30_000)
    expect(result.maximumDecodeMs).toBe(120_000)
    expect(result.maximumTokens).toBe(8192)
  })
})

// ── checkBudget -------------------------------------------------------------

describe("checkBudget", () => {
  const budget = getDefaultComputeBudget()

  it("returns not exceeded when usage is within limits", () => {
    const result = checkBudget(budget, {
      runtimeMs: 1000,
      tokens: 500,
      inputTokens: 200,
      outputTokens: 300,
      memoryBytes: 1024,
      outputBytes: 100,
    })
    expect(result.exceeded).toBe(false)
    expect(result.violations).toEqual([])
  })

  it("detects runtime exceeded", () => {
    const result = checkBudget({ ...budget, maximumRuntimeSeconds: 1 }, { runtimeMs: 2000 })
    expect(result.exceeded).toBe(true)
    expect(result.violations).toContain("runtime_ms exceeded: 2000 > 1000")
  })

  it("detects total tokens exceeded", () => {
    const result = checkBudget({ ...budget, maximumTokens: 100 }, { tokens: 150 })
    expect(result.exceeded).toBe(true)
    expect(result.violations[0]).toMatch(/total_tokens exceeded/)
  })

  it("detects input tokens exceeded", () => {
    const result = checkBudget({ ...budget, maximumInputTokens: 50 }, { inputTokens: 100 })
    expect(result.exceeded).toBe(true)
    expect(result.violations[0]).toMatch(/input_tokens exceeded/)
  })

  it("detects output tokens exceeded", () => {
    const result = checkBudget({ ...budget, maximumOutputTokens: 50 }, { outputTokens: 100 })
    expect(result.exceeded).toBe(true)
    expect(result.violations[0]).toMatch(/output_tokens exceeded/)
  })

  it("detects memory exceeded", () => {
    const result = checkBudget({ ...budget, maximumMemoryBytes: 1000 }, { memoryBytes: 2000 })
    expect(result.exceeded).toBe(true)
    expect(result.violations[0]).toMatch(/memory_bytes exceeded/)
  })

  it("detects gpu time exceeded when budget has limit", () => {
    const result = checkBudget({ ...budget, maximumGpuTimeMs: 100 }, { gpuTimeMs: 200 })
    expect(result.exceeded).toBe(true)
    expect(result.violations[0]).toMatch(/gpu_time_ms exceeded/)
  })

  it("does not check gpu time when budget limit is null", () => {
    const result = checkBudget({ ...budget, maximumGpuTimeMs: null }, { gpuTimeMs: 999999 })
    expect(result.exceeded).toBe(false)
  })

  it("detects output bytes exceeded", () => {
    const result = checkBudget({ ...budget, maximumOutputBytes: 100 }, { outputBytes: 200 })
    expect(result.exceeded).toBe(true)
    expect(result.violations[0]).toMatch(/output_bytes exceeded/)
  })

  it("reports multiple violations", () => {
    const tight = { ...budget, maximumTokens: 10, maximumMemoryBytes: 10, maximumOutputBytes: 10 }
    const result = checkBudget(tight, { tokens: 100, memoryBytes: 999, outputBytes: 999 })
    expect(result.exceeded).toBe(true)
    expect(result.violations.length).toBeGreaterThanOrEqual(3)
  })
})
