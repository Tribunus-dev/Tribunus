---
title: chore(ci): classify and control CodeQL/security workflow scope
lane: ci
kind: hardening
severity: medium
owner: ci-team
---

## Context
The current `.github/workflows/codeql.yml` runs on every push and pull request, covering `actions`, `c-cpp`, `javascript-typescript`, `python`, and `rust`. We need to formalize whether this CodeQL configuration is repo-local, org-inherited, or GitHub security-default to better manage false positives and build times.

## Problem Statement
CodeQL analysis is currently broad, scanning multiple languages that may have varying levels of security scrutiny required. Non-product or test-heavy code might be triggering unnecessary failures, and we need a clear policy on whether these failures block merging or merely report to the security dashboard.

## Non-goals
- Changing the underlying CodeQL engine or analysis rules.
- Removing languages from scanning without a clear security impact assessment.

## Implementation Notes
- Audit `.github/workflows/codeql.yml` and define a merge policy for non-product-code CodeQL alerts.
- Determine if we can refine the `on` triggers to avoid redundant analysis on minor changes.
- Ensure the workflow correctly identifies product vs. non-product code.

## Acceptance Criteria
- Policy defined for CodeQL failures in non-product code.
- Workflow configuration updated to reflect clear ownership and scope.
- Documentation added to the repo regarding security analysis coverage.

## Verification Commands
- `gh workflow run codeql.yml`
- Inspect `gh run list --workflow=codeql.yml` to verify triggering behavior.
- Check security dashboard in GitHub for CodeQL alert distribution.

## Related PRs
- N/A

## Rollback Notes
- Revert changes to `.github/workflows/codeql.yml` if analysis breaks or becomes unavailable.
