Title: chore(web): reconcile Astro and Cloudflare adapter upgrades after v2 foundation
Lane: lane:web
Kind: kind:dependency
Severity: severity:low
Owner Type: team:web

## Context
Following the stabilization of the v2 design-system foundation (#23), we need to update Astro and Cloudflare adapter versions to support newer deployment features and performance improvements.

## Problem Statement
Outdated dependencies for Astro and Cloudflare adapters can cause deployment issues or prevent usage of new platform features. However, upgrading these before the foundation is stabilized introduces unnecessary risk of build collisions.

## Non-goals
- Major framework migration.
- Changing infrastructure provider.

## Implementation Notes
- This issue depends on the successful merge and verification of PR #23.
- Update `package.json` and adapter configurations in `packages/web`.
- Verify build compatibility with new adapter versions.

## Acceptance Criteria
- Dependencies updated to target versions.
- Web package builds and deploys successfully with new adapters.
- No regression in page load times or SSR performance.

## Verification Commands
- `npm run build` in `packages/web`
- Deploy preview to verify Cloudflare adapter integration.

## Related PRs
- #24 (Astro upgrade)
- #25 (Cloudflare adapter upgrade)

## Rollback Notes
- Revert `package.json` changes and restore previous lockfile state if build fails.
