#!/usr/bin/env bun
import { $ } from "bun"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`



await $`rm -rf out`
await $`mkdir -p out/main/chunks/postgres.data`
await $`cp -r ../runtime/migration-pg out/migration-pg`



