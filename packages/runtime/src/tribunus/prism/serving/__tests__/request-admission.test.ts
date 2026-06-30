/**
 * Prism llm-d Worker — Request Admission & Execution Tests
 *
 * Covers:
 *   - Admission gates: worker state rejects, model loaded, token budget,
 *     concurrency, deadline
 *   - Execution lifecycle: create → start → complete / fail / cancel
 *   - Query functions: getActiveExecutionCount, getExecutionsForRequest
 */

import { describe, it, expect } from "bun:test"

import {
  evaluateAdmission,
  checkWorkerState,
  checkModelLoaded,
  checkTokenBudget,
  checkConcurrency,
  checkDeadline,
} from "../worker-admission"

import {
  createExecution,
  startExecution,
  completeExecution,
  failExecution,
  cancelExecution,
  getActiveExecutionCount,
  getExecutionsForRequest,
} from "../worker-request-store"

import type {
  PrismWorkerRequest,
  PrismWorkerModel,
  PrismModelWorker,
  PrismRequestExecution,
  WorkerLifecycleState,
} from "../worker-types"

// ── Fixture helpers --------------------------------------------------------

function makeWorker(
  lifecycleState?: WorkerLifecycleState,
): PrismModelWorker {
  return {
    workerId: "w1",
    workerInstanceId: "wi1",
    workerVersion: "1.0",
    protocolVersion: 1,
    lifecycleState: lifecycleState ?? "ready",
    advertisedModels: [],
    targetCapabilitySignature: "sig1",
    containmentProfileDigest: null,
    deploymentClass: "default",
    startedAt: new Date().toISOString(),
  }
}

function makeModel(overrides?: Partial<PrismWorkerModel>): PrismWorkerModel {
  return {
    modelId: "m1",
    artifactDigest: "abc123",
    tokenizerDigest: "tok1",
    modelFamily: "llama",
    quantizationScheme: "q4_0",
    artifactAdmissionState: "admitted",
    computeImageDigest: "sha256:a",
    targetCapabilitySignature: "sig1",
    modelState: "loaded",
    loadedAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeRequest(overrides?: Partial<PrismWorkerRequest>): PrismWorkerRequest {
  return {
    requestId: "req-1",
    requestNamespace: "ns1",
    modelId: "m1",
    modelArtifactDigest: "abc123",
    workloadClass: "chat_completion",
    inputDigest: "in1",
    promptReference: "",
    maxInputTokens: 4096,
    maxOutputTokens: 1024,
    samplingPolicy: "default",
    stream: false,
    deadlineAt: null,
    dharmaLeaseId: null,
    sessionId: null,
    traceContext: null,
    ...overrides,
  }
}

function makeExec(overrides?: Partial<PrismRequestExecution>): PrismRequestExecution {
  const now = new Date().toISOString()
  return {
    executionId: "exec-1",
    requestId: "req-1",
    modelArtifactDigest: "abc123",
    computeImageDigest: "",
    targetCapabilitySignature: "",
    prefillState: "pending",
    decodeState: "pending",
    kvNamespaceId: null,
    admissionTime: now,
    startedAt: now,
    completedAt: null,
    ...overrides,
  }
}

// ── Admission gates --------------------------------------------------------

describe("checkWorkerState", () => {
  it("returns true when worker is ready", () => {
    expect(checkWorkerState(makeWorker("ready"))).toBe(true)
  })

  it("returns true when worker is serving", () => {
    expect(checkWorkerState(makeWorker("serving"))).toBe(true)
  })

  it("returns true when worker is degraded", () => {
    expect(checkWorkerState(makeWorker("degraded"))).toBe(true)
  })

  it("returns false when worker is draining", () => {
    expect(checkWorkerState(makeWorker("draining"))).toBe(false)
  })

  it("returns false when worker is stopped", () => {
    expect(checkWorkerState(makeWorker("stopped"))).toBe(false)
  })

  it("returns false when worker is failed", () => {
    expect(checkWorkerState(makeWorker("failed"))).toBe(false)
  })
})

describe("checkModelLoaded", () => {
  it("returns loaded=true when model exists and is loaded", () => {
    const r = makeRequest()
    const models = [makeModel()]
    expect(checkModelLoaded(r, models)).toEqual({ loaded: true, errorCode: null })
  })

  it("returns error when model not found by modelId or digest", () => {
    const r = makeRequest({ modelId: "unknown", modelArtifactDigest: "nonexistent" })
    const models = [makeModel()]
    const result = checkModelLoaded(r, models)
    expect(result.loaded).toBe(false)
    expect(result.errorCode).toBe("model_not_loaded")
  })

  it("returns error when model exists but is not in loaded state", () => {
    const r = makeRequest()
    const models = [makeModel({ modelState: "loading" })]
    const result = checkModelLoaded(r, models)
    expect(result.loaded).toBe(false)
    expect(result.errorCode).toBe("model_not_loaded")
  })

  it("matches by artifactDigest when modelId differs", () => {
    const r = makeRequest({ modelId: "other", modelArtifactDigest: "abc123" })
    const models = [
      makeModel({ modelId: "m1", artifactDigest: "abc123" }),
    ]
    expect(checkModelLoaded(r, models).loaded).toBe(true)
  })
})

describe("checkTokenBudget", () => {
  it("passes when request is under limits", () => {
    const r = makeRequest({ maxInputTokens: 1000, maxOutputTokens: 500 })
    expect(checkTokenBudget(r, 4096, 2048)).toEqual({ valid: true, errorCode: null })
  })

  it("rejects when input exceeds max", () => {
    const r = makeRequest({ maxInputTokens: 8000 })
    const result = checkTokenBudget(r, 4096, 2048)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe("input_too_large")
  })

  it("rejects when output exceeds max", () => {
    const r = makeRequest({ maxOutputTokens: 3000 })
    const result = checkTokenBudget(r, 4096, 2048)
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe("output_budget_exceeded")
  })

  it("passes when request has 0 limits (unbounded)", () => {
    const r = makeRequest({ maxInputTokens: 0, maxOutputTokens: 0 })
    expect(checkTokenBudget(r, 4096, 2048)).toEqual({ valid: true, errorCode: null })
  })
})

describe("checkConcurrency", () => {
  it("passes when inflight < max", () => {
    expect(checkConcurrency(3, 5)).toEqual({ available: true, errorCode: null })
  })

  it("fails when inflight equals max", () => {
    expect(checkConcurrency(5, 5)).toEqual({ available: false, errorCode: "worker_overloaded" })
  })

  it("fails when inflight exceeds max", () => {
    const result = checkConcurrency(10, 5)
    expect(result.available).toBe(false)
    expect(result.errorCode).toBe("worker_overloaded")
  })
})

describe("checkDeadline", () => {
  it("passes when no deadline is set", () => {
    expect(checkDeadline(makeRequest({ deadlineAt: null }))).toBe(true)
  })

  it("passes when deadline is in the future", () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(checkDeadline(makeRequest({ deadlineAt: future }))).toBe(true)
  })

  it("fails when deadline has passed", () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(checkDeadline(makeRequest({ deadlineAt: past }))).toBe(false)
  })
})

// ── Composite admission ----------------------------------------------------

describe("evaluateAdmission", () => {
  const worker = makeWorker("ready")
  const models = [makeModel()]

  it("admits a valid request", () => {
    const req = makeRequest()
    const result = evaluateAdmission(req, worker, models, 3, 10)
    expect(result.admitted).toBe(true)
    expect(result.errorCode).toBeNull()
    expect(result.reason).toBeNull()
  })

  it("rejects when worker is draining", () => {
    const drainingWorker = makeWorker("draining")
    const result = evaluateAdmission(makeRequest(), drainingWorker, models, 0, 10)
    expect(result.admitted).toBe(false)
    expect(result.errorCode).toBe("worker_draining")
  })

  it("rejects when model not loaded", () => {
    const result = evaluateAdmission(
      makeRequest({ modelId: "unknown", modelArtifactDigest: "nonexistent" }),
      worker,
      models,
      0,
      10,
    )
    expect(result.admitted).toBe(false)
    expect(result.errorCode).toBe("model_not_loaded")
  })

  it("rejects when input token budget exceeded", () => {
    const req = makeRequest({ maxInputTokens: 99999 })
    const result = evaluateAdmission(req, worker, models, 0, 10, 50000, 50000)
    expect(result.admitted).toBe(false)
    expect(result.errorCode).toBe("input_too_large")
  })

  it("rejects when concurrency exceeded", () => {
    const result = evaluateAdmission(makeRequest(), worker, models, 10, 5)
    expect(result.admitted).toBe(false)
    expect(result.errorCode).toBe("worker_overloaded")
  })

  it("rejects when deadline passed", () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const req = makeRequest({ deadlineAt: past })
    const result = evaluateAdmission(req, worker, models, 0, 10)
    expect(result.admitted).toBe(false)
    expect(result.errorCode).toBe("request_timeout")
  })
})

// ── Execution lifecycle ----------------------------------------------------

describe("createExecution", () => {
  it("creates an execution in pending state", () => {
    const exec = createExecution("e1", "req-1", "abc123")
    expect(exec.executionId).toBe("e1")
    expect(exec.requestId).toBe("req-1")
    expect(exec.modelArtifactDigest).toBe("abc123")
    expect(exec.prefillState).toBe("pending")
    expect(exec.decodeState).toBe("pending")
    expect(exec.completedAt).toBeNull()
  })
})

describe("startExecution", () => {
  it("transitions prefill to running", () => {
    const exec = startExecution(createExecution("e1", "req-1", "abc123"))
    expect(exec.prefillState).toBe("running")
    expect(exec.decodeState).toBe("pending")
  })
})

describe("completeExecution", () => {
  it("transitions both states to completed", () => {
    const started = startExecution(createExecution("e1", "req-1", "abc123"))
    const done = completeExecution(started)
    expect(done.prefillState).toBe("completed")
    expect(done.decodeState).toBe("completed")
    expect(done.completedAt).not.toBeNull()
  })
})

describe("failExecution", () => {
  it("transitions decode to failed", () => {
    const started = startExecution(createExecution("e1", "req-1", "abc123"))
    const failed = failExecution(started)
    expect(failed.prefillState).toBe("failed")
    expect(failed.decodeState).toBe("failed")
    expect(failed.completedAt).not.toBeNull()
  })

  it("keeps prefill completed if already completed", () => {
    const exec = makeExec({ prefillState: "completed", decodeState: "running" })
    const failed = failExecution(exec)
    expect(failed.prefillState).toBe("completed")
    expect(failed.decodeState).toBe("failed")
  })
})

describe("cancelExecution", () => {
  it("transitions both states to cancelled", () => {
    const started = startExecution(createExecution("e1", "req-1", "abc123"))
    const cancelled = cancelExecution(started)
    expect(cancelled.prefillState).toBe("cancelled")
    expect(cancelled.decodeState).toBe("cancelled")
    expect(cancelled.completedAt).not.toBeNull()
  })
})

describe("getActiveExecutionCount", () => {
  it("counts only non-terminal executions", () => {
    const execs: PrismRequestExecution[] = [
      makeExec({ executionId: "e1", prefillState: "running", decodeState: "streaming" }),
      makeExec({
        executionId: "e2",
        prefillState: "completed",
        decodeState: "completed",
        completedAt: new Date().toISOString(),
      }),
      makeExec({ executionId: "e3", prefillState: "pending", decodeState: "pending" }),
      makeExec({
        executionId: "e4",
        prefillState: "completed",
        decodeState: "failed",
        completedAt: new Date().toISOString(),
      }),
    ]
    expect(getActiveExecutionCount(execs)).toBe(2) // e1 (streaming) + e3 (pending)
  })

  it("returns 0 for empty list", () => {
    expect(getActiveExecutionCount([])).toBe(0)
  })
})

describe("getExecutionsForRequest", () => {
  it("returns executions matching the requestId", () => {
    const execs = [
      makeExec({ executionId: "e1", requestId: "req-1" }),
      makeExec({ executionId: "e2", requestId: "req-2" }),
      makeExec({ executionId: "e3", requestId: "req-1" }),
    ]
    const found = getExecutionsForRequest("req-1", execs)
    expect(found).toHaveLength(2)
    expect(found.map((e) => e.executionId).sort()).toEqual(["e1", "e3"])
  })

  it("returns empty when no match", () => {
    const execs = [makeExec({ requestId: "req-2" })]
    expect(getExecutionsForRequest("req-1", execs)).toEqual([])
  })
})
