---
title: hardening(governance): ratchet identity-boundary violations without blocking historical debt
lane: governance
kind: hardening
severity: medium
owner: governance-team
---

## Context
The identity boundary is critical for maintaining module independence and security. The current `.github/workflows/identity-boundary.yml` uses scripts in `scripts/identity/` to verify boundaries. We need to implement a "ratchet" mechanism where new violations are blocked, but existing historical debt is allowed to persist until explicitly resolved.

## Problem Statement
Total enforcement of identity boundaries is difficult due to significant pre-existing architectural debt. Currently, the verifier likely fails on any deviation, which hampers development of new features while the debt remains.

## Non-goals
- Forcing immediate cleanup of all legacy identity violations.

## Implementation Notes
- Modify `scripts/identity/verify-identity.ts` to support a baseline state (baseline JSON).
- The verifier should compare the current state against the baseline.
- If the current state has new violations (diff > 0), the workflow should fail.
- If the current state has fewer or equal violations compared to the baseline, the workflow passes.
- CI logs must clearly differentiate between "total violations" and "newly introduced violations" so developers know exactly what to fix.

## Acceptance Criteria
- Identity verifier script updated to support baseline-based comparison.
- Workflow successfully blocks new violations.
- Historical debt remains ignored but tracked in the output.
- Documentation created explaining how to update the baseline after intentional violations are removed.

## Verification Commands
- `bun run scripts/identity/verify-identity.ts --source-identity-baseline`
- Verify that a mock violation introduced into a core package fails the CI check.
- Verify that existing legacy violations do not trigger failure.

## Related PRs
- N/A

## Rollback Notes
- Revert changes to `scripts/identity/verify-identity.ts` and `.github/workflows/identity-boundary.yml` to return to total enforcement mode if necessary.
