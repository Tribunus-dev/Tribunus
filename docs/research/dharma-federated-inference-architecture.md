# Dharma: Federated Mutual-Aid Inference Architecture

## Overview

Dharma is a federated inference orchestration layer for semi-trusted mutual-aid networks. It adapts datacenter disaggregated serving concepts (Dynamo, vLLM) to privacy-scoped, reputation-accounted, heterogeneous local compute.

Where Tribunus is "evidence-driven inference on the hardware you own" and Dynamo is "datacenter-scale distributed inference orchestration," Dharma is "mutual-aid inference across devices you trust differently."

## The Problem

Existing inference is either local (you own the hardware) or cloud (you rent it). There is a middle ground:
- Friends have different hardware (M1, RTX 4090, B580, Blackhole, Tenstorrent)
- Some nodes are better at prefill (big GPU), others at decode (low latency), others at CPU-side tasks (embeddings, reranking, summarization)
- Trust varies per peer: one friend's desktop can see raw prompts, another only sees anonymized KV, a third just verifies speculative tokens
- Availability is unpredictable: peers appear and disappear; the scheduler must degrade gracefully

## Key Insight

KV cache is not just a performance artifact in federated inference — it is a **social object**. It represents shared context, and context may be sensitive. The router must reason about "who is allowed to hold this context?" before it reasons about "who can process it fastest?"

## Three-Plane Architecture

### 1. Execution Plane
Phase realizations: prefill, decode, KV append/view, embeddings, rerank, tool planning, summarization, speculative draft, verification. Each phase carries resource requirements and privacy constraints.

### 2. Coordination Plane
Routing, leases, receipts, failure recovery, contribution accounting, peer reputation. This is where the existing Valkey/PGlite state-machine architecture fits. Every handoff must be proved (receipts), not just assumed.

### 3. Trust Plane
Classifies data and intermediate state into privacy tiers:
- **Public**: shared repo context, group documents, public specs
- **Session-local**: chat history shared among known session members
- **Private**: raw prompts, hidden states, KV cache of private conversations
- **Derived**: summaries, redacted derivatives, encrypted KV (may be transferable)
- **Non-transferable**: must stay local, never leave device

The trust plane decides what may leave the device and under what conditions.

## Relationship to Existing Systems

| Property | Tribunus (Local) | Dynamo (Datacenter) | Dharma (Federated) |
|---|---|---|---|
| Trust model | Single user | Administrative unity | Semi-trusted peers |
| Interconnect | Unified memory | NVLink/RDMA | NAT/mobile/LAN/QUIC/WebRTC |
| Availability | Always-on | Clustered | Unstable, graceful degradation |
| Accounting | N/A | Cost/$ per token | Reputation/tribute/contribution |
| KV cache placement | Local VRAM | GPU->CPU->SSD->remote | Privacy-scoped, policy-routed |
| Failure mode | Crash | Pod restart, request migration | Peer disappears, schedule degrades |

## Overlap with Dynamo Concepts

1. **Prefill/decode disaggregation**: Directly applicable — asymmetric peers can specialize. A friend's big GPU does prefill; a low-latency laptop does decode; a Raspberry Pi does embedding reranking.

2. **KV-aware routing**: The router scores cache overlap AND load, but must also check: privacy scope, identity, reputation, consent, whether the requested inference can leave the local authority boundary.

3. **Continuous batching**: Relevant for prefix caching in shared group context. Peers working on the same shared documents, issue threads, or design specs can reuse materialized prefixes.

4. **Transfer-aware placement**: Instead of NIXL, Dharma needs a transport abstraction where "transfer KV artifact" can resolve to: local shared memory, LAN, Thunderbolt, QUIC, WebRTC, relay-mediated, or "do not transfer; recompute locally."

## Implementation Roadmap

### Phase 1: Federated prefill assistance
- Explicitly shareable sessions only (user opts in)
- Prefill is chunky, compute-heavy, easier to schedule, less latency-sensitive
- A peer can help process a long context, return an admitted phase artifact
- Receipt generated for contribution accounting

### Phase 2: Prefix-cache sharing for public/group documents
- Multiple users in a mutual-aid session working on same repo, docs, issue thread
- Shared prefix materialized once by a stronger node, reused by others
- Equivalent to KV-aware routing — cache valuable because everyone reads same project context

### Phase 3: Speculative assistance
- Remote peers generate draft continuations, candidate plans, tool-call hypotheses
- Local node remains authoritative verifier (preserves correctness)
- Maps to "evidence-driven" worldview: remote produces candidates, local policy admits or rejects

## Dharma as the Research Thesis

Dharma is federated inference orchestration for semi-trusted mutual-aid networks, adapting datacenter disaggregated serving concepts to privacy-scoped, reputation-accounted, heterogeneous local compute.

This is stronger than generic "distributed local inference" because it says exactly what is new:
- **Identity**: who can participate, at what trust level
- **Consent**: what data may leave the device, for which peers
- **Reputation**: past contribution track record
- **Receipts**: cryptographically proved handoffs, not just trust
- **Authority boundaries**: what each peer may decide vs what must be verified locally
- **Social accounting**: tribute/reputation for contribution, not money

## Open Questions

- KV compression for privacy: can we derive a KV representation that preserves utility but removes sensitive content?
- Verifiable speculation: how does the local node prove that a remote peer's draft was actually used (or rejected) for tribute accounting?
- Trust calibration: how does the system bootstrap reputation for a new peer?
