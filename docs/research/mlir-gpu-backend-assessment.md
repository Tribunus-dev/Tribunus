# MLIR GPU Dialect Assessment for Tribunus Compiler Backend

**Status:** Research Report — June 2026
**Audience:** Tribunus architecture team
**Question:** Should Tribunus adopt MLIR as its canonical compiler IR and GPU lowering infrastructure, replacing or supplementing custom PhaseIR codegen?

---

## Executive Summary

**Recommendation: Do not adopt MLIR as the canonical compiler IR. Use MLIR selectively as a lowering library for specific backends where it provides a proven, mature path (SPIR-V for Vulkan, NVVM for CUDA), but keep PhaseIR as the canonical representation.**

The MLIR GPU ecosystem is real and advancing rapidly, but adopting it wholesale would add 2-4 quarters of integration work for uncertain gain. The most pragmatic strategy is thin MLIR integration on a per-backend basis, treating MLIR dialects as compilation targets from PhaseIR rather than replacing PhaseIR. This preserves Tribunus' architectural bets (deterministic compilation, residency planning, receipts, speculative KV transactions) while leveraging MLIR's GPU code generation where it is most mature.

---

## 1. The MLIR GPU Landscape in 2025-2026

### 1.1 Core Dialect Status

| Dialect | Status | Maturity | Tribunus Relevance |
|---|---|---|---|
| **gpu** (generic GPU) | Active development, "more likely to change" | Moderate | Kernel launch abstraction, gpu.module/gpu.func for device code |
| **nvgpu** (NVIDIA-specific) | Active, targeting Blackwell features | High | TMA, async copy, warp-group MMA — Hopper/Blackwell tensor ops |
| **nvvm** (NVIDIA PTX) | Stable, default pipeline | High | CUDA binary generation via PTX → CUBIN |
| **rocdl** (AMD ROCm) | Active, MI300X/MI350X features in progress | Moderate | AMD GPU compute via ROCm intrinsics |
| **spirv** (Khronos SPIR-V) | Stable, serialization/deserialization | High | Vulkan, OpenCL, cross-vendor GPU targets |
| **mps** (Apple Metal) | Community development, AIR bitcode emission | Low | Apple GPU, bypasses Metal Shading Language compilation |
| **tosa** (Tensor Operator Set) | Stable, upgrading to v1.0 (breaking changes) | High | Common ingestion point for ML models |

**Key finding**: The GPU dialect itself is undergoing a cleanup in 2025. An RFC proposes removing ops that don't align with the dialect's core semantics, with a "two-target rule" — ops must lower to at least two GPU targets to justify their existence. This signals that multi-vendor portability is a goal, not yet a reality, for the generic GPU dialect.

### 1.2 Lowering Pipelines

The standard MLIR GPU lowering pipeline works as follows:

```
TOSA (high-level ML ops)
  → Linalg (linear algebra, tiling)
    → Vector (SIMD, vectorization)
      → GPU (kernel launch abstraction)
        → NVVM / ROCDL / SPIR-V / MPS (vendor-specific)
          → PTX / AMDGPU / SPIR-V / AIR (binary codegen)
```

This is a real, working pipeline — but it requires explicit parallelization transforms before reaching the GPU dialect. The GPU dialect **does not** parallelize code; it provides an abstraction over already-parallelized IR. Users must apply transformations (tiling, distribution to thread blocks, mapping to threads) before the GPU dialect can consume the IR.

For inference specifically, the lowering path for a transformer model would look like:

```
StableHLO / TOSA (model graph)
  → Linalg (matmul, softmax, layer norm as linalg.generic)
    → Transform dialect (tiling decisions, fusion, scheduling)
      → Vector (SIMD width selection)
        → GPU (gpu.launch_func)
          → Target dialect (NVVM / ROCDL / SPIR-V / MPS)
```

This is a substantial pipeline. Each stage has its own patterns, constraints, and configuration decisions.

### 1.3 CUDA Lowering: The Strongest Path

The `gpu-lower-to-nvvm-pipeline` is the most mature MLIR GPU lowering path:

- Dialects lowered: arith, memref, scf, vector, gpu, nvgpu → NVVM
- NVVM → PTX via LLVM's NVPTX backend
- PTX → CUBIN via CUDA driver's "last mile" JIT
- Supports Tensor Cores via nvgpu.mma operations (warp-group MMA on Hopper/Blackwell)
- "CUDA Tile IR" presented at MLIR Workshop 2026 — a tile-based dialect for vendor-specific optimization

**Assessment for Tribunus**: If Tribunus targets NVIDIA GPUs, the NVVM pipeline is the right path. It is production-grade at Google (IREE uses it), and the nvgpu dialect exposes tensor core operations that would otherwise require inline PTX assembly. Tribunus should generate MLIR from PhaseIR → NVVM for CUDA, not write PTX or CUDA C.

### 1.4 ROCm Lowering: Improving Fast

- ROCDL dialect for AMD GPU intrinsics
- EuroLLVM 2026 presentations on TOSA/Linalg → AMDGPU/ROCDL compilation
- MI300X/MI350X features: double-rate MFMAs, DirectToLDS, MXFP4/FP4
- Micro-kernel path for ROCm being fleshed out (was lagging behind CUDA)

**Assessment for Tribunus**: The ROCm path is younger than CUDA but advancing quickly. AMD is investing in MLIR as their unified AI software strategy, including Vulkan/SPIR-V portability between AMD and NVIDIA GPUs. This is a second-tier priority after CUDA but should be tracked.

### 1.5 SPIR-V Lowering: Cross-Vendor Baseline

- SPIR-V is an "egress dialect" with serialization/deserialization
- IREE uses it for Vulkan, which covers AMD, Intel, NVIDIA, ARM, Qualcomm GPUs
- OpenCL support via SPIR-V is being brought up
- Micro-kernel path for SPIR-V being developed
- "The Long Tail of AI: SPIR-V in IREE and MLIR" at Vulkanised 2025 highlighted upstream ML kernel development via SPIR-V

**Assessment for Tribunus**: SPIR-V is the most portable path for GPU compute. It's the right choice for Vulkan backends (Intel Arc, AMD RDNA, integrated GPUs). The SPIR-V dialect is stable enough for production use via IREE. Tribunus should use SPIR-V for any backend targeting Vulkan.

### 1.6 Metal Lowering: Least Mature, Strategic Importance

- An MPS (Metal Performance Shaders) dialect exists with AIR bitcode emission capability
- Bypasses Metal Shading Language compilation (faster, more predictable code structure)
- Requires Apple's `xcrun metallib` for final packaging
- Community-driven, not a core LLVM focus
- IREE's Metal HAL support is described as "foundational" with future plans

**Assessment for Tribunus**: The Metal path is the weakest link in MLIR GPU lowering — and unfortunately, it's Tribunus' primary target. Until Metal support rivals SPIR-V/NVVM maturity, MLIR adds complexity without delivering value for the v1 platform. Apple's WWDC26 developments (M5 neural accelerator, Metal TensorOps, quantized data types) will make Metal a richer target, and MLIR's MPS dialect could eventually lower directly to these features. But today it's not ready to replace MLX or hand-tuned Metal kernels.

---

## 2. IREE as a Runtime: Assessment

### 2.1 IREE Runtime Architecture

IREE's runtime model:
- **Compiler**: MLIR-based, progressive lowering through IREE-specific dialects (flow, stream, hal)
- **Runtime**: Lightweight (~30KB) host VM + HAL (Hardware Abstraction Layer)
- **Deployable artifact**: FlatBuffers binary with multi-vendor kernel variants
- **Device dispatch**: HAL selects appropriate variant at runtime based on device capabilities

### 2.2 Backend Maturity Matrix

| Backend | Status | Performance | Blockers for Tribunus |
|---|---|---|---|
| **Vulkan/SPIR-V** | Mature | "Reasonable across all GPUs" | No residency contracts, no page leasing |
| **CUDA** | Functional | BERT training demonstrated | No KV cache management, no speculative pages |
| **Metal** | Foundational | Unknown | Least mature, critical for v1 |
| **CPU (LLVM)** | Mature | Good | Not relevant for GPU inference |

### 2.3 Architectural Mismatch with Tribunus

IREE's architecture conflicts with Tribunus' core design principles:

| Tribunus Requirement | IREE Behavior | Gap |
|---|---|---|
| **All decisions at compile time** | Runtime selects kernel variants | Tribunus requires compile-time winner freezing |
| **Residency manifest** | No page residency concept | Tribunus needs MANDATORY/HOT/WARM/COLD tiers |
| **Phase graph execution** | DAG of HAL commands | Tribunus has explicit phase contracts with lease semantics |
| **Per-token receipts** | No receipt infrastructure | Tribunus requires backend/wallclock/copy receipts |
| **Speculative KV transactions** | No fork/rollback semantics | Tribunus needs CoW page tables for speculation |
| **Arena memory planning** | Dynamic allocation | Tribunus pre-plans all memory at compile time |
| **Fused region binaries** | Yes (via linalg fusion) | Compatible, but boundary decisions differ |
| **Model virtual memory** | No page fault handling | Tribunus pages weights from disk with prefetch |

**Summary**: IREE is a general-purpose ML runtime. Tribunus is a deterministic inference state machine. The two architectures pull in opposite directions on most design dimensions. Adapting IREE to support Tribunus' Layer 0-3 model would require modifications deep in the HAL and VM that exceed the value of reusing IREE.

IREE could serve as a **compiler library** (using its MLIR lowering pipelines without its runtime), but its runtime is not a good fit for Tribunus' deterministic execution model.

### 2.4 IREE's Value as a Compiler (Not Runtime)

What IREE's compilation pipeline provides that Tribunus could use:

- **Proven dialect lowering**: TOSA → Linalg → Vector → GPU → SPIR-V/NVVM. These passes are debugged, tested, and maintained.
- **Kernel selection at compile time**: IREE compiles multiple SPIR-V variants. Tribunus could freeze the winner rather than letting the runtime select.
- **Micro-kernel infrastructure**: The emerging micro-kernel path for SPIR-V and ROCm could generate fused region implementations.

**Recommendation**: Use IREE's MLIR compilation passes as a library for backends beyond Metal. Do not adopt IREE's runtime.

---

## 3. CIRCT / ESI / Calyx: Spatial Architecture Relevance

### 3.1 Overview

| Project | What It Does | Tribunus Relevance |
|---|---|---|
| **CIRCT** | MLIR for hardware design — SystemVerilog codegen | FPGA/ASIC targeting only |
| **Calyx** | Compiler for hardware accelerators | FPGA accelerator synthesis |
| **ESI** | Standardized hardware interconnects | Inter-module communication fabrics |

CIRCT/Calyx targets the *hardware generation* problem: take a computation description and produce synthesizable RTL. This is relevant if Tribunus ever targets custom silicon or FPGA accelerators. For GPU/CPU/NPU targets, CIRCT is not applicable.

### 3.2 Tenstorrent Bridge

TT-Forge (Tenstorrent's MLIR-based compiler) could serve as a bridge, but Tribunus already has a direct TT-Metalium plan (ADR 0030). The direct path is simpler and more stable — TT-Metalium is the vendor's low-level SDK, not a research compiler. TT-Forge integration remains optional.

### 3.3 Calyx for FPGA Acceleration

If Tribunus ever targets embedded FPGA accelerators (e.g., for MoE routing or token classification on device), Calyx provides a PyTorch → Calyx → SystemVerilog pipeline (Dec 2025 paper). This is speculative and merits a separate research ADR if the requirement materializes.

---

## 4. MLIR vs Triton for Inference Kernels

### 4.1 The Triton Advantage

Triton has become the de facto standard for GPU kernel development in ML inference for good reasons:

- **Productivity**: Python DSL, 90-95% of hand-tuned CUDA performance
- **Autotuning**: Built-in tile size, pipeline depth optimization
- **Portability**: NVIDIA (primary), AMD (growing), Intel (experimental)
- **Ecosystem**: PyTorch TorchInductor uses Triton as its primary GPU backend
- **MLIR foundation**: Triton v3 is built on MLIR — it uses a Triton dialect, middle-end optimizations, and LLVM GPU backends

Writing a fused attention kernel in Triton takes hours. Writing the same kernel directly in MLIR (Linalg → Vector → GPU → NVVM) takes days and requires understanding five dialects.

### 4.2 When MLIR Is Better Than Triton

- **Cross-vendor code generation**: MLIR can emit SPIR-V, PTX, AMDGPU, and Metal from the same IR. Triton targets NVIDIA/AMD only (no Metal, no SPIR-V).
- **Compiler research**: MLIR's extensible dialect system lets you add custom passes. Triton is a fixed pipeline optimized for GPU matmul/attention patterns.
- **Non-GPU targets**: MLIR can lower to CPU (LLVM), NPU (via custom dialects), and even FPGA (via CIRCT). Triton is GPU-only.
- **Integration with larger compilation flows**: MLIR can host optimization passes that span the model graph, not just individual kernels.

### 4.3 The Triton-MLIR Relationship

Triton *is* an MLIR-based compiler. It adds a Triton dialect on top of MLIR's infrastructure:

```
Triton Python DSL
  → Triton MLIR dialect (tt.load, tt.dot, tt.store)
    → Triton GPU dialect optimizations (coalescing, pipelining, prefetch)
      → LLVM IR (via MLIR LLVM dialect)
        → PTX (via NVPTX backend)
```

This means: using MLIR directly gives you *more control* than Triton but *less productivity*. The right strategy for Tribunus is:

1. **Metal v1**: Hand-tuned Metal kernels via MLX fork (already planned in ADR 0034). Metal is not a Triton target and the MPS dialect is immature.
2. **CUDA v1**: Generate NVVM dialect IR from PhaseIR, lower through MLIR's NVVM pipeline. This avoids writing CUDA C or inline PTX.
3. **Vulkan/SPIR-V**: Generate SPIR-V dialect IR from PhaseIR, use MLIR's SPIR-V serialization.
4. **Triton as a developer tool**: Use Triton for rapid kernel prototyping and autotuning, then lower Triton-generated MLIR to the target dialect. This is the path TorchInductor takes.

---

## 5. The Central Question: MLIR as Canonical IR vs PhaseIR

### 5.1 What MLIR Would Replace

If MLIR became the canonical IR, it would replace:

- **PhaseIR** (the 42 canonical phases — embed, norm, attention, etc.)
- **Pipeline 3** (canonical phase lowering)
- **Pipeline 4** (backend candidate generation — partially)
- **Pipeline 6** (fusion and region formation — partially)

PhaseIR's current state: `research/docs/pipeline-stages.md` defines 42 stages. The phases are a deliberately limited set. Each has strict contracts. The phase graph is static for a given model.

### 5.2 What MLIR Could Represent

MLIR could represent the same information:

- **TOSA dialect**: tensor-level ops (matmul, softmax, layer norm, attention) that map to Tribunus' canonical phases
- **Linalg dialect**: generic linear algebra with tiling and fusion annotations
- **Transform dialect**: schedule transformations (tiling, vectorization, distribution)
- **GPU dialect**: kernel launch, threadgroup configuration, memory hierarchy

A Tribunus "canonical phase" could be one of:
- A TOSA op (tosa.matmul, tosa.negate + tosa.add for residual)
- A custom Tribunus dialect op (tribunus.rope, tribunus.kv_append, tribunus.speculative_verify)
- A Linalg structured op with a defined computation and indexing maps

### 5.3 Tradeoff Analysis

| Dimension | PhaseIR (Custom) | MLIR as Canonical IR |
|---|---|---|
| **Expressiveness** | Purpose-built for transformer inference. Can represent exactly what Tribunus needs. | General-purpose. Can represent anything but the transformer-specific semantics are implicit. |
| **Stability** | Tribunus controls the IR. No upstream churn. | GPU dialect "more likely to change." TOSA v1.0 has breaking changes. Dependence on LLVM release cycle. |
| **Tooling** | Minimal — custom verifier, custom serializer. | Rich — verifiers, pretty-printers, passes, transformation infrastructure. |
| **Lowering pipelines** | Must write every lowering pass for every target. | Free lowering to NVVM, ROCDL, SPIR-V, LLVM CPU. |
| **Optimization passes** | Must write every fusion, tiling, vectorization pass. | Linalg/Vector/Transform dialects provide these. |
| **Language dependency** | Rust (Tribunus' primary language). | C++ (MLIR is C++17). Requires FFI bridge. |
| **Build complexity** | None — standard Rust crate. | LLVM/MLIR build (~30 min on M1 Max, ~15 GB). Adds C++ toolchain dependency. |
| **Portability story** | Must implement each backend from scratch. | Backends exist for major GPU targets. |
| **Team expertise** | Rust compiler engineering. | MLIR/LLVM compiler engineering (different skill set). |
| **Ecosystem compatibility** | No automatic ONNX/TFLite/PyTorch import. | Import via TOSA/StableHLO from standard frameworks. |
| **Phase contract enforcement** | Type-level contracts in Rust. | MLIR verifiers + custom dialect constraints. |
| **Residency/page planning** | First-class in PhaseIR. | Must be layered on top — not a native MLIR concept. |
| **Receipt emission** | Built into the execution model. | Not represented in MLIR. |

### 5.4 The Verdict

**PhaseIR is the right canonical IR for Tribunus.** Here's why:

1. **The IR's job is to represent *what* Tribunus compiles, not *how* it lowers to hardware.** PhaseIR's 42 canonical phases capture exactly the transformer inference semantics Tribunus needs. MLIR would require building a custom dialect anyway to represent speculative KV transactions, page leases, residency tiers, and receipt contracts — at which point you've done the work of PhaseIR but in C++ with LLVM build dependencies.

2. **The lowering infrastructure MLIR provides is valuable, but it operates best as a *target dialect* from PhaseIR, not as a replacement for PhaseIR.** The proven strategy is: PhaseIR → generate target-specific MLIR → use MLIR's lowering pipelines to GPU code. This is what IREE does (ONNX/StableHLO → MLIR → GPU), what Triton does (Python → Triton dialect → MLIR → GPU), and what Tribunus should do (PhaseIR → per-backend MLIR → GPU).

3. **The Metal gap is decisive.** MLIR's weakest GPU path is Metal — and Tribunus must excel on Metal first. Committing to MLIR as the canonical IR when the v1 platform's primary backend is the least mature MLIR path is the wrong bet. MLX fork + hand-tuned Metal kernels (ADR 0034) is the right v1 path. MLIR can join later for CUDA/SPIR-V.

4. **Tribunus' architectural bets are not MLIR-shaped.** Page residency, arena planning, speculative KV transactions, receipt emission — these are not concepts MLIR represents natively. Building them in Rust on top of PhaseIR gives Tribunus full control. Building them in MLIR requires either extending MLIR dialects (C++, upstream contributions) or building a parallel data structure (two sources of truth).

---

## 6. Recommended Integration Strategy

### 6.1 Phase 1: Metal v1 (No MLIR)

- Continue with MLX fork + hand-tuned Metal kernels (ADR 0034)
- Direct Metal Shading Language kernel generation
- Core ML MIL island generation via `coremltools`
- No MLIR dependency for v1 delivery

### 6.2 Phase 2: CUDA via MLIR NVVM Pipeline (Thin Integration)

When Tribunus adds NVIDIA support (ADR 0032):

```
PhaseIR (Rust)
  → Generate MLIR NVVM dialect IR (Rust → C FFI → MLIR C API)
    → gpu-lower-to-nvvm-pipeline (upstream MLIR passes)
      → PTX
        → CUBIN (via CUDA driver JIT)
```

- Use MLIR's C API (`mlir-c/`) for Rust integration
- Generate only the NVVM dialect ops needed for each canonical phase
- No TOSA, no Linalg — go directly from PhaseIR to NVVM for matmul, attention, etc.
- Custom dialect ops for Tribunus-specific semantics (KV cache page access, speculative verify)
- This avoids the full TOSA→Linalg→Vector→GPU pipeline and gives Tribunus control over tiling and scheduling

### 6.3 Phase 3: Vulkan/SPIR-V via MLIR SPIR-V Dialect

For Intel Arc, AMD RDNA, and integrated GPUs (ADRs 0029, 0031):

```
PhaseIR (Rust)
  → Generate MLIR SPIR-V dialect IR
    → SPIR-V serialization
      → Vulkan dispatch
```

- Same thin integration pattern as CUDA
- SPIR-V dialect is stable — lower risk than the full GPU pipeline
- Reuse SPIR-V lowering infrastructure from IREE (as a library, not a runtime)

### 6.4 Phase 4: Metal MLIR (When Ready)

When the MPS dialect matures or an alternative Metal lowering path stabilizes:

- Evaluate whether generating AIR bitcode via MLIR outperforms MLX's Metal JIT
- Track WWDC26 Metal developments (M5 neural accelerator, TensorOps, quantized types)
- Only adopt when the Metal path is demonstrably better than hand-tuned MSL

### 6.5 Do Not Adopt

- **IREE runtime**: Architectural mismatch with Tribunus' deterministic execution model
- **MLIR as canonical IR**: Wrong tradeoff for Tribunus' domain
- **Triton compiler**: Not a Metal target, not a SPIR-V target. Use for CUDA kernel prototyping only.
- **CIRCT/Calyx**: Not relevant until FPGA acceleration is a concrete requirement

---

## 7. Risk Assessment

### 7.1 Risks of Not Adopting MLIR Now

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| MLIR becomes the universal GPU IR standard | Medium | Medium | Thin integration strategy keeps the door open |
| Rewriting lowering passes for each backend | High | Medium | Accept as cost of design control; MLIR lowering passes are thin wrappers per backend |
| Missing free optimizations from Linalg/Vector dialects | Medium | Low-Medium | Tribunus' domain is narrow enough that custom passes can match MLIR |
| Competitor advantage from MLIR ecosystem | Medium | Low | No competitor has Tribunus' deterministic compilation model; MLIR adoption alone doesn't provide it |

### 7.2 Risks of Adopting MLIR Now

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GPU dialect instability ("more likely to change") | High | High | Wait for dialect stabilization before adopting |
| Metal path immaturity blocks v1 delivery | High | Critical | Use MLX fork + MSL for v1 |
| C++ build dependency adds complexity | Certain | Medium | Accept for CUDA/SPIR-V backends only |
| MLIR learning curve slows team | High | Medium | Limit to thin integration, not full build system ownership |
| TOSA v1.0 breaking changes cause churn | Certain | Medium | Skip TOSA; generate target dialects directly |

---

## 8. Concrete Recommendations

1. **Keep PhaseIR as the canonical compiler IR.** It is purpose-built, stable, and already represents Tribunus' architectural decisions (residency, receipts, speculation, page leasing).

2. **Generate MLIR on a per-backend basis from PhaseIR.** Write thin Rust→MLIR bridges for NVVM (CUDA) and SPIR-V (Vulkan). Go directly to the target dialect — do not use the full TOSA→Linalg→Vector→GPU progressive lowering pipeline.

3. **Use MLIR's `mlir-c` API for Rust integration.** No C++ in the hot path. The bridge converts PhaseIR contracts to MLIR dialect ops, invokes the lowering pipeline, and extracts the binary. All Tribunus logic stays in Rust.

4. **Track but do not adopt**: IREE runtime, CIRCT/Calyx, Triton (beyond prototyping), MPS dialect (until mature).

5. **Re-evaluate in 2027**: When Metal path is mature, when GPU dialect is stable, when TOSA v1.0 has shipped — reassess whether MLIR should host more of the compilation pipeline.

---

## 9. Comparison: PhaseIR + Thin MLIR vs. Full MLIR Adoption

| | PhaseIR + Thin MLIR (Recommended) | Full MLIR Adoption |
|---|---|---|
| **Time to Metal v1** | Current (MLX fork) | +3-6 months (MPS dialect work) |
| **Time to CUDA** | +4-6 weeks (NVVM bridge) | +2-3 months (full pipeline) |
| **Time to Vulkan** | +3-4 weeks (SPIR-V bridge) | +2-3 months (TOSA pipeline) |
| **Build dependencies** | Rust + optional LLVM | LLVM/MLIR required |
| **Team skill** | Rust + GPU backend expertise | C++ MLIR expertise required |
| **Custom optimizations** | Full control | MLIR pass infrastructure |
| **Ecosystem compatibility** | Manual import from PyTorch | TOSA/StableHLO import free |
| **Design control** | Complete | Constrained by upstream MLIR |
| **Residency / receipts** | First-class in PhaseIR | Must be layered on top |

The thin integration approach delivers the value of MLIR's GPU lowering (tested, maintained, cross-vendor) without sacrificing Tribunus' architectural control. Every backend gets exactly the MLIR surface it needs, and no more.

---

## Sources

- MLIR GPU Dialect documentation: `llvm.org/docs/MLIR/GPU.html`
- GPU dialect cleanup RFC: LLVM Discourse, September 2025
- "CUDA Tile IR" presentation: MLIR Workshop 2026
- IREE Vulkan/Metal/CUDA documentation: `iree.dev`
- "The Long Tail of AI: SPIR-V in IREE and MLIR": Vulkanised 2025
- EUROML 2026: TOSA/Linalg to AMDGPU/ROCDL compilation flow
- MLIR Metal (MPS) dialect: `readthedocs.io/mlir-metal`
- Triton compiler MLIR integration: `triton-lang.org`
- CIRCT/Calyx/ESI: `circt.llvm.org`, `calyxir.org`
- Tenstorrent TT-Forge MLIR compiler: TT documentation
- Apple WWDC26 Metal developments: Metal TensorOps, M5 neural accelerator
- Tribunus ADRs 0030-0037: Backend and compilation architecture
