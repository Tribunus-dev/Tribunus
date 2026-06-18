# Tribunus Community Contribution License & Consent Architecture

## Principle

> Raw AI-generated output may lack copyright protection when there is no human authorship, but Tribunus still obtains an explicit license because shared design schemas may contain human-authored contributions, third-party material, metadata, selection/arrangement data, and contractual rights. The license is not just for copyright — it is for platform operation, redistribution, sublicensing, commercialization, research export, and aggregation.

## Copyright Reality

The U.S. Copyright Office's 2025 AI report confirms: purely AI-generated material is not protected by copyright. Human authorship is required. But AI-assisted works CAN be protected where sufficient human creative contribution exists, and the human-authored parts may be independently protectable. Tribunus shared artifacts are rarely "purely AI-generated" — they contain human selection, arrangement, editing, prompts, component choices, naming, layout decisions, annotations, and curation. Some of that is likely protectable. Some of it isn't. The license should not depend on guessing which is which.

Additionally, design assets and provenance metadata can implicate: trademarks (a "cursed Apple-style settings panel"), trade dress, privacy rights, publicity rights, database rights (in some jurisdictions), and third-party licenses (licensed icon packs, proprietary component designs). Copyrightability of AI output does not solve any of these. An explicit grant is required regardless.

## Dual Consent Tiers

### Tier 1 — Local / Private

Default. The user designs, the agents operate, the design council evaluates. Everything stays local. Usage telemetry may be collected under a disclosed privacy policy. No design schemas, receipts, or provenance data leave the machine without explicit consent.

### Tier 2 — Community / Codex Sharing

Opt-in per artifact with a visible share dialog. When a user publishes a design schema or cursed receipt to the community registry, they grant Tribunus a broad license. This is the moment the license attaches — not buried in a TOS accepted at signup, not implied by usage. A clear, one-screen share dialog.

## Tribunus Community Contribution License (TCCL)

The contributor grants Tribunus a worldwide, royalty-free, irrevocable, sublicensable license to host, display, distribute, reproduce, modify, adapt, create derivative works from, aggregate, analyze, commercialize, and include in research datasets the shared materials, including: design schemas, component definitions, token sets, prompt text, heuristic profiles, model configuration metadata, before/after screenshots, critic council verdicts, mutation provenance, interaction signals, and metadata.

This license survives unpublishing or deletion of the visible artifact, except that previously distributed datasets, aggregate statistics, backups, and derived models may not be fully retractable. This must be stated clearly: "Deleting your published artifact removes it from the public registry. Previously distributed copies, research exports, and aggregate analytics may persist."

The contributor warrants they have the right to grant this license for all material they submit, including any third-party assets, and agrees not to submit material that infringes third-party intellectual property, privacy, or contractual rights.

## Research Dataset Value

The commercially valuable dataset is not "screenshots of AI designs." It is provenance-rich process data:

- Request (user intent, natural language)
- Constraints (heuristic profile, mode, model settings, temperature)
- Role loop (cartographer map, architect patch plan, builder change receipt)
- Artifact (design schema, code patch, rendered screenshot)
- Evaluation (critic council verdicts — which rules passed, which screamed)
- Human decision (accept / reject / iterate, edit history)
- Social signals (popularity, remix lineage, downstream reuse)
- Community classification (success story, cursed receipt, governed component)

This is research-friendly because it captures process, not just output. It is commercially useful because it can train or evaluate: design agents, code-generation agents, accessibility critics, UI preference models, layout repair systems, heuristic compliance checkers, and taste classifiers.

## Public Codex vs. Private Aggregate

**Public Codex:** Curated, projection-based. Only popular, high-quality, useful, or intentionally cursed artifacts are visible. The public Codex stays legible. It is not an infinite landfill.

**Private Aggregate:** Stores normalized features, provenance, heuristic outcomes, model/settings metadata, and interaction metrics from all consented contributions. This is the research dataset and commercial asset. It is not publicly browsable but may be packaged and licensed as a commercial research export.

Users can inspect their own contributed records and visible public/community records. The existence of non-public aggregate datasets, analytics, and commercial exports is disclosed.

## Licensing Artifacts for Public Reuse

For artifacts published to the public Codex, a visible license label is attached (e.g., CC BY). This is separate from the TCCL — the TCCL is the contributor-to-Tribunus grant. The CC label is the downstream-to-public grant. Contributors should understand both.

## Non-Negotiables

1. **Contribution is opt-in per artifact** with a visible license badge. No blanket "by using Tribunus you grant us everything."
2. **Public sharing and commercial dataset inclusion may be combined into one toggle** if the business model requires it. The toggle label must be unmistakable — "Contribute to Community Codex," not "Share." The confirmation copy must state that this publishes the artifact into the community pipeline and grants Tribunus rights to redistribute, sublicense, analyze, aggregate, and commercialize the contributed artifact and its provenance.
3. **Deletion is honest.** Users can delete or unpublish visible artifacts. Previously distributed datasets, aggregate statistics, backups, and derived models may not be fully retractable. This must be stated clearly in the share dialog — not hidden in a separate policy page.


The daily flush is a **privacy boundary**, not a cron job. Before the flush, the contribution ledger is identifiable or pseudonymous. After the flush, the Codex dataset is a separate transformed artifact that has passed an anonymization/deidentification pipeline. Pseudonymisation is a GDPR safeguard, not anonymisation — data remains personal if additional information can reconnect it to a person. The flush must break linkability, not just rotate IDs.

### Raw Daily Ledger (Pre-Flush — Zone 2)

Contains: account ID, artifact ID, contributor handle, timestamps, model settings, prompt text, design schema, screenshots, social interactions, moderation events, and provenance. Treated as regulated contribution data. Retained only for licensing, abuse, moderation, and compliance.

### Anonymization Job (The Flush)

Direct identifiers removed: account ID, contributor handle, workspace/repository names, IP addresses, device identifiers, EXIF/geolocation data, GitHub handles, issue numbers, local paths, domains, icons, logos, visible text in screenshots that identifies a person or organization.

Quasi-identifiers generalized: timestamps coarsened to day granularity, rare model settings bucketed into common ranges, stable contributor IDs removed or replaced with non-linkable pseudonyms, prompts normalized (secrets redacted, workspace names stripped, rare patterns suppressed).

Outlier suppression: artifacts or metadata combinations too rare to be safe are generalized, delayed until they join a larger bucket, or excluded. This follows the k-anonymity principle — an artifact must be indistinguishable from at least k other artifacts in the dataset.

### Codex Dataset (Post-Flush — Zone 3)

The transformed Codex delta must pass this rule:

> Nothing enters the Codex dataset unless it can survive: contributor ID removal, timestamp coarsening, prompt/content redaction, workspace-name stripping, rare-bucket suppression, and linkage-risk scoring.

The flush produces a receipt: what was ingested, what was suppressed, what identifiers were stripped, what quasi-identifiers were bucketed, what artifacts were excluded, and which anonymization policy version was applied. The receipt is public or semi-public without exposing raw data.

### What This Enables

The identifiable contribution ledger (Zone 2) remains regulated, inspectable, and subject to deletion/unpublish obligations. The Codex dataset (Zone 3) may qualify as deidentified/aggregate for commercial/research distribution. The license/account ledger is retained separately for compliance — never used as part of the commercial Codex.

## Identity Tiers

The contribution pipeline separates three identity contexts:

| Tier | Purpose | Contains |
|------|---------|----------|
| **Public identity** | Visible on shared artifacts | Display handle (if user opts in), remix lineage, public rankings |
| **Contributor identity** | Codex ledger records | Stable pseudonymous contributor ID, provenance chain, dharma ledger entries |
| **Research identity** | Commercial/research exports | Stripped of direct identifiers, workspace names, private repo references. Provenance necessary for dataset purpose retained |

Research/commercial exports remove: direct identifiers, secrets, workspace/private repository names, personal data, and any material that could identify an individual. Provenance needed for the dataset's purpose — prompt text, heuristic profiles, critic verdicts, model metadata — may be retained.

## Redaction & Deletion

Privacy regimes (CCPA/CPRA, GDPR) may require deletion or suppression of contributed material, even from an append-only ledger. The solution is **tombstones and redaction receipts:**

- The Codex ledger remains append-only for technical integrity
- A redaction event is appended: "artifact X was redacted at timestamp Y, reason Z"
- Public visibility is suppressed; the artifact is excluded from future exports
- Previously distributed datasets, aggregate statistics, backups, and derived models may not be fully retractable
- This is stated in the share dialog: "You may unpublish or redact visible artifacts. Prior distributed copies may persist."

## The Honest Asymmetry

The exchange is asymmetric. Framing it otherwise is deceptive. The fair statement:

> Tribunus maintains the full aggregate dataset. Contributors receive curated Codex deltas, public rankings, remix lineage, and community access. Tribunus retains the full aggregate including richer provenance, analytics, moderation signals, social interactions, and research/export metadata.

This is a legitimate bargain if it is explicit. The user gets distribution, community participation, remix lineage, reputation, access to curated deltas, and participation in the knowledge codex. Tribunus gets the full dataset and the right to commercialize it. Neither party should be surprised.

## TCCL Rights (Expanded)

The Tribunus Community Contribution License should cover: host, store, reproduce, display, distribute, modify, transform, translate, adapt, create derivative works, sublicense, relicense, commercialize, analyze, benchmark, include in datasets, use for model evaluation/training, and combine with other contributions.

The license must also include a contributor warranty that they: have the rights to contribute the material, will not knowingly upload secrets, private third-party content, infringing assets, confidential client work, or personal data they lack rights to share, and agree that previously distributed copies, research exports, and aggregate statistics may persist after unpublishing.

## Data Zone Architecture

Contribution telemetry reduces surface area. It does not create exemption from GDPR/CPRA. Under GDPR, pseudonymised data is still personal data — pseudonymisation is a safeguard, not an exit. Under CPRA/CCPA, deidentified/aggregate status requires the information not be reasonably linkable back to a consumer or household. If you retain stable contributor IDs, account mappings, device data, timestamps, repo/project names, prompt text, screenshots, or contribution lineage, you are likely still processing personal information.

The architecture separates data into three zones:

### Zone 1 — Private Local

No server collection. No telemetry. Local design, agent orchestration, and codex operations remain entirely on the user's machine. This is the default. Strongest for trust and simplest for compliance.

### Zone 2 — Contribution Ledger

Identifiable or pseudonymous records tied to: contributor license acceptance, account identity, artifact metadata, share event, moderation decisions, and provenance chain. This zone is treated as regulated personal data. Requirements: notice at collection, access/export workflows, deletion/unpublish workflows with redaction tombstones, and clear consent/license records per contribution.

### Zone 3 — Codex Dataset

Daily-normalized records derived from Zone 2 with: direct identifiers removed, secrets scrubbed, rare/outlier metadata bucketed, timestamps coarsened (day granularity), project/repository names removed, screenshots sanitized, and contributor identity replaced with deidentified stable pseudonyms or omitted. This zone may qualify as deidentified/aggregate for commercial/research distribution. Qualification depends on re-identification risk — assessed per export, not assumed.

### The Rule

> Private use emits no contribution telemetry. Sharing is an explicit contribution event. Contribution records are regulated and inspectable. Public Codex deltas are curated. Commercial/research exports are deidentified or aggregated from the contribution ledger, not raw account telemetry. Pseudonymisation reduces risk but is not treated as anonymisation.

## References

- U.S. Copyright Office, "Copyright and Artificial Intelligence Part 2: Copyrightability" (January 2025): https://www.copyright.gov/ai/
- GitHub Terms of Service, User Content License: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- Creative Commons Attribution 4.0: https://creativecommons.org/licenses/by/4.0/
- ADR 009: Design Council — Cartographer → Architect → Critic Loop for UI
