/**
 * Prism llm-d Worker — PrismWorkerProtocol Contract
 *
 * Defines the full worker-facing API surface for an OpenAI-compatible
 * serving worker that bridges Prism Engine into the llm-d distributed
 * serving path.
 */

import type {
  PrismWorkerCapabilities,
  PrismWorkerModel,
  PrismWorkerRequest,
  WorkerHealthState,
} from "./worker-types"

import type { PrismWorkerUsageReceipt } from "./worker-types"

export interface PrismWorkerProtocol {
  /** Return static capabilities of this worker instance. */
  capabilities(): PrismWorkerCapabilities

  /** List all known models (regardless of state). */
  listModels(): PrismWorkerModel[]

  /** Start loading a model artifact by its digest. Returns once loading
   *  begins (not necessarily completes). */
  loadModel(artifactDigest: string): Promise<PrismWorkerModel>

  /** Unload a previously loaded model. */
  unloadModel(modelId: string): Promise<void>

  /** Return the model for a given modelId, or null if unknown. */
  getModelStatus(modelId: string): PrismWorkerModel | null

  /** Attempt to admit a request for execution.
   *  Returns { admitted: true, executionId } on success,
   *  or { admitted: false, reason } on denial. */
  admitRequest(request: PrismWorkerRequest): {
    admitted: boolean
    reason: string | null
    executionId?: string
  }

  /** Cancel an in-flight request by its requestId. */
  cancelRequest(requestId: string): void

  /** Current health state of the worker. */
  getHealth(): WorkerHealthState

  /** True if the worker can accept requests right now. */
  getReadiness(): boolean

  /** Begin graceful drain — stop accepting new requests,
   *  finish in-flight work. */
  beginDrain(): void

  /** Immediate stop — terminate all execution. */
  stopWorker(): void

  /** Retrieve the usage receipt for a completed/cancelled request. */
  getUsageReceipt(requestId: string): PrismWorkerUsageReceipt | null

  /** Recover the requestIds of in-flight requests (e.g. after restart). */
  recoverInFlightRequests(): string[]
}
