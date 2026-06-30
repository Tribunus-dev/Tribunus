import { randomUUID } from "node:crypto"
import type {
  DharmaSession,
  SessionAuthorityGrant,
  SessionCommandRequest,
  SessionCommandReceipt,
  GrantRevocation,
  WorkspaceMutation,
  DharmaSessionAggregate,
  SessionMember,
  SessionLifecycleState,
  CommandDecision,
  CommandKind,
  ResourceScope,
  Capability,
} from "../types"
import { DEFAULT_EMPTY_SCOPE, GRANT_PROFILES } from "../types"
import type { SessionHostState, SessionHostConfig, PeerSessionProjection, PatchProposal, PatchProposalState } from "./live-types"
import type { SandboxLayoutPaths } from "./sandbox-layout"
import { applyAction, isTerminalState, isMutableState, acceptsCommands } from "../session-lifecycle"
import type { SessionAction } from "../session-lifecycle"
import { evaluateCommandAuthority, createRejectionReceipt, createAcceptanceReceipt } from "../session-controller"
import type { SessionContext } from "../session-controller"
import { createRevocation, getNextKeyEpoch } from "../session-revocation"
import { buildSandboxLayout } from "./sandbox-layout"

export class DharmaSessionHost {
  private config: SessionHostConfig
  private session: DharmaSession | null = null
  private members: Map<string, SessionMember> = new Map()
  private grants: Map<string, SessionAuthorityGrant> = new Map()
  private receipts: Map<string, SessionCommandReceipt> = new Map()
  private proposals: Map<string, PatchProposal> = new Map()
  private overlays: Map<string, string> = new Map() // membershipId -> overlayId
  private sandboxImpl: { layout: SandboxLayoutPaths | null } = { layout: null }
  private currentKeyEpoch: number = 0

  constructor(config: SessionHostConfig) {
    this.config = config
  }

  async createSession(params: {
    projectReference: string
    sourceRevision: string
  }): Promise<DharmaSession> {
    const session: DharmaSession = {
      sessionId: randomUUID(),
      federationId: "", // empty — single-host session
      ownerIdentityPublicKey: this.config.ownerIdentityPublicKey,
      ownerDeviceId: null,
      projectReference: params.projectReference,
      sourceRevision: params.sourceRevision,
      sourceTreeDigest: "",
      sourceManifestDigest: null,
      sandboxRuntimeKind: "prism_local",
      sandboxImageDigest: null,
      sandboxPolicyDigest: null,
      collaborationPolicyDigest: null,
      disclosurePolicyDigest: null,
      lifecycleState: "draft",
      visibility: "private",
      createdAt: new Date().toISOString(),
      activatedAt: null,
      sealedAt: null,
      expiresAt: null,
      sessionKeyEpoch: 0,
      predecessorSessionId: null,
      successorSessionId: null,
    }

    this.session = session
    return session
  }

  async materializeSession(): Promise<void> {
    if (!this.session) {
      throw new Error("Session not created")
    }
    if (this.session.lifecycleState !== "draft" && this.session.lifecycleState !== "materializing") {
      throw new Error(`Cannot materialize session in state ${this.session.lifecycleState}`)
    }

    this.session.lifecycleState = "materializing"
    // Advance to ready via materialize_success action
    this.session.lifecycleState = applyAction(this.session.lifecycleState, "materialize_success")

    // Store layout
    this.sandboxImpl.layout = buildSandboxLayout(this.config.profileDataRoot, this.session.sessionId)
  }

  async activateSession(): Promise<void> {
    if (!this.session) {
      throw new Error("Session not created")
    }
    if (this.session.lifecycleState !== "ready") {
      throw new Error(`Session must be in 'ready' state to activate, current state: ${this.session.lifecycleState}`)
    }

    this.session.lifecycleState = applyAction(this.session.lifecycleState, "activate")
    this.session.activatedAt = new Date().toISOString()
  }

  async acceptPeerJoin(peerPublicKey: string): Promise<SessionMember> {
    if (!this.session) {
      throw new Error("Session not created")
    }
    if (this.session.lifecycleState !== "active") {
      throw new Error(`Session must be 'active' to accept peers, current state: ${this.session.lifecycleState}`)
    }

    const member: SessionMember = {
      membershipId: randomUUID(),
      sessionId: this.session.sessionId,
      peerIdentityPublicKey: peerPublicKey,
      peerDeviceId: null,
      invitedByIdentityPublicKey: this.config.ownerIdentityPublicKey,
      displayRole: "contributor",
      status: "active",
      joinedAt: new Date().toISOString(),
      suspendedAt: null,
      removedAt: null,
      lastSeenAt: null,
      currentKeyEpoch: this.currentKeyEpoch,
    }

    this.members.set(member.membershipId, member)
    return member
  }

  async issueGrant(params: {
    subjectId: string
    profile: string
  }): Promise<SessionAuthorityGrant> {
    if (!this.session) {
      throw new Error("Session not created")
    }
    if (this.session.lifecycleState !== "active") {
      throw new Error(`Session must be 'active' to issue grants, current state: ${this.session.lifecycleState}`)
    }

    const member = this.members.get(params.subjectId)
    if (!member) {
      throw new Error(`Member not found: ${params.subjectId}`)
    }

    const capabilitySet: Capability[] = GRANT_PROFILES[params.profile as keyof typeof GRANT_PROFILES] ?? ["workspace.read"]

    const grant: SessionAuthorityGrant = {
      grantId: randomUUID(),
      sessionId: this.session.sessionId,
      subjectIdentityPublicKey: member.peerIdentityPublicKey,
      subjectMembershipId: member.membershipId,
      issuedByIdentityPublicKey: this.config.ownerIdentityPublicKey,
      issuedByGrantId: null,
      capabilitySet,
      resourceScope: { ...DEFAULT_EMPTY_SCOPE },
      executionConstraints: null,
      disclosureScope: null,
      approvalPolicy: null,
      delegationPolicy: null,
      issuedAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      revocationReason: null,
      sessionKeyEpoch: this.currentKeyEpoch,
      signature: "",
    }

    this.grants.set(grant.grantId, grant)
    return grant
  }

  async receivePeerCommand(request: SessionCommandRequest): Promise<SessionCommandReceipt> {
    if (!this.session) {
      throw new Error("Session not created")
    }
    if (!acceptsCommands(this.session.lifecycleState)) {
      throw new Error(`Session does not accept commands in state ${this.session.lifecycleState}`)
    }

    const context: SessionContext = {
      session: this.session,
      members: Array.from(this.members.values()),
      grants: Array.from(this.grants.values()),
      currentKeyEpoch: this.currentKeyEpoch,
    }

    const evaluation = evaluateCommandAuthority(context, request)

    let receipt: SessionCommandReceipt
    if (evaluation.decision === "accepted") {
      receipt = createAcceptanceReceipt(request)
    } else {
      receipt = createRejectionReceipt(request, evaluation.reason ?? "Command rejected by authority evaluation")
    }

    this.receipts.set(receipt.receiptId, receipt)
    return receipt
  }

  async createOverlayForMember(membershipId: string): Promise<void> {
    if (!this.session) {
      throw new Error("Session not created")
    }

    const member = this.members.get(membershipId)
    if (!member) {
      throw new Error(`Member not found: ${membershipId}`)
    }
    if (member.status !== "active") {
      throw new Error(`Member ${membershipId} is not active`)
    }

    const overlayId = randomUUID()
    this.overlays.set(membershipId, overlayId)
  }

  async receivePatchProposal(proposalId: string, overlayId: string): Promise<void> {
    if (!this.session) {
      throw new Error("Session not created")
    }
    if (!isMutableState(this.session.lifecycleState)) {
      throw new Error(`Session is not mutable in state ${this.session.lifecycleState}`)
    }

    // Verify overlay exists
    const overlayExists = Array.from(this.overlays.values()).some((id) => id === overlayId)
    if (!overlayExists) {
      throw new Error(`Overlay not found: ${overlayId}`)
    }

    const proposal: PatchProposal = {
      proposalId,
      sessionId: this.session.sessionId,
      membershipId: "", // will be associated via caller
      grantId: "",
      overlayId,
      baseWorkspaceDigest: "",
      patchDigest: "",
      changedPaths: [],
      patchReference: null,
      state: "pending",
      createdAt: new Date().toISOString(),
      signature: "",
    }

    this.proposals.set(proposalId, proposal)
  }

  async reviewPatch(proposalId: string, decision: "accepted" | "rejected"): Promise<void> {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`)
    }

    proposal.state = decision as PatchProposalState
  }

  async executeSandboxCommand(request: SessionCommandRequest): Promise<SessionCommandReceipt> {
    if (!this.session) {
      throw new Error("Session not created")
    }

    const context: SessionContext = {
      session: this.session,
      members: Array.from(this.members.values()),
      grants: Array.from(this.grants.values()),
      currentKeyEpoch: this.currentKeyEpoch,
    }

    const evaluation = evaluateCommandAuthority(context, request)

    let receipt: SessionCommandReceipt
    if (evaluation.decision === "accepted") {
      receipt = createAcceptanceReceipt(request)
    } else {
      receipt = createRejectionReceipt(request, evaluation.reason ?? "Sandbox command rejected by authority evaluation")
    }

    this.receipts.set(receipt.receiptId, receipt)
    return receipt
  }

  async revokeGrant(
    grantId: string,
    reason: string,
    kind?: string,
  ): Promise<GrantRevocation> {
    const grant = this.grants.get(grantId)
    if (!grant) {
      throw new Error(`Grant not found: ${grantId}`)
    }

    const nextEpoch = getNextKeyEpoch(this.currentKeyEpoch)
    this.currentKeyEpoch++

    const revocation = createRevocation({
      sessionId: grant.sessionId,
      grantId: grant.grantId,
      subjectIdentityPublicKey: grant.subjectIdentityPublicKey,
      revokedByIdentityPublicKey: this.config.ownerIdentityPublicKey,
      reason,
      kind: (kind as "graceful" | "emergency") ?? "graceful",
      previousKeyEpoch: this.currentKeyEpoch - 1,
    })

    // Update grant with revocation info
    grant.revokedAt = revocation.effectiveAt
    grant.revocationReason = reason

    return revocation
  }

  async sealSession(): Promise<DharmaSessionAggregate> {
    if (!this.session) {
      throw new Error("Session not created")
    }

    // Check if already terminal or can transition to sealed
    if (!isTerminalState(this.session.lifecycleState)) {
      this.session.lifecycleState = applyAction(this.session.lifecycleState, "seal")
    }

    this.session.sealedAt = new Date().toISOString()

    const aggregate: DharmaSessionAggregate = {
      aggregateId: randomUUID(),
      sessionId: this.session.sessionId,
      federationId: this.session.federationId,
      ownerIdentityPublicKey: this.session.ownerIdentityPublicKey,
      sourceRevisionDigest: this.session.sourceTreeDigest,
      environmentDigest: null,
      taskTaxonomy: "",
      taskSummaryDigest: "",
      authorityTopologyDigest: "",
      participantRoleSummary: "",
      collaborationTimelineSummary: "",
      approvedActionSummaries: "",
      verificationResults: "",
      acceptedPatchDigests: [],
      executionReceiptDigests: Array.from(this.receipts.keys()),
      computeUsageSummary: "",
      outcomeClassification: "",
      contributionReceiptIds: [],
      disclosurePolicy: "",
      redactionManifestDigest: null,
      provenanceChainDigest: "",
      emittedAt: new Date().toISOString(),
      signatureChain: [],
    }

    return aggregate
  }

  getState(): SessionHostState {
    if (!this.session) {
      return {
        sessionId: "",
        sandbox: null,
        lifecycleState: "unknown",
        currentKeyEpoch: 0,
        overlayCount: 0,
        pendingProposals: 0,
        activeExecutions: 0,
      }
    }

    return {
      sessionId: this.session.sessionId,
      sandbox: null,
      lifecycleState: this.session.lifecycleState,
      currentKeyEpoch: this.currentKeyEpoch,
      overlayCount: this.overlays.size,
      pendingProposals: Array.from(this.proposals.values()).filter((p) => p.state === "pending").length,
      activeExecutions: 0,
    }
  }

  async restoreSession(): Promise<void> {
    if (!this.session) {
      throw new Error("Session not created")
    }

    this.session.lifecycleState = "active"
    this.session.activatedAt = new Date().toISOString()
  }
}
