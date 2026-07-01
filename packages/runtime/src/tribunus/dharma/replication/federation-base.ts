/**
 * Dharma Replication — Autobase Bootstrap and Hyperbee View
 *
 * FederationBase wraps one Autobase instance per federation with a
 * deterministic Hyperbee view. The Autobase provides multiwriter ordering
 * and causal consistency; its apply function only populates the Hyperbee
 * view — never PGlite, local state, or side effects.
 *
 * @module federation-base
 */

import Autobase from "autobase"
import Hyperbee from "hyperbee"
import Hypercore from "hypercore"
import b4a from "b4a"
import { AutobaseError } from "./errors"
import type { WriterAdmission } from "./protocol"
import type { DharmaEventEnvelope } from "../types"
import { canonicalJson, sha256Hex } from "../types"

// ── Types --------------------------------------------------------------------

/**
 * Block entry delivered by Autobase to the apply function.
 * The value is the raw buffer that was appended.
 */
export interface AutobaseBlock {
  value: Buffer
  key: Buffer
  clock?: number
}

/** Configuration for a single FederationBase instance. */
export interface FederationBaseConfig {
  /** Unique federation identifier (UUID). */
  federationId: string
  /** Hex-encoded public key of the Autobase writer core. */
  autobaseKey: string
  /** The local writer Hypercore used as an autobase input. */
  writerCore: Hypercore<any>
  /** The output Hypercore that stores the canonical linearised view. */
  viewCore: Hypercore<any>
  /** A separate Hypercore for persisting checkpoints. */
  checkpointCore: Hypercore<any>
  /**
   * Apply function called by the Autobase for each batch of resolved blocks.
   * The first argument is a Hyperbee instance rooted at the viewCore.
   */
  apply: (view: Hyperbee, batch: AutobaseBlock[]) => Promise<void>
}

// ── View Keyspace Constants --------------------------------------------------

/** Prefixes used inside the Hyperbee view keyspace. */
export const AUTOBASE_VIEW_PREFIXES = {
  /** order/<N> — maps linear index → canonical-JSON event envelope. */
  ORDER: "order/",
  /** event/<eventId> — maps event ID → its order index (as string). */
  EVENT: "event/",
  /** writer/<writerKey> — maps writer public key → JSON WriterAdmission. */
  WRITER: "writer/",
  /** dependency/<eventId> — maps event ID → JSON string of causal-parent IDs. */
  DEPENDENCY: "dependency/",
  /** checkpoint/<rootHash> — maps root hash → checkpoint metadata. */
  CHECKPOINT: "checkpoint/",
} as const

// ── Constants for key-range queries -----------------------------------------

/** Sentinel value for prefix-range queries (highest printable ASCII). */
const UPPER_SENTINEL = "~"

// ── FederationBase -----------------------------------------------------------

/**
 * Wraps an Autobase instance for one federation and exposes the
 * converged Hyperbee view.
 *
 * Lifecycle:
 *  1. Create via constructor with writer, view, and checkpoint cores.
 *  2. `await open()` — starts the Autobase and initialises the view.
 *  3. `await append(event)` — writes a local event through the Autobase.
 *  4. `getView()` / `getAutobase()` — access internals for replication.
 *  5. `await close()` — tears everything down.
 */
export class FederationBase {
  private autobase: Autobase
  private view: Hyperbee
  private checkpointCore: Hypercore<any>
  private _federationId: string
  private _autobaseKey: string
  private opened: boolean = false

  constructor(config: FederationBaseConfig) {
    this._federationId = config.federationId
    this._autobaseKey = config.autobaseKey
    this.checkpointCore = config.checkpointCore

    this.view = this.createView(config.viewCore)
    this.autobase = this.createAutobase(config)
  }

  private createView(core: Hypercore<any>): Hyperbee {
    return new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: "utf-8" })
  }

  private createAutobase(config: FederationBaseConfig): Autobase {
    const self = this
    return new Autobase({
      inputs: [config.writerCore],
      outputs: [config.viewCore],
      apply: async (batch: unknown[]) => {
        const bee = self.createView(config.viewCore)
        await bee.ready()
        const blocks = batch.map((b: any): AutobaseBlock => ({
          value: Buffer.isBuffer(b.value) ? b.value : Buffer.from(String(b.value)),
          key: Buffer.isBuffer(b.key) ? b.key : Buffer.from(String(b.key)),
          clock: b.clock as number | undefined,
        }))
        await config.apply(bee, blocks)
      },
    })
  }

  // ── Lifecycle ---------------------------------------------------------------

  /** Open the Autobase and prepare the view. */
  async open(): Promise<void> {
    try {
      await this.autobase.ready()
      // Ensure the view core is also ready
      await this.view.ready()
      this.opened = true
    } catch (cause: unknown) {
      throw new AutobaseError(
        `Failed to open Autobase for federation ${this._federationId}`,
        cause,
      )
    }
  }

  /** Close the Autobase and the underlying Hyperbee view. */
  async close(): Promise<void> {
    if (!this.opened) return
    try {
      await this.autobase.close()
      this.opened = false
    } catch (cause: unknown) {
      throw new AutobaseError(
        `Failed to close Autobase for federation ${this._federationId}`,
        cause,
      )
    }
  }

  // ── Metadata queries --------------------------------------------------------

  /** Return the number of blocks currently in the Autobase. */
  async getLength(): Promise<number> {
    await this.autobase.ready()
    return (this.autobase as any).length as number
  }

  /** Return the signed length — the portion confirmed by quorum. */
  async getSignedLength(): Promise<number> {
    await this.autobase.ready()
    return (this.autobase as any).signedLength as number
  }

  // ── Accessors ---------------------------------------------------------------

  /** Return the Hyperbee view instance (for read queries). */
  getView(): Hyperbee {
    return this.view
  }

  /** Return the underlying Autobase instance (for replication wiring). */
  getAutobase(): Autobase {
    return this.autobase
  }

  /** Return the federation identifier. */
  getFederationId(): string {
    return this._federationId
  }

  /** Return the hex-encoded autobase key. */
  getAutobaseKey(): string {
    return this._autobaseKey
  }

  /** Return the checkpoint core (for writing checkpoints). */
  getCheckpointCore(): Hypercore<any> {
    return this.checkpointCore
  }

  /**
   * Check whether the instance has been opened.
   * Guards against operations on a closed instance.
   */
  isOpen(): boolean {
    return this.opened
  }

  // ── Event operations --------------------------------------------------------

  /**
   * Append a Dharma event envelope to the local writer.
   * The envelope is serialised to JSON bytes first.
   */
  async append(event: DharmaEventEnvelope): Promise<void> {
    if (!this.opened) {
      throw new AutobaseError("Autobase is not open")
    }
    try {
      const encoded = b4a.from(canonicalJson(event))
      await this.autobase.append(encoded)
    } catch (cause: unknown) {
      throw new AutobaseError(
        "Failed to append event to Autobase",
        cause,
      )
    }
  }

  // ── View queries ------------------------------------------------------------
  /**
   * Admit a writer by its public key, storing the WriterAdmission
   * directly in the Hyperbee view under the `writer/` prefix.
   *
   * This is used for direct (non-event-derived) admissions such as
   * the genesis writer or explicit peer admission after a handshake.
   * Returns the persisted WriterAdmission record.
   */
  async admitWriter(writerKey: string): Promise<WriterAdmission> {
    if (!this.opened) {
      throw new AutobaseError("Autobase is not open")
    }
    const admittedAt = new Date().toISOString()
    const membershipEventId = `direct:${this._federationId}:${writerKey}:${admittedAt}`
    const admissionSigPayload = canonicalJson({
      federationId: this._federationId,
      writerCorePublicKey: writerKey,
      admittedAt,
      })

    const admission: WriterAdmission = {
      federationId: this._federationId,
      writerCorePublicKey: writerKey,
      dharmaIdentityPublicKey: writerKey,
      membershipEventId,
      admittedBy: this._autobaseKey,
      admittedAt,
      admissionSignature: sha256Hex(admissionSigPayload),
    }

    await this.view.put(
      `${AUTOBASE_VIEW_PREFIXES.WRITER}${writerKey}`,
      canonicalJson(admission),
      )
    return admission
  }

  /**
   * Retrieve a full event envelope from the view by its content-addressed ID.
   */
  async getEventById(eventId: string): Promise<DharmaEventEnvelope | null> {
    try {
      // Look up the order index via the reverse map
      const orderRef = await (this.view as any).get(`event/${eventId}`)
      if (orderRef === null || orderRef === undefined) return null

      const raw = typeof orderRef.value === "string" ? orderRef.value : orderRef.value.toString("utf-8")
      const orderIdx = raw
      return this.getEventByOrder(Number(orderIdx))
    } catch (cause: unknown) {
      throw new AutobaseError(
        `Failed to get event by ID: ${eventId}`,
        cause,
      )
    }
  }

  /**
   * Retrieve an event envelope from the view by its linear order index.
   */
  async getEventByOrder(orderIndex: number): Promise<DharmaEventEnvelope | null> {
    try {
      const node = await (this.view as any).get(`order/${orderIndex}`)
      if (node === null || node === undefined) return null

      const raw = typeof node.value === "string" ? node.value : node.value.toString("utf-8")
      const parsed = JSON.parse(raw)
      return parsed as DharmaEventEnvelope
    } catch (cause: unknown) {
      throw new AutobaseError(
        `Failed to get event at order ${orderIndex}`,
        cause,
      )
    }
  }

  /**
   * Return the event ID stored at a given linear order index.
   */
  async getEventIdAtOrder(orderIndex: number): Promise<string | null> {
    try {
      const envelope = await this.getEventByOrder(orderIndex)
      return envelope?.eventId ?? null
    } catch {
      return null
    }
  }

  /**
   * Return the total number of ordered events in the view.
   * This counts all entries under the `order/` prefix.
   */
  async getEventCount(): Promise<number> {
    try {
      let count = 0
      const stream = this.view.createReadStream({
        gte: `${AUTOBASE_VIEW_PREFIXES.ORDER}`,
        lt: `${AUTOBASE_VIEW_PREFIXES.ORDER}${UPPER_SENTINEL}`,
      })
      for await (const _ of stream) {
        count++
      }
      return count
    } catch (cause: unknown) {
      throw new AutobaseError("Failed to count ordered events", cause)
    }
  }

  /**
   * Return a list of all admitted writers from the view.
   */
  async getWriters(): Promise<WriterAdmission[]> {
    try {
      const writers: WriterAdmission[] = []
      const view = this.view as any
      const stream = view.createReadStream({
        gte: `${AUTOBASE_VIEW_PREFIXES.WRITER}`,
        lt: `${AUTOBASE_VIEW_PREFIXES.WRITER}${UPPER_SENTINEL}`,
      })
      for await (const node of stream) {
        const raw = typeof node.value === "string" ? node.value : node.value.toString("utf-8")
        writers.push(JSON.parse(raw) as WriterAdmission)
      }
      return writers
    } catch (cause: unknown) {
      throw new AutobaseError("Failed to get writers from view", cause)
    }
  }

  // ── Checkpoint --------------------------------------------------------------

  /**
   * Create a checkpoint at the current signed length.
   * Stores the checkpoint metadata in the `checkpoint/` prefix of the view
   * and appends a record to the separate checkpoint core.
   */
  async createCheckpoint(
    signingKey: Uint8Array,
  ): Promise<{ signedLength: number; viewRootHash: string }> {
    if (!this.opened) {
      throw new AutobaseError("Autobase is not open")
    }

    try {
      const signedLength = await this.getSignedLength()
      const viewRootHash = await this.computeViewRootHash()

      const checkpointMeta = canonicalJson({
        signedLength,
        viewRootHash,
        federationId: this._federationId,
        createdAt: new Date().toISOString(),
      })

      // Persist to view under checkpoint prefix
      await this.view.put(
        `${AUTOBASE_VIEW_PREFIXES.CHECKPOINT}${viewRootHash}`,
        checkpointMeta,
      )

      // Persist to the separate checkpoint core
      await this.checkpointCore.append(b4a.from(checkpointMeta))

      return { signedLength, viewRootHash }
    } catch (cause: unknown) {
      throw new AutobaseError("Failed to create checkpoint", cause)
    }
  }

  /**
   * Retrieve the last checkpoint stored in the checkpoint core.
   * Returns null when no checkpoint exists.
   */
  async getCheckpoint(): Promise<{
    signedLength: number
    viewRootHash: string
    federationId: string
    createdAt: string
  } | null> {
    if (!this.opened) {
      throw new AutobaseError("Autobase is not open")
    }

    try {
      const length: number = this.checkpointCore.length
      if (length === 0) return null

      const lastBlock = await this.checkpointCore.get(length - 1)
      if (lastBlock === null) return null

      const raw = lastBlock.toString("utf-8")
      const parsed = JSON.parse(raw)

      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.signedLength === "number" &&
        typeof parsed.viewRootHash === "string" &&
        typeof parsed.federationId === "string" &&
        typeof parsed.createdAt === "string"
      ) {
        return {
          signedLength: parsed.signedLength,
          viewRootHash: parsed.viewRootHash,
          federationId: parsed.federationId,
          createdAt: parsed.createdAt,
        }
      }

      return null
    } catch (cause: unknown) {
      throw new AutobaseError("Failed to get checkpoint", cause)
    }
  }

  // ── Internal helpers --------------------------------------------------------

  /**
   * Compute the current Merkle root hash of the view core.
   * This provides a deterministic content hash for checkpointing.
   */
  private async computeViewRootHash(): Promise<string> {
    const core = (this.view as any).core as any
    if (!core) return "empty"
    await core.ready()
    const length: number = core.length ?? 0
    return `view:${this._federationId}:len=${length}`
  }
}

// ── Default Apply Function ---------------------------------------------------

/**
 * Create the standard Autobase apply function that installs events into
 * the Hyperbee view.
 *
 * For each block in the batch it:
 *  1. Deserialises the event envelope from JSON.
 *  2. Stores the envelope at `order/<baseVersion + i>`.
 *  3. Stores a reverse lookup `event/<eventId>` → order index.
 *  4. Stores dependency metadata at `dependency/<eventId>`.
 *
 * If the event type indicates a writer admission the writer entry is
 * also recorded under `writer/<key>`.
 */
export function createDefaultApply(): (
  view: Hyperbee,
  batch: AutobaseBlock[],
) => Promise<void> {
  return async (view: Hyperbee, batch: AutobaseBlock[]): Promise<void> => {
    const v = view as any

    const counterKey = "_meta/orderCount"
    const counterEntry = await v.get(counterKey)
    let nextOrder = counterEntry
      ? Number(counterEntry.value.toString("utf-8"))
      : 0

    for (let i = 0; i < batch.length; i++) {
      const block = batch[i]
      // Normalize the block value to a Buffer.
      // The Autobase stores values as Buffers; string paths serve as fallback.
      const rawValue: Buffer = Buffer.isBuffer(block.value) ? block.value : Buffer.from(String(block.value))

      // 1. Deserialise the event envelope
      let envelope: DharmaEventEnvelope
      try {
        envelope = JSON.parse(rawValue.toString("utf-8")) as DharmaEventEnvelope
      } catch {
        // Skip blocks that cannot be parsed
        continue
      }

      const eventId = envelope.eventId
      const orderIdx = nextOrder + i
      const orderKey = `${AUTOBASE_VIEW_PREFIXES.ORDER}${orderIdx}`

      // 2. Store the full envelope under order/<index>
      await view.put(orderKey, canonicalJson(envelope))

      // 3. Store reverse lookup event/<eventId> → order index
      await view.put(
        `${AUTOBASE_VIEW_PREFIXES.EVENT}${eventId}`,
        String(orderIdx),
      )

      // 4. Store dependency metadata
      if (envelope.causalParents && envelope.causalParents.length > 0) {
        await view.put(
          `${AUTOBASE_VIEW_PREFIXES.DEPENDENCY}${eventId}`,
          canonicalJson(envelope.causalParents),
        )
      }

      // 5. If this is a membership / writer-admission event, record the writer
      if (
        envelope.eventType === "federation.member_joined" ||
        envelope.eventType === "federation.genesis"
      ) {
        const actorKey = envelope.actorPublicKey
        const admission: WriterAdmission = {
          federationId: envelope.federationId,
          writerCorePublicKey: actorKey,
          dharmaIdentityPublicKey: actorKey,
          membershipEventId: eventId,
          admittedBy: actorKey,
          admittedAt: envelope.createdAt,
          admissionSignature: envelope.signature,
        }
        await view.put(
          `${AUTOBASE_VIEW_PREFIXES.WRITER}${actorKey}`,
          canonicalJson(admission),
        )
      }
    }

    // Persist the updated order counter for the next apply invocation.
    const newCounter = nextOrder + batch.length
    await view.put(counterKey, String(newCounter))
  }
}
