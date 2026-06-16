import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { readReleaseLedger, writeReleaseLedger } from "./ledger.ts"
import type { PublicationRecord } from "./types.ts"

export async function promoteRelease(repoId: string, version: string, prNumber: number, invocationId: string): Promise<PublicationRecord | null> {
  const releaseDir = resolve(process.cwd(), "releases", `release-${version}`)
  const manifestPath = join(releaseDir, "releases", "manifest.json")
  const ledger = await readReleaseLedger(releaseDir)
  if (!ledger || !existsSync(manifestPath)) return null
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { publisher_version?: string; source_commit?: string }
  const next: PublicationRecord = {
    ...ledger,
    dataset_repo_id: repoId,
    publication_state: "published",
    pull_request_number: prNumber,
    published_at: new Date().toISOString(),
    invocation_id: ledger.invocation_id || invocationId,
    publisher_tool_version: manifest.publisher_version || ledger.publisher_tool_version,
    source_commit: manifest.source_commit || ledger.source_commit,
  }
  await writeReleaseLedger(releaseDir, next)
  return next
}

export async function rollbackRelease(repoId: string, version: string, prNumber: number, invocationId: string): Promise<PublicationRecord | null> {
  const releaseDir = resolve(process.cwd(), "releases", `release-${version}`)
  const ledger = await readReleaseLedger(releaseDir)
  if (!ledger) return null
  const next: PublicationRecord = {
    ...ledger,
    dataset_repo_id: repoId,
    publication_state: "retracted",
    pull_request_number: prNumber,
    invocation_id: ledger.invocation_id || invocationId,
  }
  await writeReleaseLedger(releaseDir, next)
  return next
}
