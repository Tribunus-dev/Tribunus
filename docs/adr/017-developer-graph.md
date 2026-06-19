# ADR 017: Developer Graph — Technology Foundation for Social Collaboration Fabric

## Status
Accepted — June 2026

## Context

ADR 016 defined the sandbox Cell model. The next layer is the Developer Graph — the pseudo-social layer where people and Cells discover each other, establish trust, form work contexts, and route collaboration. This is not a social network. It is a social collaboration fabric for executable projects. The network can route attention and proposals, but it cannot mutate local truth.

## Decision

### Technology Stack

| Concern | Technology | Why |
|---------|-----------|-----|
| **Portable identity** | AT Protocol DIDs (`did:plc`, `did:web`) | User owns identity, portable across servers, IETF-standardizing in 2026, Bluesky validates at tens-of-millions scale |
| **Identity bootstrap** | GitHub OAuth → DID mapping | Start with existing developer identity. Map GitHub accounts to Tribunus DIDs. No new account creation required. |
| **Social graph storage** | Append-only event-sourced table in PGlite | Every follow, watch, join, proposal, review is an immutable event. Read models derived by replay. Complete audit trail. JSONL as export/envelope format. |
| **Feed generation** | PGlite projections + DuckDB analytics | Event sourcing stores raw events. Read models (projections) serve feeds. DuckDB answers "which project tags are trending." |
| **Real-time presence** | Yjs (CRDT) for collaborative state inside sandboxes | Live cursors, real-time editing, presence in shared sandbox Cells. Network-agnostic, offline-capable. Rust rewrite (Yrs) for speed. |
| **Real-time updates** | Valkey pub/sub for volatile events | "Agent X is typing," "sandbox opened," "proposal submitted." Not durable. Rebuilt from PGlite on restart. |
| **Capability-based access** | OAuth session grants first (MVP), UCAN proof chains later | Internally modeled as capability grants. UCAN-compatible shape from day one. Full UCAN for shareable/offline invite links. |
| **Protocol backbone** | Tribunus Cell envelopes + relay | No external protocol dependency. The Developer Graph is an envelope on the Cell federation model. AT Protocol/Nostr/ActivityPub are optional public-facing adapters, not the backbone. |

### Three Layers

**Layer 1 — Cell-native graph.** Authoritative for Tribunus collaboration. Envelopes, receipts, capability grants, sandbox proposals. Stored in PGlite event tables.

**Layer 2 — Public protocol adapters.** ATProto-compatible PDS adapter (optional). Nostr relay adapter (optional discovery). ActivityPub adapter (optional fediverse integration). Adapters publish or ingest selected events. The Cell is not necessarily a PDS.

**Layer 3 — Social UX.** Profiles, project cards, follow graph, feeds, work signals, sandbox entry points. Rendered as Git-powered static frontends or PWA dashboards. The UI presents projections of the graph, not the raw event log.

### Portable Identity: AT Protocol DIDs

Bluesky's AT Protocol provides the identity primitive: Decentralized Identifiers (DIDs) as persistent, cryptographically secure account identifiers. Users are identified by domain names mapping to DIDs. Portable identity — users can migrate between servers without losing their social graph. The protocol is standardizing in the IETF as of January 2026. The Lexicon schema system provides global interoperability between apps in the "Atmosphere."

For Tribunus: GitHub identity bootstraps the initial DID. A GitHub OAuth flow generates a `did:plc` or `did:web` for the user. The developer graph is an AT Protocol-compatible data repository. Tribunus Cells may expose an ATProto-compatible PDS adapter — a Cell is not necessarily a PDS. The relay may optionally implement BGS + App View semantics for public federation. Internally, Cell envelopes remain the backbone. This gives Tribunus interoperability with the Bluesky ecosystem (validated at tens-of-millions scale) without coupling core architecture to ATProto Lexicon semantics.

### Event-Sourced Social Graph

The Developer Graph is append-only and event-sourced in PGlite. The logical model is immutable events. The physical storage is an event table with typed columns (monotonic sequence, actor DID, object key, event type, timestamp, payload JSON, hash, previous hash). JSONL is the envelope/export format, not the primary storage format. Every social action is an event:

```jsonl
{"type":"UserFollowedProject","user_did":"did:plc:abc123","project_id":"proj-xyz","timestamp":1717360000}
{"type":"SandboxJoinRequest","from_did":"did:plc:def456","target_cell":"cell-xyz","snapshot_id":"snap-001"}
{"type":"ChangeProposalSubmitted","sandbox_id":"sandbox-001","proposal_hash":"sha256:..."}
{"type":"ReviewEndorsed","proposal_hash":"sha256:...","reviewer_did":"did:plc:ghi789","verdict":"approved"}
```

Read models (projections) are derived by replaying events: who follows whom, which projects are trending, what sandboxes are active, who has a pending review. Feeds are projections. The event log IS the social graph.

### Real-Time Collaboration Inside Sandboxes

Yjs for collaborative state inside sandbox Cells. Live cursors, real-time code editing, shared terminal presence. Yjs is network-agnostic, supports offline editing, version snapshots, and undo/redo. The 2026 ecosystem is Yjs-dominant — Liveblocks, PartyKit, and most collaboration tools use Yjs or Automerge underneath.

**CRDT Invariant:** CRDT state is sandbox-local and never the merge artifact. The merge artifact is a normalized SandboxChangeProposal (snapshot + patch bundle + receipts). CRDT state is not replayed into the authoritative source repository. The sandbox Cell uses Yjs for collaboration. The owner Cell imports only reviewable, receipt-backed proposals.

### Capability-Based Access: UCAN

UCAN provides the scoped authority model for the Developer Graph:

```
User X can participate in sandbox S for project P
  with scope: read code, run tests, propose changes
  with constraints: files in /src/** only, 60-minute session
  with delegation: may invite others with subset of this scope
  proof chain: root DID → workspace admin → sandbox participant
```

The UCAN spec describes public-key-verifiable, delegable, extensible capabilities with DIDs as principals. This maps directly to ADR 016's authority model. The owning Cell issues UCANs for sandbox access. The sandbox Cell verifies UCANs for participant operations. Change proposals carry the UCAN chain as provenance.

**Migration path:** MVP ships with OAuth session grants internally modeled as capability grants with UCAN-compatible shape. Full UCAN proof chains are introduced later for shareable/offline invite links. This keeps the architecture capability-native without blocking the MVP on less mature UCAN tooling.

### Feeds as Projections

Feeds are projections over the event-sourced graph. Three feed types:

1. **Follow Feed:** activity from projects and people the user follows. Derived from `UserFollowedProject` and `UserFollowedUser` events.
2. **Discover Feed:** trending projects, popular sandboxes, funded bounties, active reviewers. Derived from aggregate event analytics (DuckDB).
3. **Work Feed:** pending reviews, active sandbox invitations, proposal status changes, bounty funding updates. Derived from user-specific collaboration events.

The Work Feed is not a social feed — it is an operational queue. The highest-value feed in Tribunus is not "what are people saying?" It is "what work is available, blocked, reviewable, funded, or ready to merge?" This is the differentiation from Bluesky, GitHub, Discord, and Slack.

Feeds are NOT the event log. Feeds are read models updated asynchronously. The event log is canonical. Feeds can be rebuilt from the log at any time.


### PGlite vs Valkey: What Goes Where

The Developer Graph is part of Tribunus durable truth — not just live social activity. Who followed whom, who requested sandbox access, who was granted a capability, who submitted a proposal, who reviewed it, and what the owning Cell accepted or rejected are durable audit events. They require authoritative storage.

**The rule:** if losing the data would change history, it belongs in PGlite. If losing it only means you need to recompute, resubscribe, or rebuild a live view, it can live in Valkey.

| Data | Storage | Why |
|------|---------|-----|
| `UserFollowedProject` event | PGlite | Changes the durable graph. Source of truth for follower projections. |
| `SandboxJoinRequest` event | PGlite | Auditable access request. Part of collaboration provenance. |
| `CapabilityGranted` event | PGlite | Affects authority. Provenance for who had what access when. |
| `ChangeProposalSubmitted` event | PGlite | Durable work artifact. Owner Cell import/merge history. |
| `ReviewEndorsed` event | PGlite | Audit trail for review decisions. |
| "User X is online" | Valkey | Ephemeral presence. Loss means a stale online indicator until next heartbeat. |
| "Agent is typing" | Valkey | Volatile UI signal. No audit value. |
| "Proposal notification to fan out" | Valkey | Fanout trigger. Source event is already in PGlite. |
| "Feed projection cache refresh" | Valkey | Disposable cache. Rebuilt from PGlite on restart. |
| "Sandbox invite link still active" | Valkey TTL | Lease/expiry check. Source grant is in PGlite. |
| Cursor location, typing indicator, open WebSocket session | Yjs awareness or Valkey | Collaboration ephemera. Not durable. |

**Dual-write pattern:** commit the authoritative event to PGlite first, then publish a derived notification or projection update into Valkey. Valkey serializes the next move, drives queues, and updates live clients. PGlite records the fact that the move happened. Valkey is rebuildable from PGlite.

The trap is using Valkey Streams because "append-only streams feel like events." Valkey Streams are coordination primitives — they serialize work, not truth. The Developer Graph event log must survive Valkey wipes, evictions, and rebuilds. PGlite is the durable event store. Valkey is the coordination layer on top of it.
### Protocol Strategy

The Tribunus Developer Graph is NOT a protocol adapter. It is a Cell-native envelope protocol that optionally speaks AT Protocol to the outside world. The internal graph is the authority. AT Protocol compatibility is a public-facing adapter. Nostr and ActivityPub are additional optional adapters for specific use cases (Nostr for lightweight discovery, ActivityPub for fediverse integration).

### MVP Scope

1. **Public profiles:** GitHub identity → DID mapping, display name, project cards, Cell identities
2. **Project cards:** name, description, tags, sandbox availability, activity feed. Bounty objects reserved for later — no money in the first release.
3. **Follow graph:** explicit follows (people, projects, tags), no algorithmic feed yet
4. **Sandbox invite links:** OAuth-backed capability grants (UCAN-compatible shape), scoped access
5. **Work signals:** "looking for help," "sandbox open," "ADR needs review," "proposal ready"
6. **Work Feed:** treated as an operational queue, not a social feed

Not included in MVP: global algorithmic feed, real-time presence outside sandbox Cells, reputation/endorsement system, bounty board with money, personalized PageRank trust scoring, full UCAN proof chains.

## Consequences

### Positive
- **Portable identity from day one.** AT Protocol DIDs mean no vendor lock-in. Users keep their graph if they migrate.
- **Event-sourced graph is auditable.** Every connection, proposal, and review is an immutable event. The graph IS the audit trail.
- **UCAN scoped authority matches the Cell model.** Capability-based access control, offline-first verification, delegation without key sharing.
- **Interoperability with the Atmosphere.** Tens-of-millions-scale Bluesky ecosystem validates portable identity.
- **No external protocol dependency for core operation.** The graph is native. AT Protocol is an adapter.

### Negative
- **AT Protocol is still standardizing.** IETF process underway but not complete. Lexicon schemas evolving.
- **Yjs adds a dependency for real-time collaboration.** Acceptable tradeoff — Yjs is the dominant CRDT in 2026, maintained, Rust-optimized.
- **UCAN is less widely adopted than OAuth.** The developer ecosystem is smaller. Tooling is emerging but not yet mature. Mitigated by OAuth-first MVP with UCAN-compatible shape.
- **Feed generation from event-sourced projections adds complexity.** Event sourcing benefits (auditability, replay) come with projection maintenance overhead. Snapshots mitigate long replay times.

## References
- AT Protocol: https://atproto.com
- Bluesky: https://bsky.app
- Yjs: https://yjs.dev
- UCAN: https://ucan.xyz
- Liveblocks: https://liveblocks.io
- PartyKit: https://partykit.io
- ADR 014: Tribunus Cell — Sovereign Local Federation
- ADR 016: Repository Sandbox Serving — Browser Sandbox Cell
