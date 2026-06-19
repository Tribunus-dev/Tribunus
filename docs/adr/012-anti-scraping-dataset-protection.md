# ADR 012: Anti-Scraping & Dataset Protection — Three Codex Surfaces

## Status
Accepted — June 2026

## Context

The Tribunus Codex contains structured design artifacts, provenance chains, dharma receipts, and agent interaction signals. Making this data public at full fidelity creates an irreversible asset leak. Robots.txt and "no AI scraping" terms are signals and legal hooks — they are not access control. Browsers and scrapers fetch the same URLs. If the browser can read `/codex-delta-2026-06-03.json`, so can a scraper.

The architecture must distinguish between **public visibility** and **dataset access**. The public surface markets the dataset. It must not be the dataset.

## Decision

### Three Codex Surfaces

| Surface | Access | Contents | Purpose |
|---------|--------|----------|---------|
| **Public Gallery** | Unauthenticated, rate-limited, lossy | Artifact cards, rendered screenshots, titles, tags, scores, short descriptions, "open in Tribunus" affordance | Marketing, community preview, human browsing |
| **Contributor Codex** | Authenticated, curated daily deltas | Curated projection derived from the internal ledger — normalized schemas, provenance summaries, aggregated scores, community rankings | Community participation, remix lineage, reputation |
| **Commercial/Research Codex** | Separately licensed, metered, fingerprinted, audited | Full-fidelity structured records with provenance, critic verdicts, model metadata, accept/reject traces, remix graphs | Licensed dataset for model training, evaluation, and research |

### The Rule

> No complete Codex dataset is ever available from a static public URL. Every full-fidelity record requires an authenticated, logged, scoped request. Bulk export requires a commercial/research license. Every export is uniquely fingerprinted. Public pages are previews, not records, and projections are not durable truth.

### Anti-Scrape Posture (8 Layers)

1. **Do not publish the full thing.** Public Gallery is deliberately lossy. Screenshots, titles, tags, scores — not schemas, provenance chains, prompts, critic reports, or model settings.

2. **Authenticate access.** Contributor Codex requires contributor license acceptance + account. Commercial requires separate license + API key.

3. **Rate-limit.** By account, IP, token, and behavioral pattern. Cloudflare rate-limiting rules cap requests matching expressions once limits are hit.

4. **Paginate through server-controlled API.** No static JSON dumps. All data served through cursored, paginated endpoints.

5. **Fingerprint exports.** Every commercial export includes a unique per-licensee watermark or canary record. Leaks are attributable.

6. **Prohibit scraping and redistribution.** Terms of service, license terms, and machine-readable `X-Robots-Tag` headers. Robots.txt as a notice layer — not enforcement, but a legal hook.

7. **Log and detect anomalies.** Audit logs for API access patterns. Anomaly detection for bulk scraping behavior. Revocable API keys.

8. **Make the public preview low-value as training data.** Public Gallery cards show a render, not structured data. A scraper gets screenshots and tags — useless for training a design agent. The structured data lives behind authentication.

### The Internal Ledger vs. Distributed Projections

The internal full aggregate ledger is append-only. The distributed community Codex is a projection, not the source of truth. Contributors do not receive the raw ledger. They receive curated daily deltas derived from it. If you publish a full append-only ledger at a public URL, you cannot claw it back. The projection is lossy by design — good enough for community participation, insufficient for model training or authority.

### Why Not Just Robots.txt?

Robots.txt compliance is unreliable. A 2025 empirical study found scraper non-compliance, especially among AI-oriented crawlers. Multiple AI companies were alleged to bypass robots.txt when scraping publisher sites. OWASP classifies scraping as an automated threat using accessible pages or API outputs, including through fake or compromised accounts. Robots.txt belongs in the stack — as a notice layer, a legal hook, and a signal of intent. It does not belong as the only line of defense.

## Consequences

### Positive
- **The monetizable asset stays protected.** The full-fidelity Codex dataset is never accidentally published as a static JSON file.
- **Contributors still get value.** Curated daily deltas provide community participation without giving away the asset.
- **Scrapers get low-value previews.** A screen-scraped public gallery yields screenshots and tags — useless for training.
- **Leaks are attributable.** Unique per-export fingerprinting means commercial dataset leaks can be traced to the licensee.

### Negative
- **More infrastructure.** Three surfaces require three access tiers with authentication, rate-limiting, and API infrastructure.
- **Contributors may expect more.** If the community surface is lossy, some contributors may feel shortchanged compared to the raw ledger. The honest asymmetry framing from ADR 010 must be visibly applied here: "Contributors receive curated Codex deltas. Tribunus retains the full aggregate."
- **GitHub Pages cannot host protected data.** The PWA shell stays on GitHub Pages. The Codex API goes behind a gateway. This adds an operational boundary that did not exist when everything was static files.

## References
- Google Robots.txt: https://developers.google.com/search/docs/crawling-indexing/robots/intro
- OWASP Automated Threats: https://owasp.org/www-project-automated-threats-to-web-applications/
- Cloudflare Rate Limiting: https://developers.cloudflare.com/waf/rate-limiting-rules/
- Cloudflare Bot Management: https://www.cloudflare.com/products/bot-management/
- ADR 010: Community Contribution License & Consent Architecture
