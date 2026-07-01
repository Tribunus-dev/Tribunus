// Prism Engine napi bindings
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const t = (() => {
  const a = process.arch, p = process.platform
  if (p === 'darwin' && a === 'arm64') return 'darwin-arm64'
  if (p === 'darwin' && a === 'x64') return 'darwin-x64'
  if (p === 'linux' && a === 'arm64') return 'linux-arm64'
  if (p === 'linux' && a === 'x64') return 'linux-x64'
  return null
})()

if (!t) throw new Error(`unsupported: ${process.platform} ${process.arch}`)

const ps = [
  join(__dirname, `prism-engine.${t}.node`),
  join(__dirname, `tribunus-compute-native.${t}.node`),
]

let mod = null
for (const p of ps) { if (existsSync(p)) { mod = require(p); break } }
if (!mod) throw new Error(`No addon found (tried ${ps.join(', ')})`)

export default mod
export const {
  PrismInferenceServer,
  ComputeEngine,
  engineGenerate,
  engineCancelGeneration,
  engineInstallModel,
  nativeCapabilityReport,
  generationChannel,
  GenerationSender,
  GenerationStream,
  compileImage,
  readCompiledImage,
  verifyCompiledImage,
  inspectSafetensors,
  loadSafetensors,
  detectDefaultDevice,
  mlxActiveMemory,
  mlxClearCache,
  gemmaForward,
  gemma412BConfig,
  gemmaSampleGreedy,
  runFullModelFromImage,
  validateEventSequence,
} = mod
