# ADR 0031: Intel Multi-Engine Backend — Arc Xe GPU, NPU, and AMX CPU Inference for Tribunus Compute

## Status
Proposed — June 2026

## Context

Intel's compute architecture spans three distinct engines that map to Tribunus' multi-backend model:

| Engine | Hardware | Performance | API |
|---|---|---|---|
| Arc Xe GPU (Battlemage Xe2) | B580: 20 Xe-cores, 160 XMX | 14.6 FP32 TFLOPS, 233 INT8 TOPS | Level Zero / SYCL |
| Intel NPU | Meteor Lake / Lunar Lake / Arrow Lake | 10-45 INT8 TOPS | OpenVINO |
| CPU AMX | Granite Ridge P-cores, Lunar Lake E-cores | 2x AVX-512 VNNI throughput | x86 AMX intrinsics |

This three-engine architecture mirrors both Apple Silicon (GPU + ANE + AMX) and AMD Ryzen (RDNA3 + XDNA + Zen4 AMX). The Intel backend is the third port in Tribunus' multi-platform strategy with significant code reuse from the AMD64 port:

- CPU dispatch layer (zenblas.rs) — ~80% shared (same x86 AMX instruction encoding)
- GPU backend — ~70% shared (Level Zero replaces Vulkan but kernel structure is identical)
- NPU bridge architecture — ~60% shared (OpenVINO replaces ONNX Runtime C API)
- Placement routing table — ~90% shared (add Intel-specific capability descriptions)

## Decision

Implement three Intel compute backends — Arc Xe GPU (via oneAPI/Level Zero), Intel NPU (via OpenVINO), and CPU AMX (via AMX intrinsics + OpenBLAS) — following the same five-layer architecture as the AMD64 port (ADR 0029) with engine-specific substitutions.

### Layer 1: Arc Xe GPU Backend (Level Zero + SYCL)

Level Zero is the appropriate low-level API for Tribunus because it provides direct control over XMX engine dispatch, device-local memory, and command synchronization without driver overhead.

**arc_inventory.rs:** Device discovery via zeDeviceGet, query Xe-core count, XMX engine count, VRAM size, EU count per subslice.

**arc_executor.rs:** Command queue management, kernel dispatch, synchronization via zeFence.

**arc_backend.rs:** TensorBackend trait implementation dispatching SYCL-compiled SPIR-V kernels.

XMX engines process 8x8x16 INT8 tiles per clock. The 160 XMX engines on B580 dispatch 256+ parallel tile operations per wave. Kernel compilation uses SYCL's offline compiler (icpx -fsycl) to produce SPIR-V binaries loaded via zeModuleCreate, avoiding runtime compilation.

Device-local VRAM management:
- zeMemAllocDevice for GPU-only weights
- zeMemAllocShared for zero-copy weight upload on integrated SKUs
- zeCommandListCopy for explicit staging on discrete SKUs

| Model | Arc B580 (projected) |
|---|---|
| 7B Q4 single batch | 20-30 tok/s |
| 7B Q4 batch 16 | 200-300 tok/s |
| 13B Q4 single | 10-15 tok/s |

### Layer 2: Intel NPU Backend (OpenVINO)

The NPU is accessed through OpenVINO's C API (ov_core.h). Implementation follows the same pattern as the XDNA NPU bridge (ADR 0029, Layer 3):

**openvino_bridge.rs:** Rust FFI to ov_core.h
**openvino_state.rs:** Model loading via ov_core_read_model, NPU compilation via ov_compile_model(device="NPU")
**openvino_pipeline.rs:** Subgraph partitioner for NPU-compatible INT8 operations

The NPU excels at:
- Speculative decoding draft models (1-2 layer transformers, ~30 tok/s)
- Low-power background inference (reranking, embedding)
- Offloading small models when the GPU is power-gated

### Layer 3: CPU AMX Backend

Intel AMX provides tile-based matrix operations via x86 AMX tile intrinsics. The CPU dispatch layer (zenblas.rs from ADR 0029) already selects between AMX, OpenBLAS, and AVX2. Adding Intel AMX extends the dispatch table with Intel tile instructions at the same intrinsic level as AMD Zen4 AMX — the same code path covers both vendors.

Detection: `__builtin_cpu_supports("amx-tile")` or /proc/cpuinfo flags amx_tile / amx_bf16 / amx_int8.

### Layer 4: Multi-Engine Routing

The placement_profile.rs and routing.rs select between Arc GPU, NPU, and CPU AMX based on operation type, model size, latency requirement, and power state. This is a superset of the AMD64 routing table.

### Layer 5: Profiling and Monitoring

- GPU: Level Zero zeEvent for command-level timing
- NPU: OpenVINO ov_infer_request_get_profiling_info
- CPU AMX: Linux perf tile instruction counters

### Additional Backend: oneDNN Integration

Intel oneDNN provides optimized primitives for AMX, AVX-512, and Xe GPUs. The CPU dispatch layer should detect oneDNN at build time and prefer it over OpenBLAS when available.

### Risk and Mitigation

- **Level Zero fragmentation**: Varies between integrated and discrete Arc. Maintain a capability switch in the inventory.
- **OpenVINO NPU support varies**: Gracefully fall back to CPU if the NPU is absent or unsupported.
- **XMX utilization**: Use SYCL's ext_intel_math library for XMX-specific matrix operations.
- **Driver dependency**: Intel GPU compute on Linux requires intel-opencl-icd and level-zero. Include in installation scripts.

## Consequences

### Positive

- Third multi-engine port with ~70% code reuse from AMD64
- Highest raw consumer throughput (B580: 233 INT8 TOPS)
- NPU for power-efficient background inference
- AMX reuse from AMD64 port (same x86 instruction encoding)
- oneDNN optimization eliminates hand-tuned CPU dispatch

### Negative

- Two different low-level GPU APIs to maintain (Level Zero + Vulkan)
- OpenVINO C API less mature than ONNX Runtime
- Intel GPU compute driver stability historically weaker than AMD ROCm
- NPU absent on desktop platforms

### Estimated Effort

4-6 weeks (single developer) with AMD64 port complete. 8-10 weeks from scratch.

### Hardware Recommendation

Arc B580 (12 GB, $250 USD) for GPU. Any Meteor Lake/Lunar Lake laptop with OpenVINO NPU for NPU. NPU development can proceed in CPU emulation mode without NPU hardware.
