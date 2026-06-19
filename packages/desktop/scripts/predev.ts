import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

// Force fresh build output before electron-vite runs
await $`rm -rf out/main out/renderer out/migration-pg`.quiet()
await $`cp -r ../runtime/migration-pg out/migration-pg`.quiet()
