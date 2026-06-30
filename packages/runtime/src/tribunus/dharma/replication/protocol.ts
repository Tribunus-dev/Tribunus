/**
 * Dharma Replication — Protocol Types and Constants
 *
 * Defines the protocol-level types for Phase 2 peer-to-peer replication.
 * These types are shared across handshake, swarm, and peer modules.
 */

// ── Protocol Constants -------------------------------------------------------

/** Current Phase 2 protocol version (semantic uint16). */
export const DHARMA_REPLICATION_PROTOCOL_VERSION = 1

/** Hyperswarm topic derivation prefix. */
export const DHARMA_SWARM_TOPIC_PREFIX = "tribunus.dharma.phase2"

/** Max bytes per replicated event block. */
export const MAX_EVENT_BLOCK_BYTES = 256 * 1024 // 256 KB

/** Max events per minute per peer. */
export const MAX_EVENTS_PER_MINUTE = 120

/** Max concurrent peers per federation. */
export const MAX_PEERS_PER_FEDERATION = 8

/** Max global concurrent peers. */
export const MAX_GLOBAL_PEERS = 24

/** Max inbound replication streams. */
export const MAX_INBOUND_STREAMS = 16

/** Max outbound replication streams. */
export const MAX_OUTBOUND_STREAMS = 16

/** Max pending handshake duration in ms. */
export const MAX_HANDSHAKE_DURATION_MS = 10_000

/** Dependency wait budget in ms. */
export const DEPENDENCY_WAIT_BUDGET_MS = 5 * 60 * 1000

/** Dependency background retry interval in ms. */
export const DEPENDENCY_RETRY_INTERVAL_MS = 30_000

/** Max pending dependency graph depth. */
export const MAX_DEPENDENCY_DEPTH = 64

/** Max unresolved events per federation. */
export const MAX_UNRESOLVED_EVENTS = 10_000

/** Exponential backoff base in ms. */
export const RECONNECT_BACKOFF_BASE_MS = 1_000

/** Max reconnect backoff in ms. */
export const RECONNECT_BACKOFF_MAX_MS = 60_000

// ── Swarm Lifecycle States ---------------------------------------------------

export type SwarmLifecycleState =
  | "stopped"
  | "starting"
  | "joining"
  | "connected"
  | "degraded"
  | "paused"
  | "stopping"

// ── Peer States --------------------------------------------------------------

export type PeerState =
  | "discovered"
  | "handshaking"
  | "active"
  | "degraded"
  | "disconnected"
  | "blocked"

// ── Federation Lifecycle States ----------------------------------------------

export type FederationLifecycleState =
  | "unaware"
  | "discovered"
  | "invited"
  | "joining"
  | "active"
  | "limited"
  | "suspended"
  | "left"
  | "revoked"

// ── Outbox States ------------------------------------------------------------

export type OutboxEntryState =
  | "created"
  | "ready"
  | "appending"
  | "appended"
  | "observed_in_view"
  | "imported"
  | "complete"
  | "retry_wait"
  | "failed_terminal"

// ── Importer Cursor Types ----------------------------------------------------

export type ImporterCursorType = "provisional" | "finalized"

// ── Replication Limits -------------------------------------------------------

export interface ReplicationLimits {
  maxPeersPerFederation: number
  maxGlobalPeers: number
  maxInboundStreams: number
  maxOutboundStreams: number
  maxHandshakeDurationMs: number
  maxEventBlockBytes: number
  maxEventsPerMinute: number
}

export const DEFAULT_REPLICATION_LIMITS: ReplicationLimits = {
  maxPeersPerFederation: MAX_PEERS_PER_FEDERATION,
  maxGlobalPeers: MAX_GLOBAL_PEERS,
  maxInboundStreams: MAX_INBOUND_STREAMS,
  maxOutboundStreams: MAX_OUTBOUND_STREAMS,
  maxHandshakeDurationMs: MAX_HANDSHAKE_DURATION_MS,
  maxEventBlockBytes: MAX_EVENT_BLOCK_BYTES,
  maxEventsPerMinute: MAX_EVENTS_PER_MINUTE,
}

// ── Federation Bootstrap Record ----------------------------------------------

export interface FederationBootstrapRecord {
  protocolVersion: number
  federationId: string
  federationGenesisEventId: string
  federationRootPublicKey: string
  autobaseKey: string
  autobaseDiscoveryKey: string
  initialPolicyDigest: string
  genesisWriterKey: string
  createdAt: string
  bootstrapSignature: string
}

// ── Invitation Bundle --------------------------------------------------------

export interface DharmaInvitationBundle {
  invitationId: string
  bootstrap: FederationBootstrapRecord
  inviterIdentityPublicKey: string
  inviteeIdentityPublicKey: string | null
  membershipRole: string
  expiresAt: string
  maxUses: number
  invitationNonce: string
  encryptedJoinPayload: string | null
  signature: string
}

// ── Writer Admission ---------------------------------------------------------

export interface WriterAdmission {
  federationId: string
  writerCorePublicKey: string
  dharmaIdentityPublicKey: string
  membershipEventId: string
  admittedBy: string
  admittedAt: string
  admissionSignature: string
}

// ── Peer Messages ------------------------------------------------------------

export interface DharmaPeerHello {
  protocolVersion: number
  nodeInstanceId: string
  supportedSchemaVersions: number[]
  supportedFederations: string[]
  identityPublicKey: string | null
  devicePublicKey: string
  timestamp: string
  nonce: Uint8Array
  signature: Uint8Array
}

export interface DharmaPeerWelcome {
  protocolVersion: number
  acceptedFederations: string[]
  rejectedFederations: string[]
  maxEventsPerMinute: number
  maxEventBlockBytes: number
  serverTime: string
  nonceEcho: Uint8Array
  nonce: Uint8Array
  signature: Uint8Array
}

export interface PeerHandshakeResult {
  accepted: boolean
  acceptedFederations: string[]
  limits: ReplicationLimits
  peerId: string
  serverTime: string
}

// ── Replicated Event Format --------------------------------------------------

export interface ReplicatedDharmaEvent {
  protocolVersion: number
  writerCorePublicKey: string
  writerSequence: number
  eventEnvelopeBytes: Uint8Array
  eventId: string
  eventHash: string
  appendedAt: string
}

// ── Replication Diagnostics --------------------------------------------------

export interface DharmaReplicationDiagnostics {
  federationId: string
  lifecycleState: SwarmLifecycleState | "inactive"
  swarmJoined: boolean
  activePeerCount: number
  successfulHandshakes: number
  failedHandshakes: number
  writerCount: number
  autobaseLength: number
  autobaseSignedLength: number
  importerProvisionalCursor: number
  importerFinalizedCursor: number
  pendingOutboxCount: number
  pendingDependencyCount: number
  quarantineCount: number
  lastSuccessfulReplicationAt: string | null
  lastError: string | null
}

// ── User-Facing Federation Status -------------------------------------------

export type FederationUserStatus =
  | "offline"
  | "connecting"
  | "synchronizing"
  | "up_to_date"
  | "degraded"
  | "paused"
  | "attention_required"
