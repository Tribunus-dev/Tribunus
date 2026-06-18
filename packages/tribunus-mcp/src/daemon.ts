import { createServer, startServer } from "./server/server.js"
import { initPathPolicy } from "./governance/paths.js"
import { join, resolve } from "node:path"
import { homedir } from "node:os"
import { registerAllTools } from "./register-all.js"

const repoRoot = process.env.TRIBUNUS_REPO_ROOT || process.cwd()
const MLX_MODEL_DIR = process.env.TRIBUNUS_MLX_MODEL_DIR || join(homedir(), ".cache/tribunus/models")

const server = createServer()

initPathPolicy(
  repoRoot,
  process.env.TRIBUNUS_EVIDENCE_DIR || join(repoRoot, ".tribunus/evidence"),
  MLX_MODEL_DIR,
  process.env.TRIBUNUS_OMP_EVIDENCE_DIR || join(repoRoot, ".tribunus/omp/evidence"),
)

registerAllTools()

// Standalone tool defaults to startServer (STDIO transport)
await startServer(server)
