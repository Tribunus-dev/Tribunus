## The Wrong Abstraction

AI coding tools are chat windows with tool access. Each window has its own context, model, and state. An operator running five independent agent instances has no coordination, no shared state, no unified permission model. This does not scale.

## What Tribunus Does Differently

Tribunus treats agents as managed processes with:

- Centralized session management with explicit lifecycle
- Capability boundaries per session, no ambient authority
- Approval levels for destructive operations (read, ask, write, exec)
- State persistence via Valkey (ephemeral) and PGlite (durable)
- Receipt-based execution verification
- Backend-agnostic inference routing (MLX GPU, ANE, Accelerate CPU)

## Agent Lifecycle

Every agent session moves through explicit states:

- POST /v1/sessions creates a session (Created)
- Authorization: Bearer validates identity (Authorized)
- POST /v1/chat/completions begins generation (Running)
- Idle timeout suspends the session (Paused)
- DELETE /v1/sessions/:id terminates it

Each transition is a policy injection point: rate limiting, approval gates, capability checks, receipt recording.

## Comparison

| Aspect | Chat window | Tribunus agent session |
|--------|-------------|----------------------|
| State | Ephemeral, in-context | Persistent, Valkey+PGlite |
| Auth | Machine login | Bearer token per request |
| Capabilities | Ambient (terminal access) | Scoped by manifest |
| Approval | None | Per-operation levels |
| Recovery | Lost on crash | Receipt-based reconstruction |
| Backend | Single model | FlexDispatch GPU/ANE/CPU |
| Multi-agent | Manual coordination | Centralized session manager |

## Admin API

- GET /v1/admin/sessions — list active sessions
- POST /v1/admin/sessions/:id/cancel — terminate
- GET /v1/admin/status — system health
- POST /v1/admin/reload — reload config
- POST /v1/admin/evolkv — trigger KV cache eviction

## Why This Matters

Without agent system administration, multi-agent systems are coordination-free chaos. Tribunus treats agent orchestration as a systems problem: processes, permissions, state, and observability — not a prompt engineering problem.