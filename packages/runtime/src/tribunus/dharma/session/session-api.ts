/**
 * Dharma Session Authority — Typed API Surface
 *
 * Provides the governed external API for session lifecycle, membership,
 * grants, commands, compute, and aggregate operations.
 */

import { Context, Layer } from "effect"
import { serviceUse } from "@tribunus/core/effect/service-use"
import type {
  DharmaSession, SessionLifecycleState, SessionVisibility,
  SessionMember, MembershipStatus,
  SessionAuthorityGrant, Capability, GrantProfile, ResourceScope,
  SessionCommandRequest, SessionCommandReceipt, CommandKind, CommandDecision,
  SessionInvitation,
  WorkspaceMutation, WorkspaceOverlay, MutationKind,
  DharmaSessionAggregate,
  ComputeLease, BackendKind, ComputeLeaseStatus,
  GrantRevocation, RevocationKind,
  SessionOwnershipTransfer,
} from "./types"
import { ALL_CAPABILITIES } from "./types"
import { createGrantFromProfile, mergeScope } from "./session-grants"
import { createMember, createMembershipFromInvitation, isInvitationValid } from "./session-membership"
import { createCommandRequest, createCommandReceipt, createApprovalRequirement } from "./session-commands"
import { createRevocation, createOwnershipTransfer, getNextKeyEpoch } from "./session-revocation"
import { createMutation, createOverlay } from "./workspace-model"
import { evaluateCommandAuthority } from "./session-controller"
import type { SessionContext } from "./session-controller"
import { createSessionAggregate } from "./session-aggregate"
import { applyAction } from "./session-lifecycle"
import type { SessionAction } from "./session-lifecycle"

// ── API Interface -----------------------------------------------------------

export interface SessionApi {
  // Session lifecycle
  create(config: {
    federationId: string
    ownerIdentityPublicKey: string
    projectReference: string
    sourceRevision: string
    sandboxRuntimeKind?: string
    visibility?: SessionVisibility
  }): DharmaSession

  get(sessionId: string): DharmaSession | undefined
  list(federationId?: string): DharmaSession[]
  updateState(sessionId: string, action: SessionAction): DharmaSession

  // Membership
  invitePeer(sessionId: string, peerPublicKey: string, role?: string): SessionInvitation
  acceptInvitation(invitation: SessionInvitation, peerIdentityPublicKey: string): SessionMember
  removePeer(sessionId: string, peerIdentityPublicKey: string): void
  listMembers(sessionId: string): SessionMember[]

  // Grants
  issueGrant(config: {
    sessionId: string
    subjectIdentityPublicKey: string
    subjectMembershipId: string
    issuedByIdentityPublicKey: string
    profile: GrantProfile
    resourceScope?: Partial<ResourceScope>
    expiresAt?: string
  }): SessionAuthorityGrant

  revokeGrant(grantId: string, revokedBy: string, reason: string, kind?: RevocationKind): GrantRevocation
  listGrants(sessionId: string): SessionAuthorityGrant[]
  explainAuthority(sessionId: string, memberIdentity: string): Capability[]

  // Workspace
  createOverlay(sessionId: string, ownerIdentity: string): WorkspaceOverlay
  proposeMutation(config: {
    sessionId: string
    actorIdentityPublicKey: string
    grantId: string
    mutationKind: MutationKind
    pathScope: string
    baseWorkspaceDigest: string
    overlayId?: string
  }): WorkspaceMutation

  acceptMutation(mutationId: string, acceptedBy: string): void
  rejectMutation(mutationId: string): void
  getWorkspaceState(sessionId: string): { digest: string; overlayCount: number }

  // Commands
  requestCommand(config: {
    sessionId: string
    actorIdentityPublicKey: string
    actorMembershipId: string
    grantId: string
    sessionKeyEpoch: number
    commandKind: CommandKind
    payloadDigest: string
  }): SessionCommandReceipt

  approveCommand(requestId: string): void
  cancelCommand(requestId: string): void
  getCommandReceipt(requestId: string): SessionCommandReceipt | undefined

  // Compute
  requestLease(config: {
    sessionId: string
    requesterIdentityPublicKey: string
    requesterMembershipId: string
    backendKind: BackendKind
    modelArtifactDigest: string
    workloadClass: string
    maximumRuntimeSeconds: number
  }): ComputeLease

  approveLease(leaseId: string): void
  cancelLease(leaseId: string): void
  getLeaseStatus(leaseId: string): ComputeLeaseStatus | undefined

  // Aggregate
  exportArtifactBundle(sessionId: string): Uint8Array | null
  getAggregateProjection(sessionId: string): DharmaSessionAggregate | null
}

// ── In-Memory Implementation -------------------------------------------------

class SessionApiImpl implements SessionApi {
  private sessions: Map<string, DharmaSession> = new Map()
  private members: Map<string, SessionMember[]> = new Map()
  private grants: Map<string, SessionAuthorityGrant[]> = new Map()
  private invitations: Map<string, SessionInvitation[]> = new Map()
  private commands: Map<string, SessionCommandReceipt[]> = new Map()
  private approvals: Map<string, string[]> = new Map()
  private overlays: Map<string, WorkspaceOverlay[]> = new Map()
  private mutations: Map<string, WorkspaceMutation[]> = new Map()
  private leases: Map<string, ComputeLease[]> = new Map()
  private aggregates: Map<string, DharmaSessionAggregate> = new Map()

  create(config: Parameters<SessionApi["create"]>[0]): DharmaSession {
    const now = new Date().toISOString()
    const session: DharmaSession = {
      sessionId: crypto.randomUUID(),
      federationId: config.federationId,
      ownerIdentityPublicKey: config.ownerIdentityPublicKey,
      ownerDeviceId: null,
      projectReference: config.projectReference,
      sourceRevision: config.sourceRevision,
      sourceTreeDigest: "",
      sourceManifestDigest: null,
      sandboxRuntimeKind: config.sandboxRuntimeKind ?? "local",
      sandboxImageDigest: null,
      sandboxPolicyDigest: null,
      collaborationPolicyDigest: null,
      disclosurePolicyDigest: null,
      lifecycleState: "draft",
      visibility: config.visibility ?? "private",
      createdAt: now,
      activatedAt: null,
      sealedAt: null,
      expiresAt: null,
      sessionKeyEpoch: 0,
      predecessorSessionId: null,
      successorSessionId: null,
    }
    this.sessions.set(session.sessionId, session)
    return session
  }

  get(sessionId: string): DharmaSession | undefined {
    return this.sessions.get(sessionId)
  }

  list(federationId?: string): DharmaSession[] {
    const all = [...this.sessions.values()]
    return federationId ? all.filter((s) => s.federationId === federationId) : all
  }

  updateState(sessionId: string, action: SessionAction): DharmaSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const nextState = applyAction(session.lifecycleState, action)
    const updated: DharmaSession = { ...session, lifecycleState: nextState }
    if (nextState === "active") updated.activatedAt = new Date().toISOString()
    if (nextState === "sealed") updated.sealedAt = new Date().toISOString()
    this.sessions.set(sessionId, updated)
    return updated
  }

  invitePeer(sessionId: string, peerPublicKey: string, role?: string): SessionInvitation {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const invitation: SessionInvitation = {
      invitationId: crypto.randomUUID(),
      sessionId,
      federationId: session.federationId,
      inviterIdentityPublicKey: session.ownerIdentityPublicKey,
      inviteeIdentityPublicKey: peerPublicKey,
      initialDisplayRole: role ?? "contributor",
      initialGrantTemplates: [],
      sessionKeyEpoch: session.sessionKeyEpoch,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      maxUses: 1,
      visibilitySummary: "",
      encryptedJoinPayload: null,
      signature: "",
    }
    const existing = this.invitations.get(sessionId) ?? []
    this.invitations.set(sessionId, [...existing, invitation])
    return invitation
  }

  acceptInvitation(invitation: SessionInvitation, peerIdentityPublicKey: string): SessionMember {
    const val = isInvitationValid(invitation)
    if (!val.valid) throw new Error(`Invitation invalid: ${val.reason}`)
    const member = createMembershipFromInvitation(invitation, peerIdentityPublicKey)
    const existing = this.members.get(invitation.sessionId) ?? []
    this.members.set(invitation.sessionId, [...existing, member])
    return member
  }

  removePeer(sessionId: string, peerIdentityPublicKey: string): void {
    const members = this.members.get(sessionId) ?? []
    this.members.set(
      sessionId,
      members.map((m) =>
        m.peerIdentityPublicKey === peerIdentityPublicKey ? { ...m, status: "removed" as MembershipStatus } : m,
      ),
    )
  }

  listMembers(sessionId: string): SessionMember[] {
    return this.members.get(sessionId) ?? []
  }

  issueGrant(config: Parameters<SessionApi["issueGrant"]>[0]): SessionAuthorityGrant {
    const session = this.sessions.get(config.sessionId)
    if (!session) throw new Error(`Session not found: ${config.sessionId}`)
    const grant = createGrantFromProfile({
      grantId: crypto.randomUUID(),
      sessionId: config.sessionId,
      subjectIdentityPublicKey: config.subjectIdentityPublicKey,
      subjectMembershipId: config.subjectMembershipId,
      issuedByIdentityPublicKey: config.issuedByIdentityPublicKey,
      profile: config.profile,
      resourceScope: config.resourceScope,
      sessionKeyEpoch: session.sessionKeyEpoch,
      expiresAt: config.expiresAt,
    })
    const existing = this.grants.get(config.sessionId) ?? []
    this.grants.set(config.sessionId, [...existing, grant])
    return grant
  }

  revokeGrant(grantId: string, revokedBy: string, reason: string, kind?: RevocationKind): GrantRevocation {
    const revocation = createRevocation({
      sessionId: "",
      grantId,
      subjectIdentityPublicKey: revokedBy,
      revokedByIdentityPublicKey: revokedBy,
      reason,
      kind: kind ?? "graceful",
      previousKeyEpoch: 0,
    })
    return revocation
  }

  listGrants(sessionId: string): SessionAuthorityGrant[] {
    return this.grants.get(sessionId) ?? []
  }

  explainAuthority(sessionId: string, memberIdentity: string): Capability[] {
    const grants = this.grants.get(sessionId) ?? []
    const memberGrants = grants.filter((g) => g.subjectIdentityPublicKey === memberIdentity)
    const caps = new Set<Capability>()
    for (const g of memberGrants) {
      for (const c of g.capabilitySet) caps.add(c)
    }
    return [...caps]
  }

  createOverlay(sessionId: string, ownerIdentity: string): WorkspaceOverlay {
    const overlay = createOverlay({ sessionId, ownerIdentityPublicKey: ownerIdentity, baseWorkspaceDigest: "" })
    const existing = this.overlays.get(sessionId) ?? []
    this.overlays.set(sessionId, [...existing, overlay])
    return overlay
  }

  proposeMutation(config: Parameters<SessionApi["proposeMutation"]>[0]): WorkspaceMutation {
    const mutation = createMutation(config)
    const existing = this.mutations.get(config.sessionId) ?? []
    this.mutations.set(config.sessionId, [...existing, mutation])
    return mutation
  }

  acceptMutation(mutationId: string, acceptedBy: string): void {
    for (const [, mutations] of this.mutations) {
      const idx = mutations.findIndex((m) => m.mutationId === mutationId)
      if (idx !== -1) {
        mutations[idx] = { ...mutations[idx], approvalState: "accepted", acceptedBy, acceptedAt: new Date().toISOString() }
        return
      }
    }
  }

  rejectMutation(mutationId: string): void {
    for (const [, mutations] of this.mutations) {
      const idx = mutations.findIndex((m) => m.mutationId === mutationId)
      if (idx !== -1) {
        mutations[idx] = { ...mutations[idx], approvalState: "rejected" }
        return
      }
    }
  }

  getWorkspaceState(sessionId: string): { digest: string; overlayCount: number } {
    const overlays = this.overlays.get(sessionId) ?? []
    return { digest: "", overlayCount: overlays.length }
  }

  requestCommand(config: Parameters<SessionApi["requestCommand"]>[0]): SessionCommandReceipt {
    const session = this.sessions.get(config.sessionId)
    if (!session) throw new Error(`Session not found: ${config.sessionId}`)
    const members = this.members.get(config.sessionId) ?? []
    const grants = this.grants.get(config.sessionId) ?? []

    const request = createCommandRequest(config)
    const context: SessionContext = {
      session,
      members,
      grants,
      currentKeyEpoch: session.sessionKeyEpoch,
    }
    const evaluation = evaluateCommandAuthority(context, request)
    const receipt = createCommandReceipt(request, evaluation.decision, { denialReason: evaluation.reason ?? undefined })
    const existing = this.commands.get(config.sessionId) ?? []
    this.commands.set(config.sessionId, [...existing, receipt])
    return receipt
  }

  approveCommand(_requestId: string): void {}
  cancelCommand(_requestId: string): void {}

  getCommandReceipt(requestId: string): SessionCommandReceipt | undefined {
    for (const [, receipts] of this.commands) {
      const found = receipts.find((r) => r.requestId === requestId)
      if (found) return found
    }
    return undefined
  }

  requestLease(config: Parameters<SessionApi["requestLease"]>[0]): ComputeLease {
    const lease: ComputeLease = {
      leaseId: crypto.randomUUID(),
      sessionId: config.sessionId,
      requesterIdentityPublicKey: config.requesterIdentityPublicKey,
      requesterMembershipId: config.requesterMembershipId,
      providerIdentityPublicKey: null,
      backendKind: config.backendKind,
      trustTier: 0,
      modelArtifactDigest: config.modelArtifactDigest,
      workloadClass: config.workloadClass,
      inputDisclosureClass: "session",
      inputDigest: "",
      outputDisclosureClass: "session",
      maximumTokens: null,
      maximumRuntimeSeconds: config.maximumRuntimeSeconds,
      maximumMemoryBytes: 0,
      maximumCost: null,
      dharmaCreditAmount: null,
      routingPolicy: "local",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      revocationEpoch: 0,
      status: "pending",
      signatureChain: "",
    }
    const existing = this.leases.get(config.sessionId) ?? []
    this.leases.set(config.sessionId, [...existing, lease])
    return lease
  }

  approveLease(leaseId: string): void {
    for (const [, leases] of this.leases) {
      const idx = leases.findIndex((l) => l.leaseId === leaseId)
      if (idx !== -1) {
        leases[idx] = { ...leases[idx], status: "active" }
        return
      }
    }
  }

  cancelLease(leaseId: string): void {
    for (const [, leases] of this.leases) {
      const idx = leases.findIndex((l) => l.leaseId === leaseId)
      if (idx !== -1) {
        leases[idx] = { ...leases[idx], status: "cancelled" }
        return
      }
    }
  }

  getLeaseStatus(leaseId: string): ComputeLeaseStatus | undefined {
    for (const [, leases] of this.leases) {
      const found = leases.find((l) => l.leaseId === leaseId)
      if (found) return found.status
    }
    return undefined
  }

  exportArtifactBundle(_sessionId: string): Uint8Array | null {
    return null // Future: filesystem-backed export
  }

  getAggregateProjection(sessionId: string): DharmaSessionAggregate | null {
    return this.aggregates.get(sessionId) ?? null
  }
}

// ── Effect Service ----------------------------------------------------------

export class Service extends Context.Service<Service, SessionApi>()(
  "@tribunus/dharma/SessionApi",
) {}

export const use = serviceUse(Service)

export const layer: Layer.Layer<Service> = Layer.succeed(
  Service,
  Service.of(new SessionApiImpl()),
)
