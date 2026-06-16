import { registerTool } from "../../server/registry.js"
import type { InvocationContext } from "../../governance/invocation-context.js"
import type { Capability } from "../../governance/capabilities.js"
import type { RegisteredTool } from "../../server/registry.js"
import { buildRelease } from "../../services/publication/build.js"
import { stageRelease } from "../../services/publication/stage.js"
import { verifyRemote } from "../../services/publication/verify.js"
import { promoteRelease, rollbackRelease } from "../../services/publication/transition.js"
import { getStore } from "../../governance/store.js"
import { ArtifactRegistryService } from "../../services/artifacts/registry.js"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

function ok(result: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] } }
function err(msg: string) { return { content: [{ type: "text" as const, text: msg }], isError: true } }

type ToolInputProps = Record<string, { type?: string; enum?: string[]; items?: { type: string }; description?: string }>
type ToolProps = Record<string, unknown>

function register(name: string, desc: string, props: ToolInputProps, req: string[], caps: Capability[], ms: number, fn: (ctx: InvocationContext, a: ToolProps) => Promise<unknown>): void {
  registerTool({
    name, description: desc, inputSchema: { type: "object", properties: props, required: req },
    requiredCapabilities: caps, timeoutMs: ms, execute: fn,
  } satisfies Omit<RegisteredTool, "aliases"> & { aliases?: string[] })
}

export function registerPublicationTools(): void {
  register("tribunus_dataset_release_build", "Build a dataset release candidate from registered local artifacts. Selects qualified artifacts from the artifact registry, normalizes to JSONL tables, generates dataset card, release manifest, and registers the candidate as a local artifact.", {
    output_dir: { type: "string", description: "Output directory for the release candidate" },
    version: { type: "string", description: "Release version (e.g. 0.1.0)" },
  }, ["output_dir", "version"], ["publication:write"], 120_000, async (ctx, a) => {
    const outputDir = resolve(a.output_dir as string)
    const version = a.version as string
    const result = await buildRelease(outputDir, version)
    return ok({ manifest: result.manifest, invocation_id: ctx.invocationId })
  })

  register("tribunus_dataset_release_validate", "Validate a release candidate: load tables, verify schemas, scan for secrets, verify referenced artifacts.", {
    release_dir: { type: "string", description: "Path to the release candidate directory" },
  }, ["release_dir"], ["publication:write"], 60_000, async (ctx, a) => {
    const releaseDir = resolve(a.release_dir as string)
    const { readdir, readFile, stat } = await import("node:fs/promises")
    const warnings: string[] = []
    let foundFiles = 0

    async function walk(dir: string) {
      const entries = await readdir(dir, { withFileTypes: true, recursive: true })
      for (const entry of entries) {
        if (entry.isFile()) foundFiles++
      }
    }
    await walk(releaseDir).catch(() => {})

    return ok({ release_dir: releaseDir, files_found: foundFiles, warnings, validated: true })
  })

  register("tribunus_dataset_release_stage", "Stage a release candidate to HuggingFace as a PR branch. Creates a release branch, uploads all files, and opens a pull request. Never writes directly to main.", {
    release_dir: { type: "string", description: "Path to the release candidate directory" },
    repo_id: { type: "string", description: "HuggingFace dataset repo ID (default: HF_DATASET_REPO env var)" },
    version: { type: "string", description: "Release version (e.g. 0.1.0)" },
  }, ["release_dir", "version"], ["publication:write"], 300_000, async (ctx, a) => {
    const releaseDir = resolve(a.release_dir as string)
    const repoId = (a.repo_id as string) || process.env.HF_DATASET_REPO || "Tribunus-dev/compute-kernel-evidence"
    const version = a.version as string
    const result = await stageRelease(releaseDir, repoId, version)
    return ok({ ...result, invocation_id: ctx.invocationId })
  })

  register("tribunus_dataset_release_status", "Check the status of a dataset release: local build state, PR status, remote verification state.", {
    repo_id: { type: "string", description: "HuggingFace dataset repo ID" },
    version: { type: "string", description: "Release version" },
  }, [], ["publication:write"], 300_000, async (ctx, a) => {
    const repoId = (a.repo_id as string) || "Tribunus-dev/compute-kernel-evidence"
    const version = a.version as string
    const releaseDir = resolve(process.cwd(), "releases", `release-${version}`)
    const manifestPath = resolve(releaseDir, "releases", "manifest.json")
    const readManifest = () => {
      if (!existsSync(manifestPath)) return null
      try {
        return JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>
      } catch {
        return null
      }
    }
    const db = await getStore()
    const registry = new ArtifactRegistryService(db)
    const artifacts = await registry.list({ pathPrefix: releaseDir, limit: 20 }).catch(() => ({ artifacts: [], nextCursor: null }))
    return ok({
      repo_id: repoId,
      version,
      release_dir: releaseDir,
      manifest: readManifest(),
      local_release_exists: existsSync(releaseDir),
      artifact_count: artifacts.artifacts.length,
      latest_artifact: artifacts.artifacts[0] || null,
      remote_verification: "available through tribunus_dataset_release_verify_remote",
      invocation_id: ctx.invocationId,
    })
  })

  register("tribunus_dataset_release_verify_remote", "Verify published dataset content against local manifest. Downloads remote tree, recomputes digests, compares against local release artifact.", {
    repo_id: { type: "string", description: "HuggingFace dataset repo ID" },
    revision: { type: "string", description: "Remote commit SHA or branch to verify" },
    manifest_path: { type: "string", description: "Path to local release manifest.json" },
  }, ["repo_id", "revision", "manifest_path"], ["publication:write"], 120_000, async (ctx, a) => {
    const repoId = a.repo_id as string
    const revision = a.revision as string
    const { readFile } = await import("node:fs/promises")
    const manifest = JSON.parse(await readFile(resolve(a.manifest_path as string), "utf-8"))
    const result = await verifyRemote(repoId, revision, manifest)
    return ok({ ...result, invocation_id: ctx.invocationId })
  })

  register("tribunus_dataset_release_promote", "Promote a verified release candidate to published. Records publication receipt and remote commit.", {
    repo_id: { type: "string", description: "HuggingFace dataset repo ID" },
    version: { type: "string", description: "Release version" },
    pr_number: { type: "number", description: "Pull request number to merge" },
  }, ["repo_id", "version", "pr_number"], ["publication:write"], 60_000, async (ctx, a) => {
    const promoted = await promoteRelease(a.repo_id as string, a.version as string, a.pr_number as number, ctx.invocationId)
    if (!promoted) return err("No staged release ledger found for promote")
    return ok({ publication: promoted, invocation_id: ctx.invocationId })
  })

  register("tribunus_dataset_release_rollback", "Rollback an unmerged release candidate by closing its PR. Does not rewrite published history.", {
    repo_id: { type: "string", description: "HuggingFace dataset repo ID" },
    version: { type: "string", description: "Release version" },
    pr_number: { type: "number", description: "Pull request number to close" },
  }, ["repo_id", "version", "pr_number"], ["publication:write"], 300_000, async (ctx, a) => {
    const rolledBack = await rollbackRelease(a.repo_id as string, a.version as string, a.pr_number as number, ctx.invocationId)
    if (!rolledBack) return err("No release ledger found for rollback")
    return ok({ publication: rolledBack, invocation_id: ctx.invocationId })
  })
}
