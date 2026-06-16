---
title: chore(repo): establish issue labels, PR linkage, and agent-ready issue template
lane: lane:repo-hygiene
kind: kind:hardening
severity: severity:high
---

## Context
Standardizing project governance and automation-ready issue templates.

## Problem Statement
Lack of standardized labels and issue templates creates friction for agent-based issue management.

## Non-goals
- Overhauling project-wide CI policies in this pass.

## Implementation Notes
1. Create and apply the `lane`, `kind`, `severity` taxonomy in GitHub.
2. Install standard issue template supporting agent-required metadata fields.
3. Add a project-level automation rule requiring all PRs to reference an issue number.

## Acceptance Criteria
- Taxonomy documented and applied in GitHub settings.
- Pull Request template mandates Issue linkage.
- All new issues in batch conform to the template.

## Verification Commands
- `gh label list` to verify taxonomy.
- Attempt to open a test PR without linking an issue (should be documented/enforced).

## Related PRs
None.

## Rollback Notes
- Remove new labels via GitHub CLI if conflict occurs.
- Revert template files to pre-existing state.
