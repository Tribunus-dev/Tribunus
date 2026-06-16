import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { verifySemanticArtifactsByteIdentical } from "../src/services/code-intelligence/snapshot.js";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

describe("Semantic Artifacts Byte Identical Verification", () => {
  let tempDir: string;
  let semanticZipPath: string;
  let sourceZipPath: string;
  let mismatchSemanticZipPath: string;

  const semanticEntries = [
    "01_manifest.json",
    "02_file_index.json",
    "03_module_graph.json",
    "04_symbol_index.json",
    "05_type_api_surface.json",
    "06_tool_kernel_ir.json",
    "07_pglite_duckdb_ir.json",
    "08_tests_and_ci_ir.json",
    "09_architecture_context.json",
    "10_review_findings.json",
  ];

  beforeAll(() => {
    tempDir = join(tmpdir(), "tribunus-snapshot-test-" + Date.now());
    mkdirSync(tempDir, { recursive: true });

    semanticZipPath = join(tempDir, "semantic.zip");
    sourceZipPath = join(tempDir, "source.zip");
    mismatchSemanticZipPath = join(tempDir, "semantic_mismatch.zip");

    const semanticDir = join(tempDir, "semantic-review");
    const sourceDir = join(tempDir, "source-review");

    mkdirSync(semanticDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });

    // Create the files with matching contents
    for (const entry of semanticEntries) {
      const content = `{"data": "${entry}"}`;

      // For semantic packet, files are at tribunus-source-review/<entry>
      const semPathDir = join(semanticDir, "tribunus-source-review");
      mkdirSync(semPathDir, { recursive: true });
      writeFileSync(join(semPathDir, entry), content);

      // For source packet, files are at tribunus-source-review/semantic-review/<entry>
      const srcPathDir = join(sourceDir, "tribunus-source-review/semantic-review");
      mkdirSync(srcPathDir, { recursive: true });
      writeFileSync(join(srcPathDir, entry), content);
    }

    // Zip matching semantic and source
    spawnSync("zip", ["-r", semanticZipPath, "tribunus-source-review"], { cwd: semanticDir });
    spawnSync("zip", ["-r", sourceZipPath, "tribunus-source-review"], { cwd: sourceDir });

    // Create mismatching semantic packet
    const mismatchDir = join(tempDir, "mismatch-review");
    mkdirSync(mismatchDir, { recursive: true });
    for (const entry of semanticEntries) {
      const semPathDir = join(mismatchDir, "tribunus-source-review");
      mkdirSync(semPathDir, { recursive: true });

      // Introduce a mismatch on the first entry
      if (entry === "01_manifest.json") {
        writeFileSync(join(semPathDir, entry), `{"data": "mismatch"}`);
      } else {
        writeFileSync(join(semPathDir, entry), `{"data": "${entry}"}`);
      }
    }
    spawnSync("zip", ["-r", mismatchSemanticZipPath, "tribunus-source-review"], { cwd: mismatchDir });
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("succeeds when byte-identical", () => {
    expect(() => verifySemanticArtifactsByteIdentical(semanticZipPath, sourceZipPath)).not.toThrow();
  });

  test("fails with mismatch error when bytes differ", () => {
    expect(() => verifySemanticArtifactsByteIdentical(mismatchSemanticZipPath, sourceZipPath))
      .toThrow("Semantic artifact mismatch for 01_manifest.json");
  });
});
