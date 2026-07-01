/**
 * Prism llm-d Worker — LlmDPrismAdapter
 *
 * Interface and helper utilities for the llm-d adapter layer that
 * bridges the Prism Engine into an llm-d-compatible distributed serving path.
 */

import type {
  PrismWorkerCapabilities,
  PrismWorkerModel,
  WorkerHealthState,
  PrismWorkerRequest,
  PrismKvEventBatch,
  PrismWorkerUsageReceipt,
} from "./worker-types"

/**
 * The LlmDPrismAdapter contract that concrete implementations must fulfill.
 * This is the boundary between the Prism Engine and the llm-d serving runtime.
 */
export interface LlmDPrismAdapter {
  getWorkerCapabilities(): PrismWorkerCapabilities
  getModelInventory(): PrismWorkerModel[]
  getHealth(): WorkerHealthState
  getReadiness(): boolean
  beginDrain(): void
  routeRequest(request: PrismWorkerRequest): { accepted: boolean; executionId?: string; error?: string }
  cancelRequest(requestId: string): void
  getMetricsEndpoint(): string
  subscribeKvEvents(): AsyncIterable<PrismKvEventBatch>
  replayKvEvents(afterSequence: number): PrismKvEventBatch[]
  getUsageReceipt(requestId: string): PrismWorkerUsageReceipt | null
}

/**
 * Create a default adapter stub that reports the worker as healthy
 * and ready but rejects all requests (useful during initialization).
 */
export function createDefaultAdapterStub(workerId: string): LlmDPrismAdapter {
  const baseCapabilities: PrismWorkerCapabilities = {
    protocolVersion: 1,
    supportedWorkloadClasses: ["chat_completion", "completion"],
    supportedStreamModes: ["sse"],
    supportedArtifactFormats: ["gguf"],
    supportedComputeTargets: ["metal"],
    maximumConcurrentRequests: 1,
    maximumInputTokens: 4096,
    maximumOutputTokens: 4096,
    supportsCancellation: true,
    supportsStreaming: true,
    supportsKvEvents: false,
    supportsDrain: true,
    supportsDharmaLeaseCorrelation: false,
  }

  return {
    getWorkerCapabilities(): PrismWorkerCapabilities {
      return { ...baseCapabilities }
    },

    getModelInventory(): PrismWorkerModel[] {
      return []
    },

    getHealth(): WorkerHealthState {
      return "healthy"
    },

    getReadiness(): boolean {
      return false
    },

    beginDrain(): void {
      /* stub — no-op until bound to a real adapter */
    },

    routeRequest(_request: PrismWorkerRequest): { accepted: boolean; executionId?: string; error?: string } {
      return { accepted: false, error: "adapter not initialized" }
    },

    cancelRequest(_requestId: string): void {
      /* stub — no-op until bound to a real adapter */
    },

    getMetricsEndpoint(): string {
      return `/worker/${workerId}/metrics`
    },

    async *subscribeKvEvents(): AsyncIterable<PrismKvEventBatch> {
      /* stub — no-op; yields nothing */
    },

    replayKvEvents(_afterSequence: number): PrismKvEventBatch[] {
      return []
    },

    getUsageReceipt(_requestId: string): PrismWorkerUsageReceipt | null {
      return null
    },
  }
}
