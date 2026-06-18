# Inference Serving Ecosystem Comparison: Gap Analysis for Tribunus Datacenter

June 2026 | ResearchEcosystem

---

## 1. Executive Summary

The inference serving ecosystem is converging on disaggregated prefill/decode architectures with KV cache as the central resource. Each system surveyed solves a real problem well, but none provides **multi-engine, multi-vendor evidence-driven control**. This is where Tribunus Datacenter fits: as a control plane above serving engines (Dynamo, vLLM, SGLang, TensorRT-LLM) that makes placement and realization decisions based on measured evidence, not vendor defaults or static heuristics.

This document analyzes six inference serving systems and NVIDIA Dynamo against Tribunus' architectural thesis. For each system: what it does well, what gaps it leaves, where an evidence control plane adds value, and what Tribunus should wrap vs implement natively.

---

## 2. The Ecosystem at a Glance

| System | Primary Innovation | Layer | Vendor Lock |
|---|---|---|---|
| **vLLM** | PagedAttention + continuous batching | Serving engine | CUDA-leaning, growing HIP |
| **SGLang** | RadixAttention (prefix KV reuse) + structured generation | Serving engine + DSL | CUDA/HIP |
| **TensorRT-LLM** | CUDA Graphs + in-flight batching + plugin system | Compiled backend + serving | NVIDIA-only |
| **KVServe** | Adaptive KV compression + online controller | KV middleware | vLLM extension |
| **FlashInfer-Bench** | AI-generated kernels + 0-day deployment loop | Kernel layer | NVIDIA/AMD |
| **TraCT** | CXL shared-memory KV cache at rack scale | Hardware interconnect | CXL hardware required |
| **NVIDIA Dynamo** | Disaggregated orchestration + SLO planning | Orchestration layer | Backend-agnostic, NVIDIA-tuned |
| **Tribunus Datacenter** | Evidence-driven control plane across engines | Control plane | Multi-vendor by design |

---

## 3. Detailed System Analysis

### 3.1 vLLM

**What it does well:**
- **PagedAttention** (SOSP 2023) is the industry standard for KV cache memory management: breaks KV cache into fixed-size blocks (16 tokens default) mapped to non-contiguous physical GPU memory. This eliminates up to 96% of KV fragmentation and enables on-demand allocation and prefix sharing through copy-on-write block tables.
- **Continuous batching** operates at token granularity — new requests join running batches after each forward pass, completed requests exit immediately. This maximizes GPU saturation (2-4x throughput improvement vs static batching).
- **V1 architecture** (default since March 2025) modularizes the scheduler, KV cache manager, and model runner into a multi-process design with ZMQ communication between API server and engine core.
- **Ecosystem breadth**: speculative decoding, chunked prefill, prefix caching, quantization (GPTQ, AWQ, FP8 KV), tensor parallelism, OpenAI-compatible API.
- Massive community adoption makes it the de facto baseline.

**What gaps it leaves:**
- **Single-engine monoculture.** vLLM is a serving engine, not a control plane. It answers "how do I serve this model with this engine?" — not "which engine should serve which phase on this hardware?"
- **No evidence-driven backend selection.** vLLM uses what's available (CUDA, HIP, TPU) but doesn't benchmark candidates. It doesn't ask whether TensorRT-LLM would be faster for attention, whether SGLang's RadixAttention would give better prefix reuse, or whether a custom kernel would beat llm.nine's implementation.
- **No cross-engine orchestration.** vLLM cannot delegate prefill to TensorRT-LLM while running decode on a different engine.
- **No numerical governance.** No oracle-based correctness verification across backend variants.
- **No compute-image model.** vLLM discovers graphs at runtime; it doesn't precompile a deterministic execution plan with frozen backend assignments and memory layouts.
- **Limited non-NVIDIA support.** HIP support exists but is secondary; no Apple Silicon, no Intel XMX, no Tenstorrent, no Vulkan fallback.
- **No per-request receipt infrastructure.** Cannot distinguish "golden path executed" from "correct output through fallback."

**Where an evidence control plane adds value:**
A Tribunus control plane above vLLM would:
- Benchmark vLLM's PagedAttention kernel against FlashInfer, TensorRT-LLM, and custom kernels on the actual hardware.
- Select per-phase winners (e.g., vLLM for KV management + TensorRT-LLM for attention compute).
- Provide precompiled compute images that tell vLLM exactly what to run — no runtime graph discovery.
- Add numerical oracle verification across engine boundaries.
- Add per-token receipts showing which engine actually executed.

**Wrap vs implement natively:**
- **Wrap**: vLLM's PagedAttention KV block manager, continuous batching scheduler, and OpenAI-compatible API server. These are mature, well-tested, and have ecosystem gravity.
- **Reimplement in Tribunus terms**: KV cache paging already exists in Tribunus' arena/ring/lease architecture (ADR 0036) — it's more general (typed rings, generation counters, IOSurface backing) but could reuse vLLM's block-table data structure for NVIDIA backends.
- **Do NOT reimplement**: vLLM's custom CUDA attention kernels. Use FlashInfer or TensorRT-LLM's attention kernels instead — these are more actively maintained and performance-competitive.

---

### 3.2 SGLang

**What it does well:**
- **RadixAttention** is the standout innovation: maintains a radix tree (compressed prefix trie) of all KV cache prefixes ever computed. New requests find the longest cached prefix, reuse those KV tensors, and only compute the unmatched suffix. This transforms KV cache from a per-request disposable artifact into a durable, shared resource. Particularly effective for long system prompts, multi-turn conversations, few-shot examples, and agentic workflows.
- **Structured generation** via xGrammar and a Python-embedded DSL (`gen()`, `select()`, `fork()`/`join()`). Guarantees grammatically valid output through constrained token sampling — no post-processing retries needed.
- **Cache-aware routing** with `sgl-router` (Rust-based): routes requests to workers that already hold the relevant KV cache prefix, maximizing cache hit rates in multi-node deployments.
- **Zero-overhead batch scheduler** overlaps CPU processing with GPU computation, achieving 95%+ GPU utilization.
- **Prefill-decode disaggregation** and speculative decoding support.
- **Multi-model, multi-modal** — supports text, vision, audio with developments like SGLang Diffusion (late 2025/early 2026).

**What gaps it leaves:**
- **Same engine monoculture problem as vLLM.** SGLang is a serving engine, not a control plane. Its cache-aware routing is engine-internal — it doesn't route across engines (e.g., SGLang prefill to TensorRT-LLM decode).
- **KV cache radix tree is engine-proprietary.** No standard representation for sharing KV prefix state across different serving engines. A vLLM worker cannot benefit from SGLang's radix tree.
- **No quantitative assessment infrastructure.** SGLang doesn't benchmark whether RadixAttention beats vLLM's prefix caching on specific workloads — it assumes it does.
- **Limited structured generation backends.** xGrammar is effective but not the only approach (lm-format-enforcer, outlines, guidance). No evidence-driven selection of constraint engine.
- **No numerical oracle.**
- **No compute-image model.**

**Where an evidence control plane adds value:**
- Provide a **cross-engine KV prefix index** — a standardized representation of cached prefixes that any engine can query. Tribunus becomes the source of truth for "what KV prefixes are materialized where?"
- **Evidence-driven router**: instead of SGLang's assumption that RadixAttention always wins, Tribunus measures whether RadixAttention, vLLM prefix caching, or TraCT's CXL cache gives the best TTFT for a given workload pattern.
- **Structured generation backend selection**: benchmark xGrammar vs lm-format-enforcer vs outlines on actual schemas and select the fastest.

**Wrap vs implement natively:**
- **Wrap**: RadixAttention as a KV reuse strategy for SGLang-backed lanes. SGLang's DSL for structured generation front-ends.
- **Implement natively**: Cross-engine KV prefix index in Tribunus' control plane. This is the Tribunus Datacenter value proposition — coordinating prefix state across heterogeneous engines.
- **Do NOT reimplement**: SGLang's radix tree data structure unless no cross-engine standard emerges. Better to wrap and add a translation layer.

---

### 3.3 TensorRT-LLM

**What it does well:**
- **In-flight batching**: the NVIDIA term for continuous batching. TensorRT-LLM dynamically adds/removes requests from running batches, processing prefill and decode concurrently.
- **CUDA Graphs integration**: captures sequences of CUDA kernel launches into single replays. Uses graph padding — batch sizes are bucketed (e.g., 1, 2, 4, 8, 16, 32, 64) and incoming batches are padded to the nearest larger graph size. Eliminates per-kernel CPU launch overhead.
- **Plugin system**: supports custom operators via the TensorRT plugin interface. NVIDIA's Multi-head Attention (MHA) and GEMM plugins are highly optimized.
- **Timing cache**: profiles candidate kernel implementations during engine building, caches results to disk. Reuses across builds for same model + hardware combination.
- **ModelOpt quantization**: FP8, INT8, INT4 weight-only quantization with calibration. NVIDIA's FP8 attention kernels are state-of-the-art on Hopper/Blackwell.
- **Multi-node**: Tensor and pipeline parallelism with NCCL, plus the new NIXL transfer engine for disaggregated KV transfer.
- **Raw performance**: on NVIDIA hardware, TensorRT-LLM is usually the fastest option for a given model due to deep hardware-specific optimization.

**What gaps it leaves:**
- **NVIDIA-only.** The compiler, kernels, graph capture, and plugins are all CUDA-specific. Zero portability to AMD, Intel, Apple, or Tenstorrent.
- **Closed compiler.** TensorRT's builder is a black box — you cannot inspect, verify, or replace individual kernel decisions. The timing cache is opaque. No numerical oracle comparison against a reference implementation.
- **Engine-specific orchestration.** TensorRT-LLM's "TrtGptModel" ties serving to TensorRT execution. Cannot delegate phases to non-TensorRT engines.
- **No kv-cache prefix sharing across engine boundaries.** A TensorRT-LLM decode worker cannot reuse KV prefixes computed by a vLLM prefill worker (except through Dynamo's NIXL, which is NVIDIA's own solution).
- **Graceful degradation on non-NVIDIA hardware is impossible** — there is no fallback.

**Where an evidence control plane adds value:**
- **Multi-vendor assessment**: benchmark TensorRT-LLM's attention against Triton, CUTLASS, FlashInfer on the same NVIDIA hardware — TensorRT doesn't always win for every shape. Freeze the evidence.
- **Cross-engine placement**: prefill on TensorRT-LLM (best FP8 attention for Hopper), decode on vLLM (lighter-weight, faster iteration scheduler), KV cache in CXL if available (TraCT) or NVLink if single-node.
- **Numerical oracle**: verify TensorRT-LLM's FP8 output against Apple Silicon FP32 reference. Catch silent numerical drift from aggressive fast-math.
- **Receipts**: TensorRT-LLM's timing cache contains profiling data; Tribunus can elevate this into the per-token receipt stream.

**Wrap vs implement natively:**
- **Wrap**: TensorRT-LLM as a backend lane for NVIDIA hardware. Its in-flight batching scheduler, CUDA Graph capture, and ModelOpt quantization are best-in-class on NVIDIA.
- **Do NOT implement natively on NVIDIA**: custom CUDA attention kernels. Wrap TensorRT-LLM's. The maintainability cost of competing with NVIDIA's kernel team is prohibitive.
- **Implement natively**: the cross-engine placement decision. Tribunus decides that "this phase goes to TensorRT-LLM, that phase to vLLM" based on assessment evidence. Neither engine makes this decision today.

---

### 3.4 KVServe

**What it does well:**
- **Addresses the KV communication bottleneck in disaggregated serving.** When prefill and decode run on separate machines, the KV cache must be transferred — often the dominant latency source.
- **Bayesian Profiling Engine**: offline discovery of optimal compression strategies across a modular strategy space (quantization levels 2-bit through 8-bit, lossless coding, mixed-precision). The Bayesian approach efficiently searches the combinatorial space.
- **Service-Aware Online Controller**: uses a lightweight bandit algorithm with an analytical latency model to select the best compression profile at runtime based on current network bandwidth, workload type, and SLO targets. This corrects mismatches between offline profiling assumptions and actual execution conditions.
- **Modular integration**: designed as a vLLM KV connector extension — plugs into existing systems without major modifications.
- **Impressive results**: up to 9.13x JCT speedup in prefill/decode separated serving, up to 32.8x TTFT reduction in KV-disaggregated serving.

**What gaps it leaves:**
- **vLLM-specific KV connector.** KVServe works with vLLM's KV block table representation. Adapting to SGLang's RadixAttention KV layout or TensorRT-LLM's internal KV format requires separate connectors.
- **Compression decisions are engine-local.** The online controller selects compression strategies for one engine's KV path. In a cross-engine deployment (vLLM prefill to TensorRT-LLM decode), the compression format must be negotiated.
- **No cross-engine KV compression standard.** Each engine has its own KV layout (contiguous, paged, block table, radix tree, quantized). There is no standard representation for "compressed KV cache" that multiple engines can consume.
- **No numerical validation of compression correctness.** How much quality loss is acceptable? KVServe optimizes for latency/bandwidth but doesn't tie compression to downstream perplexity or token acceptance rates.
- **Bayesian engine is offline.** The profiling engine runs once, not continuously. On hardware or workload changes, it needs re-profiling. No evidence feedback loop.

**Where an evidence control plane adds value:**
- **Cross-engine KV compression policy**: Tribunus determines the compression strategy (algorithm, bit-width, block size) and enforces it across engines. The KV cache format becomes part of the compute image contract.
- **Numerical quality gates for KV compression**: tie compression parameters to measured token acceptance rate in speculative decoding or perplexity on held-out data. Don't compress more aggressively than quality allows.
- **Continuous online adaptation**: extend KVServe's bandit controller to re-assess compression strategies as hardware conditions change (thermal throttling, network congestion, new hardware).
- **KV compression as a compiler pass**: integrate KVServe's compression strategies into Tribunus' weight compression pipeline (ADR 0034). The same codec assignment logic that chooses AWQ for dense layers and codebook for MoE experts can also assign KV compression codecs per layer based on attention sensitivity analysis.

**Wrap vs implement natively:**
- **Wrap**: KVServe's Bayesian profiling engine and online bandit controller as a KV compression subsystem. The modular strategy space is well-designed.
- **Implement natively**: Cross-engine KV compression contract. The compressed KV format, decode contract (block size, scale layout, zero-point layout), and checksum must be standardized so any engine can decompress.
- **Do NOT implement from scratch**: the adaptive compression algorithm. KVServe's approach is sound. Focus on making it cross-engine.

---

### 3.5 FlashInfer-Bench

**What it does well:**
- **AI-generated GPU kernel pipeline**: LLMs fine-tuned for code synthesis produce novel GPU kernels (Triton or CUDA) from operator definitions in the FlashInfer Trace schema. This is the "virtuous cycle" — AI improving the inference systems that serve AI.
- **Systematic benchmarking**: evaluates kernels for correctness (deterministic, low-precision, stochastic) and performance (latency, throughput, speedup) in isolation and against reference implementations (FlashAttention 2/3, cuDNN, CUTLASS, TensorRT-LLM).
- **0-day production deployment**: kernels that pass benchmarks are injected into production engines (vLLM, SGLang, MLC-Engine) through a dynamic substitution mechanism (`apply()`) with near-zero runtime overhead.
- **Engine-agnostic with unified API**: works across serving frameworks. Supports CUDA Graphs and `torch.compile` for low-latency inference.
- **Hardware profiling with CUPTI**: uses CUDA Performance Tools Interface for hardware-level kernel timing (pure GPU compute time, no host overhead). Falls back to CUDA events.
- **NVIDIA backing**: NVIDIA is releasing its most performant kernels in FlashInfer, including TensorRT-LLM kernels. AMD ROCm support arriving 2025.
- **Public leaderboard**: tracks LLM agent capability in GPU programming — creates a competitive dynamic for kernel improvement.

**What gaps it leaves:**
- **NVIDIA/AMD GPU only.** No Apple Silicon (Metal), no Intel (XMX/Level Zero), no Tenstorrent (Tensix), no CPU kernels. The kernel generation targets CUDA/Triton.
- **No cross-engine kernel selection.** FlashInfer-Bench benchmarks kernels and deploys them, but the decision of *which* kernel to use for *which* phase of *which* model on *which* hardware is left to the user or the engine. It's a kernel catalog, not a placement system.
- **AI-generated kernels have no numerical oracle.** Correctness is checked against a reference kernel, but there's no multi-backend numerical comparison. A CUDA kernel might pass correctness checks but silently produce different logits than the same operation on Metal.
- **The deployment loop is engine-internal.** `apply()` injects kernels into a specific engine. There's no concept of a compiled compute image that freezes kernel selections.
- **No server-side deployment.** Focused on the kernel pipeline, not serving orchestration (batching, scheduling, KV management, routing).

**Where an evidence control plane adds value:**
- **Tribunus as the kernel selection authority.** FlashInfer-Bench generates and benchmarks candidates. Tribunus assesses them against the numerical oracle, selects per-phase winners, and freezes them into the compute image.
- **Multi-backend kernel assessment.** Extend FlashInfer's benchmarking to Apple Metal, Intel XMX, and Tenstorrent Tensix. The unified PhaseIR from ADR 0037 provides the interface.
- **Receipt verification for AI-generated kernels.** Every execution of an AI-generated kernel produces a receipt: was it the kernel we selected? Did it produce correct output? Did it match the numerical oracle?
- **Feedback loop to kernel generation.** If receipts show a kernel is numerically unstable or slower than assessed, trigger re-generation and re-benchmarking.

**Wrap vs implement natively:**
- **Wrap**: FlashInfer-Bench's kernel generation pipeline, JIT compilation, benchmarking framework, and `apply()` injection mechanism. This is a specialized capability that Tribunus shouldn't duplicate.
- **Implement natively**: The kernel assessment → candidate admission → compute-image freeze pipeline. This is Tribunus' Layer 0-1 (Assessment + Compilation) from ADR 0034. FlashInfer-Bench is the kernel factory; Tribunus is the quality gate.
- **Extend natively**: FlashInfer's Trace schema to support PhaseIR. This enables kernel generation for arbitrary Tribunus canonical phases, not just attention.

---

### 3.6 TraCT

**What it does well:**
- **CXL shared memory as KV transport**: eliminates network hops by using CXL's cache-coherent interconnect for direct GPU-to-GPU KV transfer. GPUs write and read KV blocks via CXL load/store and DMA — no NIC, no RDMA, no network stack.
- **Rack-scale prefix-aware KV cache**: CXL shared memory becomes a rack-wide prefix-aware cache. All GPUs in the rack see the same KV cache. Prefixes computed by one GPU are instantly available to others.
- **Decentralized KV management**: no central KV cache server. Each GPU directly accesses CXL memory. This is architecturally elegant — it turns the interconnect into a shared memory pool.
- **Impressive performance**: 9.8x average TTFT reduction, 6.2x P99 latency reduction, 1.6x peak throughput improvement vs RDMA + DRAM caching baselines.
- **Hardware efficiency**: lower power consumption through eliminating network transfers, higher GPU utilization.

**What gaps it leaves:**
- **CXL hardware dependency.** CXL 2.0+ switches and CXL-attached memory are required. As of mid-2026, this is bleeding-edge datacenter hardware (Samsung CXL Memory Module, Astera Labs Leo switches). Not available on Apple Silicon, consumer GPUs, or edge devices.
- **KV cache is raw, not compressed.** TraCT assumes full-precision KV transfer over CXL. For bandwidth-constrained scenarios or edge cases, compression is still needed. TraCT + KVServe would be a natural combination.
- **No KV cache selection policy across memory tiers.** TraCT provides CXL as one tier. A full solution needs multi-tier KV management: GPU HBM → CXL → NVMe → remote storage. TraCT doesn't address tiering policy.
- **No numerical governance or receipts.**
- **Single-fabric assumption.** TraCT assumes a homogeneous CXL fabric. Real datacenters mix CXL, NVLink, InfiniBand, and Ethernet.

**Where an evidence control plane adds value:**
- **Multi-tier KV placement policy**: Tribunus decides which KV pages live in HBM (hot, recent tokens), CXL (warm, shared prefixes), and SSD (cold, archived context) based on measured access patterns. This extends Tribunus' existing model virtual memory (ADR 0035) and KV cache compression policy (ADR 0034) to include CXL as a tier.
- **Cross-fabric KV routing**: Tribunus routes KV cache across CXL (same rack), NVLink (same node), RDMA (cross-rack), and local unified memory (Apple Silicon). The router is evidence-driven: measure TTFT for each path and select the fastest available.
- **KV compression before CXL transfer**: combine KVServe's adaptive compression with TraCT's CXL transport. Compress KV before writing to CXL, decompress on read. Tribunus determines the compression policy.
- **Receipts for CXL KV transfers**: track CXL read/write latency, bandwidth, and correctness for every KV operation. Feed back into placement decisions.

**Wrap vs implement natively:**
- **Wrap**: TraCT's GPU-CXL DMA primitives and decentralized KV management protocol for CXL hardware. This is hardware-specific code that NVIDIA/Intel/Samsung are investing in.
- **Implement natively**: Multi-tier KV placement policy, cross-fabric routing decisions, KV compression pipeline. These are control-plane concerns — Tribunus' sweet spot.
- **Do NOT implement**: CXL device drivers or hardware abstraction. Use the OS/vendor CXL stack.

---

## 4. NVIDIA Dynamo: The Orchestration Layer

Dynamo (GTC 2025) is the most architecturally relevant system to Tribunus Datacenter because both position as orchestration layers above serving engines. Understanding where Dynamo goes and where it stops defines Tribunus' differentiation.

**What Dynamo does well:**
- **Disaggregated serving at scale**: separates prefill and decode across GPU clusters. Independent scaling per phase. This is table stakes for 2026 datacenter inference.
- **KV-aware smart router**: tracks KV cache match rates and load across workers. Routes requests to workers that already hold the relevant KV prefix. Equivalent to SGLang's cache-aware router but at the orchestration layer.
- **Multi-tier KV cache offloading**: GPU → CPU → SSD → remote storage. Extends capacity beyond GPU memory.
- **SLO Planner**: monitors capacity and dynamically adjusts resources to meet latency targets at minimum TCO. This is control-plane functionality — resource allocation based on SLOs.
- **NIXL (NVIDIA Inference Transfer Engine)**: fast async GPU-to-GPU KV transfer — NVIDIA's answer to RDMA-based KV transfer. Tightly integrated with NVLink and NVIDIA networking.
- **ModelExpress**: streams model weights GPU-to-GPU for fast cold starts.
- **Backend-agnostic**: supports SGLang, TensorRT-LLM, and vLLM as worker engines. This is key — Dynamo is not an engine, it's above engines.
- **Deployment flexibility**: standalone (integrated frontend) or Kubernetes Gateway API Inference Extension mode.
- **Positioned as "OS of an AI factory"** — Jensen Huang's framing.

**What gaps Dynamo leaves:**
- **NVIDIA-tuned, not vendor-neutral.** While Dynamo supports multiple engines, the orchestration decisions (placement, routing, SLO planning) are tuned for NVIDIA hardware. NIXL is NVIDIA-specific. The SLO planner assumes NVIDIA GPU characteristics. There's no assessment infrastructure for non-NVIDIA hardware.
- **No evidence-driven engine selection.** Dynamo supports multiple engines but doesn't benchmark them. It doesn't ask "should this decode phase run on TensorRT-LLM or vLLM?" — it uses whatever engine is configured per worker pool.
- **No numerical oracle or cross-engine correctness verification.** Dynamo trusts each engine's output. There's no reference implementation comparison.
- **No per-token receipts with backend attribution.** Dynamo has metrics and telemetry for SLO tracking, but not the receipt model Tribunus defines: which backend actually executed, native symbols called, bytes copied, fallback count, arena lifecycle events.
- **No compute-image model.** Dynamo discovers graphs and schedules at runtime, not compile time. This is the fundamental architectural difference: Dynamo is a runtime orchestrator; Tribunus is a compile-time + runtime control plane.
- **No heterogeneous compute surface.** Dynamo assumes homogeneous GPU pools (all NVIDIA, all with CUDA). Tribunus targets heterogeneous backends (NVIDIA, AMD, Intel, Apple, Tenstorrent) with assessment determining what runs where.
- **SLO planning is throughput/latency-only.** Dynamo doesn't plan for numerical correctness, memory residency contracts, or speculative decoding tree topology. Tribunus' compute image pre-declares all of these.

**Where Tribunus Datacenter complements Dynamo:**

| Concern | Dynamo | Tribunus Datacenter |
|---|---|---|
| Engine support | SGLang, TRT-LLM, vLLM (runtime) | Same + assessment across them |
| Engine selection | Static per pool | Evidence-driven per phase |
| Placement | GPU pools | Individual backends + lanes |
| Correctness | Trust engine output | Numerical oracle verification |
| Memory model | KV cache offloading tiers | Arena/ring/lease + IOSurface |
| Execution model | Runtime schedule | Precompiled compute image |
| Receipts | Metrics/telemetry | Per-token, per-backend, cryptographically-verifiable |
| Hardware | NVIDIA-focused | Multi-vendor (NVIDIA, AMD, Intel, Apple, Tenstorrent) |
| Compilation | Runtime | Compile-time assessment + freezing |
| KV transfer | NIXL (NVIDIA) | Multi-fabric (CXL, NVLink, RDMA, unified memory) |

**The architectural relationship:**
Dynamo is the inference operating system. Tribunus is the inference compiler + evidence authority. The two are complementary: Tribunus compiles a compute image that Dynamo executes.

In practical terms:
- Tribunus assesses which engine + kernel combination is optimal for each phase on each hardware SKU.
- Tribunus compiles this into a compute image with pre-declared memory, placement, and receipts.
- Dynamo receives the compute image and orchestrates execution across worker pools.
- Tribunus verifies execution through receipt comparison against the expected profile.

---

## 5. Cross-Cutting Gap Analysis

### 5.1 The Universal Gaps

Every system surveyed shares these gaps:

1. **No evidence-driven engine selection.** Systems either use one engine exclusively (vLLM-only, SGLang-only, TRT-LLM-only) or support multiple engines but don't benchmark which is better for which phase (Dynamo). Nobody measures "TensorRT-LLM beats vLLM for attention on H100 at batch size 8, but vLLM's scheduler is faster for decode."

2. **No compile-time memory pre-declaration.** All systems allocate and manage memory at runtime. Tribunus' compute-image model (pre-declare every buffer, arena, ring slot, and page lease before execution) is unique.

3. **No numerical oracle across backends.** TRT-LLM kernels produce different logits than vLLM's attention kernels. Nobody verifies equivalence. Tribunus' four-tier numerical oracle (ADR 0038) is novel.

4. **No per-token receipts.** No system can answer "did the golden path execute or did we silently fall back?" Tribunus' Layer 3 receipt infrastructure (ADR 0034) is a differentiator.

5. **No heterogeneous compute surface.** Every system targets homogeneous GPU pools. Tribunus' multi-vendor BackendRealizer architecture (ADR 0037) with evidence-based winner selection is novel.

6. **No KV cache format standard across engines.** Each engine has its own KV layout. KVServe provides compression but only for vLLM. TraCT provides transport but assumes raw KV. No one has defined a portable compressed KV format.

### 5.2 Where Tribunus Datacenter Fits

Tribunus Datacenter is not another serving engine. It is a **control plane above serving engines** that:

1. **Assesses** which engine + kernel combination is optimal for each canonical phase on each hardware SKU (vLLM vs TRT-LLM vs SGLang for attention; which KV compression; which speculative draft model; which routing strategy).

2. **Compiles** assessment results into a machine-specific compute image: pre-declared memory, frozen backend assignments, placement manifest, numerical oracle evidence, receipt specification.

3. **Orchestrates** execution by handing the compute image to a serving orchestrator (Dynamo) with explicit instructions: "this phase on this engine, these KV pages at this compression level, these receipts must be emitted."

4. **Verifies** execution through receipt comparison. If receipts deviate from the expected profile (wrong backend, unexpected fallback, latency anomaly), Tribunus flags the golden path as degraded and triggers re-assessment.

### 5.3 What Tribunus Should NOT Build

- **Another serving engine.** The world has vLLM, SGLang, TensorRT-LLM. Tribunus wraps and schedules them; it doesn't compete with them on serving engine primitives (batching, scheduling, API serving).
- **Another NVLink competitor.** NIXL and CXL are hardware interconnects. Tribunus makes placement decisions across them; it doesn't implement transport protocols.
- **Another kernel library.** FlashInfer, CUTLASS, Triton, and cuBLAS are the kernel libraries. Tribunus assesses and selects from them; it generates candidates only where existing libraries have gaps (model-agnostic canonical phases like speculative branch commit/rollback, token-tree verification, paged KV ops).
- **Another GPU driver or runtime.** CUDA, HIP, Metal, Level Zero, and Vulkan are the backends. Tribunus' BackendRealizer trait (ADR 0037) wraps them uniformly.

---

## 6. Tribunus Datacenter Architecture: Proposed Layering

```
                         ┌──────────────────────────┐
                         │   Tribunus Control Plane  │
                         │   (Assessment + Compile)  │
                         └────────────┬─────────────┘
                                      │ compute image
                         ┌────────────▼─────────────┐
                         │   Orchestration Layer     │
                         │   (Dynamo or equivalent)  │
                         └────────────┬─────────────┘
                                      │ phase dispatch
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
    ┌─────────▼────────┐  ┌──────────▼─────────┐  ┌─────────▼────────┐
    │   vLLM Lane      │  │  TensorRT-LLM Lane │  │  SGLang Lane     │
    │   (PagedAttn,    │  │  (CUDA Graphs,     │  │  (RadixAttn,     │
    │   cont. batch)   │  │   FP8 attn, NIXL)  │  │   struct. gen)   │
    └──────────────────┘  └────────────────────┘  └──────────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │   KV Transport Layer      │
                         │   (TraCT-CXL / NIXL /     │
                         │    RDMA / Unified Memory) │
                         └──────────────────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │   KV Compression Layer    │
                         │   (KVServe-style adaptive │
                         │    + multi-engine format) │
                         └──────────────────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │   Kernel Layer            │
                         │   (FlashInfer / CUTLASS / │
                         │    Triton / cuBLAS)       │
                         └──────────────────────────┘
```

### Key Interfaces

1. **Tribunus → Dynamo**: Compute image manifest. "Here is what to run, where to run it, what receipts to emit."
2. **Dynamo → Engines**: Phase dispatch with KV page leases. "Execute this attention phase on these KV pages. Emit these receipts."
3. **Tribunus → Engines**: Numerical oracle verification. "Prove your output matches the FP32 reference within tolerance."
4. **Engines → KV Transport**: Read/write KV blocks through standardized page handles. The KV transport layer abstracts CXL, NVLink, RDMA, and unified memory behind a uniform interface.

---

## 7. Implementation Priorities

### Phase 1: Assessment Infrastructure (3-4 weeks)
- Implement the assessment harness: benchmark vLLM vs TRT-LLM vs SGLang for attention, prefill, and decode on available hardware.
- Build the assessment receipt database (ADR 0034 Layer 0).
- Integrate numerical oracle for cross-engine correctness verification.

### Phase 2: Compute Image for Datacenter (2-3 weeks)
- Extend Tribunus' compute-image model to support per-engine phase assignments.
- Implement the placement manifest format: "phase X → engine Y at compression level Z."
- Build the receipt specification for multi-engine execution.

### Phase 3: Dynamo Integration (2-3 weeks)
- Build the Tribunus → Dynamo compute image handoff.
- Implement execution verification: compare runtime receipts against expected profile.
- Add degraded-path detection and re-assessment triggers.

### Phase 4: Cross-Engine KV (3-4 weeks)
- Define the portable compressed KV format.
- Build KVServe-style adaptive compression with multi-engine decode contracts.
- Integrate with TraCT-compatible CXL transport where hardware is available.

### Phase 5: Kernel Assessment Loop (ongoing)
- Integrate FlashInfer-Bench's kernel generation pipeline.
- Extend to non-CUDA backends via PhaseIR.
- Build the automated assessment → admission → freeze → verification loop.

---

## 8. Open Questions

1. **Dynamo vs self-built orchestrator?** Dynamo is the clear choice for NVIDIA-centric deployments. For AMD-only or heterogeneous deployments, a Tribunus-native orchestrator may be simpler. How much of Dynamo's SLO planning can be reused for non-NVIDIA hardware?

2. **KV format standardization.** Can the industry converge on a portable KV cache format (analogous to ONNX for models)? Or is this a Tribunus-proprietary format that engines adopt through connectors?

3. **Receipt overhead at scale.** Per-token receipts for every phase could generate substantial data at datacenter throughput. What sampling strategy balances observability with overhead?

4. **Cold-start vs warm inference.** Dynamo's ModelExpress cold-start optimization and Tribunus' compute-image model both address the cold-start problem from different angles. Can they be unified?

5. **Community adoption.** Tribunus Datacenter requires engine integrations (vLLM KV connector, SGLang routing plugin, TRT-LLM plugin). How much of this must Tribunus build vs community contributions?

---

## 9. References

- vLLM: [PagedAttention (SOSP 2023)](https://arxiv.org/abs/2309.06180), [vLLM V1 Architecture](https://docs.vllm.ai/en/latest/design/arch_overview.html)
- SGLang: [SGLang: Efficient Execution of Structured Language Model Programs (NeurIPS 2024)](https://arxiv.org/abs/2312.07104), [RadixAttention](https://lmsys.org/blog/2024-01-17-sglang/)
- TensorRT-LLM: [NVIDIA TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM), [In-flight Batching](https://nvidia.github.io/TensorRT-LLM/batching.html)
- KVServe: [KVServe: Service-Aware Adaptive KV Compression for Disaggregated LLM Serving (arXiv 2026)](https://arxiv.org/abs/2505.22671)
- FlashInfer-Bench: [FlashInfer-Bench (2025)](https://flashinfer.ai), [FlashInfer Kernel Library](https://github.com/flashinfer-ai/flashinfer)
- TraCT: [TraCT: Disaggregated LLM Serving with CXL Shared Memory KV Cache at Rack-Scale (arXiv 2026)](https://arxiv.org/abs/2505.22674)
- NVIDIA Dynamo: [NVIDIA Dynamo (GTC 2025)](https://developer.nvidia.com/dynamo), [Dynamo GitHub](https://github.com/ai-dynamo/dynamo)
- Tribunus: ADRs 0034 (Compiled Inference), 0035 (Model Virtual Memory), 0036 (Arena/Ring/Lease Runtime), 0037 (Backend Realization Contract), 0038 (Numerical Governance)
