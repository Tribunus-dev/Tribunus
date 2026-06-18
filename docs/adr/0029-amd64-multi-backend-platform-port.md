# ADR 0029: AMD64 Multi-Backend Port — Porting the Apple Silicon Compute Stack to AMD Ryzen 7040/8040 Series

## Status
Proposed — June 2026

## Context

Tribunus Compute currently targets Apple Silicon natively via three execution backends:

- MLX Metal for GPU inference
- Accelerate (vDSP/BNNS/vForce) for CPU inference
- CoreML for the Apple Neural Engine

This provides working inference on Apple Silicon hardware at competitive performance but locks Tribunus to Apple's ecosystem. The AMD Ryzen 7040HS (Phoenix) and 8040 series (Hawk Point) processors present an attractive Linux development and deployment target with a three-engine architecture that mirrors Apple Silicon:

| Apple Silicon | AMD 7040/8040 Series |
|---|---|
| CPU + AMX coprocessor | Zen4 CPU + AMX tile instructions |
| Metal GPU (M1 ~2.6 TFLOPS) | RDNA3 iGPU 12CU (~3.4 TFLOPS FP16) |
| Apple Neural Engine (~11 TOPS) | XDNA NPU (~16 TOPS INT8) |

The AMD stack has the critical advantage of open driver stacks: ROCm for GPU profiling, ONNX Runtime EP for NPU, and standard Linux perf/oprofile for CPU. At current hardware pricing (~$450 for a Minisforum UM790 Pro with 32 GB, ~$600 with 64 GB), an AMD64 development machine costs roughly equivalent to an M1 Mac Mini while offering more RAM and a fully open multi-backend development environment.

The TensorBackend trait, compiler IR, fusion planner, placement engine, executor, KV cache, and all test infrastructure are already backend-agnostic — approximately 32,000 lines of the codebase require no changes. The port is a rewrite of approximately 5,000 lines across 5 execution layers, not a rewrite of Tribunus.

## Decision

Port the Apple Silicon compute stack to AMD64 by implementing the TensorBackend trait for AMD hardware across five layers, replacing approximately 5,000 lines of Apple-specific code while preserving approximately 32,000 lines of backend-agnostic infrastructure untouched.

### Layer 1: GPU Inference Backend (Vulkan Compute)

**Apple files (~1,400 lines):** mlx_executor.rs, mlx_inventory.rs, mlx_patch_register.rs, gemma.rs

**AMD replacement:** vulkan_executor.rs + vulkan_inventory.rs + vulkan_pipeline.rs

The MLX Metal backend dispatches quantized matmul, RMS norm, RoPE, fused SiLU, and attention through Apple's Metal Performance Shaders via the mlx_rs Rust crate. The AMD equivalent wraps Vulkan compute shaders for the same operations, targeting RDNA3's 12 compute units.

Vulkan is chosen over ROCm HIP for three reasons: it is the universal Linux GPU compute layer, it runs on any GPU vendor, and the llama.cpp community has already published well-optimized RDNA3 Vulkan compute shaders for all required inference primitives. These shaders need wrapping in the TensorBackend trait, not rewriting.

Implementation details:

- VkPhysicalDevice discovery via vkEnumeratePhysicalDevices, selecting the integrated RDNA3 GPU
- Device-local VkDeviceMemory for model weights, host-visible staging for input/output
- VkCommandBuffer submission with timeline semaphores for GPU-to-host synchronization
- Wrapping existing ggml-style RDNA3 Vulkan shaders for Q4/Q6/Q8 quantized matmul, flash attention, RoPE, RMS norm, SiLU
- Prefill on GPU (large matmul-bound), decode on either GPU or CPU depending on latency requirements

gemma.rs calls the TensorBackend trait. It does not call MLX directly and requires no changes.

### Layer 2: CPU Compute Backend (OpenBLAS + AMX)

**Apple files (~300 lines):** backend/accelerate.rs, backend/accelerate_ffi.rs

**AMD replacement:** backend/zenblas.rs + backend/zenblas_ffi.rs

Apple's Accelerate framework provides cblas_sgemm (matmul via AMX), BNNS (quantized matmul, softmax), vDSP (elementwise ops, transpose), and vForce (activation functions). On AMD Zen4:

- cblas_sgemm maps directly to OpenBLAS cblas_sgemm
- AMX tile intrinsics handle small fixed-size matmul tiles at high throughput
- BNNS quantized matmul maps to a direct integer matmul loop using AVX2 vpdpbusd (Zen4 VNNI instruction)
- Elementwise ops use standard libm plus AVX2 vectorized loops

The dispatch layer selects between AMX tile ops (tiles <= 64), OpenBLAS (large matmuls), and AVX2 loops (elementwise) based on operation and shape.

### Layer 3: NPU Bridge (ONNX Runtime XDNA)

**Apple files (~2,000 lines):** coreml_bridge.rs, coreml_state.rs, coreml_pipeline.rs, coreml_audit.rs, plus 4 ObjC bridge files

**AMD replacement:** xdna_bridge.rs + xdna_state.rs + xdna_pipeline.rs + 3 C bridge files

The CoreML ANE bridge compiles CoreML model packages, manages NPU memory through a private arena, and executes inference via CoreML's C API using ObjC bridge functions. The AMD XDNA NPU is accessed through ONNX Runtime's XDNA execution provider, which is open source and uses a standard C API.

The XDNA NPU is particularly well-suited for speculative decoding: the draft model runs on the NPU at low power (~30 tok/s), while the target model validates on the GPU or CPU. This workload split is physically impossible on Apple Silicon because ANE-GPU synchronization requires going through the CPU and CoreML's opaque runtime.

coreml_audit.rs is format-agnostic (it audits inference correctness, not CoreML specifics) and stays unchanged.

### Layer 4: Profiling and Monitoring

**Apple files (~6,300 lines, ~86 platform-specific gates)**

**AMD approach:** In-place modifications swapping macOS APIs for Linux equivalents.

- metal_capture.rs → rocm_capture.rs: Replace Metal GPU trace API with ROCProfiler and rocTracer
- cpu_benchmarks.rs: Replace ~50 lines of sysctl hardware queries with /proc/cpuinfo parsing. The remaining ~600 lines are platform-agnostic.
- worker_memory.rs: Replace 17 cfg(macos) gates using mach_vm calls with /proc/self/status and getrusage.
- compute_image.rs: Replace 18 Metal texture interop gates with Vulkan buffer-to-image copies in cfg(target_os = "linux") blocks

### Layer 5: Dispatch and Timing

profiled_executor.rs has a single cfg(macos) gate for Metal event-based timing. Replace with std::time::Instant wall-clock timing. The remaining 1,319 of 1,320 lines are backend-agnostic.

backend/routing.rs and capability.rs require no changes. The routing layer selects backends based on capability tables; the AMD capability table describes RDNA3 compute units, XDNA NPU cores, Zen4 AMX support, and OpenBLAS availability.

### Porting Strategy: Community Kernel Wrapping

The AMD backends should not be written from scratch. Battle-tested community implementations exist for every required primitive:

| Primitive | Source | Integration |
|---|---|---|
| Q4/Q6/Q8 quantized matmul | ggml (llama.cpp) | FFI to C functions |
| RDNA3 Vulkan compute shaders | llama.cpp Vulkan branch | Vulkan dispatch wrapping |
| Flash attention | xformers, triton, or llama.cpp Vulkan | Vulkan compute shader copy |
| NPU inference | ONNX Runtime XDNA EP | Shared library link + C API |
| BLAS matmul | OpenBLAS | FFI to cblas_sgemm |

This strategy reduces the port from kernel authoring to integration work. The first pass wraps existing code for correctness; the second pass replaces bottleneck kernels with Tribunus-native tuned implementations.

### Performance Projections

| Model | M1 MLX (current) | 7940HS ported (GPU+NPU+CPU) |
|---|---|---|
| 7B Q4 | ~35 tok/s | 35-50 tok/s |
| 13B Q4 | cannot load (16 GB) | 20-30 tok/s |
| 34B Q3 | cannot load | 10-15 tok/s |
| 70B Q2 | cannot load | 3-5 tok/s |
| 7B speculative decode | impossible (ANE-GPU lock) | 50-60 tok/s |

## Consequences

### Positive

- **Multi-platform target complete.** Tribunus gains a working Linux compute stack on cost-effective multi-backend hardware. Apple Silicon and AMD64 become first-class targets with architectural parity.
- **Open toolchain.** Vulkan, ONNX Runtime, ROCProfiler, and OpenBLAS are fully open-source, debuggable, and instrumentable. The NPU is accessible through a documented C API rather than Apple's private frameworks.
- **Speculative decode becomes possible.** The XDNA NPU + RDNA3 GPU pipeline enables workload splitting that is architecturally impossible on Apple Silicon.
- **Larger model capacity.** 64 GB RAM versus M1's 16 GB enables models up to 70B Q2 that cannot run on standard M1 hardware at all.
- **Minimal blast radius.** ~32,000 lines of the codebase require zero changes. Compiler, executor, fusion planner, KV cache, placement engine, TypeScript layer, tests, decode attribution, contracts, receipts, JSON schemas — all untouched.

### Negative

- **Discrete GPU memory model.** The iGPU has dedicated VRAM (typically 2-4 GB from system RAM). Large models require explicit paging or kernel offloading for weights exceeding VRAM. Must account for device-local GPU allocations with host-side weight paging.
- **NPU software immaturity.** The XDNA software stack is newer and less battle-tested than CoreML. Expect driver crashes, unsupported operations, and performance variability in early development.
- **Vulkan shader fragmentation.** RDNA3-tuned shaders may need adjustment for discrete Radeon GPUs or other vendors. Test on at least two RDNA-family devices.
- **AMX availability.** Zen4 AMX tile instructions may be absent on lower-end mobile SKUs. Backend must fall back to OpenBLAS or AVX2.
- **Increased test matrix.** Every test must pass on both Apple Silicon and AMD64 Linux. Each AMD backend file requires its own conformance tests.

### Estimated Effort

| Layer | Timeline |
|---|---|
| Vulkan GPU backend | 1-2 weeks |
| OpenBLAS + AMX CPU backend | 3-4 days |
| XDNA NPU bridge | 1-2 weeks |
| Profiling and monitoring | 2-3 days |
| Dispatch and timing | 1 day |
| Integration and conformance | 1 week |
| **Total** | **4-6 weeks (single developer, full-time)** |

### Hardware Recommendation

Minisforum UM790 Pro (7940HS) with 64 GB RAM (~$600-650 USD). Provides the cheapest fully open Linux development environment for building and testing all three AMD backends (CPU AMX, GPU RDNA3, NPU XDNA) on a single machine.
