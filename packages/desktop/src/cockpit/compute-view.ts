/**
 * ComputeView — compute resource view: devices, leases, receipts summary.
 *
 * Pure data types and state machine — no UI rendering. Provides the logic
 * layer for the compute resource panel.
 */

/* ── Types ──────────────────────────────────────────────── */

export interface ComputeViewDevice {
  deviceId: string
  deviceClass: string
  availableMemoryBytes: number
  activeLeases: number
  healthState: string
}

export interface ComputeViewLease {
  leaseId: string
  sessionId: string
  deviceId: string
  status: string
  admittedAt: string
  completedAt: string | null
  receiptDigest: string | null
}

export interface ComputeViewSnapshot {
  sessionId: string
  devices: ComputeViewDevice[]
  activeLeases: ComputeViewLease[]
  completedLeases: ComputeViewLease[]
  totalComputeDurationMs: number
  totalTokensProcessed: number
}

/* ── Helpers ────────────────────────────────────────────── */

function copyLease(lease: ComputeViewLease): ComputeViewLease {
  return { ...lease }
}

function copyDevice(device: ComputeViewDevice): ComputeViewDevice {
  return { ...device }
}

/* ── Factory ────────────────────────────────────────────── */

export function createComputeSnapshot(sessionId: string): ComputeViewSnapshot {
  return {
    sessionId,
    devices: [],
    activeLeases: [],
    completedLeases: [],
    totalComputeDurationMs: 0,
    totalTokensProcessed: 0,
  }
}

/* ── Mutators ───────────────────────────────────────────── */

export function addDevice(
  snapshot: ComputeViewSnapshot,
  device: ComputeViewDevice,
): ComputeViewSnapshot {
  return {
    ...snapshot,
    devices: [...snapshot.devices, copyDevice(device)],
    activeLeases: [...snapshot.activeLeases],
    completedLeases: [...snapshot.completedLeases],
  }
}

export function addLease(
  snapshot: ComputeViewSnapshot,
  lease: ComputeViewLease,
): ComputeViewSnapshot {
  const isActive =
    lease.completedAt === null && lease.status !== "completed" && lease.status !== "failed"

  const target = isActive ? snapshot.activeLeases : snapshot.completedLeases
  const updated = [...target, copyLease(lease)]

  return {
    ...snapshot,
    devices: [...snapshot.devices],
    activeLeases: isActive ? updated : [...snapshot.activeLeases],
    completedLeases: isActive ? [...snapshot.completedLeases] : updated,
  }
}

/* ── Queries ────────────────────────────────────────────── */

export function getActiveDeviceCount(snapshot: ComputeViewSnapshot): number {
  return snapshot.devices.filter((d) => d.healthState !== "offline").length
}
