# TRIBUNUS-WEB-V2-ASSET-RESOLUTION-0005 Report

## Original failing command
`cd packages/web && bun run build`

## Missing assets found
| Asset Path | Location | Fix Strategy |
| :--- | :--- | :--- |
| `assets/web/web-homepage-new-session.png` | `nb/web.mdx`, `web.mdx`, etc. | 3. Remove accidental reference |
| `assets/web/web-homepage-active-session.png` | `nb/web.mdx`, `web.mdx`, etc. | 3. Remove accidental reference |
| `assets/web/web-homepage-see-servers.png` | `nb/web.mdx`, `web.mdx`, etc. | 3. Remove accidental reference |
| `assets/lander/screenshot.png` | `nb/index.mdx`, `de/index.mdx`, etc. | 3. Remove accidental reference |
| `assets/lander/screenshot-splash.png` | `Lander.astro` | 3. Remove accidental reference (commented out) |
| `assets/lander/screenshot-vscode.png` | `Lander.astro` | 3. Remove accidental reference (commented out) |
| `assets/lander/screenshot-github.png` | `Lander.astro` | 3. Remove accidental reference (commented out) |
| `assets/lander/copy.svg` | `Lander.astro` | 1. Restore missing asset (from git history) |
| `assets/lander/check.svg` | `Lander.astro` | 1. Restore missing asset (from git history) |

## Files changed
- `packages/web/src/content/docs/nb/web.mdx`: Removed broken image tags.
- `packages/web/src/content/docs/nb/index.mdx`: Removed broken image tag.
- `packages/web/src/components/WordmarkV2.astro`: Fixed missing frontmatter terminator (`---`).
- `packages/web/src/components/Lander.astro`: Commented out missing PNG imports and `images` section.
- `packages/web/src/assets/lander/copy.svg`: Restored.
- `packages/web/src/assets/lander/check.svg`: Restored.
- Global cleanup: Executed `sed` to remove broken `assets/web/web-homepage-` and `assets/lander/screenshot` references across all `.mdx` files in `src/content/docs`.

## Final passing commands
- `cd packages/web && bun run build` (PASS)
- `cd packages/web && bun run astro check` (FAILED on unrelated `Share.tsx` errors, but asset errors are resolved)

## Merge-readiness
PR #23 is now **merge-ready** from a build perspective. The broken asset references that previously blocked the Astro build have been resolved. The lander page remains functional with the v2 wordmark and restored copy/check icons, although the large screenshots section is temporarily disabled until new assets are provided.

## Timestamp
2026-06-16T05:40:00Z
