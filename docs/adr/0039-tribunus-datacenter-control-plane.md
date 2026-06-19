# ADR 0039: Tribunus Datacenter — Evidence-Driven Inference Control Plane for Multi-Engine, Multi-Vendor, Multi-Scale Serving

## Status
Proposed — June 2026

## Context

Tribunus Local (ADR 0034-0038) proves evidence-driven phase realization on a single device. But the inference serving landscape has three scales that share the same underlying problem — routing inference work across heterogeneous resources while minimizing recomputation, respecting latency, preserving state, and accounting for contribution:

| Scale | Hardware | Trust | Interconnect | Accounting |
|---|---|---|---|---|
| **Local** (Tribunus) | Your devices | Single user | Unified memory | N/A |
| **Node** (Single server) | Multi-GPU server | Admin unified | PCIe/NVLink | Cost/token |
| **Fleet** (Datacenter) | GPU cluster | Admin unified | RDMA/Ethernet | Cost/token + SLO |
| **Dharma** (Federated) | Peer devices | Semi-trusted | NAT/LAN/QUIC | Reputation/tribute |

The datacenter inference space is already crowded at the serving-engine layer. vLLM, SGLang, TensorRT-LLM, and NVIDIA Dynamo each optimize within a chosen runtime. **Tribunus should not become another vLLM.** It should become the evidence layer that tells a datacenter which executable realization should serve a given model, phase, hardware pool, SLO, and cost target — and in federated settings, which peer should serve it based on trust and contribution.

## Decision

Define Tribunus Datacenter as an evidence-driven inference control plane with three layers:

1. **Bottom layer — Backend Realizers:** Integrates existing serving engines (vLLM, SGLang, TensorRT-LLM, Dynamo), kernel compilers (Triton, CUTLASS, rocBLAS), and future runtimes as BackendRuntimeRealizers.
2. **Middle layer — Evidence Contract:** PhaseIR + BackendRealizer evidence system (ADR 0037) extended with fleet telemetry, admission standards, and compute images.
3. **Top layer — SLO/Cost Scheduler:** Routes requests based on model, phase, hardware pool, KV locality, latency target, and cost function (dollars in datacenter, tribute in Dharma).

### Dynamo Audit Matrix

Dynamo (NVIDIA's open-source distributed inference runtime, Apache 2.0) is the closest datacenter equivalent and the primary design pattern source.

| Dynamo Subsystem | Action | Rationale |
|---|---|---|
| **Disaggregated prefill/decode** | Copy concept | Core architectural pattern — prefill and decode scale independently. Maps to Dharma: asymmetric peers specialize in different phases. |
| **KV-aware routing** | Copy concept | Route by cache overlap + load. Dharma adds: privacy scope, identity, reputation, consent before routing. |
| **KV Block Manager** | Adapt interface | Multi-tier KV (GPU→CPU→SSD→remote) is correct. Dharma adds: KV as social object with privacy classification. |
| **Planner (FPM-based autoscaler)** | Copy concept | SLA-driven scaling from live metrics. FPM model (finance-inspired) is architecture-agnostic. |
| **Grove (K8s topology operator)** | Adapt | K8s-native gang scheduling for NVL72. Replace with generic topology-aware placement. |
| **AIConfigurator (config simulator)** | Copy concept | 10K+ config simulations in seconds without burning GPU-hours. Directly aligns with Tribunus evidence model. |
| **ModelExpress (weight streaming)** | Wrap as external runtime | NIXL/NVLink weight streaming. Useful when available, but no dependency. |
| **Fault tolerance / request migration** | Copy concept | Canary health checks + in-flight migration. Applies at all scales. |
| **Rust/Python split** | Copy concept | Rust for runtime, scheduler, receipts, evidence cache. Python for kernel DSLs, benchmarking harnesses. |
| **NIXL data transfer** | Adapt / wrap | High-speed KV transfer. Useful for Fleet/Datacenter tier; for Dharma, replace with transport abstraction (local/LAN/QUIC/WebRTC). |
| **NVIDIA-specific assumptions** | Do not copy | TensorRT-LLM dependencies, CUDA Graphs hardcoding, NVLink-only topologies. Tribunus must be multi-vendor. |

### Serving Ecosystem Gap Analysis

| System | Does Well | Gap (Tribunus fills) |
|---|---|---|
| **vLLM** | PagedAttention, continuous batching, V1 architecture | No cross-engine selection, no compile-time memory pre-declaration, no numerical oracle |
| **SGLang** | Structured generation, RadixAttention, runtime design | Same gaps; RadixAttention prefix caching is protocol to study and wrap |
| **TensorRT-LLM** | In-flight batching, CUDA Graphs, plugin system | NVIDIA-only, no heterogenous surface targeting |
| **KVServe** | KV compression with online controller | Profiles then selects compression — extremely close to Tribunus philosophy |
| **FlashInfer-Bench** | Kernel generation→benchmark→deploy loop | Validates "kernel candidates + evidence + injection" model |
| **TraCT** | CXL shared-memory KV cache | Interesting transport substrate, not a control plane |

**Universal gaps across all systems:**
- No evidence-driven engine selection
- No compile-time memory pre-declaration (unique to Tribunus)
- No numerical oracle across backends
- No per-token receipt infrastructure
- No heterogeneous compute surface targeting
- No KV cache format standard across engines

### Five-Phase Implementation Roadmap

**Phase 1: Assessment Infrastructure (3-4 weeks)** — Extend ADR 0038's numerical oracle with fleet telemetry. Emit p50/p95/p99 latency, TTFT, inter-token latency, cache hit rate, KV transfer time, HBM utilization, GPU occupancy, queue depth, preemption, failed replay, power draw, and cost per million tokens.

**Phase 2: Compute Image for Datacenter (2-3 weeks)** — Extend compute image (ADR 0034) to hold per-hardware-pool evidence: "for Llama/Qwen/Mixtral model X, prompt shape bucket Y, concurrency regime Z, hardware pool H100/B200/MI300X/Intel/TPU/Tensix, here is the admitted execution plan and its measured evidence."

**Phase 3: Dynamo Integration (2-3 weeks)** — Implement BackendRuntimeRealizer that wraps Dynamo as an execution substrate. Delegates NVIDIA serving to Dynamo, records Tribunus evidence around routing, phase behavior, SLOs, cost, and compute-image decisions. For local/mixed-vendor pools, uses Tribunus-native realizers.

**Phase 4: Cross-Engine KV (3-4 weeks)** — Define KV format standard across vLLM/SGLang/TRT-LLM. Implement KV cache profiling for routing decisions. KV-aware routing that respects privacy boundaries (Dharma).

**Phase 5: Kernel Assessment Loop (ongoing)** — Integrate FlashInfer-Bench pattern: candidate kernels produced by Triton, vendor libraries, or custom backends get compiled, benchmarked, numerically checked, cached, and ranked. Best winner frozen into compute image.

### Dharma Integration Path

Dharma is federated mutual-aid inference for semi-trusted peers. It adapts the same three-plane architecture with a trust layer:

- **Execution plane**: Standard Tribunus phase realizations, but each phase carries privacy constraints
- **Coordination plane**: Valkey/PGlite state machine extended with peer reputation, tribute accounting, consent verification
- **Trust plane**: Classifies data into public/session-local/private/non-transferable tiers. Decides what may leave the device and under what conditions

Implementation targets in order:
1. Federated prefill assistance for explicitly shareable sessions
2. Prefix-cache sharing for shared public documents (group repos, specs)
3. Speculative assistance (remote drafts, local authoritative verification)

## Consequences

**Positive:** Tribunus avoids competing head-on with vLLM/SGLang/Dynamo at their own game. Instead, it becomes the evidence layer that can use any of them as execution substrates. The same architecture scales from a MacBook to a Galaxy cluster to a federated mutual-aid network.

**Negative:** Requires engine-specific BackendRuntimeRealizer for each integrated system (vLLM, SGLang, TRT-LLM, Dynamo). Cross-engine KV format standard requires coordination across multiple open-source projects.

**Effort:** 12-16 weeks for full 5-phase implementation. Phase 1-3 (Fleet-capable): 7-9 weeks. Phase 4-5 (Full datacenter): +5-7 weeks. Dharma: additional 6-8 weeks for trust plane and federated transport.

**Key risk:** NVIDIA Dynamo is already moving aggressively into control-plane space. Tribunus must differentiate on multi-vendor support and evidence-driven selection, not just orchestration.

**Key differentiator for the paper:** Tribunus separates semantic portability from executable portability. PhaseIR gives one meaning. BackendRuntimeRealizers produce many possible realizations across engines and hardware. The evidence harness decides what is correct, fast, stable, and replayable on this device at this scale.
