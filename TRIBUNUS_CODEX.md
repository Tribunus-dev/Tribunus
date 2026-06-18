# Tribunus Codex — Product Specification

## Positioning

Tribunus turns solved debugging work into reusable, consented, auditable diagnostic packets that other developers' agents can validate, adapt, and convert into pull requests.

This is not "AI community support." It is a knowledge-routing system where agents notice solved-work overlap, ask humans for consent, convert prior debugging evidence into transferable packets, and produce auditable engineering output. The agent does not replace developer-to-developer help. It makes latent developer-to-developer help discoverable.

## The Problem

Today, the developer who solved a bug and the developer currently stuck on the same bug are invisible to each other. GitHub Issues, Discord, Stack Overflow, and Reddit all fail at the matching layer because they operate on text similarity, not engineering evidence. The developer who fixed the WebSocket keepalive last Tuesday is busy building features. The developer whose CI pipeline fails with the same symptom on Thursday is debugging from scratch. Neither knows the other exists.

## The Insight

Tribunus agents already have the missing context: local repo history, failed attempts, commits, test output, environment details, and the developer's prior debugging path. This means matching happens on engineering evidence — not fuzzy text search. When an agent says "this looks like something Developer A solved," it is not guessing. It is comparing symptom signatures, environment shapes, file involvement patterns, and hypothesis trees.

## Core Artifact: The Community Diagnostic Packet

A diagnostic packet is not an answer. It is a portable investigation record.

### Packet Structure

```
Community Diagnostic Packet v1
├── Attribution
│   ├── Author: GitHub identity (verified)
│   ├── Timestamp: when the original solution was confirmed
│   └── Source repo: anonymized or explicit per consent
├── Problem Signature
│   ├── Symptom description (structured, not free-text)
│   ├── Environment shape (OS, runtime, relevant dependencies)
│   ├── Files involved (paths, not contents)
│   └── Error signature (stack trace hash, log pattern)
├── Investigation Record
│   ├── Failed hypotheses (what was tried and ruled out)
│   ├── Successful hypothesis (what actually worked)
│   ├── Root cause analysis (if determined)
│   └── Test evidence (reproduction, verification)
├── Solution
│   ├── Approach description (not just "the fix" — the reasoning)
│   ├── Relevant commits (hashes, not full diffs)
│   ├── Adaptation notes (what might differ in other codebases)
│   └── Risks and known edge cases
└── Provenance
    ├── Confirmation chain (who validated this packet)
    ├── Propagation history (PRs opened from this packet)
    └── Supersedes / Superseded by (lineage)
```

### Why structured

A structured packet is:

- **Validatable.** The receiving agent checks: does the symptom signature match? Does the environment shape overlap? Are the file paths relevant? It produces a confidence score before proposing human review.
- **Adaptable.** The receiving agent knows which parts are universal (the root cause) and which are context-specific (the exact file path). It adapts, not copies.
- **Auditable.** Every claim in the packet has provenance — who found it, who confirmed it, what test verified it. This is evidence-ring architecture applied to knowledge sharing.

## The Codex: A Living Registry

The codex is a decentralized, continuously updated corpus of solved problems. Every confirmed diagnostic packet enriches it.

### Entry Lifecycle

1. **Proposed** — Agent generates a candidate packet from local debugging evidence. Human must approve before it enters the codex.
2. **Confirmed** — At least one downstream developer has validated the packet against their own issue and confirmed it resolved the problem.
3. **Propagated** — The packet has been adapted into one or more PRs in different repositories.
4. **Superseded** — A newer packet provides a better approach (root cause vs. workaround, edge case coverage). The superseded packet remains in the codex for context.
5. **Deprecated** — The approach is no longer applicable (e.g., the framework version it targeted is EOL). Still preserved for archival reference.
6. **Dangerous** — The approach has been flagged as producing incorrect or harmful results. Still preserved as a warning.
7. **Context-Limited** — The approach works only in specific environments. Flagged with constraints.

No entry is ever deleted. The codex preserves the full lineage: first workaround, later root cause, later edge case, later architectural reframing. Agents see the entire diagnostic tree, not just the "accepted answer."

### Novelty Pressure

Every new contribution must be novel relative to the existing packet. If seven approaches to the same Postgres connection leak already exist, the eighth must either propose a genuinely new approach or synthesize the existing ones into a higher-order understanding. The agent cannot earn value by resubmitting the obvious first fix when the packet already contains it.

This inverts the Stack Overflow model. Stack Overflow rewards being first. The codex rewards being **different from everything that came before.** Over time, this pushes the community from "how do I fix X" toward "how many ways can X be understood."

### Sync Protocol

When a developer contributes a diagnostic packet, their local codex receives a sync: every newly confirmed packet, every update to existing entries, every supersession and propagation record. The more you contribute, the more current your codex — and therefore the more effective your agents. Helping someone is not charity. It is a sync operation.

## The Dharma Economy

### Identity Backbone: GitHub

Every developer connects with their GitHub identity. This provides attribution, anti-sybil weight, and a public contribution graph. A developer with years of verified commits is not a sock puppet farming reputation points.

But GitHub activity is not truth. It bootstraps trust. Community-confirmed utility dominates.

### Dharma: Functional, Not Gamified

Dharma is not a badge or a leaderboard position. Dharma is **system privilege:**

- **Higher queue visibility.** Your help requests surface faster in the community queue.
- **Faster codex sync.** Your local codex updates more frequently.
- **More agent review budget.** When your agent proposes a diagnostic packet, it receives more compute budget for validation.
- **Trusted packet propagation.** Your packets carry default credibility.
- **Default confidence.** When your agent says "I think this is relevant," it carries more weight.

All dharma is earned from confirmed downstream usefulness: diagnostic packets confirmed by recipients, packets propagated into merged PRs, novel approaches that supersede existing entries, failed hypotheses documented as saving others time, and codex entries that helped later agents match.

### Queue Priority Model

The community queue is not FIFO. It is priority-weighted:

```
Priority = BaseUrgency × DharmaScore × MatchRelevance × RecencyOfContribution
```

Recent helpers get priority. Stopping for six months causes decay. The system rewards sustained participation, not one-time heroics.

## Privacy and Disclosure Gate

Diagnostic packets can accidentally carry proprietary code, secrets, architecture details, or customer data. From day one, every packet must clear a human-controlled redaction gate.

### Local Preparation

Agents prepare candidate packets entirely locally. No data leaves the machine without explicit human approval.

### Default Safety

The packet defaults to evidence summaries (not raw log contents), file paths (not file contents), error shapes (hashed stack traces, not full call stacks), approach descriptions (not full diffs), and commit hashes (not full commit messages).

### Options Per Packet

- **Full share** — Complete packet, suitable for open-source communities
- **Anonymized** — File paths and identifiers replaced with structural descriptions
- **Abstracted** — Problem described in pseudocode, disconnected from original codebase
- **Private codex** — Packet shared only within a specific organization

## The Architecture

```
Developer A (Tribunus)                          Developer B (Tribunus)
       │                                               │
       ├─ Agent observes solved issue                  │
       │  └─ Generates candidate packet (local)        │
       │     └─ A reviews, redacts, approves           │
       │        └─ Packet enters A's local codex       │
       │                                               │
       │                                               ├─ Agent detects stuck state
       │                                               │  └─ Queries community queue
       │                                               │     └─ Match found: A's packet
       │                                               │
       │  ◄── Consent request ────────────────────────┤
       │                                               │
       │  ──── Diagnostic packet ────────────────────► │
       │                                               │
       │                                               ├─ B reviews packet
       │                                               │  └─ Agent validates locally
       │                                               │     ├─ Reproduces symptoms
       │                                               │     ├─ Checks constraints
       │                                               │     ├─ Adapts solution
       │                                               │     └─ Proposes PR
       │                                               │
       │                                               ├─ B confirms/resolves
       │                                               │  └─ Codex updated
       │                                               │     └─ Dharma ledger updated
       │                                               │
       │  ◄── Confirmation + Dharma receipt ──────────┤
       │                                               │
       ├─ A's codex syncs (receives all new packets)   │
       └─ A's dharma increments                        │
```

## Moderation: Epistemic, Not Content

The primary moderation challenge is not harassment or spam. It is epistemic: is this packet correct, applicable, current, safe, and well-scoped?

### Packet Status States

Every codex entry carries a status that agents evaluate: Proposed, Confirmed, Propagated, Superseded, Deprecated, Dangerous, Context-Limited. Every claim carries provenance — who proposed it, who confirmed it, what test verified it, when it was superseded.

## Launch Strategy: Narrow and Deep

Do not launch as "federated AI support communities for every stack." Launch around one stack where the value is immediately obvious — Electron/Vite/macOS desktop app packaging and native module issues. This is Tribunus' own development domain. The initial codex is seeded with real diagnostic packets from real debugging sessions.

Once the packet format, dharma loop, and privacy gate are proven in one domain, additional communities are just namespaces.

## What This Is Not

- Not Stack Overflow — no upvotes, no gamification, no "closed as duplicate"
- Not a chatbot — the agent matches, packages, and routes. The human decides.
- Not a code copying tool — the receiving agent adapts, validates, and tests.
- Not a surveillance system — all packet sharing requires explicit human consent.
- Not an AI feature — the AI is the coordination layer. The value is in matching, routing, provenance, and evidence.
