/**
 * Prism Heterogeneous Memory Fabric — NPU Admission Tests
 *
 * Tests the PrismNpuAdmissionPolicy type and admission logic by exercising
 * policy creation, operator class matching, tensor layout checking, and
 * precision mode validation.
 */

import { describe, it, expect } from "bun:test"
import type { PrismNpuAdmissionPolicy } from "../../fabric-types"

// ── Admission Functions (test-local implementations) ──────────────────────────

function createNpuAdmissionPolicy(overrides?: Partial<PrismNpuAdmissionPolicy>): PrismNpuAdmissionPolicy {
  return {
    backendAvailable: true,
    supportedOperatorClasses: [
      "matmul",
      "conv2d",
      "softmax",
      "layernorm",
      "silu",
      "rms_norm",
      "add",
      "reshape",
    ],
    supportedTensorLayouts: ["nchw", "nhwc", "tnhwc"],
    supportedPrecisionModes: ["fp32", "fp16", "bf16", "int8"],
    sharedMemoryAccessMode: "read_write",
    maximumTensorBytes: 2_000_000_000,
    maximumExecutionDurationMs: 30_000,
    supportsCancellation: true,
    supportsReceipts: true,
    supportsDharmaCorrelation: true,
    ...overrides,
  }
}

function isOperatorClassSupported(policy: PrismNpuAdmissionPolicy, operatorClass: string): boolean {
  return policy.supportedOperatorClasses.includes(operatorClass)
}

function isTensorLayoutSupported(policy: PrismNpuAdmissionPolicy, layout: string): boolean {
  return policy.supportedTensorLayouts.includes(layout)
}

function isPrecisionModeSupported(policy: PrismNpuAdmissionPolicy, precision: string): boolean {
  return policy.supportedPrecisionModes.includes(precision)
}

function canAdmitTensor(
  policy: PrismNpuAdmissionPolicy,
  tensorBytes: number,
): boolean {
  if (!policy.backendAvailable) return false
  if (tensorBytes > policy.maximumTensorBytes) return false
  return true
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("NpuAdmissionPolicy", () => {
  // ── Policy Creation ───────────────────────────────────────────────────────

  describe("createPolicy", () => {
    it("creates a default admission policy with all fields populated", () => {
      const policy = createNpuAdmissionPolicy()

      expect(policy.backendAvailable).toBe(true)
      expect(policy.supportedOperatorClasses).toContain("matmul")
      expect(policy.supportedOperatorClasses).toContain("softmax")
      expect(policy.supportedTensorLayouts).toContain("nchw")
      expect(policy.supportedPrecisionModes).toContain("fp16")
      expect(policy.maximumTensorBytes).toBeGreaterThan(0)
      expect(policy.maximumExecutionDurationMs).toBeGreaterThan(0)
    })

    it("allows overrides for specific fields", () => {
      const policy = createNpuAdmissionPolicy({
        backendAvailable: false,
        maximumTensorBytes: 512_000_000,
      })

      expect(policy.backendAvailable).toBe(false)
      expect(policy.maximumTensorBytes).toBe(512_000_000)
      // Non-overridden fields keep defaults
      expect(policy.supportedOperatorClasses).toContain("matmul")
      expect(policy.supportsCancellation).toBe(true)
    })

    it("accepts an empty override object", () => {
      const policy = createNpuAdmissionPolicy({})
      expect(policy.backendAvailable).toBe(true)
    })
  })

  // ── Operator Class Matching ────────────────────────────────────────────────

  describe("operatorClassMatching", () => {
    it("recognizes a supported operator class", () => {
      const policy = createNpuAdmissionPolicy()
      expect(isOperatorClassSupported(policy, "matmul")).toBe(true)
      expect(isOperatorClassSupported(policy, "conv2d")).toBe(true)
      expect(isOperatorClassSupported(policy, "silu")).toBe(true)
    })

    it("rejects an unsupported operator class", () => {
      const policy = createNpuAdmissionPolicy()
      expect(isOperatorClassSupported(policy, "non_max_suppression")).toBe(false)
      expect(isOperatorClassSupported(policy, "topk")).toBe(false)
    })

    it("is case-sensitive when matching operator classes", () => {
      const policy = createNpuAdmissionPolicy()
      expect(isOperatorClassSupported(policy, "MatMul")).toBe(false)
      expect(isOperatorClassSupported(policy, "MATMUL")).toBe(false)
    })

    it("works with an empty operator list", () => {
      const policy = createNpuAdmissionPolicy({ supportedOperatorClasses: [] })
      expect(isOperatorClassSupported(policy, "matmul")).toBe(false)
    })

    it("works with a custom operator list from overrides", () => {
      const policy = createNpuAdmissionPolicy({
        supportedOperatorClasses: ["flash_attention", "rope"],
      })
      expect(isOperatorClassSupported(policy, "flash_attention")).toBe(true)
      expect(isOperatorClassSupported(policy, "rope")).toBe(true)
      expect(isOperatorClassSupported(policy, "matmul")).toBe(false)
    })
  })

  // ── Tensor Layout Check ────────────────────────────────────────────────────

  describe("tensorLayoutCheck", () => {
    it("recognizes standard tensor layouts", () => {
      const policy = createNpuAdmissionPolicy()
      expect(isTensorLayoutSupported(policy, "nchw")).toBe(true)
      expect(isTensorLayoutSupported(policy, "nhwc")).toBe(true)
      expect(isTensorLayoutSupported(policy, "tnhwc")).toBe(true)
    })

    it("rejects an unsupported tensor layout", () => {
      const policy = createNpuAdmissionPolicy()
      expect(isTensorLayoutSupported(policy, "chwn")).toBe(false)
      expect(isTensorLayoutSupported(policy, "hwcn")).toBe(false)
    })

    it("rejects tensor layouts when none are configured", () => {
      const policy = createNpuAdmissionPolicy({ supportedTensorLayouts: [] })
      expect(isTensorLayoutSupported(policy, "nchw")).toBe(false)
    })

    it("handles a single supported layout", () => {
      const policy = createNpuAdmissionPolicy({ supportedTensorLayouts: ["nhwc"] })
      expect(isTensorLayoutSupported(policy, "nhwc")).toBe(true)
      expect(isTensorLayoutSupported(policy, "nchw")).toBe(false)
    })
  })

  // ── Precision Mode Check ───────────────────────────────────────────────────

  describe("precisionModeCheck", () => {
    it("recognizes standard precision modes", () => {
      const policy = createNpuAdmissionPolicy()
      expect(isPrecisionModeSupported(policy, "fp32")).toBe(true)
      expect(isPrecisionModeSupported(policy, "fp16")).toBe(true)
      expect(isPrecisionModeSupported(policy, "bf16")).toBe(true)
      expect(isPrecisionModeSupported(policy, "int8")).toBe(true)
    })

    it("rejects an unsupported precision mode", () => {
      const policy = createNpuAdmissionPolicy()
      expect(isPrecisionModeSupported(policy, "int4")).toBe(false)
      expect(isPrecisionModeSupported(policy, "fp8")).toBe(false)
    })

    it("rejects precision modes when none are configured", () => {
      const policy = createNpuAdmissionPolicy({ supportedPrecisionModes: [] })
      expect(isPrecisionModeSupported(policy, "fp16")).toBe(false)
    })

    it("handles a single supported precision mode", () => {
      const policy = createNpuAdmissionPolicy({ supportedPrecisionModes: ["int8"] })
      expect(isPrecisionModeSupported(policy, "int8")).toBe(true)
      expect(isPrecisionModeSupported(policy, "fp16")).toBe(false)
    })
  })

  // ── Admission Gating ───────────────────────────────────────────────────────

  describe("admissionGating", () => {
    it("admits a tensor within size limits", () => {
      const policy = createNpuAdmissionPolicy({ maximumTensorBytes: 1_000_000_000 })
      expect(canAdmitTensor(policy, 500_000_000)).toBe(true)
    })

    it("rejects a tensor exceeding the size limit", () => {
      const policy = createNpuAdmissionPolicy({ maximumTensorBytes: 1_000_000_000 })
      expect(canAdmitTensor(policy, 2_000_000_000)).toBe(false)
    })

    it("rejects admission when backend is unavailable", () => {
      const policy = createNpuAdmissionPolicy({
        backendAvailable: false,
        maximumTensorBytes: 1_000_000_000,
      })
      expect(canAdmitTensor(policy, 500_000_000)).toBe(false)
    })

    it("admits a zero-size tensor when permitted", () => {
      const policy = createNpuAdmissionPolicy()
      expect(canAdmitTensor(policy, 0)).toBe(true)
    })

    it("exact boundary match passes admission", () => {
      const policy = createNpuAdmissionPolicy({ maximumTensorBytes: 1_000_000_000 })
      expect(canAdmitTensor(policy, 1_000_000_000)).toBe(true)
    })
  })
})
