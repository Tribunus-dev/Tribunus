import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { createTool, PluginContext } from "../sdk/mod.js"
import { PermissionError } from "../sdk/permissions.js"
import path from "node:path"
import fs from "node:fs/promises"

describe("Plugin SDK", () => {
  const mockManifest = {
    name: "test-plugin",
    version: "1.0.0",
    "tribunus.plugin": {
      name: "test-plugin",
      version: "1.0.0",
      tools: ["helloTool"],
      permissions: {
        filesystem: ["/tmp/test"],
      },
    },
  }

  test("loads, activates, and runs a tool successfully", async () => {
    const ctx = new PluginContext(process.cwd())
    
    // Load plugin
    await ctx.load(mockManifest)
    
    // Register tool
    const helloTool = createTool(
      "helloTool",
      z.object({ name: z.string() }),
      async (args) => `Hello, ${args.name}!`
    )
    ctx.registerTool(helloTool)
    
    // Verify it fails if not activated
    expect(ctx.runTool("helloTool", { name: "World" })).rejects.toThrow("Cannot run tool in state: loaded")
    
    // Activate
    ctx.activate()
    
    // Run tool
    const result = await ctx.runTool("helloTool", { name: "World" })
    expect(result).toBe("Hello, World!")
  })

  test("enforces manifest validation for tools", async () => {
    const ctx = new PluginContext(process.cwd())
    await ctx.load(mockManifest)

    // Register a tool not in the manifest
    const badTool = createTool(
      "undeclaredTool",
      z.object({}),
      async () => "bad"
    )
    
    expect(() => ctx.registerTool(badTool)).toThrow(PermissionError)
  })

  test("scoped filesystem prevents reading outside allowed paths", async () => {
    const ctx = new PluginContext(process.cwd())
    await ctx.load(mockManifest)
    ctx.activate()

    expect(ctx.fs).toBeDefined()
    if (ctx.fs) {
       expect(ctx.fs.readFile("../outside.txt")).rejects.toThrow(PermissionError)
       
       // Because "/tmp/test" is in the permissions block
       expect(ctx.fs.readFile("/tmp/test/test.txt")).rejects.toThrow(/ENOENT|no such file or directory/i)
    }
  })
})
