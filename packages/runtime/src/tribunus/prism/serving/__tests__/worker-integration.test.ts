/**
 * Prism llm-d Worker — Integration Test
 *
 * End-to-end flow: worker lifecycle, model loading, request admission,
 * execution, receipt generation, drain, and stop.
 *
 * All tests use pure functions — no real HTTP server or Prism binary.
 */

import { expect, test, describe } from "bun:test"
import { applyWorkerAction, canAcceptRequests } from "../worker-lifecycle"
import { evaluateAdmission } from "../worker-admission"
import { createModelEntry, loadModel, completeLoad, isModelReady } from "../worker-model-registry"
import { createExecution, completeExecution, startExecution } from "../worker-request-store"
import { createWorkerReceipt, isReceiptValid } from "../worker-receipts"
import { beginDrain } from "../worker-drain"
import type { PrismWorkerCapabilities } from "../worker-types"

import type {
  PrismModelWorker,
  PrismWorkerRequest,
  PrismWorkerModel,
  PrismRequestExecution,
  WorkerLifecycleState,
} from "../worker-types"

describe("Worker integration — end-to-end flow", () => {
  test("full lifecycle: start → init → load → serve → admit → execute → receipt → drain → stop", () => {
    // ── 1. Create worker in starting state ─────────────────────────────────
    const capabilities: PrismWorkerCapabilities = {
      protocolVersion: 1,
      supportedWorkloadClasses: ["chat_completion"],
      supportedStreamModes: ["sse"],
      supportedArtifactFormats: ["gguf"],
      supportedComputeTargets: ["metal"],
      maximumConcurrentRequests: 4,
      maximumInputTokens: 4096,
      maximumOutputTokens: 2048,
      supportsCancellation: true,
      supportsStreaming: true,
      supportsKvEvents: false,
      supportsDrain: true,
      supportsDharmaLeaseCorrelation: false,
    }

    const worker: PrismModelWorker & { capabilities: PrismWorkerCapabilities } = {
      workerId: "wkr-001",
      workerInstanceId: "inst-001",
      workerVersion: "1.0.0",
      protocolVersion: 1,
      lifecycleState: "starting",
      advertisedModels: [],
      targetCapabilitySignature: "sig-default",
      containmentProfileDigest: null,
      deploymentClass: "default",
      startedAt: new Date().toISOString(),
      capabilities,
    }

    // ── 2. Initialize worker ───────────────────────────────────────────────
    worker.lifecycleState = applyWorkerAction(worker.lifecycleState, "initialize")
    expect(worker.lifecycleState).toBe("initializing")
    expect(canAcceptRequests(worker.lifecycleState)).toBe(false)

    // ── 3. Admit model artifact ────────────────────────────────────────────
    const model: PrismWorkerModel = createModelEntry(
      "artifact-abc-123-def-456",
      "llama",
      "tok-001",
    )
    expect(model.modelState).toBe("admitted")
    expect(model.artifactDigest).toBe("artifact-abc-123-def-456")
    expect(model.modelFamily).toBe("llama")

    // ── 4. Load model ──────────────────────────────────────────────────────
    worker.lifecycleState = applyWorkerAction(worker.lifecycleState, "load")
    expect(worker.lifecycleState).toBe("loading_model")

    const loadingModel = loadModel(model)
    expect(loadingModel.modelState).toBe("loading")

    const loadedModel = completeLoad(loadingModel, "compute-sha256-xxx", "sig-model-v1")
    expect(loadedModel.modelState).toBe("loaded")
    expect(loadedModel.computeImageDigest).toBe("compute-sha256-xxx")
    expect(loadedModel.targetCapabilitySignature).toBe("sig-model-v1")
    expect(loadedModel.loadedAt).not.toBeNull()
    expect(isModelReady(loadedModel)).toBe(true)

    // ── 5. Worker becomes ready ────────────────────────────────────────────
    worker.lifecycleState = applyWorkerAction(worker.lifecycleState, "become_ready")
    expect(worker.lifecycleState).toBe("ready")
    expect(canAcceptRequests(worker.lifecycleState)).toBe(true)

    // ── 6. Admit a valid request ───────────────────────────────────────────
    const request: PrismWorkerRequest = {
      requestId: "req-001",
      requestNamespace: "default",
      modelId: loadedModel.modelId,
      modelArtifactDigest: loadedModel.artifactDigest,
      workloadClass: "chat_completion",
      inputDigest: "input-hash-001",
      promptReference: "prompt-001",
      maxInputTokens: 512,
      maxOutputTokens: 256,
      samplingPolicy: '{"temperature": 0.7}',
      stream: false,
      deadlineAt: null,
      dharmaLeaseId: null,
      sessionId: null,
      traceContext: null,
    }

    const admission = evaluateAdmission(
      request,
      worker,
      [loadedModel],
      0,
      worker.capabilities.maximumConcurrentRequests,
    )
    expect(admission.admitted).toBe(true)
    expect(admission.errorCode).toBeNull()
    expect(admission.reason).toBeNull()

    // ── 7. Create execution ────────────────────────────────────────────────
    const execution: PrismRequestExecution = createExecution(
      "exec-001",
      request.requestId,
      request.modelArtifactDigest,
    )
    expect(execution.executionId).toBe("exec-001")
    expect(execution.prefillState).toBe("pending")
    expect(execution.decodeState).toBe("pending")
    expect(execution.completedAt).toBeNull()

    const started = startExecution(execution)
    expect(started.prefillState).toBe("running")

    // ── 8. Complete execution ──────────────────────────────────────────────
    const completed = completeExecution(started)
    expect(completed.prefillState).toBe("completed")
    expect(completed.decodeState).toBe("completed")
    expect(completed.completedAt).not.toBeNull()

    // ── 9. Generate receipt ────────────────────────────────────────────────
    const receipt = createWorkerReceipt({
      request,
      worker,
      execution: completed,
      inputTokens: 50,
      outputTokens: 100,
      prefillMs: 150,
      decodeMs: 1200,
      totalMs: 1350,
      peakMemoryBytes: 256 * 1024 * 1024,
      executionState: "completed",
    })

    expect(isReceiptValid(receipt)).toBe(true)
    expect(receipt.requestId).toBe("req-001")
    expect(receipt.workerId).toBe("wkr-001")
    expect(receipt.inputTokenCount).toBe(50)
    expect(receipt.outputTokenCount).toBe(100)
    expect(receipt.prefillDurationMs).toBe(150)
    expect(receipt.decodeDurationMs).toBe(1200)
    expect(receipt.totalDurationMs).toBe(1350)
    expect(receipt.executionState).toBe("completed")
    expect(receipt.workerSignature).toBeTruthy()
    expect(typeof receipt.workerSignature).toBe("string")
    expect(receipt.workerSignature.length).toBeGreaterThan(0)

    // ── 10. Drain worker → reject new requests ─────────────────────────────
    worker.lifecycleState = applyWorkerAction(worker.lifecycleState, "drain")
    expect(worker.lifecycleState).toBe("draining")
    expect(canAcceptRequests(worker.lifecycleState)).toBe(false)

    const drainState = beginDrain()
    expect(drainState.newRequestsRejected).toBe(true)

    // New request should be rejected during drain
    const rejectedRequest: PrismWorkerRequest = {
      requestId: "req-002",
      requestNamespace: "default",
      modelId: loadedModel.modelId,
      modelArtifactDigest: loadedModel.artifactDigest,
      workloadClass: "chat_completion",
      inputDigest: "input-hash-002",
      promptReference: "prompt-002",
      maxInputTokens: 64,
      maxOutputTokens: 64,
      samplingPolicy: '{"temperature": 0.5}',
      stream: false,
      deadlineAt: null,
      dharmaLeaseId: null,
      sessionId: null,
      traceContext: null,
    }

    const rejectedAdmission = evaluateAdmission(
      rejectedRequest,
      worker,
      [loadedModel],
      0,
      worker.capabilities.maximumConcurrentRequests,
    )
    expect(rejectedAdmission.admitted).toBe(false)
    expect(rejectedAdmission.errorCode).toBe("worker_draining")

    // ── 11. Stop worker ────────────────────────────────────────────────────
    worker.lifecycleState = applyWorkerAction(worker.lifecycleState, "stop")
    expect(worker.lifecycleState).toBe("stopped")
    expect(canAcceptRequests(worker.lifecycleState)).toBe(false)
  })
})
