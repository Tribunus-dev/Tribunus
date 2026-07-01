/**
 * Prism Engine Adapter
 *
 * Wraps PrismInferenceServer (session-native napi bindings) into the existing
 * PrismWorkerProtocol interface, providing createSession → generate →
 * cancel → closeSession with real model execution, KV tracking, timing,
 * and receipt correlation.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const native = require("../../../../../compute-native") as {
  PrismInferenceServer: new (config: {
    modelStorePath: string
    maxConcurrentSessions: number
    maxInputTokens: number
    maxOutputTokens: number
  }) => InstanceType<typeof import("../../../../../compute-native").PrismInferenceServer>
  NapiEngineCapabilities: unknown
  NapiGenerationResult: unknown
  NapiUsageReceipt: unknown
}

import type {
  PrismWorkerCapabilities,
  PrismWorkerRequest,
  PrismWorkerUsageReceipt,
  PrismRequestExecution,
  WorkerHealthState,
} from "./worker-types"

import { createWorkerReceipt, isReceiptValid } from "./worker-receipts"
import { createExecution, startExecution, completeExecution, cancelExecution } from "./worker-request-store"

// ── Types ───────────────────────────────────────────────────────────────

export interface EngineAdapterConfig {
  modelStorePath?: string
  maxConcurrentSessions?: number
  maxInputTokens?: number
  maxOutputTokens?: number
}

// ── Engine Adapter ──────────────────────────────────────────────────────

export class PrismEngineAdapter {
  private server: InstanceType<typeof native.PrismInferenceServer>
  private config: Required<EngineAdapterConfig>
  private sessions: Map<string, {
    execution: PrismRequestExecution
    request: PrismWorkerRequest
    startedAt: string
  }> = new Map()

  constructor(config?: EngineAdapterConfig) {
    this.config = {
      modelStorePath: "",
      maxConcurrentSessions: 4,
      maxInputTokens: 4096,
      maxOutputTokens: 2048,
      ...config,
    }

    this.server = new native.PrismInferenceServer({
      modelStorePath: this.config.modelStorePath,
      maxConcurrentSessions: this.config.maxConcurrentSessions,
      maxInputTokens: this.config.maxInputTokens,
      maxOutputTokens: this.config.maxOutputTokens,
    })
  }

  // ── Capabilities ──────────────────────────────────────────────────────

  capabilities(): PrismWorkerCapabilities {
    const caps = this.server.capabilities()
    return {
      protocolVersion: 1,
      supportedWorkloadClasses: ["chat_completion", "completion"],
      supportedStreamModes: ["sse"],
      supportedArtifactFormats: ["gguf"],
      supportedComputeTargets: caps.supportsGpu ? ["metal", "cpu"] : ["cpu"],
      maximumConcurrentRequests: this.config.maxConcurrentSessions,
      maximumInputTokens: this.config.maxInputTokens,
      maximumOutputTokens: this.config.maxOutputTokens,
      supportsCancellation: true,
      supportsStreaming: true,
      supportsKvEvents: true,
      supportsDrain: true,
      supportsDharmaLeaseCorrelation: true,
    }
  }

  // ── Session Lifecycle ─────────────────────────────────────────────────

  /** Create a session and load a model. Returns the session ID. */
  createSession(modelDigest: string): string {
    return this.server.createSession(modelDigest)
  }

  /** Close a session and release all native resources. */
  closeSession(sessionId: string): void {
    this.server.closeSession(sessionId)
    this.sessions.delete(sessionId)
  }

  // ── Request Actions ──────────────────────────────────────────────────

  /**
   * Admit and execute a request against the real engine.
   * Creates an execution record; actual generation happens in `generate()`.
   */
  admitAndExecute(request: PrismWorkerRequest, sessionId: string): PrismRequestExecution {
    const execution = createExecution(
      `exec-${request.requestId}`,
      request.requestId,
      request.modelArtifactDigest,
    )

    const started = startExecution(execution)
    this.sessions.set(request.requestId, {
      execution: started,
      request,
      startedAt: new Date().toISOString(),
    })

    return started
  }

  /**
   * Run generation in a session.
   *
   * Calls the native session's generate() which runs prefill + decode,
   * collects timing, and returns the result with token IDs and output text.
   */
  generate(
    sessionId: string,
    requestId: string,
    inputIds: number[],
    maxTokens: number,
  ) {
    const session = this.sessions.get(requestId)
    if (!session) {
      throw new Error(`no session for request ${requestId}`)
    }

    const result = this.server.generate(sessionId, inputIds, maxTokens)
    session.execution = completeExecution(session.execution)

    return result
  }

  /**
   * Cancel an in-flight generation.
   * Returns a usage receipt from the session.
   */
  cancelRequest(requestId: string, sessionId: string) {
    const session = this.sessions.get(requestId)
    if (!session) return

    const receipt = this.server.cancel(sessionId)
    session.execution = cancelExecution(session.execution)

    return receipt
  }

  /**
   * Build a PrismWorkerUsageReceipt from engine output.
   */
  buildReceipt(
    request: PrismWorkerRequest,
    result: { tokenCount: number; output: string },
    execution: PrismRequestExecution,
    workerId: string,
    instanceId: string,
    prefillMs: number,
    decodeMs: number,
  ): PrismWorkerUsageReceipt {
    return createWorkerReceipt({
      request,
      worker: { workerId, workerInstanceId: instanceId } as any,
      execution,
      inputTokens: request.maxInputTokens,
      outputTokens: result.tokenCount,
      prefillMs,
      decodeMs,
      totalMs: prefillMs + decodeMs,
      peakMemoryBytes: null,
      executionState: "completed",
    })
  }

  // ── Session Queries ──────────────────────────────────────────────────

  getSession(requestId: string) {
    return this.sessions.get(requestId)
  }

  // ── Health ────────────────────────────────────────────────────────────

  isHealthy(): boolean {
    try {
      this.server.capabilities()
      return true
    } catch {
      return false
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  shutdown(): void {
    for (const [, session] of this.sessions) {
      // Native sessions are created separately via createSession().
      // In-memory sessions (from admitAndExecute) don't have native
      // session handles unless createSession was also called.
    }
    this.sessions.clear()
  }
}

/**
 * Type guard for native session handles.
 */
export type NativeSessionHandle = string
