/**
 * Prism llm-d Worker — Lifecycle State Machines
 */

import type { WorkerLifecycleState, ModelState, WorkerHealthState } from "./worker-types"

// ── Worker Lifecycle --------------------------------------------------------

export const VALID_WORKER_TRANSITIONS: Record<WorkerLifecycleState, readonly WorkerLifecycleState[]> = {
  starting: ["initializing", "failed"], initializing: ["loading_model", "failed"],
  loading_model: ["ready", "failed"], ready: ["serving", "draining"],
  serving: ["degraded", "draining"], degraded: ["serving", "draining"],
  draining: ["stopped"], stopped: [], failed: [],
}

export type WorkerAction = "initialize" | "load" | "become_ready" | "serve" | "degrade" | "recover" | "drain" | "stop" | "fail"

export function applyWorkerAction(current: WorkerLifecycleState, action: WorkerAction): WorkerLifecycleState {
  const map: Record<WorkerLifecycleState, Partial<Record<WorkerAction, WorkerLifecycleState>>> = {
    starting: { initialize: "initializing", fail: "failed" },
    initializing: { load: "loading_model", fail: "failed" },
    loading_model: { become_ready: "ready", fail: "failed" },
    ready: { serve: "serving", recover: "serving", drain: "draining" },
    serving: { degrade: "degraded", drain: "draining" },
    degraded: { recover: "serving", drain: "draining" },
    draining: { stop: "stopped" }, stopped: {}, failed: {},
  }
  const next = map[current][action]
  if (!next) throw new Error(`Invalid worker transition: ${current} → ${action}`)
  return next
}

export function canAcceptRequests(state: WorkerLifecycleState): boolean {
  return state === "ready" || state === "serving" || state === "degraded"
}

// ── Model State -------------------------------------------------------------

export const VALID_MODEL_TRANSITIONS: Record<ModelState, readonly ModelState[]> = {
  unavailable: ["admitted"], admitted: ["loading", "revoked"],
  loading: ["loaded", "failed"], loaded: ["draining", "failed"],
  draining: ["unloading", "failed"], unloading: ["unavailable"],
  failed: ["admitted"], revoked: [],
}

export type ModelAction = "admit" | "load" | "load_complete" | "drain" | "unload" | "revoke" | "fail" | "retry"

export function applyModelAction(current: ModelState, action: ModelAction): ModelState {
  const map: Record<ModelState, Partial<Record<ModelAction, ModelState>>> = {
    unavailable: { admit: "admitted" },
    admitted: { load: "loading", revoke: "revoked" },
    loading: { load_complete: "loaded", fail: "failed" },
    loaded: { drain: "draining", fail: "failed" },
    draining: { unload: "unloading", fail: "failed" },
    unloading: { unload: "unavailable" },
    failed: { retry: "admitted" }, revoked: {},
  }
  const next = map[current][action]
  if (!next) throw new Error(`Invalid model transition: ${current} → ${action}`)
  return next
}

// ── Health State ------------------------------------------------------------

export const VALID_HEALTH_TRANSITIONS: Record<WorkerHealthState, readonly WorkerHealthState[]> = {
  healthy: ["degraded", "draining", "unhealthy"],
  degraded: ["healthy", "draining", "unhealthy"],
  unhealthy: ["healthy", "draining"],
  draining: ["unhealthy", "healthy"],
}
