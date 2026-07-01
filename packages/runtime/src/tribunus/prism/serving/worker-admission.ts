/**
 * Prism llm-d Worker — Request Admission Chain
 *
 * Pure functions that evaluate whether a request can be admitted
 * for execution.  Each check returns a structured result.
 */

import type {
  PrismWorkerRequest,
  PrismWorkerModel,
  PrismModelWorker,
  WorkerErrorCode,
} from "./worker-types"

import { canAcceptRequests } from "./worker-lifecycle"

// ── Composite admission -----------------------------------------------------

export interface AdmissionResult {
  admitted: boolean
  errorCode: WorkerErrorCode | null
  reason: string | null
}

/**
 * Run every gate in the admission chain.  Returns the first rejection
 * or a successful admission.
 *
 * @param maxInput  Maximum allowed input tokens (from worker capability).
 * @param maxOutput Maximum allowed output tokens (from worker capability).
 */
export function evaluateAdmission(
  request: PrismWorkerRequest,
  worker: PrismModelWorker,
  models: PrismWorkerModel[],
  inflight: number,
  maxConcurrent: number,
  maxInput: number = Infinity,
  maxOutput: number = Infinity,
): AdmissionResult {
  // 1. Worker state
  if (!checkWorkerState(worker)) {
    return {
      admitted: false,
      errorCode: "worker_draining",
      reason: "Worker is not accepting requests (draining/stopped)",
    }
  }

  // 2. Model loaded
  const modelCheck = checkModelLoaded(request, models)
  if (!modelCheck.loaded) {
    return {
      admitted: false,
      errorCode: modelCheck.errorCode!,
      reason: `Model ${request.modelId} is not in loaded state`,
    }
  }

  // 3. Input/output token budget
  const budgetCheck = checkTokenBudget(request, maxInput, maxOutput)
  if (!budgetCheck.valid) {
    return {
      admitted: false,
      errorCode: budgetCheck.errorCode!,
      reason: `Request exceeds token budget (input: ${request.maxInputTokens}, output: ${request.maxOutputTokens})`,
    }
  }

  // 4. Concurrency
  const concurrencyCheck = checkConcurrency(inflight, maxConcurrent)
  if (!concurrencyCheck.available) {
    return {
      admitted: false,
      errorCode: concurrencyCheck.errorCode!,
      reason: `Worker at capacity (${inflight}/${maxConcurrent} in-flight)`,
    }
  }

  // 5. Deadline
  if (!checkDeadline(request)) {
    return {
      admitted: false,
      errorCode: "request_timeout",
      reason: "Request deadline has already passed",
    }
  }

  return { admitted: true, errorCode: null, reason: null }
}

// ── Individual gates --------------------------------------------------------

export function checkWorkerState(worker: PrismModelWorker): boolean {
  return canAcceptRequests(worker.lifecycleState)
}

export function checkModelLoaded(
  request: PrismWorkerRequest,
  models: PrismWorkerModel[],
): { loaded: boolean; errorCode: WorkerErrorCode | null } {
  const model = models.find(
    (m) => m.modelId === request.modelId || m.artifactDigest === request.modelArtifactDigest,
  )
  if (!model) {
    return { loaded: false, errorCode: "model_not_loaded" }
  }
  if (model.modelState !== "loaded") {
    return { loaded: false, errorCode: "model_not_loaded" }
  }
  return { loaded: true, errorCode: null }
}

export function checkTokenBudget(
  request: PrismWorkerRequest,
  maxInput: number,
  maxOutput: number,
): { valid: boolean; errorCode: WorkerErrorCode | null } {
  if (request.maxInputTokens > 0 && request.maxInputTokens > maxInput) {
    return { valid: false, errorCode: "input_too_large" }
  }
  if (request.maxOutputTokens > 0 && request.maxOutputTokens > maxOutput) {
    return { valid: false, errorCode: "output_budget_exceeded" }
  }
  return { valid: true, errorCode: null }
}

export function checkConcurrency(
  inflight: number,
  maxConcurrent: number,
): { available: boolean; errorCode: WorkerErrorCode | null } {
  if (inflight >= maxConcurrent) {
    return { available: false, errorCode: "worker_overloaded" }
  }
  return { available: true, errorCode: null }
}

export function checkDeadline(request: PrismWorkerRequest): boolean {
  if (!request.deadlineAt) return true
  const deadline = new Date(request.deadlineAt).getTime()
  return Date.now() < deadline
}
