/**
 * TaskBoardSurface — task board with claim/complete/review workflow.
 *
 * Pure data types and state machine — no UI rendering. Provides the logic
 * layer that a LitElement or SolidJS component calls.
 */

/* ── Types ──────────────────────────────────────────────── */

export type TaskStatus =
  | "available"
  | "claimed"
  | "in_progress"
  | "submitted"
  | "accepted"
  | "rejected"
  | "cancelled"

export interface TaskBoardItem {
  taskId: string
  sessionId: string
  title: string
  description: string
  requiredEvidence: string[]
  disclosureClass: string
  computePolicy: string
  status: TaskStatus
  claimedBy: string | null
  submittedAt: string | null
  acceptedAt: string | null
}

/* ── Transition helpers ─────────────────────────────────── */

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  available:     ["claimed", "cancelled"],
  claimed:       ["cancelled"],
  in_progress:   ["submitted", "cancelled"],
  submitted:     ["accepted", "rejected"],
  accepted:      [],
  rejected:      ["available"],
  cancelled:     [],
}

function assertTransition(from: TaskStatus, to: TaskStatus): void {
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed?.includes(to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`)
  }
}

function copy<T extends TaskBoardItem>(item: T): T {
  return { ...item, requiredEvidence: [...item.requiredEvidence] }
}

/* ── Factory ────────────────────────────────────────────── */

export function createTaskItem(
  taskId: string,
  sessionId: string,
  title: string,
  description: string,
): TaskBoardItem {
  return {
    taskId,
    sessionId,
    title,
    description,
    requiredEvidence: [],
    disclosureClass: "standard",
    computePolicy: "default",
    status: "available",
    claimedBy: null,
    submittedAt: null,
    acceptedAt: null,
  }
}

/* ── Transitions ────────────────────────────────────────── */

export function claimTask(item: TaskBoardItem, contributorId: string): TaskBoardItem {
  assertTransition(item.status, "claimed")
  return { ...copy(item), status: "claimed", claimedBy: contributorId }
}

export function submitTask(item: TaskBoardItem): TaskBoardItem {
  assertTransition(item.status, "submitted")
  return {
    ...copy(item),
    status: "submitted",
    submittedAt: new Date().toISOString(),
  }
}

export function acceptTask(item: TaskBoardItem): TaskBoardItem {
  assertTransition(item.status, "accepted")
  return {
    ...copy(item),
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  }
}

export function rejectTask(item: TaskBoardItem, _reason: string): TaskBoardItem {
  assertTransition(item.status, "rejected")
  return { ...copy(item), status: "rejected" }
}

export function cancelTask(item: TaskBoardItem): TaskBoardItem {
  assertTransition(item.status, "cancelled")
  return { ...copy(item), status: "cancelled" }
}

/* ── Queries ────────────────────────────────────────────── */

export function getAvailableTasks(items: TaskBoardItem[]): TaskBoardItem[] {
  return items.filter((t) => t.status === "available")
}

export function getTasksByClaimant(
  items: TaskBoardItem[],
  contributorId: string,
): TaskBoardItem[] {
  return items.filter((t) => t.claimedBy === contributorId)
}
