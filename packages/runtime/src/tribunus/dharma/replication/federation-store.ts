/**
 * Federation Store — Storage Operations for a Single Federation
 *
 * Reads and writes federation data through the DharmaCorestore's named cores.
 * Writes bootstrap records and writer admissions into the view core (the
 * autobase-linearized feed shared by all federation members), and appends
 * signed events to the local writer core (owned by this identity alone).
 *
 * All view-core records are stored as canonical JSON (UTF-8 encoded Uint8Array
 * blocks) with a `type` discriminator so scanners can filter by record kind.
 */

import type { DharmaCorestore } from "./corestore"
import type Hypercore from "hypercore"
import { ReplicationError } from "./errors"
import type { FederationBootstrapRecord, WriterAdmission } from "./protocol"
import { canonicalJson } from "../types"
import b4a from "b4a"

// ── Internal Tagged Format ---------------------------------------------------

type ViewCoreEntry =
  | { type: "bootstrap"; record: FederationBootstrapRecord }
  | { type: "writer_admission"; record: WriterAdmission }

function encodeEntry(entry: ViewCoreEntry): Uint8Array {
  return b4a.from(canonicalJson(entry), "utf-8")
}

function decodeEntry(bytes: Uint8Array): ViewCoreEntry {
  return JSON.parse(b4a.toString(bytes, "utf-8")) as ViewCoreEntry
}

// ── FederationStore ----------------------------------------------------------

export class FederationStore {
  constructor(
    private corestore: DharmaCorestore,
    private federationId: string,
    /** The local Dharma identity that owns writer operations for this store. */
    private identityId: string,
  ) {}

  // ── Bootstrap --------------------------------------------------------

  /** Store a bootstrap record as the first block in the federation view core. */
  async storeBootstrap(record: FederationBootstrapRecord): Promise<void> {
    const view = await this.corestore.getViewCore(this.federationId)
    const entry: ViewCoreEntry = { type: "bootstrap", record }
    await view.append(encodeEntry(entry))
  }

  /** Read the bootstrap record (first block of the view core). */
  async getBootstrap(): Promise<FederationBootstrapRecord | null> {
    const view = await this.corestore.getViewCore(this.federationId)
    if (view.length === 0) return null
    try {
      const block = await view.get(0)
      if (!block) return null
      const entry = decodeEntry(block as Uint8Array)
      return entry.type === "bootstrap" ? entry.record : null
    } catch {
      return null
    }
  }

  // ── Writer Admissions -------------------------------------------------

  /** Store a writer admission record in the federation view core. */
  async storeWriterAdmission(admission: WriterAdmission): Promise<void> {
    const view = await this.corestore.getViewCore(this.federationId)
    const entry: ViewCoreEntry = { type: "writer_admission", record: admission }
    await view.append(encodeEntry(entry))
  }

  /** Get all admitted writers for this federation by scanning the view core. */
  async getWriters(): Promise<WriterAdmission[]> {
    const view = await this.corestore.getViewCore(this.federationId)
    const writers: WriterAdmission[] = []

    for (let seq = 0; seq < view.length; seq++) {
      try {
        const block = await view.get(seq)
        if (!block) continue
        const entry = decodeEntry(block as Uint8Array)
        if (entry.type === "writer_admission") {
          writers.push(entry.record)
        }
      } catch {
        // Skip corrupt or unreadable blocks
      }
    }

    return writers
  }

  // ── Event Appending --------------------------------------------------

  /** Append a signed event envelope to the local writer core. */
  async appendEvent(
    eventEnvelope: Uint8Array,
  ): Promise<{ sequence: number; hash: string }> {
    const core = await this.corestore.getWriterCore(
      this.federationId,
      this.identityId,
    )

    try {
      await core.append(eventEnvelope)
      const sequence = core.length - 1
      const hash = await computeSha256Hex(eventEnvelope)
      return { sequence, hash }
    } catch (cause) {
      throw new ReplicationError(
        "APPEND_FAILED",
        `Failed to append event to writer core: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
  }

  // ── Writer Core Introspection ----------------------------------------

  /** Get the writer core's current length (number of blocks). */
  async getWriterLength(): Promise<number> {
    const core = await this.corestore.getWriterCore(
      this.federationId,
      this.identityId,
    )
    return core.length
  }

  /** Get a block from the writer core by zero-based sequence number. */
  async getWriterBlock(
    sequence: number,
  ): Promise<{ block: Uint8Array; hash: string } | null> {
    const core = await this.corestore.getWriterCore(
      this.federationId,
      this.identityId,
    )

    if (sequence < 0 || sequence >= core.length) return null

    try {
      const block = await core.get(sequence)
      if (!block) return null
      const blockBytes = block as Uint8Array
      const hash = await computeSha256Hex(blockBytes)
      return { block: blockBytes, hash }
    } catch {
      return null
    }
  }

  // ── Core Access (delegation) -----------------------------------------

  /** Get the autobase view core for this federation. */
  async getViewCore(): Promise<Hypercore> {
    return this.corestore.getViewCore(this.federationId)
  }

  /** Get the checkpoint core for this federation. */
  async getCheckpointCore(): Promise<Hypercore> {
    return this.corestore.getCheckpointCore(this.federationId)
  }
}

// ── Helpers ------------------------------------------------------------------

async function computeSha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new Uint8Array(data))
  return b4a.toString(new Uint8Array(buf), "hex")
}
