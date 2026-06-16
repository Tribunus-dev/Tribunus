/**
 * HuggingFace Dataset Staging — commits a release candidate directly through
 * the Hub API so the tool owns the full staged transition.
 */

import { join } from "node:path"
import { readReleaseLedger, writeReleaseLedger } from "./ledger.ts"
import { commitFiles } from "./hf-client.ts"
import type { PublicationRecord } from "./types.ts"

export interface StageResult {
  repo_id: string
  branch: string
  commit_sha: string
  files_uploaded: number
  pr_url: string
  errors: string[]
}

export async function stageRelease(
  releaseDir: string,
  repoId: string,
  version: string,
): Promise<StageResult> {
  const branch = `release/v${version}`
  const result: StageResult = {
    repo_id: repoId,
    branch,
    commit_sha: "",
    files_uploaded: 0,
    pr_url: `https://huggingface.co/datasets/${repoId}/discussions/new?branch=${encodeURIComponent(branch)}`,
    errors: [],
  }

  // Count files
  let fileCount = 0
  async function countFiles(dir: string) {
    const { readdir } = await import("node:fs/promises")
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) await countFiles(join(dir, entry.name))
      else fileCount++
    }
  }
  await countFiles(releaseDir)
  if (fileCount === 0) {
    result.errors.push("No files found in release directory")
    return result
  }
  result.files_uploaded = fileCount

  const operations = await buildCommitOperations(releaseDir)
  if (operations.length === 0) {
    result.errors.push("No release files found to commit")
    return result
  }

  const commit = await commitFiles(repoId, operations, `Release ${version} — Tribunus MCP v0.6.0`, branch)
  result.commit_sha = commit.sha

  const current = await readReleaseLedger(releaseDir)
  if (current) {
    const next: PublicationRecord = {
      ...current,
      dataset_repo_id: repoId,
      target_revision: branch,
      pull_request_number: current.pull_request_number,
      remote_commit_sha: result.commit_sha || current.remote_commit_sha,
      publication_state: "staged",
      invocation_id: current.invocation_id,
    }
    await writeReleaseLedger(releaseDir, next)
  }

  return result
}

async function buildCommitOperations(releaseDir: string): Promise<Array<{ op: string; path: string; content: string }>> {
  const { readdir, readFile } = await import("node:fs/promises")
  const operations: Array<{ op: string; path: string; content: string }> = []

  async function walk(dir: string, prefix = ""): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath, relativePath)
        continue
      }
      operations.push({
        op: "add",
        path: relativePath,
        content: await readFile(fullPath, "utf8"),
      })
    }
  }

  await walk(releaseDir)
  return operations
}
