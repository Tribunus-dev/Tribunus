import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { randomUUID } from "node:crypto"
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { listTools } from "./registry.js"
import { dispatchToolCall } from "./dispatch.js"

export function createServer(): Server {
  const server = new Server(
    { name: "tribunus", version: "0.4.0" },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = listTools().map((t) => {
      const minBudget = t.requiredClientBudgetMs ?? (t.budgetClass === "artifact_export" ? 120_000 : t.budgetClass === "long_running" ? 60_000 : 30_000);
      const properties = {
        ...(t.inputSchema.properties ?? {}),
        client_budget_ms: {
          type: "number",
          description: `Optional timeout budget in milliseconds. This tool requires a client budget of at least ${minBudget}ms.`,
        },
      };
      return {
        name: t.name,
        description: t.description,
        inputSchema: {
          ...t.inputSchema,
          properties,
        },
      };
    })
    return { tools }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const ac = new AbortController()
    const timeout = setTimeout(() => ac.abort(), 1_200_000)
    try {
      return (await dispatchToolCall(request, ac.signal)) as unknown as CallToolResult
    } finally {
      clearTimeout(timeout)
    }
  })

  return server
}

export async function startServer(server: Server): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

export interface DaemonLifecycle {
  readonly statePath: string
  readonly port: number
  readonly stop: () => Promise<void>
}

export async function startDaemon(server: Server): Promise<DaemonLifecycle> {
  const statePath = resolve(process.cwd(), "state", "daemon", "ready.json")
  await mkdir(resolve(statePath, ".."), { recursive: true })
  await writeFile(
    statePath,
    JSON.stringify({ status: "starting", pid: process.pid, started_at: new Date().toISOString() }, null, 2),
    "utf8",
  )

  const port = Number(process.env.TRIBUNUS_MCP_PORT || 3333)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  await server.connect(transport)

  const httpServer = createHttpServer(async (req, res) => {
    try {
      if (!req.url) {
        res.statusCode = 400
        res.end("missing url")
        return
      }
      const url = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`)
      if (url.pathname === "/health") {
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify({ status: "ok", pid: process.pid, ready_at: new Date().toISOString() }))
        return
      }
      if (url.pathname !== "/mcp") {
        res.statusCode = 404
        res.end("not found")
        return
      }
      const parsedBody = await readRequestBody(req)
      await transport.handleRequest(req as IncomingMessage, res as ServerResponse, parsedBody)
    } catch (error) {
      res.statusCode = 500
      res.end(error instanceof Error ? error.message : String(error))
    }
  })

  const { promise, resolve: resolvePromise, reject: rejectPromise } = Promise.withResolvers<void>()
  httpServer.once("error", rejectPromise)
  httpServer.listen(port, "127.0.0.1", () => resolvePromise())
  await promise

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    try {
      await writeFile(
        statePath,
        JSON.stringify({ status: "stopping", pid: process.pid, stopped_at: new Date().toISOString() }, null, 2),
        "utf8",
      )
    } catch {}
    try {
      await transport.close()
    } catch {}
    try {
      await new Promise<void>((resolvePromise) => httpServer.close(() => resolvePromise()))
    } catch {}
    try {
      await writeFile(
        statePath,
        JSON.stringify({ status: "stopped", pid: process.pid, stopped_at: new Date().toISOString() }, null, 2),
        "utf8",
      )
    } catch {}
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void stop().finally(() => process.exit(0))
    })
  }

  await writeFile(
    statePath,
    JSON.stringify({ status: "ready", pid: process.pid, port, ready_at: new Date().toISOString() }, null, 2),
    "utf8",
  )

  return { statePath, port, stop }
}

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "DELETE") return undefined
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
