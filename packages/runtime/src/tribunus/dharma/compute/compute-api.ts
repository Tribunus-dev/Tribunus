/**
 * Dharma Local Prism Compute — In-Memory API
 *
 * Provides an in-memory API surface wrapping the compute lease lifecycle,
 * artifact admission, budget enforcement, Prism adapter, execution,
 * usage receipts, KV namespace tracking, and recovery. All data lives in
 * Maps; no persistence, no IO.
 */

import crypto from "node:crypto"
import {
  type PrismArtifactAdmission,
  type LocalPrismComputeLease,
  type ComputeImagePolicy,
  type PrismUsageReceipt,
  type ComputeLeaseStatus,
  type ComputeBackendKind,
  type ComputeWorkloadClass,
} from "./compute-types"
import { LeaseError, ArtifactError, ComputeCancelledError } from "./compute-errors"

// ── Internal helpers ──────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString()
}

// ── ComputeApi ────────────────────────────────────────────────────────────────

export class ComputeApi {
  private readonly artifacts = new Map<string, PrismArtifactAdmission>()
  private readonly leases = new Map<string, LocalPrismComputeLease>()
  private readonly policies = new Map<string, ComputeImagePolicy>()
  private readonly executionStatuses = new Map<string, string>()
  private readonly usageReceipts = new Map<string, PrismUsageReceipt>()
  private readonly kvSummaries = new Map<
    string,
    { namespaceCount: number; activeNamespaces: number; totalHits: number | null }
  >()

  // ── Artifacts ──────────────────────────────────────────────────────────────

  listLocalArtifacts(): PrismArtifactAdmission[] {
    return Array.from(this.artifacts.values())
  }

  inspectLocalArtifact(digest: string): PrismArtifactAdmission | undefined {
    return this.artifacts.get(digest)
  }

  // ── Capabilities ───────────────────────────────────────────────────────────

  getLocalCapabilities(): {
    available: boolean
    supportedTargets: string[]
    supportedWorkloads: string[]
  } {
    // Discover from admitted artifacts
    const supportedTargets = new Set<string>()
    const supportedWorkloads = new Set<string>()
    for (const art of this.artifacts.values()) {
      for (const t of art.supportedComputeTargets) supportedTargets.add(t)
      for (const w of art.supportedWorkloadClasses) supportedWorkloads.add(w)
    }
    return {
      available: this.artifacts.size > 0,
      supportedTargets: Array.from(supportedTargets),
      supportedWorkloads: Array.from(supportedWorkloads),
    }
  }

  // ── Lease lifecycle ────────────────────────────────────────────────────────

  requestLocalLease(config: Partial<LocalPrismComputeLease>): LocalPrismComputeLease {
    const nowISO = now()
    const lease: LocalPrismComputeLease = {
      leaseId: config.leaseId ?? crypto.randomUUID(),
      sessionId: config.sessionId ?? "",
      taskId: config.taskId ?? null,
      requesterIdentityPublicKey: config.requesterIdentityPublicKey ?? "",
      requesterMembershipId: config.requesterMembershipId ?? "",
      approvingIdentityPublicKey: config.approvingIdentityPublicKey ?? null,
      grantId: config.grantId ?? "",
      sessionKeyEpoch: config.sessionKeyEpoch ?? 0,
      backendKind: (config.backendKind ?? "prism_local") as ComputeBackendKind,
      workloadClass: (config.workloadClass ?? "chat_completion") as ComputeWorkloadClass,
      modelArtifactDigest: config.modelArtifactDigest ?? "",
      computeImagePolicyDigest: config.computeImagePolicyDigest ?? "",
      inputDisclosureClass: config.inputDisclosureClass ?? "local_private",
      inputDigest: config.inputDigest ?? "",
      inputReference: config.inputReference ?? null,
      outputDisclosureClass: config.outputDisclosureClass ?? "local_private",
      requestedMaxTokens: config.requestedMaxTokens ?? null,
      requestedMaxRuntimeSeconds: config.requestedMaxRuntimeSeconds ?? 60,
      requestedMaxMemoryBytes: config.requestedMaxMemoryBytes ?? 536870912,
      requestedMaxOutputBytes: config.requestedMaxOutputBytes ?? 1048576,
      requestedMaxGpuTimeMs: config.requestedMaxGpuTimeMs ?? null,
      requiredContainmentLevel: config.requiredContainmentLevel ?? "contained",
      approvalPolicy: config.approvalPolicy ?? "",
      status: (config.status ?? "draft") as ComputeLeaseStatus,
      issuedAt: config.issuedAt ?? nowISO,
      expiresAt: config.expiresAt ?? null,
      revokedAt: config.revokedAt ?? null,
      cancellationReason: config.cancellationReason ?? null,
      signatureChain: config.signatureChain ?? "",
    }
    this.leases.set(lease.leaseId, lease)
    return lease
  }

  approveLocalLease(leaseId: string): void {
    const lease = this.leases.get(leaseId)
    if (!lease) throw new LeaseError(`Lease not found: ${leaseId}`)
    this.leases.set(leaseId, { ...lease, status: "approved" })
  }

  rejectLocalLease(leaseId: string): void {
    const lease = this.leases.get(leaseId)
    if (!lease) throw new LeaseError(`Lease not found: ${leaseId}`)
    this.leases.set(leaseId, { ...lease, status: "rejected" })
  }

  cancelLocalLease(leaseId: string): void {
    const lease = this.leases.get(leaseId)
    if (!lease) throw new LeaseError(`Lease not found: ${leaseId}`)
    this.leases.set(leaseId, { ...lease, status: "cancelled", cancellationReason: "user_cancelled" })
  }

  getLease(leaseId: string): LocalPrismComputeLease | undefined {
    return this.leases.get(leaseId)
  }

  listLeases(sessionId?: string): LocalPrismComputeLease[] {
    const all = Array.from(this.leases.values())
    if (sessionId) return all.filter((l) => l.sessionId === sessionId)
    return all
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  executeLocalPrism(leaseId: string): string {
    const lease = this.leases.get(leaseId)
    if (!lease) throw new LeaseError(`Lease not found: ${leaseId}`)

    if (lease.status !== "approved" && lease.status !== "admitted") {
      throw new LeaseError(
        `Cannot execute lease ${leaseId} in status "${lease.status}"`,
      )
    }

    const executionId = crypto.randomUUID()
    this.leases.set(leaseId, { ...lease, status: "running" })
    this.executionStatuses.set(leaseId, "running")
    return executionId
  }

  async *streamLocalPrism(leaseId: string): AsyncGenerator<string> {
    const lease = this.leases.get(leaseId)
    if (!lease) throw new LeaseError(`Lease not found: ${leaseId}`)

    if (lease.status !== "approved" && lease.status !== "admitted") {
      throw new LeaseError(
        `Cannot stream lease ${leaseId} in status "${lease.status}"`,
      )
    }

    this.leases.set(leaseId, { ...lease, status: "streaming" })
    this.executionStatuses.set(leaseId, "streaming")
    yield `lease:${leaseId}:stream:start`
  }

  getExecutionStatus(leaseId: string): string | undefined {
    if (!this.leases.has(leaseId)) return undefined
    return this.executionStatuses.get(leaseId) ?? this.leases.get(leaseId)?.status
  }

  // ── Receipts ───────────────────────────────────────────────────────────────

  getUsageReceipt(leaseId: string): PrismUsageReceipt | undefined {
    return this.usageReceipts.get(leaseId)
  }

  // Internal: allow receipt registration
  private setUsageReceipt(leaseId: string, receipt: PrismUsageReceipt): void {
    this.usageReceipts.set(leaseId, receipt)
  }

  // ── Policy ─────────────────────────────────────────────────────────────────

  setSessionComputePolicy(sessionId: string, policy: Partial<ComputeImagePolicy>): void {
    const existing = this.policies.get(sessionId)
    const merged: ComputeImagePolicy = {
      policyDigest: existing?.policyDigest ?? policy.policyDigest ?? crypto.randomUUID(),
      allowedTargets: policy.allowedTargets ?? existing?.allowedTargets ?? [],
      requiredDeterminismClass: policy.requiredDeterminismClass ?? existing?.requiredDeterminismClass ?? "",
      allowedPrecisionModes: policy.allowedPrecisionModes ?? existing?.allowedPrecisionModes ?? [],
      allowedMemoryTiers: policy.allowedMemoryTiers ?? existing?.allowedMemoryTiers ?? [],
      maxCompileTimeMs: policy.maxCompileTimeMs ?? existing?.maxCompileTimeMs ?? 30000,
      maxModelLoadTimeMs: policy.maxModelLoadTimeMs ?? existing?.maxModelLoadTimeMs ?? 30000,
      allowCacheReuse: policy.allowCacheReuse ?? existing?.allowCacheReuse ?? true,
      allowCompiledArtifactReuse: policy.allowCompiledArtifactReuse ?? existing?.allowCompiledArtifactReuse ?? true,
      requireArtifactSealing: policy.requireArtifactSealing ?? existing?.requireArtifactSealing ?? true,
      requireExecutionReceipts: policy.requireExecutionReceipts ?? existing?.requireExecutionReceipts ?? true,
    }
    this.policies.set(sessionId, merged)
  }

  getSessionComputePolicy(sessionId: string): ComputeImagePolicy | undefined {
    return this.policies.get(sessionId)
  }

  // ── KV ─────────────────────────────────────────────────────────────────────

  getKvSummary(leaseId: string): {
    namespaceCount: number
    activeNamespaces: number
    totalHits: number | null
  } {
    const existing = this.kvSummaries.get(leaseId)
    if (existing) return existing
    return { namespaceCount: 0, activeNamespaces: 0, totalHits: null }
  }

  invalidateLeaseKv(leaseId: string): void {
    this.kvSummaries.delete(leaseId)
  }

  // Internal: register a KV summary
  private setKvSummary(
    leaseId: string,
    summary: { namespaceCount: number; activeNamespaces: number; totalHits: number | null },
  ): void {
    this.kvSummaries.set(leaseId, summary)
  }

  // ── Recovery ───────────────────────────────────────────────────────────────

  recoverPendingLeases(): string[] {
    const pending: string[] = []
    for (const [leaseId, lease] of this.leases) {
      if (
        lease.status === "running" ||
        lease.status === "streaming" ||
        lease.status === "draft" ||
        lease.status === "requested" ||
        lease.status === "pending_approval"
      ) {
        pending.push(leaseId)
      }
    }
    return pending
  }
}
