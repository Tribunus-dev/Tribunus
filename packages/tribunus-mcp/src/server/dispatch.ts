import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js"
import { resolveTool } from "./registry.js"
import { checkCapability } from "../governance/capabilities.js"
import { makeReceipt } from "../governance/receipts.js"
import { sha256Hex } from "../shared/digests.js"
import { ToolError } from "../shared/errors.js"
import { runWithContext, type InvocationContext } from "../governance/invocation-context.js"
import { ALLOWED_ENV } from "../governance/subprocess.js"
import { DEFAULT_BUDGET } from "../governance/limits.js"

export interface DispatchResult {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}

import { BUDGET_CONFIGS, type BudgetClass } from "../governance/budget.js"
import type { ResourceBudget } from "../governance/limits.js"

export async function dispatchToolCall(request: CallToolRequest, signal: AbortSignal) {
  const { name, arguments: args } = request.params
  const input = (args ?? {}) as Record<string, unknown>

  const tool = resolveTool(name)
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    }
  }

  // Check budget requirements
  const clientBudgetMs = (input.client_budget_ms as number) ?? 30_000
  const budgetClass = tool.budgetClass ?? "standard"
  const config = BUDGET_CONFIGS[budgetClass]
  const requiredBudgetMs = tool.requiredClientBudgetMs ?? config.requiredClientBudgetMs

  if (clientBudgetMs < requiredBudgetMs) {
    return {
      content: [{
        type: "text",
        text: `[requires_long_running_client_budget] Tool "${name}" belongs to budget class "${budgetClass}" and requires a client budget of at least ${requiredBudgetMs}ms. The current client budget is ${clientBudgetMs}ms. Please configure your client timeout or pass the 'client_budget_ms' parameter to allow longer execution.`
      }],
      isError: true,
    }
  }

  // Check capabilities
  const capCheck = checkCapability(name)
  if (!capCheck.allowed) {
    return {
      content: [{ type: "text", text: `Capability denied: tool "${name}" requires [${capCheck.missing.join(", ")}]. Set TRIBUNUS_CAPABILITIES to enable.` }],
      isError: true,
    }
  }

  // Build invocation context
  const envDigest = sha256Hex(
    Object.entries(process.env)
      .filter(([k]) => ALLOWED_ENV.has(k))
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  )
  const { receipt, finalize } = makeReceipt(name, envDigest)

  // Configure budget context
  const toolBudget: ResourceBudget = {
    maxRows: DEFAULT_BUDGET.maxRows,
    maxBytes: DEFAULT_BUDGET.maxBytes,
    maxDurationMs: config.maxDurationMs,
  }

  // Set up combined abort controller & timeout provenance
  const localController = new AbortController()
  let timeoutProvenance: "client_abort" | "server_budget_limit" | null = null

  if (signal.aborted) {
    timeoutProvenance = "client_abort"
    localController.abort()
  }
  signal.addEventListener("abort", () => {
    timeoutProvenance = "client_abort"
    localController.abort()
  })

  const serverTimeout = setTimeout(() => {
    timeoutProvenance = "server_budget_limit"
    localController.abort()
  }, config.maxDurationMs)

  const ctx: InvocationContext = {
    invocationId: receipt.invocation_id,
    toolName: name,
    capabilities: new Set(tool.requiredCapabilities),
    receipt,
    budget: toolBudget,
    signal: localController.signal,
    envPolicyDigest: envDigest,
    startedAt: Date.now(),
  }

  try {
    const result = await runWithContext(ctx, () => tool.execute(ctx, input))
    finalize({
      success: true,
      timeout: false,
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      created: [],
      modified: [],
      outputDigests: {},
      errors: [],
    })
    receipt.metadata = {
      ...receipt.metadata,
      client_budget_ms: clientBudgetMs,
      budget_class: budgetClass,
    }
    process.stderr.write(JSON.stringify(receipt) + "\n")
    return formatResult(result)
  } catch (error) {
    clearTimeout(serverTimeout)
    const isTimeout = localController.signal.aborted
    const provenance = isTimeout ? (timeoutProvenance ?? "client_abort") : null
    const message = isTimeout
      ? `Execution timed out (${provenance}). Maximum duration was ${config.maxDurationMs}ms.`
      : (error instanceof Error ? error.message : String(error))
    const category = isTimeout ? "timeout" : (error instanceof ToolError ? error.category : "internal_error")

    finalize({
      success: false,
      timeout: isTimeout,
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: message,
      created: [],
      modified: [],
      outputDigests: {},
      errors: [`[${category}] ${message}`],
    })
    receipt.metadata = {
      ...receipt.metadata,
      timeout_provenance: provenance,
      client_budget_ms: clientBudgetMs,
      budget_class: budgetClass,
    }
    process.stderr.write(JSON.stringify(receipt) + "\n")
    return {
      content: [{ type: "text", text: `[${category}] ${message}` }],
      isError: true,
    }
  } finally {
    clearTimeout(serverTimeout)
  }
}

function formatResult(result: unknown): DispatchResult {
  if (result && typeof result === "object" && "content" in result) {
    return result as DispatchResult
  }
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  }
}
