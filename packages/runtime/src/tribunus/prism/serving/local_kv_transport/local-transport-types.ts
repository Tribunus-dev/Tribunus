/**
 * Prism Local-Host KV Transport — Types
 */

// ── Transport Backends ------------------------------------------------------

export type LocalTransportBackendKind = "linux_unix_socket_shared_memory" | "macos_future_transport" | "test_fixture_transport"

// ── Capability --------------------------------------------------------------

export interface PrismLocalHostKvTransportCapability {
  backendKind: LocalTransportBackendKind
  supported: boolean
  protocolVersion: number
  maximumSegmentBytes: number
  maximumConcurrentSegments: number
  supportedTransferRepresentations: string[]
  supportsReadOnlyDestinationMapping: boolean
  supportsFdPassing: boolean
  supportsIntegrityTrailer: boolean
  supportsCancellation: boolean
  supportsOrphanRecovery: boolean
  platformCapabilityDigest: string
}

// ── Authority Domain --------------------------------------------------------

export interface LocalHostAuthorityDomain {
  hostInstanceId: string
  operatingSystemFamily: string
  localTransportBackend: LocalTransportBackendKind
  runtimeUserScope: string
  transportNamespaceDigest: string
}

// ── Handshake ---------------------------------------------------------------

export interface LocalKvTransportHandshake {
  protocolVersion: number
  workerId: string
  workerInstanceId: string
  hostInstanceId: string
  transportCapabilityDigest: string
  ephemeralTransportPublicKey: string
  nonce: string
  timestamp: string
  signature: string
}

export interface LocalKvTransportHandshakeAcceptance {
  protocolVersion: number
  workerId: string
  workerInstanceId: string
  hostInstanceId: string
  transportCapabilityDigest: string
  ephemeralTransportPublicKey: string
  nonceEcho: string
  nonce: string
  timestamp: string
  signature: string
}

// ── Control Message ---------------------------------------------------------

export type LocalKvControlMessageKind =
  | "handshake" | "handshake_accept" | "handoff_offer" | "handoff_accept" | "handoff_reject"
  | "export_ready" | "segment_descriptor" | "import_started" | "import_verified"
  | "import_activated" | "import_acknowledged" | "commit" | "rollback" | "cancel"
  | "source_disposition_request" | "source_disposition_complete" | "heartbeat" | "error"

export interface LocalKvControlMessage {
  protocolVersion: number
  messageId: string
  sequenceNumber: number
  handoffId: string
  routeId: string
  requestId: string
  sourceWorkerInstanceId: string
  destinationWorkerInstanceId: string
  kind: LocalKvControlMessageKind
  payloadDigest: string
  payload: Record<string, unknown> | null
  sentAt: string
  signature: string
}

// ── Shared-Memory Segment ---------------------------------------------------

export type SegmentState =
  | "allocated" | "writing" | "sealed" | "offered" | "mapped_by_destination"
  | "import_verified" | "acknowledged" | "released"
  | "failed" | "cancelled" | "expired"

export interface PrismKvSharedMemorySegment {
  segmentId: string
  handoffId: string
  ownerWorkerInstanceId: string
  destinationWorkerInstanceId: string
  hostInstanceId: string
  byteLength: number
  mappedByteLength: number
  alignment: number
  createdAt: string
  expiresAt: string
  state: SegmentState
  payloadChecksum: string
  descriptorDigest: string
}

// ── Segment Descriptor ------------------------------------------------------

export interface PrismKvSegmentDescriptor {
  handoffId: string
  segmentId: string
  byteLength: number
  alignment: number
  envelopeDigest: string
  payloadChecksum: string
  expiresAt: string
  transportSessionId: string
  descriptorNonce: string
  descriptorSignature: string
}

// ── Transfer Envelope -------------------------------------------------------

export interface PrismKvTransferEnvelope {
  envelopeVersion: number
  handoffId: string
  sourceKvNamespaceId: string
  modelArtifactDigest: string
  tokenizerDigest: string
  compatibilityDescriptorDigest: string
  transferRepresentation: string
  sequenceLength: number
  layerCount: number
  pageCount: number
  payloadByteLength: number
  payloadAlignment: number
  payloadChecksum: string
  createdAt: string
}

// ── Transfer Trailer --------------------------------------------------------

export interface PrismKvTransferTrailer {
  envelopeDigest: string
  payloadChecksum: string
  payloadByteLength: number
  serializationGeneration: number
  completedAt: string
}

// ── Transport Session -------------------------------------------------------

export type TransportSessionState = "pending" | "active" | "transferring" | "completed" | "failed" | "cancelled" | "expired"

export interface LocalKvTransportSession {
  sessionId: string
  handoffId: string
  sourceWorkerId: string
  sourceInstanceId: string
  destWorkerId: string
  destInstanceId: string
  hostInstanceId: string
  state: TransportSessionState
  createdAt: string
  expiresAt: string
}

// ── Handshake Rejection Reasons ---------------------------------------------

export type HandshakeRejection =
  | "unknown_worker" | "worker_instance_mismatch" | "host_authority_mismatch"
  | "transport_capability_mismatch" | "protocol_version_mismatch"
  | "invalid_signature" | "expired_handshake" | "replayed_nonce"
  | "transport_session_expired"

// ── Timeout Classes ---------------------------------------------------------

export type TransportTimeoutClass =
  | "serialization_timeout" | "descriptor_delivery_timeout" | "destination_map_timeout"
  | "integrity_validation_timeout" | "deserialization_timeout"
  | "acknowledgement_timeout" | "source_cleanup_timeout" | "transport_session_timeout"

// ── Handoff Mode Extension --------------------------------------------------

export type KvHandoffMode = "simulation_only" | "local_host_real_transport" | "future_network_transport_required"

// ── Orphan Record -----------------------------------------------------------

export interface OrphanSegmentRecord {
  segmentId: string
  handoffId: string
  ownerInstanceId: string
  byteLength: number
  state: string
  expiredAt: string
  reclaimedAt: string | null
  quarantined: boolean
}

// ── Metrics -----------------------------------------------------------------

export const LOCAL_TRANSPORT_METRICS = [
  "prism_kv_local_transport_handoffs_total", "prism_kv_local_transport_handoffs_inflight",
  "prism_kv_local_transport_completed_total", "prism_kv_local_transport_failed_total",
  "prism_kv_local_transport_cancelled_total",
  "prism_kv_local_transport_orphaned_segments_total",
  "prism_kv_local_transport_reclaimed_segments_total",
  "prism_kv_local_transport_serialization_seconds",
  "prism_kv_local_transport_descriptor_delivery_seconds",
  "prism_kv_local_transport_import_seconds",
  "prism_kv_local_transport_total_seconds",
  "prism_kv_local_transport_payload_bytes",
  "prism_kv_local_transport_segments_active",
  "prism_kv_local_transport_segment_expirations_total",
  "prism_kv_local_transport_integrity_failures_total",
  "prism_kv_local_transport_authorization_failures_total",
  "prism_kv_local_transport_timeout_total",
] as const

// ── Dharma Policy -----------------------------------------------------------

export interface DharmaLocalTransportPolicy {
  allowSimulatedHandoff: boolean
  allowLocalHostRealTransport: boolean
  allowFutureNetworkTransport: boolean
  allowedTransportBackends: string[]
  maximumHandoffBytes: number
  maximumHandoffDurationMs: number
  maximumConcurrentHandoffs: number
  requireSameHostAuthorityDomain: boolean
  requireStrictRepresentationCompatibility: boolean
  requireDestinationSignature: boolean
  requireSourceCleanupReceipt: boolean
}
