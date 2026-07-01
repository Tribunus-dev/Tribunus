/**
 * Prism llm-d Worker — Model Artifact Registry
 *
 * Pure state-transition functions for the model artifact lifecycle.
 * Each function returns a new PrismWorkerModel with updated state.
 */

import type { PrismWorkerModel } from "./worker-types"
import { applyModelAction } from "./worker-lifecycle"

// ── Factory ----------------------------------------------------------------

/**
 * Create the initial model entry, state = "admitted".
 */
export function createModelEntry(
  artifactDigest: string,
  modelFamily: string,
  tokenizerDigest: string,
): PrismWorkerModel {
  const now = new Date().toISOString()
  return {
    modelId: `model-${artifactDigest.slice(0, 12)}`,
    artifactDigest,
    tokenizerDigest,
    modelFamily,
    quantizationScheme: "unknown",
    artifactAdmissionState: "admitted",
    computeImageDigest: "",
    targetCapabilitySignature: "",
    modelState: "admitted",
    loadedAt: null,
    lastUsedAt: null,
  }
}

// ── State transitions ------------------------------------------------------

/**
 * Transition: admitted → loading.
 */
export function loadModel(model: PrismWorkerModel): PrismWorkerModel {
  const nextState = applyModelAction(model.modelState, "load")
  return { ...model, modelState: nextState }
}

/**
 * Transition: loading → loaded.
 * Populates compute image and target signature once loading completes.
 */
export function completeLoad(
  model: PrismWorkerModel,
  computeDigest: string,
  targetSig: string,
): PrismWorkerModel {
  const nextState = applyModelAction(model.modelState, "load_complete")
  const now = new Date().toISOString()
  return {
    ...model,
    modelState: nextState,
    computeImageDigest: computeDigest,
    targetCapabilitySignature: targetSig,
    loadedAt: now,
    lastUsedAt: now,
  }
}

/**
 * Transition: loading → failed.
 */
export function failModel(model: PrismWorkerModel): PrismWorkerModel {
  const nextState = applyModelAction(model.modelState, "fail")
  return { ...model, modelState: nextState }
}

/**
 * Transition: loaded → draining → unloading → unavailable (full unload).
 * Requires two consecutive calls (drain then unload).
 */
export function unloadModel(model: PrismWorkerModel): PrismWorkerModel {
  if (model.modelState === "loaded") {
    const drained = applyModelAction(model.modelState, "drain")
    return { ...model, modelState: drained }
  }
  if (model.modelState === "draining") {
    const unloaded = applyModelAction(model.modelState, "unload")
    return { ...model, modelState: unloaded }
  }
  // unloading → unavailable
  const nextState = applyModelAction(model.modelState, "unload")
  return { ...model, modelState: nextState }
}

/**
 * Transition: any → revoked (admitted only).
 * Or: loaded → failed → revoked if called directly.
 */
export function revokeModel(model: PrismWorkerModel): PrismWorkerModel {
  const nextState = applyModelAction(model.modelState, "revoke")
  return { ...model, modelState: nextState }
}

// ── Queries ----------------------------------------------------------------

/**
 * Returns true only when the model is fully loaded and ready to serve.
 */
export function isModelReady(model: PrismWorkerModel): boolean {
  return model.modelState === "loaded"
}
