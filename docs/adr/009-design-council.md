# ADR 009: Design Council — Cartographer → Architect → Critic Loop for UI

## Status
Accepted — June 2026

## Context

ADR 008 defined the hard problems for a code-native design canvas: schema, undo/redo, mutation safety, responsive validation, and taste enforcement. This ADR defines the agent workflow that operates on that canvas.

The problem: asking an agent to "make it look better" produces attractive mush — the agent averages Dribbble, SaaS templates, and Tailwind demos with no understanding of the specific surface, the user task, the product semantics, or the design doctrine. The solution is role separation and constraint loops, the same pattern that makes the cartographer → architect → critic loop work for code.

This council governs design mutations, not product truth; it consumes projections and emits receipts under the shared spine.

## Decision

### The Design Council Model

Design is not assigned to a single "design agent." It is assigned to a **design council** — a pipeline of specialized roles that operate on the design document under explicit constraints.

```
Cartographer  →  Architect  →  Builder  →  Critic Council  →  Operator  →  Receipt
(surface map)   (patch plan)  (mutation)   (heuristic eval)   (approve)    (audit)
```

### Cartographer — Surface Map

The cartographer does not redesign anything. It inspects the current surface and produces a structured surface map:

- Component hierarchy (what elements exist, how they nest)
- Content density (compact, standard, spacious)
- User task (approval, monitoring, browsing, editing)
- Viewport classes (phone-portrait, phone-landscape, tablet, desktop)
- Interaction states present (default, hover, focus, active, loading, error, disabled)
- Tokens in use (which design tokens are referenced, which are missing)
- Accessibility risks (contrast violations, missing labels, focus traps)
- Responsive breakpoints (container query boundaries)
- Visual attention map (what draws the eye first, second, third)
- Violations against design doctrine (hard errors, soft warnings)

The cartographer is the "describe the terrain" role. It never proposes changes. It never expresses preference. It produces a structured JSON surface map that the architect consumes.

### Architect — Patch Plan

The architect proposes a design intervention under explicit constraints. It receives: the cartographer's surface map, the user's intent (e.g., "make this feel like an iPad dashboard"), and the design doctrine (constraints, tokens, allowed components, form factor rules).

The architect does not produce raw CSS or HTML. It produces a **patch plan** — a structured mutation document:

- Target components (which elements to change)
- Token mutations (which design tokens to modify)
- Layout changes (grid, flex, spacing adjustments)
- Interaction state additions/removals
- Responsive adaptations (container query breakpoint changes)
- Component additions (if new components are needed, references to existing vocabulary)
- Proposed visual hierarchy

The patch plan is validated against the design document schema before it reaches the builder. Invalid references, non-existent tokens, and forbidden component patterns are rejected at this stage.

### Builder — Mutation Application

The builder applies the patch plan to the design document. It produces: the mutated design document, the rendered HTML/CSS output, and a change receipt (what changed, what was added, what was removed).

The builder is deterministic. Given the same design document and the same patch plan, it produces the same result. No creative decisions. No "I think this looks better." Just application.

### Critic Council — Heuristic Evaluation

The critic is not a single taste judge. It is a **council** of specialized critics, each evaluating against one failure mode. Every critic produces a pass/fail verdict with evidence.

| Critic | Heuristic | Gate Rule |
|--------|-----------|-----------|
| **Accessibility** | WCAG 2.2 AA automated checks | axe-core scan must pass all auto-detectable criteria |
| **Responsive** | Component renders correctly at all defined container widths | Chromatic snapshot diff must be within threshold at every breakpoint |
| **Semantic** | HTML structure, heading hierarchy, landmark roles, focus order | Automated DOM audit must pass |
| **Brand** | Token compliance, spacing rhythm, palette restriction, dark mode coherence | Stylelint custom rules must pass with zero errors |
| **Touch** | Primary tap targets ≥ 44 CSS pixels, gate decisions visible without scroll on phone portrait, deny/approve thumb-reachable | Phone viewport Playwright render + automated measurement |
| **Product** | Surface still explains the product, content hierarchy matches user task, progressive disclosure works | Playwright render + heuristic check |
| **Identity** | Result looks like Tribunus, not inherited opencode slop, not generic SaaS dashboard | Human-only gate (not machine-enforceable) |

The critic council runs in parallel. Each critic produces a receipt. The final verdict is: all automated critics pass → present for human review. Any automated critic fails → mutation is rejected with failure receipts presented to the operator.

The **Identity** critic is the only human-only gate. It answers: "Does this feel like a governed cockpit, not a generic SaaS dashboard?" This gate is trained over time — the agent learns what gets approved and what gets rejected.

### Operator — Approval Gate

The operator (human) reviews: the side-by-side comparison (current design vs. proposed design), the critic council receipts (pass/fail with evidence), and the patch plan rationale. The operator approves, rejects, or requests another iteration.

- **Approve** → Automerge transaction commit, undo stack push, receipt stored
- **Reject** → Mutation discarded, rejection rationale sent to agent for context
- **Iterate** → Free-text feedback sent to architect for revised patch plan

### Receipt — Audit Trail

Every design decision produces a durable receipt:

```json
{
  "receipt_id": "design-abc-123",
  "timestamp": "2026-06-02T14:22:00Z",
  "surface": "cockpit-phone",
  "user_intent": "make this feel like an iPad dashboard",
  "cartographer_map_hash": "sha256:...",
  "architect_patch_plan_hash": "sha256:...",
  "builder_change_receipt_hash": "sha256:...",
  "critic_verdicts": {
    "accessibility": "pass",
    "responsive": "pass",
    "semantic": "pass",
    "brand": "pass",
    "touch": "pass",
    "product": "pass",
    "identity": "approved_by_human"
  },
  "operator": "approved",
  "operator_id": "github:juliantorr-es"
}
```

## Heuristic Rules (Concrete, Not Philosophical)

These are the enforceable design doctrine rules, not aspirations:

1. All primary tap targets must be at least 44 CSS pixels in the mobile cockpit
2. Gate decision controls must be visible without scrolling on phone portrait
3. No live projection stream may steal focus from the current task
4. Dangerous actions require reversible state or explicit confirmation
5. Every async command must show: pending, accepted, rejected, or stale
6. All panels must have a density tier annotation (compact / standard / spacious)
7. All generated components must consume design tokens, not hardcoded values
8. All command buttons must map to auditable command intents
9. No more than 2 font families (Inter + monospace)
10. No font-size below 12px, no line-height below 1.4
11. Every color must have a dark mode counterpart
12. No animation longer than 300ms without prefers-reduced-motion fallback
13. All spacing values must be multiples of the spacing unit (4px)
14. Contrast ratios must meet WCAG AA minimum (4.5:1 normal text, 3:1 large text)

## Taste = Accumulated Constraints + Critique Memory

Taste is not mystical. It is accumulated constraints plus a growing memory of what gets approved and what gets rejected. The system learns that Tribunus should feel like a governed cockpit by observing the operator's decisions over time. The agent does not need aesthetic genius. It needs doctrine, a component system, and critics that refuse violations.

## Heuristic Intensity & Generative Risk (First-Class Controls)

The user controls two orthogonal axes:

- **Heuristic strictness** — how aggressively the critic council enforces doctrine
- **Generative risk** — how much variation the architect/builder agents are allowed to explore

These are not collapsed into one "creative mode" slider. They are independent. Temperature alone is not a creativity dial — higher temperature increases novelty but also increases incoherence, and does not reliably improve cohesion. The magic is "turn constraints up and let the model search more aggressively inside the constrained box." High heuristics with moderate temperature gives the interesting zone: enough boundaries to avoid total slop, enough randomness to occasionally find a weird excellent solution.

### Mode Matrix

| Mode | Heuristics | Variance | Cursed Allowed | Ships to Production | Safety Gates |
|------|-----------|----------|----------------|---------------------|--------------|
| **Production** | Strict, all gates blocking | Low | No | Yes | Full |
| **Studio** | Strong, design critic required | Moderate | No | After review | Full |
| **Explore** | Medium, accessibility + safety still blocking | Higher | Yes (quarantined) | No | Safety + accessibility |
| **Cursed Lab** | Loose aesthetics, safety non-negotiable | High | Yes (gallery) | No | Safety minimums |

### The Safety Boundary

The safety boundary is operational, not aesthetic. A goofy UI card is fine. A destructive command hidden behind a beautiful button is not. Even in maximum chaos mode, these remain non-negotiable:

- Command gateway semantics (every button must map to auditable intents)
- Audit receipts (every mutation has provenance)
- Permission scopes (the design council cannot escalate authority)
- Accessibility minimums (contrast, focus, labels)

Let users make cursed things. Do not let cursed things merge themselves.

## Cursed Receipts & Community

Cursed output is not a failure mode. It is an artifact class. When an agent produces something hilarious, unsettling, almost brilliant, or catastrophically overdesigned, the user can share it as a **cursed receipt.**

The receipt includes: mode, heuristic profile, model/temperature settings, surface type, before/after screenshots, critic council verdicts (which rules passed, which screamed), and whether the artifact was accepted, rejected, or quarantined. This means the community is not posting random AI garbage. They are sharing reproducible design mutations with full provenance.

Success stories become accepted artifacts that passed stricter gates. Cursed elements become rejected or quarantined artifacts that are still socially useful — developers can laugh at them, remix them, file heuristic gaps, or turn an accidentally good cursed artifact into a governed component. Even the cursed thing gets a receipt.

### Community Health

The shared artifact is a small design case study: what the user asked, what constraints were active, what the model did, which critics screamed, and why it is cursed or brilliant. This gives people something to learn from, not just something to dunk on. It prevents the community from becoming a landfill while giving Tribunus a culture — meticulous without being sterile.

### The Principle

> Heuristic intensity governs what the agent is allowed to violate. Sampling risk governs how far the agent is allowed to wander. Receipts make both outcomes useful.

## Relationship to Code Workflow

The design council is the same pattern as the code cartographer → architect → critic loop, with role specialization adapted for design:

| Code Role | Design Role |
|-----------|-------------|
| Cartographer (map codebase) | Cartographer (map surface) |
| Architect (plan changes) | Architect (patch plan) |
| Surgeon (apply edits) | Builder (apply patch) |
| Critic (review correctness) | Critic Council (heuristic evaluation) |
| Operator (approve merge) | Operator (approve design) |
| Journalist (handoff) | Receipt (audit) |

The same architecture. The same constraint loop. The same evidence track. Applied to pixels instead of code.

## References
- Nielsen's Usability Heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Apple HIG: https://developer.apple.com/design/human-interface-guidelines/
- Material Design Layout: https://m3.material.io/foundations/layout
- ADR 008: Code-Native Design Canvas — The Hard Parts
