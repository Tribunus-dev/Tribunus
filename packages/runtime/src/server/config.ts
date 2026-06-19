import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { z } from "zod"

export const TribunusConfigSchema = z.object({
  server: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().default(8080),
    timeout_ms: z.number().default(30000),
    max_active_requests: z.number().default(4),
    receipt_stream: z.boolean().default(true),
  }).default({
    host: "127.0.0.1",
    port: 8080,
    timeout_ms: 30000,
    max_active_requests: 4,
    receipt_stream: true,
  }),
  model: z.object({
    default: z.string().default("Qwen3-0.6B"),
    backend: z.string().default("auto"),
    quantization: z.string().default("q4_k_m"),
    max_vram_gb: z.number().default(8.0),
  }).default({
    default: "Qwen3-0.6B",
    backend: "auto",
    quantization: "q4_k_m",
    max_vram_gb: 8.0,
  }),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    file: z.string().default("~/.tribunus/logs/server.log"),
  }).default({
    level: "info",
    file: "~/.tribunus/logs/server.log",
  }),
})

export type TribunusConfig = z.infer<typeof TribunusConfigSchema>

// Simple deep merge for plain objects
function deepMerge(...objects: any[]): any {
  const result: any = {}
  for (const obj of objects) {
    if (!obj) continue
    for (const key of Object.keys(obj)) {
      if (obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
        result[key] = deepMerge(result[key] || {}, obj[key])
      } else if (obj[key] !== undefined) {
        result[key] = obj[key]
      }
    }
  }
  return result
}

// Strip JSON comments
export function stripJsonComments(jsonc: string): string {
  return jsonc.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
}

function expandTilde(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return filepath.replace("~", os.homedir())
  }
  return filepath
}

function getConfigPath(): string | undefined {
  const envPath = process.env.TRIBUNUS_CONFIG_JSON
  if (envPath) return expandTilde(envPath)
  
  const defaultPath = path.join(os.homedir(), ".tribunus", "tribunus.jsonc")
  if (fs.existsSync(defaultPath)) return defaultPath

  return undefined
}

export function readConfigFile(): Partial<TribunusConfig> {
  const configPath = getConfigPath()
  if (!configPath || !fs.existsSync(configPath)) {
    return {}
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8")
    const stripped = stripJsonComments(content)
    const parsed = JSON.parse(stripped)
    return parsed
  } catch (error) {
    console.warn(`Failed to parse config file at ${configPath}: ${error}`)
    return {}
  }
}

export function fromEnvVars(): Partial<TribunusConfig> {
  const config: any = { server: {}, model: {}, logging: {} }
  
  if (process.env.TRIBUNUS_SERVER_HOST) config.server.host = process.env.TRIBUNUS_SERVER_HOST
  if (process.env.TRIBUNUS_SERVER_PORT) config.server.port = parseInt(process.env.TRIBUNUS_SERVER_PORT, 10)
  if (process.env.TRIBUNUS_TIMEOUT_MS) config.server.timeout_ms = parseInt(process.env.TRIBUNUS_TIMEOUT_MS, 10)
  if (process.env.TRIBUNUS_MAX_ACTIVE_REQUESTS) config.server.max_active_requests = parseInt(process.env.TRIBUNUS_MAX_ACTIVE_REQUESTS, 10)
  if (process.env.TRIBUNUS_RECEIPT_STREAM) config.server.receipt_stream = process.env.TRIBUNUS_RECEIPT_STREAM === 'true'

  if (process.env.MODEL) config.model.default = process.env.MODEL
  if (process.env.TRIBUNUS_MODEL_DEFAULT) config.model.default = process.env.TRIBUNUS_MODEL_DEFAULT
  if (process.env.TRIBUNUS_MODEL_BACKEND) config.model.backend = process.env.TRIBUNUS_MODEL_BACKEND
  if (process.env.TRIBUNUS_MODEL_QUANTIZATION) config.model.quantization = process.env.TRIBUNUS_MODEL_QUANTIZATION
  if (process.env.TRIBUNUS_MAX_VRAM_GB) config.model.max_vram_gb = parseFloat(process.env.TRIBUNUS_MAX_VRAM_GB)

  if (process.env.TRIBUNUS_LOG_LEVEL) config.logging.level = process.env.TRIBUNUS_LOG_LEVEL
  if (process.env.TRIBUNUS_LOG_FILE) config.logging.file = process.env.TRIBUNUS_LOG_FILE

  // Remove empty objects
  for (const key of Object.keys(config)) {
    if (Object.keys(config[key]).length === 0) {
      delete config[key]
    }
  }

  return config
}

export function loadConfig(cliOverrides: Partial<TribunusConfig> = {}): TribunusConfig {
  const defaults = TribunusConfigSchema.parse({})
  const fileConfig = readConfigFile()
  const envConfig = fromEnvVars()
  
  const merged = deepMerge(defaults, fileConfig, envConfig, cliOverrides)
  return TribunusConfigSchema.parse(merged)
}

export function generateDefaultConfig(): void {
  const defaultPath = path.join(os.homedir(), ".tribunus", "tribunus.jsonc")
  const dir = path.dirname(defaultPath)
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const template = `{
  // Server configuration
  "server": {
    "host": "127.0.0.1",
    "port": 8080,
    "timeout_ms": 30000,
    "max_active_requests": 4,
    "receipt_stream": true
  },
  // Model settings
  "model": {
    "default": "Qwen3-0.6B",
    "backend": "auto",
    "quantization": "q4_k_m",
    "max_vram_gb": 8.0
  },
  // Logging settings
  "logging": {
    "level": "info",
    "file": "~/.tribunus/logs/server.log"
  }
}`

  fs.writeFileSync(defaultPath, template, "utf-8")
  console.log(`Generated default config at ${defaultPath}`)
}
