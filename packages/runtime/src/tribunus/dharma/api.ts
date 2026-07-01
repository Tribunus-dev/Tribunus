/**
 * Dharma Federation Runtime — Typed Local API Surface
 *
 * Provides the governed API for renderer processes, plugins, and
 * extensions to interact with the Dharma subsystem. Every mutating
 * call requires a DharmaMutationContext for authorization.
 *
 * This module wraps the underlying services into a single, typed interface.
 */

import { Context, Effect, Layer } from "effect"
import { serviceUse } from "@tribunus/core/effect/service-use"
import type { DharmaIdentity, Federation, FederationMembership, WorkOffer, WorkClaim, ContributionReceipt, DharmaBalance, TrustAttestation, TrustDecision, ModerationFlag, ModerationDecision, ReplicationStatus, AuditEvent, DharmaMutationContext, EventValidation, DharmaEventEnvelope, OutboxEntry, EventType } from "./types"
import type { EventValidationState } from "./types"
import type { FederationAction, MembershipAction } from "./federation"
import { IdentityVault } from "./identity"
import { createSignedEvent, verifyEventSignature, type UnsignedEvent } from "./event-codec"
import { validateEvent } from "./event-validator"
import * as EventStore from "./event-store"
import * as Audit from "./audit"
import { createFederationConfig, createMembership, getNextStatus, getNextMembershipStatus, isValidRole } from "./federation"
import { createWorkOffer, createWorkClaim, isValidWorkOfferTransition, isValidWorkClaimTransition } from "./work"
import { createReceipt, isValidReceiptTransition } from "./receipt"
import { computeBalance } from "./balance"

// ── Interface ──────────────────────────────────────────────────────────────

export interface DharmaApi {
  // Identity
  identity: {
    create(displayName: string, context: DharmaMutationContext): DharmaIdentity
    rotate(identityId: string, context: DharmaMutationContext): DharmaIdentity
    getActive(): DharmaIdentity | undefined
    list(): DharmaIdentity[]
    signEvent(identityId: string, unsigned: UnsignedEvent): DharmaEventEnvelope
  }

  // Federation
  federation: {
    create(name: string, description: string, context: DharmaMutationContext): Federation
    join(federationId: string, identityId: string, context: DharmaMutationContext): FederationMembership
    leave(federationId: string, identityId: string, context: DharmaMutationContext): void
    list(): Federation[]
    getStatus(federationId: string): Federation["status"] | undefined
    getMembers(federationId: string): FederationMembership[]
    transitionStatus(federationId: string, action: FederationAction, context: DharmaMutationContext): Federation
  }

  // Work
  work: {
    createOffer(offer: Omit<Parameters<typeof createWorkOffer>[0], "expiresAt"> & { expiresAt?: string }, context: DharmaMutationContext): WorkOffer
    listOffers(federationId: string): WorkOffer[]
    claimOffer(offerId: string, identityId: string, context: DharmaMutationContext): WorkClaim
    releaseClaim(claimId: string, context: DharmaMutationContext): void
    cancelOffer(offerId: string, context: DharmaMutationContext): void
  }

  // Receipts
  receipt: {
    issue(config: Omit<Parameters<typeof createReceipt>[0], "localReceiptHash" | "evidenceDigest"> & { localReceiptHash?: string; evidenceDigest?: string }, context: DharmaMutationContext): ContributionReceipt
    accept(receiptId: string, identityId: string, context: DharmaMutationContext): void
    reject(receiptId: string, identityId: string, context: DharmaMutationContext): void
    list(federationId?: string): ContributionReceipt[]
    getEvidenceAccess(receiptId: string): string | null
  }

  // Trust
  trust: {
    attest(issuerKey: string, subjectKey: string, scope: TrustAttestation["trustScope"], confidence: number, context: DharmaMutationContext): TrustAttestation
    revoke(attestationId: string, context: DharmaMutationContext): void
    explainDecision(targetId: string, targetType: TrustDecision["targetType"]): TrustDecision | null
  }

  // Moderation
  moderation: {
    flag(targetEventId: string, category: string, severity: ModerationFlag["severity"], context: DharmaMutationContext): ModerationFlag
    decide(flagId: string, decision: ModerationDecision["decision"], context: DharmaMutationContext): ModerationDecision
    appeal(decisionId: string, reason: string, context: DharmaMutationContext): void
    listFlags(federationId: string): ModerationFlag[]
  }

  // Balance
  balance: {
    get(identityId: string, federationId: string): DharmaBalance | null
    getHistory(identityId: string, federationId: string): DharmaBalance["confirmedDharma"]
  }

  // Replication
  replication: {
    getStatus(federationId: string): ReplicationStatus
    pause(federationId: string): void
    resume(federationId: string): void
    exportDiagnostics(federationId: string): Record<string, unknown>
  }

  // Events
  event: {
    validate(envelope: DharmaEventEnvelope): EventValidation
    store(envelope: DharmaEventEnvelope): void
    get(eventId: string): DharmaEventEnvelope | null
  }

  // Audit
  audit: {
    query(filters?: Audit.AuditQueryFilters): AuditEvent[]
  }
}

// ── Implementation ──────────────────────────────────────────────────────────

class DharmaApiImpl implements DharmaApi {
  readonly identity: DharmaApi["identity"]
  readonly federation: DharmaApi["federation"]
  readonly work: DharmaApi["work"]
  readonly receipt: DharmaApi["receipt"]
  readonly trust: DharmaApi["trust"]
  readonly moderation: DharmaApi["moderation"]
  readonly balance: DharmaApi["balance"]
  readonly replication: DharmaApi["replication"]
  readonly event: DharmaApi["event"]
  readonly audit: DharmaApi["audit"]

  private vault: IdentityVault
  private federations: Map<string, Federation> = new Map()
  private memberships: Map<string, FederationMembership[]> = new Map()
  private offers: Map<string, WorkOffer[]> = new Map()
  private claims: Map<string, WorkClaim[]> = new Map()
  private receipts: Map<string, ContributionReceipt[]> = new Map()
  private trustAttestations: Map<string, TrustAttestation[]> = new Map()
  private moderationFlags: Map<string, ModerationFlag[]> = new Map()
  private balances: Map<string, DharmaBalance> = new Map()
  private pendingEvents: DharmaEventEnvelope[] = []
  private auditEvents: AuditEvent[] = []

  constructor() {
    this.vault = new IdentityVault()

    this.identity = {
      create: (displayName, _ctx) => {
        return this.vault.createIdentity(displayName)
      },
      rotate: (identityId, _ctx) => {
        return this.vault.rotateIdentity(identityId)
      },
      getActive: () => {
        const all = this.vault.listIdentities()
        return all.length > 0 ? all[all.length - 1] : undefined
      },
      list: () => {
        return this.vault.listIdentities()
      },
      signEvent: (identityId, unsigned) => {
        const identity = this.vault.getIdentity(identityId)
        if (!identity) throw new Error(`Identity not found: ${identityId}`)
        const sig = this.vault.signWithIdentity(identityId, new TextEncoder().encode(JSON.stringify(unsigned)))
        // Build full event envelope — delegate to event-codec for proper construction
        return createSignedEvent(unsigned, Buffer.from(sig))
      },
    }

    this.federation = {
      create: (name, description, _ctx) => {
        const config = createFederationConfig({ name, description })
        this.federations.set(config.federationId, config)
        return config
      },
      join: (federationId, identityId, _ctx) => {
        const fed = this.federations.get(federationId)
        if (!fed) throw new Error(`Federation not found: ${federationId}`)
        const membership = createMembership({ federationId, identityId })
        const existing = this.memberships.get(federationId) ?? []
        this.memberships.set(federationId, [...existing, membership])
        return membership
      },
      leave: (federationId, identityId, _ctx) => {
        const members = this.memberships.get(federationId) ?? []
        this.memberships.set(
          federationId,
          members.map((m) =>
            m.identityId === identityId ? { ...m, status: "left" as const } : m,
          ),
        )
      },
      list: () => [...this.federations.values()],
      getStatus: (federationId) => this.federations.get(federationId)?.status,
      getMembers: (federationId) => this.memberships.get(federationId) ?? [],
      transitionStatus: (federationId, action, _ctx) => {
        const fed = this.federations.get(federationId)
        if (!fed) throw new Error(`Federation not found: ${federationId}`)
        const nextStatus = getNextStatus(fed.status, action)
        const updated: Federation = { ...fed, status: nextStatus }
        this.federations.set(federationId, updated)
        return updated
      },
    }

    this.work = {
      createOffer: (config, _ctx) => {
        const offer = createWorkOffer({
          ...config,
          expiresAt: config.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        const fed = config.federationId
        const existing = this.offers.get(fed) ?? []
        this.offers.set(fed, [...existing, offer])
        return offer
      },
      listOffers: (fedId) => this.offers.get(fedId) ?? [],
      claimOffer: (offerId, identityId, _ctx) => {
        const claim = createWorkClaim({ offerId, federationId: "", claimantIdentity: identityId })
        // Find the offer and update its status
        for (const [fedId, offers] of this.offers) {
          const idx = offers.findIndex((o) => o.offerId === offerId)
          if (idx !== -1) {
            const updated = [...offers]
            updated[idx] = { ...updated[idx], status: "claimed" }
            this.offers.set(fedId, updated)
            claim.federationId = fedId
            break
          }
        }
        const existing = this.claims.get(claim.claimId) ?? []
        this.claims.set(claim.claimId, [...existing, claim])
        return claim
      },
      releaseClaim: (claimId, _ctx) => {
        for (const [, claims] of this.claims) {
          const idx = claims.findIndex((c) => c.claimId === claimId)
          if (idx !== -1) {
            claims[idx] = { ...claims[idx], status: "released", releasedAt: new Date().toISOString() }
          }
        }
      },
      cancelOffer: (offerId, _ctx) => {
        for (const [, offers] of this.offers) {
          const idx = offers.findIndex((o) => o.offerId === offerId)
          if (idx !== -1) {
            offers[idx] = { ...offers[idx], status: "cancelled" }
          }
        }
      },
    }

    this.receipt = {
      issue: (config, _ctx) => {
        const receipt = createReceipt({
          ...config,
          localReceiptHash: config.localReceiptHash ?? "pending",
          evidenceDigest: config.evidenceDigest ?? "pending",
        })
        const existing = this.receipts.get(receipt.federationId) ?? []
        this.receipts.set(receipt.federationId, [...existing, receipt])
        return receipt
      },
      accept: (receiptId, identityId, _ctx) => {
        for (const [, receipts] of this.receipts) {
          const idx = receipts.findIndex((r) => r.receiptId === receiptId)
          if (idx !== -1) {
            receipts[idx] = { ...receipts[idx], status: "accepted" }
          }
        }
      },
      reject: (receiptId, identityId, _ctx) => {
        for (const [, receipts] of this.receipts) {
          const idx = receipts.findIndex((r) => r.receiptId === receiptId)
          if (idx !== -1) {
            receipts[idx] = { ...receipts[idx], status: "rejected" }
          }
        }
      },
      list: (fedId) => {
        if (fedId) return this.receipts.get(fedId) ?? []
        return [...this.receipts.values()].flat()
      },
      getEvidenceAccess: () => null, // Future: evidence envelope resolution
    }

    this.trust = {
      attest: (issuerKey, subjectKey, scope, confidence, _ctx) => {
        const attestation: TrustAttestation = {
          attestationId: crypto.randomUUID(),
          issuerPublicKey: issuerKey,
          subjectPublicKey: subjectKey,
          trustScope: scope,
          confidence: Math.max(0, Math.min(1, confidence)),
          expiresAt: null,
          reasonDigest: null,
          createdAt: new Date().toISOString(),
          revokedAt: null,
        }
        const existing = this.trustAttestations.get(issuerKey) ?? []
        this.trustAttestations.set(issuerKey, [...existing, attestation])
        return attestation
      },
      revoke: (attestationId, _ctx) => {
        for (const [, attestations] of this.trustAttestations) {
          const idx = attestations.findIndex((a) => a.attestationId === attestationId)
          if (idx !== -1) {
            attestations[idx] = { ...attestations[idx], revokedAt: new Date().toISOString() }
          }
        }
      },
      explainDecision: () => null, // Future: full trust evaluator
    }

    this.moderation = {
      flag: (targetEventId, category, severity, _ctx) => {
        const flag: ModerationFlag = {
          flagId: crypto.randomUUID(),
          federationId: "",
          targetEventId,
          category,
          severity,
          evidenceDigest: null,
          reporterPublicKey: "",
          createdAt: new Date().toISOString(),
          status: "open",
        }
        const existing = this.moderationFlags.get(targetEventId) ?? []
        this.moderationFlags.set(targetEventId, [...existing, flag])
        return flag
      },
      decide: (flagId, decision, _ctx) => {
        const modDecision: ModerationDecision = {
          decisionId: crypto.randomUUID(),
          flagId,
          federationId: "",
          moderatorPublicKey: "",
          decision,
          scope: "",
          reason: null,
          expiresAt: null,
          supersedesDecisionId: null,
          createdAt: new Date().toISOString(),
        }
        return modDecision
      },
      appeal: () => { /* Future: full appeal flow */ },
      listFlags: () => [...this.moderationFlags.values()].flat(),
    }

    this.balance = {
      get: (identityId, federationId) => {
        const key = `${identityId}:${federationId}`
        return this.balances.get(key) ?? null
      },
      getHistory: () => 0, // Future: full history
    }

    this.replication = {
      getStatus: () => ({
        federationId: "",
        isConnected: false,
        connectedPeers: 0,
        eventsReplicated: this.pendingEvents.length,
        bytesTransferred: 0,
        lastSyncAt: null,
        outboxSize: 0,
      }),
      pause: () => {},
      resume: () => {},
      exportDiagnostics: () => ({ status: "not_implemented" }),
    }

    this.event = {
      validate: (envelope) => {
        const result = validateEvent(envelope)
        return {
          eventId: envelope.eventId,
          validationState: result.state,
          validationReason: result.reason,
          validatedAt: new Date().toISOString(),
          policyDigest: null,
          validatorVersion: 1,
        }
      },
      store: (envelope) => {
        this.pendingEvents.push(envelope)
      },
      get: (eventId) => {
        return this.pendingEvents.find((e) => e.eventId === eventId) ?? null
      },
    }

    this.audit = {
      query: () => this.auditEvents,
    }
  }
}

// ── Effect Service ──────────────────────────────────────────────────────────

export class Service extends Context.Service<Service, DharmaApi>()(
  "@tribunus/dharma/DharmaApi",
) {}

export const use = serviceUse(Service)

export const layer: Layer.Layer<Service> = Layer.succeed(
  Service,
  Service.of(new DharmaApiImpl()),
)
