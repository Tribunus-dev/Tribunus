---
title: TRIBUNUS-CROSS-REPO-ISSUE-COMMAND-CENTER-0001
lane: lane:repo-hygiene
kind: kind:hardening
severity: severity:blocker
status: status:ready-for-agent
agent: agent:human-decision
---

## Context
Central coordination for the Tribunus project, establishing the priority hierarchy for mission delivery.

## Problem Statement
Scattered development activity without clear priority alignment prevents efficient cross-repo integration and issue-linked agent orchestration.

## Priority Order
1. **Compute Core**: Stability and compilation.
2. **Web Foundation**: v2 design-system and navigation.
3. **Web Dependencies**: Astro/Cloudflare updates.
4. **CI/CodeQL**: Security workflow classification.
5. **Hardening**: Runtime coordination and identity boundaries.
6. **New Features**: All other project-level work.

## Active Repos/PRs
- PR #22: Compute-core compilation fixes.
- PR #23: Web v2 foundation.
- PR #24: Cloudflare adapter update.
- PR #25: Astro core update.

## Daily Rules
- Every PR MUST link to an issue in the issue control batch.
- Every commit MUST target a specific lane.
- Emergency fixes MUST be communicated via IRC to the relevant Lane Lead.

## Acceptance Criteria
- Priority order is recognized by all active agents.
- All high-impact work aligns with the lane hierarchy.

## Related PRs
- #22
- #23
- #24
- #25

## Rollback Notes
- Revert command center updates to the last known stable state in the main branch.
