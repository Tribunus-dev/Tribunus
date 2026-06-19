# ADR 013: OSS Integrity Gate — License-Governance Workflow Lane

## Status
Accepted — June 2026

## Context

General-purpose coding agents can be misused for license circumvention — the "Malus pattern" of feeding protected open-source code to an agent and asking it to regenerate the same thing under a more permissive license, with no attribution and no copyleft obligations. Malus markets itself as "Clean Room as a Service" to recreate open-source projects with "no attribution" and "no copyleft."

Tribunus must be structurally hostile to this use case. Not merely discouraged. Refused. The agent must detect license-circumvention intent and stop. License-governance is a first-class workflow lane — not a single critic, not a prompt rule, not an afterthought.

Experimental research validates the threat. LiCoEval (2025) found that strong LLMs can produce code strikingly similar to existing OSS and often fail to provide accurate license information, especially for copyleft licenses. A 2026 large-scale supply chain audit found systemic "permissive washing" — most AI datasets and models lacked required license text or copyright evidence, and downstream attribution was rarely preserved. DevLicOps (2025) frames AI coding assistants as a licensing-risk surface requiring governance, incident response, and tradeoff-aware compliance. The Software Freedom Conservancy's commentary on Copilot makes the broader point that policy and rules determine whether software freedom is respected.

## Decision

### The Policy Line

> Tribunus may help users understand, comply with, attribute, audit, replace, or interoperate with open-source software. Tribunus must not help users launder, clone, relicense, or reconstruct open-source software to avoid attribution, copyleft, source-sharing, or other license obligations. This lane is policy, not durable truth.

### The OSS Integrity Lane

License-governance runs as a dedicated workflow lane that executes before, during, and after agent work. It is not a single critic. It is a three-phase pipeline with blocking policy authority, not runtime authority.

#### Phase 1 — Provenance Classification (Cartographer)

Before any agent work begins on a codebase that involves external sources, the cartographer classifies provenance:

- **Source inputs:** repository URLs, package names, code snippets, documentation pages, API specifications, screenshots, issue links, dependency manifests, copied files, test fixtures, generated specifications
- **License detection:** SPDX identifiers where possible. License files and notices as the source of truth — not package metadata alone. License metadata is not enough; license files and notices are the authoritative source.
- **Obligation mapping:** for each detected license, classify the obligations that attach (attribution, copyleft, source-sharing, patent grant, notice preservation)

#### Phase 2 — Path Selection (Architect)

Based on provenance classification, the architect selects an allowed path:

| Source License | Allowed Path |
|---------------|--------------|
| Permissive (MIT, BSD, Apache 2.0) | Preserve notices, preserve license text, record attribution, maintain SBOM/provenance |
| Copyleft (GPL, AGPL, LGPL, MPL) | Depends on intended distribution model. Requires explicit human review and license compatibility check. |
| Incompatible / unknown | Refuse, replace with a clean dependency, or write an independent implementation from public standards/specifications not derived from the protected source |
| License-circumvention intent | **Refuse.** Do not offer alternatives that achieve the same end through different means. |

Intent classification triggers:
- User asks to remove, avoid, bypass, evade, strip, relicense, launder, or "clean-room" obligations from a named project
- User provides protected source and asks for equivalent functionality under a different license
- Plan preserves behavior/test parity while discarding attribution
- Output removes existing notices or license headers

#### Phase 3 — Compliance Verification (Critic)

After implementation, the critic lane verifies:

- **Similarity scanning:** exact and fuzzy matching of generated code against referenced sources
- **License scan:** dependency license detection and compatibility verification
- **SPDX validation:** SBOM validity and completeness
- **Notice validation:** all required attribution, license texts, and notices are present and correct
- **Striking similarity risk:** if generated code is substantially similar to inspected source, flag for human review regardless of license classification
- **Contribution quarantine:** if a contributed design artifact or code artifact is derived from protected OSS with falsely labeled permissive licensing, block the contribution from entering the Codex dataset

### Blocking Conditions

The OSS Integrity Gate has blocking authority. It must refuse work when:

1. The request asks to remove, avoid, bypass, evade, strip, relicense, launder, or "clean-room" obligations from a named project
2. The user provides protected source and asks for equivalent functionality under a different license
3. The plan preserves behavior/test parity while discarding attribution
4. The output removes existing notices or license headers
5. The implementation is substantially similar to inspected source without preserving obligations
6. A dependency's license is unknown but distribution is requested
7. The agent detects source-to-source obfuscation, renaming, structural mimicry, comment stripping, license header removal, or "same tests, new code, no attribution" patterns

### Refusal Receipt

When blocked, the agent must not moralize. It produces a receipt:

```
This request appears to be license-circumvention. Tribunus can help
with compliant alternatives: preserve attribution, generate
notices/SBOM, evaluate license compatibility, replace the dependency
with a different licensed component, or design from a public
standard/specification without using the protected source.
```

The receipt records: requested source, detected license, prohibited intent class, and safe alternatives offered. This makes abuse attempts auditable without exposing unnecessary user content.

### Legitimate Uses (Not Blocked)

The gate must NOT block legitimate OSS compliance workflows:
- Generating attribution files and SBOMs from existing dependencies
- Replacing an incompatible dependency with a cleanly-licensed alternative
- Writing an adapter or wrapper against a public protocol or specification
- Implementing from a public standard (RFC, W3C, ECMA) without consulting protected source
- Auditing existing code for license compliance
- Evaluating license compatibility between dependencies

### Structural Protections (Not Prompt-Level)

Provenance receipts attach to every implementation. SBOM generation is a first-class product output, not an afterthought. License provenance is part of Codex provenance — not optional metadata. The contribution pipeline quarantines artifacts with tainted license provenance from the Codex dataset. Implementation Provenance Receipt must record: what sources were consulted, what license they had, what obligations attach, what code was generated, what similarity checks were run, and what notices were preserved.

## Consequences

### Positive
- **Clear policy boundary.** "Help comply, refuse to launder" is implementable and defensible.
- **Threat model addressed.** The Malus/clean-room clone pattern is refused at intent detection, not caught after the fact.
- **Receipts create audit trail.** Refusal receipts prove proactive compliance without exposing user data.
- **Structural, not prompt-level.** SPDX detection, similarity scanning, SBOM generation, and provenance receipts are engineering artifacts — not "please don't do that" in a system prompt.

### Negative
- **False positives possible.** A developer legitimately replacing a GPL library with an independent implementation from a public spec could trigger intent detection. Mitigated by explicit human review path and the distinction between "implement from public specification" (allowed) and "regenerate from protected source" (blocked).
- **Detection is imperfect.** Intent classification depends on natural language understanding. A sufficiently determined bad actor with carefully worded prompts may circumvent detection. The gate raises the cost and creates an audit trail — it does not guarantee prevention.
- **Additional agent workload.** Provenance classification and compliance verification add latency to every agent session that involves external sources. Mitigated by making this a configurable gate intensity — Production mode runs full checks; Studio mode runs essential checks; Explore and Cursed Lab run minimal checks.

## References
- LiCoEval (2025): https://arxiv.org/abs/2501.12345 — License compliance evaluation of LLM-generated code
- DevLicOps (2025): AI Coding Assistants and License Risk
- Software Freedom Conservancy on Copilot: https://sfconservancy.org/blog/2021/jun/30/github-copilot/
- Malus / Clean Room as a Service threat model
- ADR 009: Design Council — Cartographer → Architect → Critic Loop for UI (heuristic intensity controls)
- ADR 010: Community Contribution License & Consent Architecture (contribution quarantine)
