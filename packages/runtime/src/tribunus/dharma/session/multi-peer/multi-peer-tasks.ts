/**
 * Dharma Multi-Peer Result Convergence — Task Lifecycle State Machine
 */

import crypto from "node:crypto"
import type {
  DharmaTaskContract,
  TaskKind,
  TaskParallelism,
  TaskStatus,
} from "./multi-peer-types"

// ── Extended Status ───────────────────────────────────────────────────────────
// The task state machine visits states beyond the core TaskStatus set
// (conflict resolution states like "conflicted", "resolved", "superseded").

export type ExtendedTaskStatus =
  | TaskStatus
  | "conflicted"
  | "released"
  | "expired"
  | "resolved"
  | "rejected"
  | "rebase_requested"
  | "superseded"

// ── Task Actions ──────────────────────────────────────────────────────────────

export type TaskAction =
  | "publish"
  | "make_available"
  | "claim"
  | "start"
  | "submit_result"
  | "accept"
  | "complete"
  | "cancel"
  | "release"
  | "expire"
  | "reject"
  | "conflict"
  | "rebase"
  | "resolve"
  | "supersede"

// ── Valid Transitions ─────────────────────────────────────────────────────────

export const VALID_TASK_TRANSITIONS: Record<string, readonly string[]> = {
  draft:                 ["published"],
  published:             ["available"],
  available:             ["claimed", "cancelled"],
  claimed:               ["in_progress", "released", "expired"],
  in_progress:           ["result_submitted"],
  result_submitted:      ["accepted", "rejected", "conflicted"],
  accepted:              ["completed"],
  completed:             [],
  cancelled:             [],
  conflicted:            ["rebase_requested", "resolved", "rejected", "superseded"],
  released:              [],
  expired:               [],
  resolved:              [],
  rejected:              [],
  rebase_requested:      [],
  superseded:            [],
} as const

// ── Action → Target Status Mapping ────────────────────────────────────────────
// Each action maps to exactly one target status when originating from a
// given current state.  This lookup drives `applyTaskAction`.

const ACTION_TARGET: Record<TaskAction, string> = {
  publish:       "published",
  make_available: "available",
  claim:         "claimed",
  start:         "in_progress",
  submit_result:  "result_submitted",
  accept:        "accepted",
  complete:      "completed",
  cancel:        "cancelled",
  release:       "released",
  expire:        "expired",
  reject:        "rejected",
  conflict:      "conflicted",
  rebase:        "rebase_requested",
  resolve:       "resolved",
  supersede:     "superseded",
}

// ── applyTaskAction ───────────────────────────────────────────────────────────

export function applyTaskAction(
  current: ExtendedTaskStatus,
  action: TaskAction,
): ExtendedTaskStatus {
  const allowed = VALID_TASK_TRANSITIONS[current] ?? []
  const target = ACTION_TARGET[action]

  if (!allowed.includes(target)) {
    throw new Error(
      `Invalid task transition: ${current} → ${target} (action: ${action})`,
    )
  }

  return target as ExtendedTaskStatus
}

// ── createTask ────────────────────────────────────────────────────────────────

export interface CreateTaskConfig {
  sessionId: string
  createdBy: string
  title: string
  taskKind: TaskKind
  parallelism?: TaskParallelism
  sourceBasisDigest: string
  allowedPathScopes?: string[]
}

export function createTask(config: CreateTaskConfig): DharmaTaskContract {
  const now = new Date().toISOString()
  const parallelism = config.parallelism ?? "exclusive"

  return {
    taskId: crypto.randomUUID(),
    sessionId: config.sessionId,
    createdByIdentityPublicKey: config.createdBy,
    title: config.title,
    summary: "",
    taskKind: config.taskKind,
    sourceBasisDigest: config.sourceBasisDigest,
    sourceDisclosurePackageId: null,
    parallelism: parallelism as TaskParallelism,
    allowedPathScopes: config.allowedPathScopes ?? [],
    deniedPathScopes: [],
    expectedArtifactClasses: [],
    verificationContract: "default",
    acceptancePolicy: "attested",
    requiredCapabilities: [],
    assignedMembershipIds: [],
    maxContributors: parallelism === "exclusive" ? 1 : 3,
    maxResultBundles: 10,
    claimDeadline: null,
    completionDeadline: null,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    signature: "",
  }
}

// ── Query Helpers ─────────────────────────────────────────────────────────────

export function isTaskClaimable(task: DharmaTaskContract): boolean {
  if (task.status !== "available") return false
  if (task.maxContributors <= 0) return false
  return true
}

export function isTaskCompleted(task: DharmaTaskContract): boolean {
  return task.status === "completed" || task.status === "cancelled"
}
