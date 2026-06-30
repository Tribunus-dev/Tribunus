/**
 * Dharma Live Sandbox — Constrained Peer Client
 *
 * Provides a restricted view into a session for remote peers.
 * Peers interact through a constrained projection — they see only
 * what their grants and the session's disclosure policy permit.
 */

import { randomUUID } from "node:crypto"
import type {
  SessionInvitation,
  SessionMember,
  SessionAuthorityGrant,
  SessionCommandReceipt,
} from "../types"
import type { PeerSessionProjection, TransportMessage } from "./live-types"
import { isMemberActive } from "../session-membership"
import { isGrantValid } from "../session-grants"
import { isFinalDecision } from "../session-commands"

// ── Peer Client State -------------------------------------------------------

interface PeerClientState {
  sessionId: string | null
  membershipId: string | null
  ownPublicKey: string | null
  membership: SessionMember | null
  projection: PeerSessionProjection | null
  grants: Map<string, SessionAuthorityGrant>
  receipts: Map<string, SessionCommandReceipt>
  overlayIds: string[]
  revocationNotified: boolean
  revocationReason: string | null
}

// ── DharmaSessionPeerClient -------------------------------------------------

export class DharmaSessionPeerClient {
  private state: PeerClientState = {
    sessionId: null,
    membershipId: null,
    ownPublicKey: null,
    membership: null,
    projection: null,
    grants: new Map(),
    receipts: new Map(),
    overlayIds: [],
    revocationNotified: false,
    revocationReason: null,
  }

  /** Accept a session invitation */
  async acceptInvitation(invitation: SessionInvitation): Promise<SessionMember> {
    const member: SessionMember = {
      membershipId: randomUUID(),
      sessionId: invitation.sessionId,
      peerIdentityPublicKey: invitation.inviteeIdentityPublicKey ?? invitation.inviterIdentityPublicKey,
      peerDeviceId: null,
      invitedByIdentityPublicKey: invitation.inviterIdentityPublicKey,
      displayRole: invitation.initialDisplayRole,
      status: "active",
      joinedAt: new Date().toISOString(),
      suspendedAt: null,
      removedAt: null,
      lastSeenAt: null,
      currentKeyEpoch: invitation.sessionKeyEpoch,
    }

    this.state.sessionId = invitation.sessionId
    this.state.membershipId = member.membershipId
    this.state.ownPublicKey = member.peerIdentityPublicKey
    this.state.membership = member

    // Build initial projection
    this.state.projection = {
      sessionId: invitation.sessionId,
      lifecycleState: "active",
      ownMembershipStatus: "active",
      activeGrants: [],
      permittedPathScopes: [],
      commandReceiptSummaries: [],
      ownOverlayState: null,
      ownPatchProposals: [],
      acceptedMutationSummaries: [],
      visibleTestResultSummaries: [],
      revocationStatus: null,
      allowedArtifactReferences: [],
    }

    return member
  }

  /** Request permission to join */
  async requestJoin(sessionId: string): Promise<void> {
    if (this.state.sessionId) {
      throw new Error(`Already participating in session ${this.state.sessionId}`)
    }
    this.state.sessionId = sessionId
    this.state.projection = null
  }

  /** Get permitted session projection */
  getSessionProjection(): PeerSessionProjection | null {
    return this.state.projection
  }

  /** Inspect allowed workspace content (through transport) */
  async inspectAllowedWorkspace(path: string): Promise<Uint8Array | null> {
    if (!this.state.projection) {
      throw new Error("Not connected to a session")
    }

    // Check the path is in permitted scopes
    const isAllowed = this.state.projection.permittedPathScopes.some(
      (scope) => path.startsWith(scope) || scope === "*",
    )
    if (!isAllowed) {
      throw new Error(`Path "${path}" not in permitted scopes`)
    }

    // In a real implementation this would fetch via the transport layer.
    // For now return null (no local workspace access from client side).
    return null
  }

  /** Create an overlay for own work */
  async createOverlayIntent(): Promise<void> {
    if (!this.state.membership) {
      throw new Error("Not a member of a session")
    }
    if (!isMemberActive(this.state.membership)) {
      throw new Error("Membership is not active")
    }

    const overlayId = randomUUID()
    this.state.overlayIds.push(overlayId)

    // Update projection
    if (this.state.projection) {
      this.state.projection.ownOverlayState = "created"
    }
  }

  /** Submit a patch proposal */
  async submitPatchProposal(overlayId: string): Promise<void> {
    if (!this.state.membership) {
      throw new Error("Not a member of a session")
    }
    if (!this.state.overlayIds.includes(overlayId)) {
      throw new Error(`Overlay not owned by this peer: ${overlayId}`)
    }
    if (!isMemberActive(this.state.membership)) {
      throw new Error("Membership is not active")
    }

    // Update projection
    if (this.state.projection) {
      this.state.projection.ownPatchProposals.push(overlayId.slice(0, 8))
    }
  }

  /** Request a bounded sandbox command */
  async requestCommand(
    commandKind: string,
    payloadDigest: string,
  ): Promise<SessionCommandReceipt> {
    if (!this.state.membership) {
      throw new Error("Not a member of a session")
    }

    const requestId = randomUUID()
    const receipt: SessionCommandReceipt = {
      receiptId: randomUUID(),
      requestId,
      sessionId: this.state.sessionId ?? "",
      actorIdentityPublicKey: this.state.ownPublicKey ?? "",
      decision: "accepted",
      denialReason: null,
      authorityEvaluationDigest: null,
      executionId: null,
      workspaceBeforeDigest: null,
      workspaceAfterDigest: null,
      outputDigest: null,
      artifactDigest: null,
      computeLeaseId: null,
      createdAt: new Date().toISOString(),
      finalizedAt: null,
      controllerSignature: "",
    }

    this.state.receipts.set(receipt.receiptId, receipt)

    // Update projection
    if (this.state.projection) {
      this.state.projection.commandReceiptSummaries.push(receipt.receiptId.slice(0, 8))
    }

    return receipt
  }

  /** Observe a command receipt */
  observeReceipt(requestId: string): SessionCommandReceipt | null {
    for (const receipt of this.state.receipts.values()) {
      if (receipt.requestId === requestId && "receiptId" in receipt) {
        return receipt
      }
    }
    return null
  }

  /** Observe grant changes */
  observeGrantChange(): SessionAuthorityGrant[] {
    if (!this.state.membership) {
      return []
    }
    return Array.from(this.state.grants.values()).filter((g) =>
      isGrantValid(g, this.state.membership!.currentKeyEpoch),
    )
  }

  /** Observe revocation */
  observeRevocation(): { revoked: boolean; reason: string | null } {
    return {
      revoked: this.state.revocationNotified,
      reason: this.state.revocationReason,
    }
  }

  /** Fetch a permitted artifact */
  async fetchPermittedArtifact(reference: string): Promise<Uint8Array | null> {
    if (!this.state.projection) {
      throw new Error("Not connected to a session")
    }

    const isAllowed = this.state.projection.allowedArtifactReferences.some(
      (ref) => reference.startsWith(ref) || ref === "*",
    )
    if (!isAllowed) {
      throw new Error(`Artifact reference "${reference}" not permitted`)
    }

    // In a real implementation this would fetch via the transport layer.
    return null
  }
}
