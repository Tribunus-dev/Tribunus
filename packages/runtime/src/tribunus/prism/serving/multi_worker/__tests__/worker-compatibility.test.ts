/**
 * Multi-Worker Router — Worker Compatibility & Registry Tests
 *
 * Coverage:
 *   Compatibility – envelope creation, artifact parity, workload support,
 *                   streaming support, context budget, dharma correlation,
 *                   summary.
 *   Discovery    – state creation, ID mismatch error, removal, reconciliation.
 *   Registry     – register, remove, get, list, eligible filters, artifact
 *                   lookups, targeted updates, reconcile-all.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "bun:test"
import type { PrismWorkerCompatibilityEnvelope, RouterWorkerState } from "../router-types.ts"
import {
  createCompatibilityEnvelope,
  isArtifactParityCompatible,
  isWorkloadSupported,
  isStreamingSupported,
  isContextBudgetSufficient,
  isDharmaCorrelationSupported,
  getCompatibilitySummary,
} from "../worker-compatibility.ts"
import {
  discoverWorker,
  removeWorker,
  reconcileWorkerState,
} from "../worker-discovery.ts"
import { WorkerRegistry } from "../worker-registry.ts"
import { WorkerDiscoveryError } from "../router-errors.ts"

// ── Fixtures ───────────────────────────────────────────────────────────────

const DEFAULT_DIGEST = "abc123def456ghi789"
const TOKENIZER_DIGEST = "tok789abc"
const TARGET_SIG = "llama-family/v3"

function makeEnvelope(overrides?: Partial<PrismWorkerCompatibilityEnvelope>): PrismWorkerCompatibilityEnvelope {
  return {
    workerId: "w-001",
    workerInstanceId: "inst-a",
    modelArtifactDigest: DEFAULT_DIGEST,
    tokenizerDigest: TOKENIZER_DIGEST,
    modelFamily: "llama-family",
    workloadClasses: ["chat_completion", "completion"],
    targetCapabilitySignature: TARGET_SIG,
    computeImageDigest: "compute@sha256:ccc",
    precisionMode: "fp16",
    maximumContextLength: 8192,
    maximumOutputTokens: 2048,
    maximumConcurrentRequests: 4,
    kvEventVersion: 1,
    kvLocalityMode: "device_local",
    supportsStreaming: true,
    supportsCancellation: true,
    supportsDrain: true,
    supportsDharmaCorrelation: false,
    lifecycleState: "ready",
    ...overrides,
  }
}

function makeState(overrides?: Partial<RouterWorkerState>): RouterWorkerState {
  return {
    workerId: "w-001",
    instanceId: "inst-a",
    compatibility: makeEnvelope(),
    healthy: true,
    ready: true,
    draining: false,
    activeRequests: 0,
    maxConcurrentRequests: 4,
    lastHealthCheck: null,
    lastError: null,
    lastKvEventSequence: 0,
    kvEventFreshness: null,
    ...overrides,
  }
}

// ── Compatibility ───────────────────────────────────────────────────────────

describe("createCompatibilityEnvelope", () => {
  it("produces a correctly shaped envelope", () => {
    const env = createCompatibilityEnvelope("w-002", "inst-b", DEFAULT_DIGEST, TOKENIZER_DIGEST, TARGET_SIG)

    expect(env.workerId).toBe("w-002")
    expect(env.workerInstanceId).toBe("inst-b")
    expect(env.modelArtifactDigest).toBe(DEFAULT_DIGEST)
    expect(env.tokenizerDigest).toBe(TOKENIZER_DIGEST)
    expect(env.targetCapabilitySignature).toBe(TARGET_SIG)
    expect(env.supportsStreaming).toBe(true)
    expect(env.supportsDharmaCorrelation).toBe(false)
    expect(env.maximumContextLength).toBeGreaterThan(0)
    expect(env.workloadClasses).toContain("chat_completion")
  })
})

describe("isArtifactParityCompatible", () => {
  it("returns true when digest matches", () => {
    const env = makeEnvelope({ modelArtifactDigest: "match123" })
    expect(isArtifactParityCompatible(env, "match123")).toBe(true)
  })

  it("returns false when digest differs", () => {
    const env = makeEnvelope({ modelArtifactDigest: "digest-a" })
    expect(isArtifactParityCompatible(env, "digest-b")).toBe(false)
  })
})

describe("isWorkloadSupported", () => {
  it("returns true for advertised workload", () => {
    const env = makeEnvelope({ workloadClasses: ["chat_completion", "embedding"] })
    expect(isWorkloadSupported(env, "chat_completion")).toBe(true)
    expect(isWorkloadSupported(env, "embedding")).toBe(true)
  })

  it("returns false for unadvertised workload", () => {
    const env = makeEnvelope({ workloadClasses: ["chat_completion"] })
    expect(isWorkloadSupported(env, "embedding")).toBe(false)
  })
})

describe("isStreamingSupported", () => {
  it("returns true when streaming not required", () => {
    const env = makeEnvelope({ supportsStreaming: false })
    expect(isStreamingSupported(env, false)).toBe(true)
  })

  it("returns true when streaming required and supported", () => {
    const env = makeEnvelope({ supportsStreaming: true })
    expect(isStreamingSupported(env, true)).toBe(true)
  })

  it("returns false when streaming required but unsupported", () => {
    const env = makeEnvelope({ supportsStreaming: false })
    expect(isStreamingSupported(env, true)).toBe(false)
  })
})

describe("isContextBudgetSufficient", () => {
  it("returns true when context length is >= required tokens", () => {
    const env = makeEnvelope({ maximumContextLength: 4096 })
    expect(isContextBudgetSufficient(env, 2048)).toBe(true)
    expect(isContextBudgetSufficient(env, 4096)).toBe(true)
  })

  it("returns false when context length is below required tokens", () => {
    const env = makeEnvelope({ maximumContextLength: 1024 })
    expect(isContextBudgetSufficient(env, 2048)).toBe(false)
  })
})

describe("isDharmaCorrelationSupported", () => {
  it("returns true when envelope supports dharma correlation", () => {
    const env = makeEnvelope({ supportsDharmaCorrelation: true })
    expect(isDharmaCorrelationSupported(env)).toBe(true)
  })

  it("returns false when envelope does not support dharma correlation", () => {
    const env = makeEnvelope({ supportsDharmaCorrelation: false })
    expect(isDharmaCorrelationSupported(env)).toBe(false)
  })
})

describe("getCompatibilitySummary", () => {
  it("includes worker id and model family", () => {
    const env = makeEnvelope({ workerId: "w-007", modelFamily: "gpt-family" })
    const summary = getCompatibilitySummary(env)
    expect(summary).toContain("worker=w-007")
    expect(summary).toContain("model=gpt-family")
  })

  it("includes truncated artifact digest", () => {
    const env = makeEnvelope({ modelArtifactDigest: "sha256:deadbeefcafe1234" })
    const summary = getCompatibilitySummary(env)
    expect(summary).toContain("artifact=sha256:deadb")
  })
})

// ── Discovery ───────────────────────────────────────────────────────────────

describe("discoverWorker", () => {
  it("creates a RouterWorkerState from identity and envelope", () => {
    const env = makeEnvelope({ maximumConcurrentRequests: 8 })
    const state = discoverWorker("w-001", "inst-a", env)

    expect(state.workerId).toBe("w-001")
    expect(state.instanceId).toBe("inst-a")
    expect(state.compatibility).toBe(env)
    expect(state.healthy).toBe(true)
    expect(state.ready).toBe(true)
    expect(state.draining).toBe(false)
    expect(state.activeRequests).toBe(0)
    expect(state.maxConcurrentRequests).toBe(8)
  })

  it("throws WorkerDiscoveryError on workerId mismatch", () => {
    const env = makeEnvelope({ workerId: "w-001" })
    expect(() => discoverWorker("w-999", "inst-x", env)).toThrow(WorkerDiscoveryError)
  })
})

describe("removeWorker", () => {
  it("returns array without the specified worker", () => {
    const a = makeState({ workerId: "a" })
    const b = makeState({ workerId: "b" })
    expect(removeWorker([a, b], "a")).toEqual([b])
  })

  it("returns same array when worker not found", () => {
    const a = makeState({ workerId: "a" })
    expect(removeWorker([a], "b")).toEqual([a])
  })

  it("returns empty array when removing the only worker", () => {
    const a = makeState({ workerId: "a" })
    expect(removeWorker([a], "a")).toEqual([])
  })
})

describe("reconcileWorkerState", () => {
  it("marks worker unhealthy and clears lastError on health=false", () => {
    const state = makeState({ lastError: "previous error" })
    const result = reconcileWorkerState(state, false, true, 2)

    expect(result.healthy).toBe(false)
    expect(result.ready).toBe(true)
    expect(result.activeRequests).toBe(2)
    expect(result.lastError).toBeNull()
    expect(result.lastHealthCheck).not.toBeNull()
  })

  it("clears lastError on health=true", () => {
    const state = makeState({ healthy: false, lastError: "OOM" })
    const result = reconcileWorkerState(state, true, true, 0)

    expect(result.healthy).toBe(true)
    expect(result.lastError).toBeNull()
  })

  it("forces ready=false when draining", () => {
    const state = makeState({ draining: true })
    const result = reconcileWorkerState(state, true, true, 1)

    expect(result.ready).toBe(false)
    expect(result.draining).toBe(true)
  })
})

// ── Registry ────────────────────────────────────────────────────────────────

describe("WorkerRegistry", () => {
  it("registers and retrieves a worker", () => {
    const r = new WorkerRegistry()
    const state = makeState({ workerId: "w-001" })
    r.registerWorker(state)
    expect(r.getWorker("w-001")).toBe(state)
  })

  it("removes a worker", () => {
    const r = new WorkerRegistry()
    r.registerWorker(makeState({ workerId: "w-001" }))
    r.removeWorker("w-001")
    expect(r.getWorker("w-001")).toBeUndefined()
    expect(r.getWorkerCount()).toBe(0)
  })

  it("removeWorker is a no-op for unknown ids", () => {
    const r = new WorkerRegistry()
    r.registerWorker(makeState({ workerId: "w-001" }))
    r.removeWorker("w-999")
    expect(r.getWorkerCount()).toBe(1)
  })

  it("listWorkers returns all registered workers", () => {
    const r = new WorkerRegistry()
    r.registerWorker(makeState({ workerId: "a" }))
    r.registerWorker(makeState({ workerId: "b" }))
    expect(r.listWorkers()).toHaveLength(2)
    expect(r.listWorkers().map((w) => w.workerId).sort()).toEqual(["a", "b"])
  })

  describe("getEligibleWorkers", () => {
    it("excludes unhealthy workers", () => {
      const r = new WorkerRegistry()
      r.registerWorker(makeState({ workerId: "a", healthy: false }))
      r.registerWorker(makeState({ workerId: "b" }))
      expect(r.getEligibleWorkers().map((w) => w.workerId)).toEqual(["b"])
    })

    it("excludes draining workers", () => {
      const r = new WorkerRegistry()
      r.registerWorker(makeState({ workerId: "a", draining: true }))
      r.registerWorker(makeState({ workerId: "b" }))
      expect(r.getEligibleWorkers().map((w) => w.workerId)).toEqual(["b"])
    })

    it("excludes not-ready workers", () => {
      const r = new WorkerRegistry()
      r.registerWorker(makeState({ workerId: "a", ready: false }))
      r.registerWorker(makeState({ workerId: "b" }))
      expect(r.getEligibleWorkers().map((w) => w.workerId)).toEqual(["b"])
    })

    it("returns empty when no eligible workers", () => {
      const r = new WorkerRegistry()
      r.registerWorker(makeState({ workerId: "a", healthy: false, draining: false, ready: true }))
      expect(r.getEligibleWorkers()).toEqual([])
    })
  })

  describe("getWorkersByArtifact", () => {
    it("matches workers by model artifact digest", () => {
      const r = new WorkerRegistry()
      r.registerWorker(makeState({ workerId: "a", compatibility: makeEnvelope({ modelArtifactDigest: "digest-X" }) }))
      r.registerWorker(makeState({ workerId: "b", compatibility: makeEnvelope({ modelArtifactDigest: "digest-Y" }) }))
      r.registerWorker(makeState({ workerId: "c", compatibility: makeEnvelope({ modelArtifactDigest: "digest-X" }) }))

      const matched = r.getWorkersByArtifact("digest-X")
      expect(matched.map((w) => w.workerId).sort()).toEqual(["a", "c"])
    })

    it("excludes workers without a compatibility envelope", () => {
      const r = new WorkerRegistry()
      r.registerWorker(makeState({ workerId: "a", compatibility: null }))
      r.registerWorker(makeState({ workerId: "b", compatibility: makeEnvelope({ modelArtifactDigest: "digest-X" }) }))

      expect(r.getWorkersByArtifact("digest-X").map((w) => w.workerId)).toEqual(["b"])
    })
  })

  describe("updateWorkerHealth", () => {
    it("updates healthy flag", () => {
      const r = new WorkerRegistry()
      r.registerWorker(makeState({ workerId: "w-001" }))
      r.updateWorkerHealth("w-001", false)
      expect(r.getWorker("w-001")!.healthy).toBe(false)
    })

    it("is a no-op for unknown workers", () => {
      const r = new WorkerRegistry()
      r.updateWorkerHealth("unknown", false)
      expect(r.getWorkerCount()).toBe(0)
    })
  })

  describe("updateWorkerState", () => {
    it("applies partial updates", () => {
      const r = new WorkerRegistry()
      r.registerWorker(makeState({ workerId: "w-001", activeRequests: 0 }))
      r.updateWorkerState("w-001", { activeRequests: 5, lastError: "timeout" })
      const w = r.getWorker("w-001")!
      expect(w.activeRequests).toBe(5)
      expect(w.lastError).toBe("timeout")
    })

    it("is a no-op for unknown workers", () => {
      const r = new WorkerRegistry()
      r.updateWorkerState("unknown", { healthy: false })
      expect(r.getWorkerCount()).toBe(0)
    })
  })

  describe("reconcileAll", () => {
    it("replaces all registry contents", () => {
      const r = new WorkerRegistry()
      r.registerWorker(makeState({ workerId: "a" }))
      r.registerWorker(makeState({ workerId: "b" }))
      r.reconcileAll([makeState({ workerId: "c" })])

      expect(r.getWorkerCount()).toBe(1)
      expect(r.getWorker("a")).toBeUndefined()
      expect(r.getWorker("c")).toBeDefined()
    })
  })
})
