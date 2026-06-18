# ADR 015: MCP as Governed Capability Protocol

## Status
Accepted — June 2026

## Context

The Model Context Protocol (MCP), introduced by Anthropic in November 2024 and donated to the Agentic AI Foundation under the Linux Foundation in December 2025, is the de facto standard for connecting LLMs to external tools, resources, and data sources. As of April 2026, there are over 2,300 public MCP servers. Major development environments (VS Code Copilot, Cursor, JetBrains AI) have integrated MCP support. The TypeScript SDK v2 stable release is anticipated Q3 2026 alongside an updated specification on July 28, 2026.

MCP defines three primitives: **tools** (actions with side effects, like POST), **resources** (data sources for loading into context, like GET), and **prompts** (reusable templates with parameters). Two transports: **stdio** (local subprocess, pipes — ideal for desktop apps) and **Streamable HTTP** (remote, single-endpoint, SSE streaming — replacing the older HTTP+SSE transport). Authorization is built on OAuth 2.1 with PKCE, token scoping, short-lived tokens, and action-level authorization. The 2026 roadmap focuses on: stateless transport across multiple instances, enterprise-managed auth with SSO-integrated flows, defined gateway/proxy patterns, and the "Tasks" primitive for durable asynchronous execution with state machines.

MCP is the plug shape. It is not the governance layer. MCP says "this server exposes a tool called X with schema Y." Tribunus must say "this tool is allowed only under policy Z, with risk class R, evidence requirements E, and receipt recording." The architecture treats MCP as one diplomatic protocol Tribunus speaks. Authority stays inside Tribunus.

## Decision

### The Primitive: Governed Capability, Not MCP Tool

The internal primitive is a **governed capability.** Every MCP tool, resource, or prompt can be adapted into one. But the canonical schema is richer than MCP:

| Field | MCP Provides | Tribunus Adds |
|-------|-------------|---------------|
| Name, description, schema | ✅ | ✅ |
| Mutation class (read-only, local-mutate, side-effect) | ❌ | ✅ |
| Determinism class (deterministic, non-deterministic, external) | ❌ | ✅ |
| Privilege boundary (none, filesystem, network, secrets, shell) | ❌ | ✅ |
| Required approval level (auto, human, senior) | ❌ | ✅ |
| Workspace trust requirement | ❌ | ✅ |
| Input/output redaction policy | ❌ | ✅ |
| Evidence contract (what receipt must include) | ❌ | ✅ |
| Timeout policy + idempotency expectations | ❌ | ✅ |
| Compensation strategy (rollback, retry, notify) | ❌ | ✅ |
| Whether the result is informative or can advance a gate | ❌ | ✅ |

The same governed capability is invocable from: desktop UI, CLI, local agent loop, GitHub integration, browser extension, or MCP client. The capability is the primitive. MCP is one adapter.

### Capability Registry Architecture

```
MCP Server (untrusted)           Tribunus Capability Registry
┌─────────────────────┐         ┌──────────────────────────┐
│ Tools, Resources,    │  ───►  │ MCP Adapter               │
│ Prompts (descriptor) │         │  └─ Translates MCP desc   │
│                      │         │     → provisional record  │
│ OAuth 2.1 (auth)     │         │                            │
└─────────────────────┘         │ Policy Compiler            │
                                │  ├─ Reject (unsafe)        │
                                │  ├─ Sandbox (untrusted)     │
                                │  ├─ Ask for trust (human)  │
                                │  └─ Promote (governed)     │
                                │                            │
                                │ Governed Capability Store  │
                                │  └─ Canonical schema       │
                                │                            │
                                │ Runtime                    │
                                │  └─ Execute + Receipt      │
                                │     (regardless of source) │
                                └──────────────────────────┘
```

### Classification Before Execution

Every invocation is classified before execution:

| Call Class | Policy | Receipt |
|-----------|--------|---------|
| Read-only, deterministic, local | Light receipt, auto-approved | Timestamp + result hash |
| Read-only, non-deterministic | Moderate receipt, logged | Full input/output |
| Mutating, filesystem-only | Full receipt, scoped path check | Full evidence record |
| Mutating, with side effects | Human approval default, heavy receipt | Approval + evidence |
| Secrets, network, shell, payments, deployment, Git mutation | Explicit human authorization, auditable user-intent link | Full governance receipt |

### Tribunus as MCP Gateway

Tribunus can be an MCP gateway. Other MCP clients connect to Tribunus, and Tribunus brokers access to local tools, remote MCP servers, browser automation, database connectors, and agent runtimes through one governed policy surface. This is more valuable than "we support MCP" — it turns Tribunus into the place where tool chaos gets normalized.

The gateway provides:
- **Authentication + authorization:** Centralizing OAuth 2.1 for all connected MCP servers
- **Routing:** Single endpoint for all tools, abstracting multi-server complexity
- **Policy enforcement:** Zero Trust filtering, tool schema validation, action-level authorization
- **Observability:** Per-call traces, logs, audit receipts for every tool invocation
- **Governance receipts:** Every invocation produces a receipt, regardless of origin protocol

### The Metaphor

> An MCP server is a witness or executor. A Tribunus governed capability is an officer of the court. The officer has standing rules, jurisdiction, evidence duties, and appeal paths. MCP gives the officer a uniform telephone number, not legal authority.

### Discovery, Registration, Promotion

1. **Discovery is cheap.** Any MCP server can be discovered and its tool schemas inspected.
2. **Registration is controlled.** The MCP adapter translates descriptors into provisional capability records.
3. **Invocation is governed.** Every call goes through the classification pipeline.
4. **Completion is receipted.** Every result produces a receipt in PGlite.
5. **Promotion is earned.** Capabilities that demonstrate safety, reliability, and heuristic compliance over time are promoted into trusted workflows.

### The Trap to Avoid

Exposing raw MCP tools directly to agents because "the schema says it is a tool" recreates async/tooling hell with nicer labels. The model must be: schema is necessary but insufficient. Governance is the gate.

## Implementation

### TypeScript SDK

The `@modelcontextprotocol/sdk` npm package provides `@modelcontextprotocol/server` and `@modelcontextprotocol/client`. Runs on Node.js, Bun, Deno. Supports stdio and Streamable HTTP transports. SDK v2 in pre-alpha, stable Q3 2026 — use v1.x for production until then.

### mcp-proxy

The `mcp-proxy` npm package (May 2026) is a TypeScript streamable HTTP + SSE proxy for MCP servers using stdio transport. Useful for bridging local stdio-based MCP servers to remote Streamable HTTP clients.

### Integration Points

- **Desktop app:** stdio transport — Tribunus spawns MCP servers as subprocesses, communicates via pipes. Zero network overhead.
- **Mobile PWA:** Command intents sent to desktop. Desktop invokes MCP servers locally. PWA receives projections. No raw MCP in the browser.
- **Team/relay:** Streamable HTTP transport for remote MCP servers. Tribunus gateway brokers access.

### Effect Schema Integration

MCP tool schemas are JSON Schema. Effect Schema (already in the repo) validates every invocation's input and output against the tool's schema. Zod is also commonly used in the MCP ecosystem for schema validation — compatible with Effect Schema's JSON Schema generation.

## Consequences

### Positive
- **Interoperability without governance leakage.** MCP provides the plug. Tribunus provides the circuit breaker, ledger, and court record.
- **2,300+ existing servers become potential capabilities.** Filesystem, GitHub, Slack, PostgreSQL, web search — all MCP-compatible tools can be governed through Tribunus.
- **Gateway positioning.** "Tribunus normalizes tool chaos" is a stronger product story than "we also do MCP."
- **Long-term value in governance, not integration.** When everyone supports MCP, the differentiator is who governs it best.

### Negative
- **MCP is still evolving.** The July 2026 specification release is a major update. Tribunus should couple loosely — the MCP adapter is replaceable if the spec changes.
- **Action-level authorization is recognized as crucial but not yet fully standardized.** MCP's 2026 roadmap includes it. Until then, Tribunus' classification pipeline is additive.
- **Gateway adds an abstraction layer.** A thin one, but still a layer between the raw MCP ecosystem and Tribunus-governed capabilities.

## References
- MCP Specification: https://modelcontextprotocol.io
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCP Gateway patterns: https://agentgateway.dev
- mcp-proxy npm: https://www.npmjs.com/package/mcp-proxy
- OAuth 2.1 for MCP: https://modelcontextprotocol.io/docs/concepts/auth
- ADR 004: Valkey as Coordination Kernel (governed execution)
- ADR 009: Design Council (heuristic enforcement)
- ADR 013: OSS Integrity Gate (policy-based refusal)
