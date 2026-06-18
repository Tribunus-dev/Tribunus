# ADR 0022: Tribunus Runtime Truth Spine

## Status

Proposed — June 14, 2026

## Context

Tribunus has accumulated several local truth models across runtime, coordination, receipt, and memory ADRs. That creates noun drift, owner drift, and ordering drift when different ADRs redefine the same concepts in different ways. The project needs a canonical truth spine so future ADRs inherit shared meanings instead of locally redefining authority, pending work, phase execution, and tensor memory. Apple Silicon runtime memory and orchestration are specializations of this spine, not separate truth sources.

## Decision

Tribunus adopts a canonical runtime truth spine that all runtime, compute, orchestration, memory, receipt, and backend ADRs must inherit.

The authority split is:

PGlite owns durable authority truth.
Valkey owns coordination visibility and recoverable pending-work truth.
Tokio owns local execution truth.
IOSurface owns Apple Silicon runtime tensor-memory truth.
Backends own execution attempts, not durable truth.
Receipts bind all transitions.

The operational ordering is:

no Valkey ack before PGlite receipt commit
no backend result becomes authority-visible before it is committed into the durable authority record
no runtime phase completes until the committed result, receipt, and coordination state agree

### Ownership Table

| Term | Owner | Meaning |
|---|---|---|
| authority | PGlite | committed durable receipt and result state |
| pending work | Valkey | claimed or unclaimed recoverable work |
| local execution | Tokio | in-process task and phase execution |
| runtime tensor truth | IOSurface | authority-visible tensor memory |
| backend output | backend | provisional until committed |
| phase completion | PGlite | receipt committed before Valkey ack |

### Spine Invariants

- Shared runtime nouns must mean the same thing across all ADRs.
- Authority ownership cannot be split between two subsystems for the same concept.
- Any transition that affects durable truth must be receipted before coordination advance.
- Any Apple Silicon tensor-memory truth must remain IOSurface-backed and authority-visible only after commit.
- Any backend-private allocation, scratch buffer, or lazy execution detail is provisional unless committed and receipted.

### Cross-Cutting Definitions

Authority truth: the durable, queryable committed record in PGlite.
Recoverable coordination truth: stream and consumer-group state in Valkey that can be rebuilt or reclaimed.
Local execution truth: task scheduling and phase execution performed by Tokio inside a process.
Runtime tensor truth: IOSurface-backed memory that Tribunus treats as the authority-visible tensor island on Apple Silicon v1.
Receipt: the durable proof that a transition occurred and was recorded.
PhaseScope: the bounded execution window in which a backend may operate on temporary views.
RuntimeWorkItem: the governed phase unit that binds admission, execution, receipts, and acknowledgment ordering.

### Governance Rule

If an ADR introduces a term that already exists in the spine, the ADR must use the spine meaning and may only narrow it by explicit specialization. If an ADR needs a new owner for an existing term, the contradiction must be called out and justified, not silently redefined. If an ADR permits an ack, commit, or phase-completion transition before the required receipt exists, that ADR contradicts the spine.

### Scope

This spine governs all runtime, compute, orchestration, memory, receipt, and backend ADRs. It is the vocabulary contract for future ADRs, not a product feature by itself. Implementable schema work such as RuntimeWorkItem and PhaseScope hangs off this spine as subordinate specs.

## Consequences

### Positive

Tribunus gets a single source of truth for runtime vocabulary and authority ownership. Future ADRs can specialize shared nouns instead of redefining them. Receipt-before-ack ordering becomes a global rule rather than a local habit. Memory truth, orchestration truth, and durable truth remain clearly separated. Contradictions become easier to spot in review because the owner of each truth class is explicit.

### Negative

Some existing ADRs will need wording cleanup to match the spine. The spine adds an extra review step before introducing new runtime terms. Local ADRs can no longer use familiar nouns loosely without inheriting the canonical meaning.

### Operational Impact

Any future runtime ADR should be checked against the spine before adoption. RuntimeWorkItem and PhaseScope should be defined as subordinate specs derived from this spine, not as independent sources of authority. A contradiction audit should flag noun drift, owner drift, and ordering drift whenever a runtime ADR is drafted or revised.
