# Tribunus — Project Governance & Contribution Policy

## Repo Ownership Strategy

### Current State: Founder-Led

The core repo stays under `juliantorr-es` while the architecture mutates fast and the public story forms. Personal account is the strongest trust anchor for early-stage open-source devtool projects. People back a visible person, not a premature institution.

### Organization: tribunus-dev

`tribunus-dev` is the public product organization around the ecosystem. It holds: website/PWA shell, docs, public roadmap, feature bounty board, Codex projections, issue templates, packages, and eventually the core repo when institutional triggers are met. Do not transfer the core repo yet. Stage the institution around it.

### Custom Domain First

Before any org transfer, put the project site behind a stable custom domain (`tribunus.dev`). GitHub Pages custom domains are configured through DNS and repository settings. Old `juliantorr-es.github.io/opencode` URLs are temporary scaffolding. The clean long-term URL is the custom domain.

### Graduation Triggers

Transfer the core repo from personal to `tribunus-dev` when at least two of these are true:

1. **Paying users beyond donations.** Money tied to product obligations (access, exports, team features, support) needs cleaner separation between personal income and project revenue.
2. **A team pilot is active.** A small team depending on Tribunus for work needs protected branches, release discipline, and documented roles.
3. **Someone else needs maintainer access.** A casual PR does not require institutionalization. A maintainer who can merge, triage bounties, moderate Codex contributions, or handle releases does.
4. **Security and trust obligations are real.** If users install a native app that coordinates agents, reads files, and pairs mobile cockpits, a visible security posture is needed. OpenSSF Best Practices Badge and Scorecard are the reference standards.
5. **Product surface area demands it.** One repo can stay personal. A system with desktop app, PWA shell, Codex API, relay, design registry, bounty ledger, docs, packages, and schemas wants an org.

### Stewardship Transition Milestone

The transfer is a milestone, not an admin chore. Acceptance criteria before transfer:

- Org rulesets configured (branch protection, required reviews, status checks)
- Release signing/story decided
- `SECURITY.md` present
- `GOVERNANCE.md` present
- Contribution/license terms drafted
- Sponsor/funding path chosen (personal or org)
- Issue templates in place
- Maintainer roles defined
- Website/custom domain decoupled from old GitHub Pages URL

### The Rule

> Personal repo for founder velocity. Organization for institutional trust. Do not give yourself org bureaucracy until it buys something concrete. Transfer when personal ownership is the riskier option.

---

## Contribution Policy

### Doctrine

> Tribunus is open-source, but not PR-driven. The preferred contributions are funding, feature bounties, reproducible feedback, design critique, and operational traces. Code changes are accepted only when they are pre-scoped, architecturally aligned, and cheap to review.

Open source means the code is available under its license. It does not obligate acceptance of external patches, integration of random features, or roadmap control by PR volume. Maintainer time is a scarce project resource. Architectural coherence is more valuable than drive-by code.

### Contribution Categories

**Welcome** (high-value, low-review-cost):
- Funding and feature bounties
- Reproducible bug reports with logs/receipts
- Design critique and accessibility feedback
- Documentation corrections and improvements
- Security reports via coordinated disclosure
- Real-world workflow traces that demonstrate issues
- Test cases that reproduce a confirmed bug

**Restricted** (requires pre-discussion):
- Small code fixes tied to an accepted issue
- Documentation PRs for confirmed gaps
- Tests for confirmed bugs
- Adapters/integrations after a design note is accepted
- Agent-generated patches WITH a provenance receipt

**Not Currently Accepted** (will be closed without review):
- Unsolicited rewrites, large refactors, alternate architectures
- Drive-by UI redesigns
- New persistence layers or database migrations
- Agent policy or workflow changes
- Licensing changes
- Agent-generated patches WITHOUT a provenance receipt
- PRs that skip the issue/design-discussion step

### Agent-Generated Contributions

Tribunus is about governed agents. Ungoverned agent patches cannot be dumped into the repo. A PR that is agent-generated must include a provenance receipt:

- Agent identity and model used
- Prompt/request summary
- Files touched and rationale
- Tests run and results
- How the change aligns with project doctrine

No receipt, no review. This is product dogma applied to the project itself.

### Tone

The message is not "don't contribute." It is "contribute in the ways the project can actually absorb." Money and feedback are not second-class contributions. For a founder-led preproduction project, they are higher value than code.

### Funding as Contribution

The best way to influence the roadmap is to fund it. Feature bounties move proposals through the governed prioritization queue. Memberships fund infrastructure. One-time contributions support the project. GitHub Sponsors and Stripe are the payment rails. Every funded movement emits a public receipt.

---

## Security Policy (Template)

### Reporting

Security vulnerabilities should be reported to `security@tribunus.dev` or via GitHub's private vulnerability reporting. Do not open public issues for security findings.

### Scope

- Desktop app: file access, agent execution, provider key storage, Valkey coordination, PGlite/Codex storage
- PWA/relay: authentication, command intent authorization, projection stream integrity
- Website: XSS, content injection, supply chain
- Codex: data leakage through diagnostic packets, quasi-identifier re-identification
- Build/packaging: dependency integrity, binary signing (future)

### Expectations

- Acknowledgment within 72 hours
- Assessment and remediation plan within 14 days
- Coordinated disclosure after fix is released
- Credit in release notes and security advisory
