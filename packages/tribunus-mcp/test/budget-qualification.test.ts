import { describe, it, expect } from "bun:test"
import { registerTool } from "../src/server/registry"
import { dispatchToolCall } from "../src/server/dispatch"
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js"

describe("MCP tool budget qualification", () => {
  it("rejects calls when client budget is below the required threshold", async () => {
    registerTool({
      name: "test_heavy_tool",
      description: "A heavy test tool.",
      inputSchema: { type: "object", properties: {}, required: [] },
      requiredCapabilities: [],
      timeoutMs: 300_000,
      budgetClass: "artifact_export",
      requiredClientBudgetMs: 120_000,
      execute: async () => ({ status: "ok" }),
    })

    const request: CallToolRequest = {
      method: "tools/call",
      params: {
        name: "test_heavy_tool",
        arguments: {
          client_budget_ms: 30_000, // less than 120,000 required
        },
      },
    }

    const abort = new AbortController()
    const response = await dispatchToolCall(request, abort.signal)
    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain("[requires_long_running_client_budget]")
  })

  it("accepts calls when client budget meets or exceeds the required threshold", async () => {
    registerTool({
      name: "test_heavy_tool_ok",
      description: "A heavy test tool.",
      inputSchema: { type: "object", properties: {}, required: [] },
      requiredCapabilities: [],
      timeoutMs: 300_000,
      budgetClass: "artifact_export",
      requiredClientBudgetMs: 120_000,
      execute: async () => ({ status: "ok" }),
    })

    const request: CallToolRequest = {
      method: "tools/call",
      params: {
        name: "test_heavy_tool_ok",
        arguments: {
          client_budget_ms: 120_000,
        },
      },
    }

    const abort = new AbortController()
    const response = await dispatchToolCall(request, abort.signal)
    expect(response.isError).toBeUndefined()
    expect(response.content[0].text).toContain("ok")
  })
})
