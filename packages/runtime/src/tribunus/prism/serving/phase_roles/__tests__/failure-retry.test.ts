/**
 * Tests — Phase Failure Classification and Retry Policy
 */

import { describe, it, expect } from "bun:test"
import {
  classifyPhaseFailure,
  getFailureRetryPolicy,
  isRetryableBeforeOutput,
  isRetryableAfterOutput,
} from "../phase-failure"
import type { PhaseFailureClass } from "../phase-role-types"

describe("classifyPhaseFailure", () => {
  it("classifies prefill budget failures", () => {
    expect(classifyPhaseFailure("prefill", "budget exceeded")).toBe("prefill_budget_exceeded")
    expect(classifyPhaseFailure("prefill", "Budget limit hit")).toBe("prefill_budget_exceeded")
  })

  it("classifies prefill timeout failures", () => {
    expect(classifyPhaseFailure("prefill", "timeout")).toBe("prefill_timeout")
    expect(classifyPhaseFailure("prefill", "Timed out after 30s")).toBe("prefill_timeout")
  })

  it("classifies prefill cancellation", () => {
    expect(classifyPhaseFailure("prefill", "cancelled")).toBe("prefill_cancelled")
    expect(classifyPhaseFailure("prefill", "Cancel requested")).toBe("prefill_cancelled")
  })

  it("classifies generic prefill failures", () => {
    expect(classifyPhaseFailure("prefill", "OOM killed")).toBe("prefill_failed")
    expect(classifyPhaseFailure("prefill", "internal error")).toBe("prefill_failed")
  })

  it("classifies decode budget failures", () => {
    expect(classifyPhaseFailure("decode", "budget exceeded")).toBe("decode_budget_exceeded")
  })

  it("classifies decode timeout failures", () => {
    expect(classifyPhaseFailure("decode", "timeout")).toBe("decode_timeout")
  })

  it("classifies decode cancellation", () => {
    expect(classifyPhaseFailure("decode", "cancelled")).toBe("decode_cancelled")
  })

  it("classifies decode KV invalid", () => {
    expect(classifyPhaseFailure("decode", "kv invalid")).toBe("decode_kv_invalid")
    expect(classifyPhaseFailure("decode", "KV_invalid after prefill")).toBe("decode_kv_invalid")
  })

  it("classifies decode worker mismatch", () => {
    expect(classifyPhaseFailure("decode", "worker mismatch")).toBe("decode_worker_mismatch")
    expect(classifyPhaseFailure("decode", "worker_mismatch detected")).toBe("decode_worker_mismatch")
  })

  it("classifies generic decode failures", () => {
    expect(classifyPhaseFailure("decode", "gpu error")).toBe("decode_failed")
  })

  it("falls back to decode_failed for unrecognised stage", () => {
    expect(classifyPhaseFailure("unknown", "error")).toBe("decode_failed")
  })
})

describe("isRetryableBeforeOutput", () => {
  const retryable: PhaseFailureClass[] = [
    "prefill_failed",
    "prefill_budget_exceeded",
    "prefill_timeout",
    "prefill_cancelled",
    "decode_timeout",
    "decode_budget_exceeded",
    "decode_kv_invalid",
    "decode_worker_mismatch",
  ]

  const notRetryable: PhaseFailureClass[] = [
    "decode_failed",
    "decode_cancelled",
  ]

  for (const cls of retryable) {
    it(`returns true for ${cls}`, () => {
      expect(isRetryableBeforeOutput(cls)).toBe(true)
    })
  }

  for (const cls of notRetryable) {
    it(`returns false for ${cls}`, () => {
      expect(isRetryableBeforeOutput(cls)).toBe(false)
    })
  }
})

describe("isRetryableAfterOutput", () => {
  const retryable: PhaseFailureClass[] = [
    "prefill_failed",
    "prefill_budget_exceeded",
    "prefill_timeout",
  ]

  const notRetryable: PhaseFailureClass[] = [
    "prefill_cancelled",
    "decode_failed",
    "decode_cancelled",
    "decode_budget_exceeded",
    "decode_timeout",
    "decode_kv_invalid",
    "decode_worker_mismatch",
  ]

  for (const cls of retryable) {
    it(`returns true for ${cls}`, () => {
      expect(isRetryableAfterOutput(cls)).toBe(true)
    })
  }

  for (const cls of notRetryable) {
    it(`returns false for ${cls}`, () => {
      expect(isRetryableAfterOutput(cls)).toBe(false)
    })
  }
})

describe("getFailureRetryPolicy", () => {
  it("before output: retryable for prefill_failed", () => {
    const policy = getFailureRetryPolicy("prefill_failed", false)
    expect(policy.retryable).toBe(true)
    expect(policy.reason).toContain("before output")
  })

  it("before output: not retryable for decode_failed", () => {
    const policy = getFailureRetryPolicy("decode_failed", false)
    expect(policy.retryable).toBe(false)
    expect(policy.reason).toContain("before output")
  })

  it("after output: retryable for prefill_failed", () => {
    const policy = getFailureRetryPolicy("prefill_failed", true)
    expect(policy.retryable).toBe(true)
    expect(policy.reason).toContain("after output")
  })

  it("after output: not retryable for decode_cancelled", () => {
    const policy = getFailureRetryPolicy("decode_cancelled", true)
    expect(policy.retryable).toBe(false)
    expect(policy.reason).toContain("after output")
  })

  it("after output: not retryable for decode_failed", () => {
    const policy = getFailureRetryPolicy("decode_failed", true)
    expect(policy.retryable).toBe(false)
    expect(policy.reason).toContain("after output")
  })
})
