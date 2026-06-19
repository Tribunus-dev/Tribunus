#!/usr/bin/env bun

import { readFile } from "node:fs/promises"

const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"))

const [adr21, adr22] = await Promise.all([
  readJson("docs/json/adrs/0021-iosurface-single-island-runtime-memory-foundation.v1.json"),
  readJson("docs/json/adrs/0022-runtime-truth-spine.v1.json"),
])

const requiredImports = ["ACR-0001", "ACR-0002", "ACR-0003", "ACR-0004", "ACR-0005"]

const hasImports = (adr: any) => requiredImports.every((id) => adr.component_imports?.includes(id))

if (!hasImports(adr21) || !hasImports(adr22)) {
  console.error("adr component import validation failed")
  process.exit(1)
}

console.log("adr component import validation passed")
