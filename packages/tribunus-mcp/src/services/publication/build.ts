import { mkdir, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import * as crypto from "node:crypto"
import { getStore } from "../../governance/store.ts"
import type { DatasetReleaseManifest, PublicationRecord } from "./types.ts"
import { writeReleaseLedger } from "./ledger.ts"

export async function buildRelease(outputDir: string, version: string): Promise<{ manifest: DatasetReleaseManifest }> {
  const db = await getStore()
  const releaseDir = resolve(outputDir, `release-${version}`)

  const dirs = [
    "data/runs", "data/operations", "data/comparisons", "data/artifacts",
    "data/events", "data/machine-profiles",
    "schema", "releases", "supplemental/review-packets",
    "supplemental/source-graphs", "supplemental/semantic-packets",
  ]
  for (const dir of dirs) await mkdir(join(releaseDir, dir), { recursive: true })

  // Pull finalized artifacts — gracefully handle empty store
  let artifactIndex: Array<Record<string, unknown>> = []
  try {
    const artifacts = await db.query(
      "SELECT * FROM artifacts_v2 WHERE state IN ('finalized','verified') AND artifact_type LIKE 'review%' ORDER BY created_at",
    )
    artifactIndex = artifacts.rows.map(r => ({
      artifact_id: r.artifact_id,
      artifact_type: r.artifact_type,
      content_digest: r.content_digest,
      byte_count: r.byte_count,
      canonical_path: r.canonical_path,
      producer_tool: r.producer_tool,
      invocation_id: r.invocation_id,
      created_at: r.created_at,
      verification_status: r.verification_status,
    }))
  } catch {
    // Store not initialized yet — empty release is valid
  }

  const indexContent = JSON.stringify(artifactIndex.map(r => JSON.stringify(r)).join("\n"))
  await writeFile(join(releaseDir, "data/artifacts/artifact-index.jsonl"), indexContent)

  const manifest: DatasetReleaseManifest = {
    release_version: version,
    release_id: `release-${version}-${Date.now()}`,
    local_release_artifact_id: "",
    local_release_digest: "",
    dataset_repo_id: process.env.HF_DATASET_REPO || "Tribunus-dev/compute-kernel-evidence",
    created_at: new Date().toISOString(),
    files: [{ path: "data/artifacts/artifact-index.jsonl", digest: crypto.createHash("sha256").update(indexContent).digest("hex"), size_bytes: Buffer.byteLength(indexContent) }],
    artifact_count: artifactIndex.length,
    run_count: 0,
    operation_count: 0,
    tables: ["artifacts/artifact-index"],
    evidence_grades: ["exploratory"],
    source_commit: "",
    publisher_version: "0.6.0",
  }

  await writeFile(join(releaseDir, "releases", "manifest.json"), JSON.stringify(manifest, null, 2))
  await writeReleaseLedger(releaseDir, {
    publication_id: `publication-${version}-${Date.now()}`,
    local_release_artifact_id: "",
    local_release_digest: "",
    dataset_repo_id: manifest.dataset_repo_id,
    repo_type: "dataset",
    target_revision: null,
    pull_request_number: null,
    remote_commit_sha: null,
    remote_tree_digest: null,
    release_version: version,
    publication_state: "built",
    publisher_tool_version: manifest.publisher_version,
    invocation_id: null,
    source_commit: "",
    dataset_card_digest: null,
    schema_digest: null,
    manifest_digest: null,
    remote_verification_receipt_id: null,
    published_at: null,
    created_at: new Date().toISOString(),
  } satisfies PublicationRecord)

  const readme = `---
license: mit
task_categories:
  - text-generation
  - benchmark
tags:
  - apple-silicon
  - mlx
  - inference
  - gemma
---

# Tribunus Apple Silicon Inference Research Dataset

Peer-review dataset for the Tribunus compute kernel decode-attribution and backend-comparison research.

## Release

Version: ${version}
Artifacts: ${artifactIndex.length}
`
  await writeFile(join(releaseDir, "README.md"), readme)

  return { manifest }
}
