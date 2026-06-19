import { registerGitHubTools } from "./domains/github/index.js"
import { registerComputeTools } from "./domains/compute/index.js"
import { registerEvidenceTools } from "./domains/evidence/index.js"
import { registerHardwareTools } from "./domains/hardware/index.js"
import { registerOmpControlPlaneTools } from "./domains/omp/control-plane.js"
import { registerOmpRepoIntelTools } from "./domains/omp/repo-intelligence.js"
import { registerCrossCuttingTools } from "./tools/index.js"
import { registerArtifactTools } from "./domains/artifacts/index.js"
import { registerPublicationTools } from "./domains/publication/index.js"

export function registerAllTools(): void {
  registerGitHubTools()
  registerComputeTools()
  registerEvidenceTools()
  registerHardwareTools()
  registerOmpControlPlaneTools()
  registerOmpRepoIntelTools()
  registerCrossCuttingTools()
  registerArtifactTools()
  registerPublicationTools()
}
