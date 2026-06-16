Title: feat(web): stabilize v2 design-system foundation and navigation structure
Lane: lane:web
Kind: kind:feature
Severity: severity:high
Owner Type: team:web

## Context
The Tribunus web project is transitioning to a v2 design system foundation, which is critical for consistent UI/UX across documentation and platform tools. This transition involves aligning navigation structures, design tokens, and layout patterns as outlined in the tribunus.dev direction.

## Problem Statement
The current web foundation is fragmented, making it difficult to maintain consistent navigation and design patterns across documentation and the upcoming v2 platform interfaces. We need to stabilize the core design system and navigation schema.

## Non-goals
- Full migration of legacy content.
- Refactoring of backend API consumers.
- Introduction of new documentation content.

## Implementation Notes
- Align navigation structures (`[...slug].md.ts`) with the new design-system tokens in `packages/web/styles/custom.css`.
- Ensure parity between current docs structure and v2 navigation hierarchy.
- Coordinate with `packages/app` for consistent cross-app look-and-feel.

## Acceptance Criteria
- Web package builds successfully (`npm run build`).
- Navigation functions as expected (home, wiki, blog, docs).
- No broken internal links in documentation.
- GitHub Pages deployment remains intact.

## Verification Commands
- `npm run build` in `packages/web`
- Navigate locally to verify routing and link health.
- Run `npm run test:e2e` (if applicable) to ensure navigation stability.

## Related PRs
- #23

## Rollback Notes
- Revert commit `feat(web): stabilize v2 design-system foundation` and restore previous `astro.config.mjs` and `styles/` state.
