/**
 * Dharma Replication — Barrel
 *
 * Re-exports all public APIs from the Phase 2 replication layer.
 */

// Protocol types and constants
export type {
  SwarmLifecycleState,
  PeerState,
  FederationLifecycleState,
  OutboxEntryState,
  ImporterCursorType,
  ReplicationLimits,
  FederationBootstrapRecord,
  DharmaInvitationBundle,
  WriterAdmission,
  DharmaPeerHello,
  DharmaPeerWelcome,
  PeerHandshakeResult,
  ReplicatedDharmaEvent,
  DharmaReplicationDiagnostics,
  FederationUserStatus,
} from "./protocol"
export {
  DHARMA_REPLICATION_PROTOCOL_VERSION,
  DHARMA_SWARM_TOPIC_PREFIX,
  MAX_EVENT_BLOCK_BYTES,
  MAX_EVENTS_PER_MINUTE,
  MAX_PEERS_PER_FEDERATION,
  MAX_GLOBAL_PEERS,
  MAX_HANDSHAKE_DURATION_MS,
  DEPENDENCY_WAIT_BUDGET_MS,
  DEPENDENCY_RETRY_INTERVAL_MS,
  MAX_DEPENDENCY_DEPTH,
  MAX_UNRESOLVED_EVENTS,
  RECONNECT_BACKOFF_BASE_MS,
  RECONNECT_BACKOFF_MAX_MS,
  DHARMA_DHT_BOOTSTRAP_INTERVAL_MS,
  DHARMA_DHT_CONNECTION_TIMEOUT_MS,
  DEFAULT_REPLICATION_LIMITS,
} from "./protocol"

// Errors
export {
  ReplicationError,
  CorestoreError,
  AutobaseError,
  SwarmError,
  HandshakeError,
  InvitationError,
  OutboxError,
  ImporterError,
  QuotaExceededError,
} from "./errors"

// Encoding
export { b4a } from "./encoding"

// Corestore
export type { CorestoreConfig } from "./corestore"
export { CoreName, DharmaCorestore } from "./corestore"

// Federation store
export { FederationStore } from "./federation-store"

// Federation base (Autobase)
export type { AutobaseBlock, FederationBaseConfig } from "./federation-base"
export { AUTOBASE_VIEW_PREFIXES, FederationBase, createDefaultApply } from "./federation-base"

// Handshake
export type { HandshakeConfig } from "./handshake"
export {
  createHello,
  respondToHello,
  verifyWelcome,
  createHandshakeResult,
  isProtocolCompatible,
  isFederationAccepted,
} from "./handshake"

// Peer
export type { PeerRecord } from "./peer"
export { PeerTracker } from "./peer"

// Swarm
export type { SwarmConfig } from "./swarm"
export {
  deriveSwarmTopic,
  DharmaSwarm,
  DEFAULT_HYPERSWARM_BOOTSTRAP,
  withDefaultBootstrap,
} from "./swarm"

// Lifecycle
export type { SwarmAction } from "./lifecycle"
export {
  VALID_SWARM_TRANSITIONS,
  isValidSwarmTransition,
  nextSwarmState,
  calculateBackoff,
} from "./lifecycle"

// Outbox
export type { OutboxEntry } from "./outbox"
export {
  VALID_OUTBOX_TRANSITIONS,
  isValidOutboxTransition,
  OutboxManager,
} from "./outbox"
// Outbox recovery
export type { OutboxRecoveryResult, OutboxStateCounts } from "./outbox-recovery"
export { recoverOutbox, getOutboxState } from "./outbox-recovery"

// Importer
export type { ImportCursor, PendingDependency } from "./importer"
export { FederationEventImporter } from "./importer"

// Checkpoint
export type { FederationCheckpoint } from "./checkpoint"
export { verifyCheckpoint, createCheckpointRecord } from "./checkpoint"

// Checkpoint recovery
export type { CheckpointRecoveryResult } from "./checkpoint-recovery"
export { recoverFromCheckpoint, isRecoveryNeeded, getRecoverySummary } from "./checkpoint-recovery"

// Diagnostics
export type { DiagnosticsSource, HealthLevel } from "./diagnostics"
export { collectDiagnostics, deriveUserStatus, assessHealth } from "./diagnostics"

// Runtime
export type { RuntimeConfig } from "./runtime"
export { DharmaReplicationRuntime } from "./runtime"

// Runtime initialization
export type { RuntimeInitResult } from "./runtime-init"
export { initializeRuntime } from "./runtime-init"

// Schema
export {
  DharmaReplicationFederationTable,
  DharmaReplicationWriterTable,
  DharmaReplicationPeerTable,
  DharmaReplicationSessionTable,
  DharmaReplicationOutboxTable,
  DharmaReplicationImportCursorTable,
  DharmaReplicationPendingDependencyTable,
  DharmaReplicationCheckpointTable,
  DharmaReplicationQuotaViolationTable,
  DharmaReplicationDiagnosticsTable,
  DHARMA_REPLICATION_SCHEMA,
} from "./schema.pg.sql"
