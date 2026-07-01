/**
 * Dharma Trusted-LAN Prism Compute — In-Memory API
 *
 * Provides an in-memory API surface wrapping provider enrollment, capability
 * advertisement, pairing, typed trust scopes, encrypted transport, remote
 * lease negotiation, provider-side admission, and usage receipts. All data
 * lives in Maps; no persistence, no IO.
 */

import crypto from "node:crypto"
import {
  type PrismLanProvider,
  type PrismLanProviderTrust,
  type LanPairing,
  type ProviderHealthState,
  type PrismLanComputeLease,
  type RemoteLeaseStatus,
  type PrismLanUsageReceipt,
  type LeaseBackendKind,
} from "./trusted-lan-types"
import {
  LeaseAdmissionError,
  PairingError,
  TrustError,
  ProviderError,
} from "./trusted-lan-errors"

// ── Internal helpers ──────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString()
}

function randomId(): string {
  return crypto.randomUUID()
}

// ── TrustedLanApi ─────────────────────────────────────────────────────────────

export class TrustedLanApi {
  private readonly providers = new Map<string, PrismLanProvider>()
  private readonly trusts = new Map<string, PrismLanProviderTrust>()
  private readonly pairings = new Map<string, LanPairing>()
  private readonly leases = new Map<string, PrismLanComputeLease>()
  private readonly usageReceipts = new Map<string, PrismLanUsageReceipt>()
  private readonly policies = new Map<string, string>()
  private discoveryActive = false

  // ── Discovery ──────────────────────────────────────────────────────────────

  startLanDiscovery(): void {
    this.discoveryActive = true
  }

  stopLanDiscovery(): void {
    this.discoveryActive = false
  }

  // ── Provider Enrollment ────────────────────────────────────────────────────

  listLanProviders(): PrismLanProvider[] {
    return Array.from(this.providers.values())
  }

  inspectLanProvider(providerId: string): PrismLanProvider | undefined {
    return this.providers.get(providerId)
  }

  getLanProviderHealth(providerId: string): ProviderHealthState | undefined {
    return this.providers.get(providerId)?.status
  }

  // ── Pairing ────────────────────────────────────────────────────────────────

  pairLanProvider(providerId: string): LanPairing {
    const provider = this.providers.get(providerId)
    if (!provider) throw new ProviderError(`Provider not found: ${providerId}`)

    const pairing: LanPairing = {
      pairingId: randomId(),
      requesterIdentityPublicKey: "",
      providerIdentityPublicKey: provider.identityPublicKey,
      transportPublicKey: provider.transportPublicKey,
      pairingMethod: "trusted_lan_mdns",
      pairedAt: now(),
      expiresAt: null,
      status: "active",
    }
    this.pairings.set(pairing.pairingId, pairing)
    return pairing
  }

  forgetLanProvider(providerId: string): void {
    const provider = this.providers.get(providerId)
    if (!provider) return

    // Clean up associated pairings
    for (const [pid, pair] of this.pairings) {
      if (pair.providerIdentityPublicKey === provider.identityPublicKey) {
        this.pairings.delete(pid)
      }
    }
    // Clean up associated trusts
    for (const [tid, trust] of this.trusts) {
      if (trust.federationId === provider.federationId) {
        this.trusts.delete(tid)
      }
    }

    this.providers.delete(providerId)
  }

  // ── Trust ──────────────────────────────────────────────────────────────────

  trustLanProvider(providerId: string, kind: string, expiresAt: string): PrismLanProviderTrust {
    const provider = this.providers.get(providerId)
    if (!provider) throw new ProviderError(`Provider not found: ${providerId}`)

    const trust: PrismLanProviderTrust = {
      trustId: randomId(),
      federationId: provider.federationId,
      providerIdentityPublicKey: provider.identityPublicKey,
      grantedByIdentityPublicKey: "",
      allowedSessionIds: null,
      allowedWorkloadClasses: [],
      allowedDisclosureClasses: [],
      allowedArtifactDigests: [],
      allowedTargetClasses: [],
      maximumRuntimeSeconds: 3600,
      maximumTokens: 8192,
      maximumMemoryBytes: 1073741824,
      maximumConcurrentLeases: 1,
      allowStreaming: true,
      allowResultArtifactReturn: false,
      expiresAt,
      revokedAt: null,
      reasonDigest: null,
      signature: "",
    }
    this.trusts.set(trust.trustId, trust)
    return trust
  }

  revokeLanProviderTrust(trustId: string): void {
    const trust = this.trusts.get(trustId)
    if (!trust) throw new TrustError(`Trust not found: ${trustId}`)
    this.trusts.set(trustId, { ...trust, revokedAt: now() })
  }

  getLanProviderTrust(providerId: string): PrismLanProviderTrust | undefined {
    const provider = this.providers.get(providerId)
    if (!provider) return undefined
    for (const trust of this.trusts.values()) {
      if (trust.providerIdentityPublicKey === provider.identityPublicKey && !trust.revokedAt) {
        return trust
      }
    }
    return undefined
  }

  // ── Lease Lifecycle ────────────────────────────────────────────────────────

  requestLanLease(config: Partial<PrismLanComputeLease>): PrismLanComputeLease {
    const nowISO = now()
    const lease: PrismLanComputeLease = {
      leaseId: config.leaseId ?? randomId(),
      sessionId: config.sessionId ?? "",
      taskId: config.taskId ?? null,
      requesterIdentityPublicKey: config.requesterIdentityPublicKey ?? "",
      requesterMembershipId: config.requesterMembershipId ?? "",
      requesterDevicePublicKey: config.requesterDevicePublicKey ?? "",
      providerId: config.providerId ?? "",
      providerIdentityPublicKey: config.providerIdentityPublicKey ?? "",
      backendKind: (config.backendKind ?? "prism_trusted_lan") as LeaseBackendKind,
      workloadClass: config.workloadClass ?? "chat_completion",
      modelArtifactDigest: config.modelArtifactDigest ?? "",
      tokenizerDigest: config.tokenizerDigest ?? "",
      artifactParityMode: config.artifactParityMode ?? "strict_artifact_parity",
      computeImagePolicyDigest: config.computeImagePolicyDigest ?? "",
      requestedTargetConstraints: config.requestedTargetConstraints ?? "",
      inputDisclosureClass: config.inputDisclosureClass ?? "",
      inputDigest: config.inputDigest ?? "",
      inputReference: config.inputReference ?? null,
      outputDisclosureClass: config.outputDisclosureClass ?? "",
      requestedMaxInputTokens: config.requestedMaxInputTokens ?? 4096,
      requestedMaxOutputTokens: config.requestedMaxOutputTokens ?? 2048,
      requestedMaxRuntimeSeconds: config.requestedMaxRuntimeSeconds ?? 60,
      requestedMaxMemoryBytes: config.requestedMaxMemoryBytes ?? 536870912,
      requestedMaxOutputBytes: config.requestedMaxOutputBytes ?? 1048576,
      requestedMaxGpuTimeMs: config.requestedMaxGpuTimeMs ?? null,
      requiredContainmentLevel: config.requiredContainmentLevel ?? "contained",
      providerTrustScopeDigest: config.providerTrustScopeDigest ?? "",
      disconnectPolicy: config.disconnectPolicy ?? "",
      status: (config.status ?? "draft") as RemoteLeaseStatus,
      issuedAt: config.issuedAt ?? nowISO,
      expiresAt: config.expiresAt ?? null,
      signatureChain: config.signatureChain ?? "",
    }
    this.leases.set(lease.leaseId, lease)
    return lease
  }

  selectLanProvider(requirements: {
    workload: string
    artifactDigest?: string
  }): PrismLanProvider | null {
    for (const provider of this.providers.values()) {
      if (provider.enrollmentState !== "active" && provider.enrollmentState !== "draining") continue
      if (provider.status === "offline") continue
      // Simple heuristic: accept any online, active provider
      return provider
    }
    return null
  }

  approveLanLease(leaseId: string): void {
    const lease = this.leases.get(leaseId)
    if (!lease) throw new LeaseAdmissionError("lease_not_found", `Lease not found: ${leaseId}`)
    this.leases.set(leaseId, { ...lease, status: "approved" })
  }

  rejectLanLease(leaseId: string): void {
    const lease = this.leases.get(leaseId)
    if (!lease) throw new LeaseAdmissionError("lease_not_found", `Lease not found: ${leaseId}`)
    this.leases.set(leaseId, { ...lease, status: "rejected" })
  }

  cancelLanLease(leaseId: string): void {
    const lease = this.leases.get(leaseId)
    if (!lease) throw new LeaseAdmissionError("lease_not_found", `Lease not found: ${leaseId}`)
    this.leases.set(leaseId, { ...lease, status: "cancelled" })
  }

  getLanLease(leaseId: string): PrismLanComputeLease | undefined {
    return this.leases.get(leaseId)
  }

  listLanLeases(sessionId?: string): PrismLanComputeLease[] {
    const all = Array.from(this.leases.values())
    if (sessionId) return all.filter((l) => l.sessionId === sessionId)
    return all
  }

  // ── Receipts ───────────────────────────────────────────────────────────────

  getLanUsageReceipt(leaseId: string): PrismLanUsageReceipt | undefined {
    return this.usageReceipts.get(leaseId)
  }

  // ── KV ─────────────────────────────────────────────────────────────────────

  getLanKvSummary(leaseId: string): { activeNamespaces: number; totalHits: number | null } {
    // Check if the lease exists; default to zeroed summary
    if (!this.leases.has(leaseId)) {
      return { activeNamespaces: 0, totalHits: null }
    }
    return { activeNamespaces: 0, totalHits: null }
  }

  // ── Recovery ───────────────────────────────────────────────────────────────

  recoverLanLeases(): string[] {
    const nonTerminal: string[] = []
    for (const [leaseId, lease] of this.leases) {
      if (!isTerminalStatus(lease.status)) {
        nonTerminal.push(leaseId)
      }
    }
    return nonTerminal
  }

  // ── Policy ─────────────────────────────────────────────────────────────────

  setLanComputePolicy(sessionId: string, policy: string): void {
    this.policies.set(sessionId, policy)
  }

  getLanComputePolicy(sessionId: string): string | undefined {
    return this.policies.get(sessionId)
  }
}

function isTerminalStatus(status: RemoteLeaseStatus): boolean {
  return ["completed", "rejected", "expired", "failed", "cancelled", "revoked"].includes(status)
}
