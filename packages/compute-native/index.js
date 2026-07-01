// Prism Engine napi bindings
// Loads the platform-specific native addon.

const { existsSync } = require('node:fs')
const { join } = require('node:path')

function getPlatformTriple() {
  const arch = process.arch
  const platform = process.platform
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  return null
}

const triple = getPlatformTriple()
if (!triple) {
  throw new Error(
    `Unsupported platform: ${process.platform} ${process.arch}. ` +
    'Prism Engine currently supports: darwin-arm64, darwin-x64, linux-arm64, linux-x64'
  )
}

const addonPath = join(__dirname, `prism-engine.${triple}.node`)

if (!existsSync(addonPath)) {
  throw new Error(
    `Prism Engine native addon not found at ${addonPath}. ` +
    'Build it with: cargo build -p prism-napi --release && cp target/release/libprism_napi.dylib packages/compute-native/prism-engine.darwin-arm64.node'
  )
}

const native = require(addonPath)
module.exports = native
