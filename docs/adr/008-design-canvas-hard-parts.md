# Code-Native Design Canvas — The Hard Parts

## 1. Design Document Schema

**Foundation: W3C DTCG (Design Tokens Community Group) Specification v2025.10**

The W3C DTCG spec provides the token layer: `$value`, `$type` (color, dimension, typography, etc.), organized into primitive → semantic → component token hierarchies. This is the vendor-neutral, machine-readable format for all design decisions in the Tribunus design system.

**Tribunus extends this with a full design document model:**

```
DesignDocument
├── Tokens (W3C DTCG compatible)
│   ├── Primitives: raw values (#0a0a0f, #d4a853, 16px)
│   ├── Semantics: color-background-primary, spacing-section-gap
│   └── Components: button-background-primary, card-border-radius
├── Pages (named surfaces: landing, cockpit-phone, dashboard-tablet)
├── Frames (layout regions within pages)
├── Components (Lit element definitions with token bindings)
│   ├── AgentCard, GateRequest, DharmaPanel, QueueItem, etc.
│   └── Each visual property references a token, not a raw value
├── Constraints (rules that govern component behavior)
│   ├── Interaction states: hover, focus, active, disabled, loading
│   ├── Accessibility rules: minimum contrast, focus indicators
│   ├── Responsive rules: container query breakpoints, density tiers
│   └── Token rules: which tokens may be used in which contexts
├── Assets (generated artifacts: OG images, diagrams, screenshots)
└── Provenance (what agent, prompt, date, approved by, receipt hash)
```

**Implementation:** Effect Schema (already in the repo) for TypeScript types. W3C DTCG JSON for serialization/portability. Style Dictionary for token transformation to CSS custom properties, Lit component tokens, and documentation.

**Key insight:** The design document is NOT a Figma file. It is a structured JSON document that maps directly to code. Tokens compile to CSS. Components compile to Lit elements. Constraints compile to lint rules and validation checks. Pages compile to HTML layouts. The document IS the codebase, not a separate artifact that gets "converted" to code. It is a presentation artifact, not a source of runtime authority.

---

## 2. Undo/Redo Semantics

**Foundation: Automerge (CRDT)**

Automerge v3 (2026) provides JSON-document CRDT with 10x memory reduction over v2, complete version history with branching, and built-in undo/redo that is scoped to the local user. Undo operations generate inverse operations that propagate across the network as regular changes.

**Tribunus approach:**

**Single-user mode (launch):** Automerge's local undo/redo is sufficient. The design document is an Automerge document. Every agent edit is a transaction. Undo replays the document state before the transaction. Redo replays the inverse. Automerge limits history to 100 operations by default to control metadata bloat.

**Team mode (later):** The "Figma model" — hybrid CRDT with a central ordering service. Automerge handles the JSON document structure. The coordination fabric (Valkey) handles the ordering of authority-changing events. Undo/redo in team mode follows Figma's approach: undoing your own edit modifies the redo history so your undo doesn't overwrite collaborators' work.

**Agent edits are transaction groups.** Every agent mutation is wrapped in a named transaction group: "Agent-alpha proposed layout change for cockpit-phone." The undo manager exposes `undo("Agent-alpha proposed layout change for cockpit-phone")` — undoing all changes from that transaction atomically. The user never sees "undo last keystroke" — they see "undo that agent's proposal."

**Yjs alternative:** Yjs `UndoManager` with `captureTimeout` would work but is optimized for text editing, not JSON document mutation. Automerge is native JSON CRDT — better fit for a design document that is JSON-structured.

---

## 3. Agent Mutation Safety

**The problem:** Agents generate HTML/CSS/TS mutations. Without constraints, they produce pretty garbage — code that looks right but breaks at different viewports, violates token rules, ignores accessibility, and doesn't compose with existing components.

**The solution: Four-layer safety pipeline.**

**Layer 1 — Structured Output:** Agents use native structured output modes (Claude strict mode, OpenAI structured outputs, XGrammar at the inference level) to produce mutations as validated JSON against the DesignDocument schema. No free-text code generation. The output IS a structured mutation, not prose that gets parsed.

**Layer 2 — Token Constraint:** Before the mutation leaves the agent, it is validated against the design token schema. Every color reference must exist in the token set. Every spacing value must be a multiple of the spacing unit. Every font family must be in the allowed set. This is an inference-level constraint enforced via the LLM's tool-call schema, not a post-hoc lint.

**Layer 3 — Component Boundary:** Mutations are scoped to existing components. An agent cannot create a new component from scratch — it can only propose mutations to existing component instances or propose new component definitions that extend the base component vocabulary. This prevents the agent from inventing a parallel design system.

**Layer 4 — Validation Gate:** Post-mutation validation runs automatically:
- Token compliance: every visual property references a valid token
- Accessibility: WCAG 2.2 automated checks via axe-core (~57% of issues caught; remaining require manual review)
- Responsive: Playwright renders the component at defined breakpoints, compares snapshots
- Visual regression: Chromatic/Percy compares against baseline, AI-powered diff filters false positives
- Code quality: Stylelint for CSS, TypeScript compiler for component code

The mutation either passes all gates and is presented to the user for approval, or it fails and the failure receipts are presented instead.

**Safety guardrails (runtime, not design-time):**
- Input validation: user prompts are sanitized before reaching the agent
- Prompt template hardening: the agent's system prompt is injection-resistant
- Tool-call gating: every proposed mutation is validated before it touches the design document
- Output filtering: generated code is scanned for PII, secrets, and malicious patterns

---

## 4. Responsive Layout Validation

**The approach: Component-level visual regression, not page-level testing.**

Tribunus components are designed with Container Queries (baseline 2026). A component's layout depends on its container, not the viewport. Validation must test each component at each container width, not just at phone/tablet/desktop breakpoints.

**Pipeline:**

1. **Storybook** renders each Tribunus component in isolation at defined container widths
2. **Chromatic** captures snapshots of every component state + container width combination
3. **TurboSnap** ensures only actually-changed components are re-tested
4. **AI-powered diff** (Chromatic or Percy Visual Review Agent) filters false positives from anti-aliasing, font variations, and minor rendering noise
5. **Playwright** (`toHaveScreenshot()`) provides pixel-level comparison with configurable threshold
6. **Container query testing:** Playwright resizes the parent container (not the viewport) and verifies the component adapts correctly

**Why not viewport-level testing:** Tribunus components are rendered in different containers across form factors. A DharmaPanel might be full-width on the phone, 300px in a tablet sidebar, and 200px in a desktop rail. Viewport testing doesn't catch whether the component works correctly at 300px specifically. Container query testing does.

**Integration point:** When an agent proposes a mutation, the validation gate automatically runs Chromatic snapshots for every affected component at every defined container width. If any snapshot differs from baseline beyond threshold, the mutation is flagged.

---

## 5. Taste Enforcement

**The hard problem:** How do you encode "this looks good" as a machine-enforceable rule?

**The answer: You don't. You encode "this violates a known bad pattern" and let the human decide "good."**

**Machine-enforceable rules:**

**Token compliance:** Every visual property must reference a token. No raw hex codes. No raw pixel values. No raw font names. Stylelint enforces this. Violations are hard errors.

**Spacing rhythm:** All spacing values must be multiples of the spacing unit (4px or 8px). Stylelint custom rule. Violations are hard errors.

**Color palette restriction:** Only colors defined in the token set may be used. No agent-invented colors. Stylelint custom rule + Effect Schema validation. Violations are hard errors.

**Dark mode coherence:** Every color token must have a dark mode counterpart. No component may use a light-mode-only color without a dark-mode fallback. Token schema validation. Violations are hard errors.

**Contrast enforcement:** Minimum contrast ratios (WCAG AA: 4.5:1 for normal text, 3:1 for large text). axe-core automated checks. Violations are soft warnings (requires human review, some false positives).

**Typography discipline:** Maximum 2 font families (Inter + monospace). No font-size below 12px. No line-height below 1.4. Stylelint rules. Violations are hard errors.

**Motion restraint:** No animation longer than 300ms. No animation without `prefers-reduced-motion` fallback. Manual review (no reliable automated checker).

**Not machine-enforceable (requires human review):**
- Visual hierarchy appropriateness
- Content density for the form factor
- Aesthetic coherence of the composition
- Whether the component "feels like Tribunus"

**The taste pipeline:**

1. Automated rules catch everything machine-enforceable (hard errors)
2. The mutation is rendered in the canvas as a proposal
3. The human sees a side-by-side: current design vs. proposed design
4. The human sees the automated check results: passed/failed with receipts
5. The human approves, rejects, or requests another pass
6. Every human decision feeds back into the agent's context for future proposals

Taste is trained, not configured. The agent learns what gets approved and what gets rejected. Over time, the automated checks filter 80% of obvious violations and the agent learns to avoid the patterns that humans consistently reject.

---

## Architecture Summary

```
User Prompt
    │
    ▼
Agent (structured output, token-constrained)
    │
    ▼
Proposed Mutation (validated JSON against DesignDocument schema)
    │
    ├─ Token compliance check (hard errors)
    ├─ Accessibility check (axe-core, soft warnings)
    ├─ Responsive check (Chromatic snapshot diff)
    ├─ Taste check (Stylelint, custom rules)
    │
    ▼
Canvas Preview (side-by-side: current vs proposed)
    │
    ▼
Human Decision: Approve / Reject / Iterate
    │
    ├─ Approve → Automerge transaction commit, undo stack push
    ├─ Reject → Mutation discarded, feedback to agent
    └─ Iterate → Feedback loop, agent proposes new mutation
```

## Key Libraries

| Problem | Library | Why |
|---------|---------|-----|
| Schema | Effect Schema (in repo) + W3C DTCG JSON | Token types + design document model |
| CRDT | Automerge v3 | JSON-document CRDT, built-in undo/redo, version history |
| Structured output | Claude strict mode / XGrammar | Guaranteed valid JSON mutations, no free-text code |
| CSS linting | Stylelint (2026) | Token compliance, spacing rhythm, palette restriction |
| Accessibility | axe-core | WCAG 2.2 automated checks, CI integration |
| Visual regression | Chromatic + Playwright | Component-level snapshot diff, container query testing |
| AI guardrails | Guardrails AI / NVIDIA NeMo | Input validation, prompt hardening, output filtering, tool-call gating |
| Token transform | Style Dictionary | W3C DTCG JSON → CSS custom properties + Lit tokens |
