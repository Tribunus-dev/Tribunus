# Tribunus — Bootstrap Monetization Strategy

## Principle

Revenue funds compliance. Revenue also creates compliance. The first paid member creates obligations that did not exist before: refund expectations, uptime expectations, support expectations, privacy promises, and tax questions. Sell small, capped, explicit benefits — not a giant magical platform promise.

## Payment Infrastructure

### Phase 1 — GitHub Sponsors (Bootstrap)

GitHub Sponsors is the launch funding rail. It matches the open-source/devtool audience and lets money flow with zero custom billing UI. Up to 10 monthly tiers and 10 one-time tiers. Personal account sponsorships have zero platform fees — 100% goes to the developer. Organization sponsorships carry up to 6% (card processing + GitHub service).

What it handles well: monthly tiers for founder memberships, one-time tiers for contributions, named priority tiers for "fund this direction" (approximating feature bounties), and public legitimacy inside the developer ecosystem.

What it does not handle: usage metering, export credits, commercial dataset licenses, invoices, team seats, coupon logic, self-serve upgrades, API quota enforcement, all-or-nothing escrow, threshold-triggered charging, bounty-specific ledgers, or automatic refunds.

The v1 model: GitHub Sponsors funds the project and named priorities. Tribunus tracks the public bounty board as a projection — not Sponsors' native features. Sponsor payments are the money rail. Your own public ledger is the product rail. When a sponsor contributes to a feature tier, you issue a funding receipt and update the feature's percentage. Once a threshold is met, the feature moves into governed review.

GitHub Sponsors still uses Stripe behind the scenes for payouts, so Stripe is not avoided — it's delayed.

### Phase 2 — Stripe (Metered Product Access)

Add Stripe when you need: membership entitlements, quota-based export credits, commercial dataset access, team billing, self-serve upgrades, invoice generation, and API quota enforcement. Stripe Billing for subscription management. Stripe Payment Links for one-time payments. Stripe Tax when multi-jurisdiction thresholds are crossed.

### The Rule

> GitHub Sponsors for community funding. Stripe for metered product access. Both can coexist.

## First Paid Tier: Founder Member

Sell one constrained tier. Not "unlimited everything" — that's a denial-of-service contract for $9/month.

**Entitlements (capped, explicit):**
- Curated Codex deltas (daily community updates)
- Authenticated dashboard access (dharma, queue, agent cockpit)
- Limited full-fidelity export credits (capped per month, quota-based from day one)
- Community posting (share artifacts, cursed receipts, diagnostic packets)
- Early access to mobile cockpit builds (PWA opt-in)
**Explicitly not included:**
- Unlimited bulk Codex mirror
- Commercial/research dataset licensing (separate license, separate pricing)
- Raw append-only ledger access (never exposed to any tier)
- Production-grade infrastructure guarantees

**Framing:** "Founder access includes member Codex browsing, limited export credits, contribution features, and early cockpit builds. Limits may change as infrastructure scales." Honest, room to evolve, no traps.

## The Revenue Ladder

1. **Charge for Founder Member** — minimal operational exposure, one clear entitlement set
2. **Pay for backend/API edge** — the three Codex surfaces need authentication, rate-limiting, and API infrastructure beyond GitHub Pages static hosting
3. **Pay for legal docs** — terms of service, privacy policy, refund policy. Revenue makes these legally material in a way that pre-revenue free tools are not
4. **Add Stripe Tax** — once tax thresholds and multi-jurisdiction complexity justify 0.5% per transaction
5. **Add commercial/research exports** — only after the contribution license (ADR 010), anonymization pipeline, and OSS integrity gate (ADR 013) are defensible
6. **Scale entitlements** — as infrastructure scales, increase export credits, add tiers, add metered usage

## The Constraint

Do not sell anything you cannot honor. The Founder Member tier must deliver what it promises on day one:

- Curated Codex deltas → requires the daily flush pipeline (ADR 010)
- Authenticated dashboard → requires GitHub identity + member entitlement check
- Limited export credits → requires quota tracking and enforcement
- Community posting → requires the contribution flow with license acceptance
- Early cockpit builds → requires the PWA deployment pipeline

If any of these are not built yet, do not list them as included. Sell what exists. Add entitlements as features ship.

## The Rule

> Revenue funds compliance, but revenue also creates compliance. Charge early, charge small, deliver exactly what you sell.

## Three-Pillar Funding Model

### Pillar 1 — Memberships (Recurring)

Fund ongoing infrastructure: hosting, Codex serving, storage, auth, moderation, Stripe fees, support, maintenance. Tiers aligned to operations, not vibes:

| Tier | Access | Export Credits |
|------|--------|---------------|
| **Free / Private** | Local app, public website, read-only Codex previews | None |
| **Contributor** | Publish to community Codex, receive curated daily deltas | None |
| **Member** | Authenticated Codex browsing, dharma dashboard, community posting | Limited monthly quota |
| **Pro / Research** | Advanced provenance search, higher API limits, priority queue | Scaled monthly quota |

Commercial dataset access remains separate — different risk and value class, separately licensed.

### Pillar 2 — One-Time Contributions

Support the project without recurring commitment. Stripe Payment Links for no-code payment pages. Pay-what-you-want supported via Stripe Checkout. No entitlement beyond community recognition and the satisfaction of funding the thing. Not a purchase. Not a membership.

### Pillar 3 — Feature Bounties

Targeted funding for prioritized work. Money does not bypass governance — money buys a gate review. A bounty reaching its threshold promotes the feature to the governed integration queue. It does not guarantee delivery, timeline, or scope. It buys priority and accountable review with public receipts.

## Feature Bounty Governance

### The Rule

> Memberships fund the platform. Contributions support the project. Feature bounties fund prioritization, not ownership. Thresholds trigger governed review, not automatic promises. Every funded movement emits a public receipt.

### Feature Status Lifecycle

| Status | Meaning |
|--------|---------|
| **Proposed** | Visible on the board, not yet scoped |
| **Scoping** | Enough interest exists to estimate implementation cost and risk |
| **Funding** | Threshold is active, accepting pledges |
| **Threshold Met** | Eligible for promotion to prioritized integration queue |
| **Accepted** | Scope approved, committed to attempting implementation |
| **In Progress** | Council loop active: cartographer → architect → builder → critic council |
| **Released** | Shipped |
| **Rejected** | Incompatible with product doctrine, license policy, safety policy, or maintenance capacity |
| **Merged** | Funding rolled into a broader feature if terms allow |

### Funding Model

Kickstarter-style all-or-nothing threshold. Funds held as pledges until threshold is met. If a feature does not reach its goal, funds are not collected. This protects both sides: creators are not expected to deliver without enough funding; contributors are not charged for features that won't ship. Alternatively, contributions can be non-refundable support toward a requested direction — simpler but requires clearer disclaimer that this is not a purchase contract.

### Terms (Explicit)

- Contributions support development priorities, not custom work-for-hire
- Contributors do not own the resulting feature, receive equity, revenue share, or IP
- Tribunus retains final product authority
- Features may be merged, split, renamed, rescoped, delayed, or rejected for safety, legal, architectural, or maintenance reasons
- Refund policy defined explicitly before payment

### Anti-Abuse Controls

A bounty must not request: license laundering, malware, scraping, surveillance, credential harvesting, bypassing paid services, or features that undermine OSS obligations. The OSS Integrity Gate (ADR 013) applies to funded feature requests. Proposal submission is gated — only approved proposals enter public funding to prevent the board from becoming a graveyard of "add blockchain" and "rewrite in Rust."

### Backend Model

Each feature proposal: public record, funding ledger, threshold, status receipt trail. Each payment: contribution receipt tied to Stripe event. Public board shows rounded totals and percentages — a projection, not the source of truth. Internal ledger keeps exact Stripe IDs, contributor account, refund state, chargeback state, and entitlement effects.

## Revenue Separation Rule

> Do not mix the ledgers. Membership revenue pays for infrastructure. Feature bounty revenue pays for prioritized development. Keeping them separate makes the system legible and prevents members from feeling their subscription disappeared into a black hole.


## BYOK (Bring Your Own Keys)

Tribunus does not sell inference. Users bring their own OpenAI, Anthropic, Gemini, or local model keys. Tribunus sells orchestration, governance, receipts, Codex access, mobile cockpit, team coordination, auditability, workflow design, and protected dataset access.

This eliminates the "inference whale" problem — agentic coding consumes orders of magnitude more tokens than ordinary code chat, with large variability between runs. Flat pricing cannot absorb one user running a multi-hour autonomous session. GitHub Copilot moved to usage-based billing in 2025 for exactly this reason.

### Security Architecture

API keys never enter the browser/PWA. Keys live in the native desktop app keychain or the user's own provider environment. The mobile PWA sends command intents to the desktop. The desktop executes locally using the user's configured keys. The phone receives projections and receipts. No keys are stored by the relay.

For teams: provider keys managed at workspace level. Desktop/workspace runner uses configured credentials. Enterprise can require "no keys stored by Tribunus cloud" — keys in customer secret manager or local runners only.

### Support Boundary

Since Tribunus is not responsible for model bills or provider uptime, support explicitly excludes provider billing, rate limits, account bans, and model output quality beyond Tribunus workflow controls. The user manages their own provider relationship.

## Pricing Tiers

### The Principle

> Seats pay for collaboration and governance. Tributes pay for expensive compute/data movement. Enterprise pays for risk reduction, deployment control, support, and procurement comfort.

### Personal Tiers

| Tier | Price | Includes |
|------|-------|----------|
| **Free / Local** | Free | Local desktop use, public docs/site, limited public Codex browsing. No hosted guarantees. No full-fidelity exports. No support beyond public docs/community. |
| **Individual Member** | $12–$19/month | Contributor identity, curated Codex deltas, limited Tributes (export credits), mobile cockpit pairing, feature bounty participation. Quotas kept low enough that one power user cannot burn infra. |
| **Pro Individual** | $29–$49/month | More Tributes, longer history, more mobile/tablet devices, priority queue on feature votes, advanced provenance search, private Codex collections. |

### Team Tiers

| Tier | Price | Includes |
|------|-------|----------|
| **Small Team** | $25–$40/seat/month (3-seat min) | Shared workspaces, team feature bounties, team Codex collections, shared dashboards, approval roles, team audit receipts, shared Tribute quota, basic admin. Cursor's $40/user/month is the ceiling reference. |
| **Team Plus / Studio** | $50–$75/seat/month (higher min) | Governance layer for teams that depend on it: higher Tribute quotas, team policy profiles, private contribution registries, advanced audit trails, custom workflow templates, team analytics, priority support. |
| **Enterprise** | Custom annual, ~$12K–$25K/yr base, scaled by seats/agents/export volume/compliance | SSO/SAML, SCIM, audit export, private relay, self-hosted or customer-controlled runners, policy enforcement, legal/security review, dedicated support. Sourcegraph's $16K enterprise floor is the market anchor. |

Commercial dataset access is priced separately — different risk and value class.

### Market Anchors

| Product | Team/Pro Price | Notes |
|---------|---------------|-------|
| Linear | $10/user Basic, $16/user Business | Team product tooling |
| Cursor | $40/user Team | AI coding agent team plan |
| GitHub Copilot | $19/user Business, $39/user Enterprise | Now with usage credits layered in |
| Sourcegraph | $16K+ Enterprise | Developer infrastructure, governance tier |

## Tributes (Platform Unit)

"Tributes" replaces "credits" and "export credits" as the brand-native platform unit. Double meaning: a contribution given voluntarily, and a unit paid into a larger civic/systemic structure. "Tribute" as something given voluntarily as due or deserved, a sign of respect or gratitude.

A Tribute is a platform unit used to fund costly Tribunus operations: full-fidelity Codex exports, hosted relay usage, feature bounties, and other metered platform work.

### Usage in Product

- Export credits → "Monthly Tributes"
- Feature bounties → "Pooled Tributes" / "72% of required Tributes pledged"
- Membership → "Includes 100 monthly Tributes"
- Ledger → "Tributes received," "Tributes spent," "Tributes returned"

### Tone Caution

"Tribute" can also imply submission to a ruler. The UI frames it as civic contribution, not feudal extraction. "Tributes fund Codex infrastructure and prioritized work" — good. "Pay tribute to unlock access" — villain-coded. Use the mask off in private, on in public.

## Support as Product Dimension

| Tier | Support Level |
|------|--------------|
| **Community** (Free) | Public docs, community forums, async issue templates. No SLA. |
| **Standard** (Individual, Pro) | Priority email with response target, not guarantee. Included in plan. |
| **Priority** (Team Plus, Enterprise) | Guaranteed response window, escalation path. |
| **Implementation / Advisory** | Paid separately. Custom workflow design, security review assistance, migration, private deployment, enterprise onboarding, feature-specific consulting. Not bundled into seat pricing unless annual contract is high enough. |

## Pilot Program

Paid pilots, not free trials. Free pilots create weak signals. A paid pilot proves the product survives procurement friction.

| Pilot Type | Duration | Users | Price | Includes |
|-----------|----------|-------|-------|----------|
| **Small Team** | 30–60 days | 3–10 | $500–$2,500 | One explicit use case, capped support, written success criteria |
| **Enterprise Design Partner** | 60–90 days | Custom | $5K–$15K | Onboarding, private deployment, security review, structured feedback loops, prioritized review of blockers |

**Exception:** very small design-partner program (2–3 teams) with discounted pricing in exchange for weekly feedback, permission to use anonymized learnings, and case-study rights.

**Pilot does not promise custom features** as deliverables unless separately scoped. Pilot promises access, onboarding, structured feedback loops, and prioritized review of blockers. If a pilot funds a feature, it goes through the same bounty/governance model: threshold, scope, receipts, acceptance criteria.

**Pilot success criterion:** does the team want to convert to a paid plan at full price when the pilot ends? If yes, the product is valuable. If no, the feedback is valuable. Free pilots produce neither signal.