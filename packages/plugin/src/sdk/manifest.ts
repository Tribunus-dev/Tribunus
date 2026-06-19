import { z } from "zod"

export const PluginManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  tools: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  permissions: z.object({
    filesystem: z.array(z.string()).optional(),
    network: z.array(z.string()).optional(),
    env: z.array(z.string()).optional(),
    subprocess: z.boolean().optional(),
  }).optional(),
})

export type PluginManifest = z.infer<typeof PluginManifestSchema>

export const PackageJsonSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  "tribunus.plugin": PluginManifestSchema,
})

export type PackageJsonWithPlugin = z.infer<typeof PackageJsonSchema>

export function validateManifest(json: unknown): PluginManifest {
  const parsed = PackageJsonSchema.parse(json)
  return parsed["tribunus.plugin"]
}
