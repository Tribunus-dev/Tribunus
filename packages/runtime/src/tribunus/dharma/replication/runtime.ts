/**
 * Dharma Replication — Runtime Orchestrator
 *
 * DharmaReplicationRuntime is the lifecycle owner for all replication
 * concerns within a single Tribunus profile. It owns one Corestore,
 * one Hyperswarm instance, and one Autobase session per active federation.
 *
 * The runtime does not expose Corestore, Hypercore, Autobase, raw
 * transport streams, or peer addresses to renderer processes.
 */

import { randomUUID } from "node:crypto"
import * as path from "node:path"
import * as os from "node:os"
import { DharmaCorestore } from "./corestore"
import type { CorestoreConfig } from "./corestore"
import { FederationBase, createDefaultApply } from "./federation-base"
import type { FederationBaseConfig } from "./federation-base"
import { FederationStore } from "./federation-store"
import { DharmaSwarm, deriveSwarmTopic } from "./swarm"
import type { SwarmConfig } from "./swarm"
import { PeerTracker } from "./peer"
import { OutboxManager } from "./outbox"
import { FederationEventImporter } from "./importer"
import { collectDiagnostics, deriveUserStatus } from "./diagnostics"
import type { DiagnosticsSource } from "./diagnostics"
import type {
  FederationBootstrapRecord,
  DharmaInvitationBundle,
  DharmaReplicationDiagnostics,
  ReplicationLimits,
  SwarmLifecycleState,
  FederationUserStatus,
  WriterAdmission,
  ReplicatedDharmaEvent,
  PeerHandshakeResult,
  OutboxEntryState,
} from "./protocol"
import {
  DEFAULT_REPLICATION_LIMITS,
  DHARMA_REPLICATION_PROTOCOL_VERSION,
  MAX_PEERS_PER_FEDERATION,
  MAX_GLOBAL_PEERS,
} from "./protocol"
import { createHello, respondToHello, verifyWelcome, createHandshakeResult, isProtocolCompatible } from "./handshake"
import type { HandshakeConfig } from "./handshake"
import { ReplicationError, CorestoreError, SwarmError } from "./errors"
import type { DharmaEventEnvelope } from "../types"
import { canonicalJson } from "../types"

// ── Runtime Configuration ---------------------------------------------------

export interface RuntimeConfig {
  /** Profile-level storage root. Default: <os.homedir()>/.tribunus/dharma/ */
  storageRoot?: string
  /** Limits for replication. Default: DEFAULT_REPLICATION_LIMITS */
  limits?: ReplicationLimits
  /** Node instance ID (persistent across restarts). Auto-generated if absent. */
  nodeInstanceId?: string
  /** Device Ed25519 public key hex for handshake identity. */
  devicePublicKey: string
  /** Device Ed25519 private key for handshake signing. */
  devicePrivateKey: Uint8Array
}

// ── Federation Runtime State -------------------------------------------------

interface FederationRuntimeState {
  federationBase: FederationBase
  federationStore: FederationStore
  swarm: DharmaSwarm
  peerTracker: PeerTracker
  outbox: OutboxManager
  importer: FederationEventImporter
  lifecycleState: SwarmLifecycleState
  bootstrapRecord: FederationBootstrapRecord | null
  successfulHandshakes: number
  failedHandshakes: number
  lastError: string | null
  lastSuccessfulReplicationAt: string | null
}

// ── DharmaReplicationRuntime -------------------------------------------------

/**
 * DharmaReplicationRuntime is the main orchestrator for Phase 2 replication.
 *
 * Lifecycle:
 *   new Runtime(config) → start() → joinFederation(id) → ... → stop()
 */
export class DharmaReplicationRuntime implements DiagnosticsSource {
  private corestore: DharmaCorestore | null = null
  private federations: Map<string, FederationRuntimeState> = new Map()
  private config: RuntimeConfig
  private started: boolean = false

  constructor(config: RuntimeConfig) {
    this.config = {
      ...config,
      storageRoot: config.storageRoot ?? path.join(os.homedir(), ".tribunus", "dharma"),
      limits: config.limits ?? DEFAULT_REPLICATION_LIMITS,
      nodeInstanceId: config.nodeInstanceId ?? randomUUID(),
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start the replication runtime. Opens the Corestore and prepares
   * for federation activity.
   */
  async start(): Promise<void> {
    if (this.started) return
    const storeConfig: CorestoreConfig = {
      storagePath: path.join(this.config.storageRoot!, "corestore"),
      limits: this.config.limits!,
    }
    this.corestore = new DharmaCorestore(storeConfig)
    await this.corestore.open()
    this.started = true
  }

  /**
   * Stop the runtime. Closes all federations, then the Corestore.
   */
  async stop(): Promise<void> {
    if (!this.started) return
    for (const fedId of this.federations.keys()) {
      await this.leaveFederation(fedId)
    }
    if (this.corestore) {
      await this.corestore.close()
      this.corestore = null
    }
    this.started = false
  }

  // ── Federation Management ─────────────────────────────────────────────────

  /**
   * Create a new federation locally with an Autobase bootstrap.
   * Returns the generated bootstrap record.
   */
  async createFederation(
    federationId: string,
    genesisEventId: string,
    rootPublicKey: string,
    autobaseKey: string,
    autobaseDiscoveryKey: string,
  ): Promise<FederationBootstrapRecord> {
    if (this.federations.has(federationId)) {
      throw new ReplicationError("FEDERATION_EXISTS", `Federation ${federationId} is already active`)
    }

    const writerCore = await this.corestore!.getWriterCore(federationId, "genesis")
    const viewCore = await this.corestore!.getViewCore(federationId)
    const checkpointCore = await this.corestore!.getCheckpointCore(federationId)

    const apply = createDefaultApply()
    const baseConfig: FederationBaseConfig = {
      federationId,
      autobaseKey,
      writerCore,
      viewCore,
      checkpointCore,
      apply,
    }
    const federationBase = new FederationBase(baseConfig)
    await federationBase.open()

    const federationStore = new FederationStore(this.corestore!, federationId, "genesis")
    const swarm = new DharmaSwarm({
      federationId,
      autobaseDiscoveryKey,
      limits: this.config.limits!,
      keyPair: null,
      onConnection: () => {},
    })
    const peerTracker = new PeerTracker(federationId)
    const outbox = new OutboxManager(federationId)
    const importer = new FederationEventImporter(federationId)

    const bootstrapRecord: FederationBootstrapRecord = {
      protocolVersion: DHARMA_REPLICATION_PROTOCOL_VERSION,
      federationId,
      federationGenesisEventId: genesisEventId,
      federationRootPublicKey: rootPublicKey,
      autobaseKey,
      autobaseDiscoveryKey,
      initialPolicyDigest: "",
      genesisWriterKey: "",
      createdAt: new Date().toISOString(),
      bootstrapSignature: "",
    }

    await federationStore.storeBootstrap(bootstrapRecord)

    this.federations.set(federationId, {
      federationBase,
      federationStore,
      swarm,
      peerTracker,
      outbox,
      importer,
      lifecycleState: "stopped",
      bootstrapRecord,
      successfulHandshakes: 0,
      failedHandshakes: 0,
      lastError: null,
      lastSuccessfulReplicationAt: null,
    })

    return bootstrapRecord
  }

  /**
   * Join an existing federation from an invitation bundle.
   */
  async joinFederation(invitation: DharmaInvitationBundle): Promise<void> {
    const { bootstrap } = invitation
    const fedId = bootstrap.federationId

    if (this.federations.has(fedId)) {
      throw new ReplicationError("ALREADY_JOINED", `Already participating in federation ${fedId}`)
    }

    const writerCore = await this.corestore!.getWriterCore(fedId, "local")
    const viewCore = await this.corestore!.getViewCore(fedId)
    const checkpointCore = await this.corestore!.getCheckpointCore(fedId)

    const apply = createDefaultApply()
    const baseConfig: FederationBaseConfig = {
      federationId: fedId,
      autobaseKey: bootstrap.autobaseKey,
      writerCore,
      viewCore,
      checkpointCore,
      apply,
    }
    const federationBase = new FederationBase(baseConfig)
    await federationBase.open()

    const federationStore = new FederationStore(this.corestore!, fedId, "local")
    const swarm = new DharmaSwarm({
      federationId: fedId,
      autobaseDiscoveryKey: bootstrap.autobaseDiscoveryKey,
      limits: this.config.limits!,
      keyPair: null,
      onConnection: (conn, info) => this.handleConnection(fedId, conn, info),
    })
    const peerTracker = new PeerTracker(fedId)
    const outbox = new OutboxManager(fedId)
    const importer = new FederationEventImporter(fedId)

    this.federations.set(fedId, {
      federationBase,
      federationStore,
      swarm,
      peerTracker,
      outbox,
      importer,
      lifecycleState: "stopped",
      bootstrapRecord: bootstrap,
      successfulHandshakes: 0,
      failedHandshakes: 0,
      lastError: null,
      lastSuccessfulReplicationAt: null,
    })

    // Start the swarm to begin peer discovery for this federation
    const state = this.federations.get(fedId)!
    await state.swarm.start()
    state.lifecycleState = "connected"
  }

  /**
   * Leave a federation. Stops the swarm and closes the Autobase.
   */
  async leaveFederation(federationId: string): Promise<void> {
    const state = this.federations.get(federationId)
    if (!state) return

    await state.swarm.stop()
    await state.federationBase.close()
    this.federations.delete(federationId)
  }

  // ── Pause / Resume ────────────────────────────────────────────────────────

  /**
   * Pause a federation. Stops discovery and outbound replication
   * but preserves replicated data and projections.
   */
  async pauseFederation(federationId: string): Promise<void> {
    const state = this.federations.get(federationId)
    if (!state) return
    state.swarm.pause()
    state.lifecycleState = "paused"
  }

  /**
   * Resume a paused federation.
   */
  async resumeFederation(federationId: string): Promise<void> {
    const state = this.federations.get(federationId)
    if (!state) return
    state.swarm.resume()
    state.lifecycleState = "connected"
  }

  // ── Event Publication ─────────────────────────────────────────────────────

  /**
   * Publish a signed Dharma event to a federation.
   * The event enters the durable outbox first, then is appended
   * to the local writer core and propagated via Autobase.
   */
  async publishEvent(federationId: string, event: DharmaEventEnvelope): Promise<void> {
    const state = this.federations.get(federationId)
    if (!state) throw new ReplicationError("FEDERATION_NOT_FOUND", `Federation ${federationId} not active`)

    // Step 1: Create outbox entry
    const entry = state.outbox.createEntry(event)
    state.outbox.markReady(entry.outboxId)

    // Step 2: Encode event envelope to bytes
    const encoded = new TextEncoder().encode(canonicalJson(event))

    // Step 3: Append to writer core via federation-store
    state.outbox.markAppending(entry.outboxId)
    try {
      const writerCore = await this.corestore!.getWriterCore(federationId, "local")
      const seq = await writerCore.append(encoded)
      state.outbox.markAppended(entry.outboxId, seq, "")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      state.outbox.scheduleRetry(entry.outboxId, msg)
      state.lastError = msg
      throw err
    }
  }

  // ── Status / Diagnostics ──────────────────────────────────────────────────

  /**
   * Get replication status for a federation.
   */
  getStatus(federationId: string): FederationUserStatus {
    const state = this.federations.get(federationId)
    if (!state) return "offline"
    const diag = this.collectFederationDiagnostics(federationId)!
    return deriveUserStatus(diag)
  }

  /**
   * Get detailed diagnostics for a federation.
   */
  getDiagnostics(federationId: string): DharmaReplicationDiagnostics | null {
    return this.collectFederationDiagnostics(federationId)
  }

  /**
   * Get diagnostics for all active federations.
   */
  getAllDiagnostics(): Map<string, DharmaReplicationDiagnostics> {
    const result = new Map<string, DharmaReplicationDiagnostics>()
    for (const fedId of this.federations.keys()) {
      const diag = this.collectFederationDiagnostics(fedId)
      if (diag) result.set(fedId, diag)
    }
    return result
  }

  /**
   * Get active federation IDs.
   */
  getActiveFederationIds(): string[] {
    return [...this.federations.keys()]
  }

  /**
   * Check if the runtime is started.
   */
  isStarted(): boolean {
    return this.started
  }

  // ── DiagnosticsSource Implementation ──────────────────────────────────────

  getLifecycleState(): SwarmLifecycleState | "inactive" {
    return this.started ? "connected" : "inactive"
  }
  isSwarmJoined(): boolean { return this.started }
  getActivePeerCount(): number { return 0 }
  getSuccessfulHandshakes(): number { return 0 }
  getFailedHandshakes(): number { return 0 }
  getWriterCount(): number { return this.federations.size }
  getAutobaseLength(): number { return 0 }
  getAutobaseSignedLength(): number { return 0 }
  getImporterProvisionalCursor(): number { return 0 }
  getImporterFinalizedCursor(): number { return 0 }
  getPendingOutboxCount(): number {
    let count = 0
    for (const state of this.federations.values()) {
      count += state.outbox.getPendingCount()
    }
    return count
  }
  getPendingDependencyCount(): number { return 0 }
  getQuarantineCount(): number { return 0 }
  getLastSuccessfulReplicationAt(): string | null { return null }
  getLastError(): string | null { return null }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private collectFederationDiagnostics(federationId: string): DharmaReplicationDiagnostics | null {
    const state = this.federations.get(federationId)
    if (!state) return null

    const source: DiagnosticsSource = {
      getLifecycleState: () => state.lifecycleState,
      isSwarmJoined: () => state.swarm.getState() !== "stopped",
      getActivePeerCount: () => state.peerTracker.getActivePeers().length,
      getSuccessfulHandshakes: () => state.successfulHandshakes,
      getFailedHandshakes: () => state.failedHandshakes,
      getWriterCount: () => {
        // Count unique writers from the federation base view
        return state.bootstrapRecord ? 1 : 0
      },
      getAutobaseLength: () => 0,
      getAutobaseSignedLength: () => 0,
      getImporterProvisionalCursor: () => state.importer.getCursor("provisional").autobaseLength,
      getImporterFinalizedCursor: () => state.importer.getCursor("finalized").autobaseLength,
      getPendingOutboxCount: () => state.outbox.getPendingCount(),
      getPendingDependencyCount: () => state.importer.getPendingDependencyCount(),
      getQuarantineCount: () => 0,
      getLastSuccessfulReplicationAt: () => state.lastSuccessfulReplicationAt,
      getLastError: () => state.lastError,
    }

    return collectDiagnostics(federationId, source)
  }

  private handleConnection(federationId: string, _connection: unknown, _info: unknown): void {
    // Future: full Corestore replication stream setup with handshake
  }
}
