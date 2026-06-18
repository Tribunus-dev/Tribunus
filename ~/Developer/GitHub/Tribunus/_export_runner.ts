import { buildCodeReviewExport } from "./.omp/tools/_lib/review-export/bootstrap-builder.js";
import buildGeminiIRArchive from "./.omp/tools/_lib/review-export/gemini-ir-builder.js";
import { formatBytes } from "./.omp/tools/_lib/review-export/fs-utils.js";

const w = process.cwd();
const profiles = [
  { profile: "bootstrap_review", builder: "bootstrap" },
  { profile: "gemini_ir", builder: "ir" },
  { profile: "gemini_code_review", builder: "bootstrap" },
] as const;

for (const { profile, builder } of profiles) {
  const start = performance.now();
  process.stderr.write(`\n=== Exporting ${profile} ===\n`);
  
  if (builder === "ir") {
    const result = await buildGeminiIRArchive({
      repoRoot: w,
      packetRoot: "tribunus-gemini-ir",
      zipPath: `${w}/tribunus-gemini-ir.zip`,
      now: new Date().toISOString(),
      includeUntracked: false,
    });
    const elapsed = Math.round(performance.now() - start);
    console.log(JSON.stringify({
      profile,
      zipPath: `${w}/tribunus-gemini-ir.zip`,
      zipSize: result.zipSize,
      zipSizeFormatted: formatBytes(result.zipSize),
      zipSha256: result.zipSha256,
      fileCount: result.includedFiles?.length ?? 0,
      warningsCount: result.warnings?.length ?? 0,
      elapsedMs: elapsed,
    }));
  } else {
    const result = buildCodeReviewExport({
      repoRoot: w,
      profile: profile as "bootstrap_review" | "gemini_code_review",
      includeUntracked: false,
      onProgress: (event: any) => {
        process.stderr.write(`  [${event.stage}:${event.status}] ${event.message ?? ""}\n`);
      },
    });
    const elapsed = Math.round(performance.now() - start);
    console.log(JSON.stringify({
      profile,
      zipPath: result.zipPath,
      zipSize: result.zipSize,
      zipSizeFormatted: formatBytes(result.zipSize),
      zipSha256: result.zipSha256,
      fileCount: result.includedFiles.length,
      warningsCount: result.warnings.length,
      adrsJson: result.adrsJson?.length ?? 0,
      adrsMarkdown: result.adrsMarkdown?.length ?? 0,
      campaigns: result.campaigns?.length ?? 0,
      missions: result.missions?.length ?? 0,
      lanes: result.lanes?.length ?? 0,
      tasks: result.tasks?.length ?? 0,
      research: result.research?.length ?? 0,
      memoryLinks: result.memoryLinks?.length ?? 0,
      exclusionEntries: result.exclusionEntries?.length ?? 0,
      oversizedFiles: result.oversizedFiles?.length ?? 0,
      elapsedMs: elapsed,
    }));
  }
}
