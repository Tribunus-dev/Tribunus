# ADR 014: Tribunus Cell — Sovereign Local Federation

## Status
Accepted — June 2026

## Context

The existing architecture defines PGlite as the durable authority store (ADR 003), Valkey as the coordination kernel that serializes recoverable work without serializing execution (ADR 004), and the mobile PWA as a remote cockpit that observes projections and sends scoped operator intents (ADR 006). DuckDB is the analytical reflection layer. None of these pretend to be the same database.

The question is how to extend this into team mode without breaking the clean separation of concerns by bolting on a distributed database that blurs authority boundaries.

## Decision

### The Tribunus Cell

A **Cell** is a sovereign local authority domain. It contains:

- **One durable PGlite store** — canonical authority truth. Diagnostic packets, dharma ledger, provenance, lifecycle state, embeddings, scheduled obligations, execution receipts. Authoritative. Never directly mutated by another Cell.
- **One Valkey coordination kernel** — serializes authority-changing events, dispatches work, manages leases/heartbeats/queues, rebuilds from PGlite on restart. Coordination truth, not durable truth.
- **One DuckDB analysis mirror** — consumes snapshots from local PGlite, Valkey metrics, and imported external envelopes. Retrospective analysis. Not product state.
- **One local execution environment** — desktop app, file system, LLM calls, agent orchestration, terminal access. The execution authority.

A Cell has zero assumption that another machine can directly mutate its truth.

### Federation Is Envelope Exchange, Not Row Sync

Cells do not sync databases. Cells exchange **content-light signed envelopes**:

- Packet confirmations
- Gate decisions
- Dharma receipts
- Queue deltas
- Projection cursors
- Mission summaries
- Agent status events
- Tribute spent/received events
- Review requests and outcomes

The federation flow:

```
Cell A                             Cell B
  │                                  │
  ├─ Event occurs                    │
  ├─ Write to PGlite (authoritative) │
  ├─ Produce receipt                 │
  ├─ Project to Valkey (local)       │
  ├─ Federation worker:              │
  │   ├─ Package content-light        │
  │   │  envelope                    │
  │   ├─ Sign/digest envelope        │
  │   └─ Send to relay               │
  │                                  │
  │     ── envelope ──►              │
  │                                  │
  │                                  ├─ Validate envelope
  │                                  ├─ Write imported-external-event
  │                                  │  to PGlite
  │                                  ├─ Project authorized effects
  │                                  │  to local Valkey
  │                                  └─ Record delivery receipt
```

The receiving Cell validates the envelope, writes an imported external-event record to its own PGlite, and projects authorized local effects into its own Valkey. Federation without remote write authority.

### Hub-and-Spoke for Team Mode

For team mode, the architecture is hub-and-spoke envelope exchange:

1. Each developer's desktop is a Cell — locally authoritative, offline-capable
2. A shared relay or optional cloud Postgres stores team-level metadata: account registry, team membership, project catalog, shared packet catalogs, public codex entries
3. Cells exchange envelopes through the relay
4. ElectricSQL (or PowerSync) syncs boring shared relational data: account metadata, team rosters, project registries, read-only or append-only projections
5. Execution authority is NEVER synced — it is receipt-driven exchange between Cells

For small teams, this works without any cloud Postgres at all. Cells exchange envelopes peer-to-peer through the relay. Each Cell remains locally useful. Team state is shared through auditable events: "gate approved by device X," "packet confirmed by user Y," "PR proposal published," "agent failed," "review requested."

### What Valkey Gains

Federation adds a new class of work items to Valkey: outgoing federation envelopes, incoming envelope validation, delivery retries, peer heartbeats, relay reconnects, and resync cursors. These are exactly the kind of timed, retryable, lease-based operations Valkey already coordinates. ADR 004's conductor model extends seamlessly.

### What DuckDB Gains

DuckDB now has more to analyze: imported external envelopes provide cross-cell data. It answers: which packet families propagate fastest between Cells, which agent routes produce bad matches across the team, which dharma signals correlate with merged PRs across contributors. Still a reflection layer, never product state.

### Sync Engine Selection

| Use Case | Engine | Rationale |
|----------|--------|-----------|
| Shared app data (accounts, teams, projects, packets, public codex) | ElectricSQL + PGlite (preferred) or PowerSync + SQLite | Boring relational sync for boring shared data. Electric preserves Postgres semantics end-to-end. PowerSync is more operationally mature for offline-first. |
| Collaborative editable documents (mission notes, planning docs, annotations) | Automerge / Yjs | CRDTs for human co-editing. Not for system truth. |
| Agent execution, receipts, audit, dharma, gates | Cell envelope exchange | Receipt-driven. NEVER raw row sync. Authority must be unambiguous per event. |

### Enterprise Story

Enterprise does not mean "cloud owns everything." It means "policy decides which Cells may exchange which classes of receipts, under which capability scopes, with which audit guarantees." A Cell is a natural enterprise boundary: policy governs what a Cell may import, what it may export, and what it may act on.

## Consequences

### Positive
- **No authority ambiguity.** Every event has a single authoritative Cell. Federation does not create "which database is right" problems.
- **Offline-capable by design.** A Cell remains fully functional without connectivity. It queues outgoing envelopes and imports incoming envelopes on reconnect.
- **Clean evolution path.** Solo user = one Cell. Small team = Cells exchanging envelopes. Enterprise = Cells governed by policy.
- **Valkey stays local.** The coordination kernel never needs to be shared or synchronized across machines. It is disposable and rebuildable.
- **Sync engines scoped to safe data.** ElectricSQL syncs the boring stuff. Never the sacred execution ledger.

### Negative
- **Envelope protocol is new infrastructure.** The envelope format, signing, validation, delivery, retry, and import semantics must be designed and maintained.
- **Relay is mandatory for team mode.** Cells cannot discover each other without a relay or rendezvous service.
- **Each Cell is a full database stack.** PGlite + Valkey + DuckDB per machine. Acceptable for developer desktops, heavy for lightweight clients.
- **Eventual consistency for cross-Cell state.** A Cell importing an envelope sees the event after the originating Cell recorded it. This is correct for an agent governance system (receipts are produced before they are shared). It would be wrong for real-time collaborative editing (use Automerge/Yjs for that).

## Relationship to Existing ADRs

- ADR 003: PGlite authoritative, Valkey coordination, DuckDB analytical — per Cell
- ADR 004: Valkey serializes authority, workers execute — per Cell
- ADR 006: PWA is a remote cockpit, not an execution node — observes projections from one Cell
- ADR 010: Contribution license — applies to envelopes exported from a Cell to the Codex
- ADR 012: Three Codex surfaces — the public Codex is a projection of aggregated envelopes, never raw Cell state

## References
- ElectricSQL: https://electric-sql.com — Postgres sync engine using Shapes
- PowerSync: https://www.powersync.com — SQLite local, Postgres central, Sync Streams
- Automerge: https://automerge.org — JSON CRDT for collaborative documents
- Yjs: https://docs.yjs.dev — CRDT for collaborative editing
- ADR 003, 004, 006, 010, 012
