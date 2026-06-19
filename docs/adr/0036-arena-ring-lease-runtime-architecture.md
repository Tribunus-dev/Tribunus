# ADR 0036: Arena, Ring, and Lease Runtime Architecture

## Status
Proposed — June 2026

## Context

ADR 0034 (Compiled Inference) defines the four-layer compiled inference model but leaves the runtime memory substrate unspecified. ADR 0035 (Model Virtual Memory) defines weight paging but assumes a generic arena. As the architecture grows to include speculative decoding, ANE prediction fabric, MLX fused kernels, Accelerate recipes, and eight typed ring buffers, the memory model must become a first-class architectural artifact: the Arena/Ring/Lease contract.

## Decision

Organize runtime memory as one Arena containing multiple typed Ring buffers. Each Ring contains fixed-size Slots. Each Slot has a state machine and generation counter. A Lease is the temporary authority granted to a backend lane to access a Slot. Backends never receive raw pointers — only (page_id, generation) pairs validated at access time.

### ArenaPage

ArenaPage is physical memory:
- pointer, byte length, dtype, alignment
- IOSurface identity (Apple Silicon — zero-copy interop)
- Backend compatibility bitmap (MLX, Core ML/ANE, Accelerate, CPU)
- Current residency tier
- Lease count

Arenas are backed by IOSurface on Apple Silicon and by cudaMalloc/hipMalloc on discrete GPUs.

### RingSlot

RingSlot is logical position with:
- token index, layer id, phase id, branch id, sequence id
- generation counter (prevents stale handles)
- State machine: free → reserved → writing → written → readable → verifying → committed → recycled
- Speculative states: draft_reserved → draft_written → verifier_visible → accepted/rejected → generation_invalidated

### Typed Rings (eight types)

1. **KV ring**: Authoritative KV pages. Append-heavy, branch-aware.
2. **Speculative KV ring**: Provisional branches. Draft KV isolated until accepted.
3. **Activation ring**: Transient layer outputs. Recycled after fence.
4. **Proposal ring**: ANE expert proposal outputs.
5. **Verifier ring**: Packed tree verification inputs.
6. **Logits ring**: Compact logits and candidate scores.
7. **Scratch ring**: Backend temporary workspace.
8. **Weight-staging ring**: Decompressed weight tiles for dynamic loading.

### Lease

Backends never receive raw pointers — only (page_id, generation, access_type, valid_backend) pairs. Lease types: MLX write, Core ML read, Accelerate scratch, CPU assemble, verifier commit.

### State Machine Invariants

- No backend owns memory. The compute image owns memory. Backends receive leases.
- A (page_id, generation) pair is valid only if generation matches.
- Speculative KV must never contaminate authoritative KV. Rejected branches increment generations.
- Generation counter prevents ABA problems from stale handles.

### Tokio Supervision

Tokio is supervisor, not hot-path scheduler. Tokio owns: sessions, requests, cancellation, model loading, disk prefetch, telemetry, failure recovery. Backend lanes are long-lived actors with command rings. The token hot path is a deterministic state machine over precompiled manifests.

### Backpressure

Explicit across the pipeline:
- Verifier ring full → ANE stops proposing
- Weight-staging full → disk prefetch stops
- MLX behind → proposal width shrinks
- Thermal/memory pressure → narrower schedule selected
- Backpressure changes runtime mode, never corrupts the arena

## Consequences

### Positive

- First-class memory model eliminates hidden allocation, stale references, and backend conflicts
- Typed rings make speculative KV isolation provably correct via generation counters
- Tokio supervision keeps lifecycle separate from deterministic hot path
- Backpressure prevents cascade failures
- Lease validation catches dangling references at access time

### Negative

- Arena planning requires compiler pre-declaration — dynamic shapes need prequalified families
- Eight typed rings increase footprint vs single shared buffer (but compiler sizes each)
- Lease validation adds ~ns overhead per access (negligible vs backend execution time)
- Apple Silicon IOSurface path different from discrete GPU cudaMalloc path

### Estimated Effort

Minimal (arena + 3 rings + 3 lanes): 5 weeks. Full (8 rings + 5 lanes + backpressure): 10-12 weeks.
