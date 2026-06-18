# ADR 0032: NVIDIA GPU Backend — Discrete GPU Compute Islands via CUDA Tensor Cores

## Status
Proposed — June 2026

## Context

The AMD64 and Intel ADRs (0029, 0031) address integrated GPU scenarios — shared memory, low TDP, APU-class performance. Discrete GPUs are architecturally distinct:

- Dedicated VRAM (12-80 GB consumer, 40-192 GB pro)
- Explicit PCIe memory staging — no zero-copy for large allocations
- Independent power domain (150-450W TDP)
- Multi-GPU topologies via NVLink or PCIe peer-to-peer
- Different programming models (CUDA, ROCm HIP) than integrated GPUs (Vulkan, Level Zero)

NVIDIA's discrete GPUs dominate ML inference in production. Their Tensor Cores — specialized matrix-multiply-accumulate hardware — deliver 1-2 orders of magnitude higher throughput than GPU ALU paths for quantized matmul. From Volta V100 through Blackwell B200, Tensor Core generations have added FP8/FP4, Sparsity, asynchronous execution, and WGMMA (warp-group MMA).

The CUDA Graphs API allows dispatching an entire inference DAG as a single GPU operation, eliminating CPU dispatch overhead between ops. This maps directly to Tribunus' operation graph and fusion planner.

NVIDIA has no separate NPU — Tensor Cores serve both GPU compute and AI inference, simplifying the multi-engine routing table but removing the speculative decode split available on AMD XDNA and Intel NPU.

## Decision

Implement an NVIDIA GPU backend for Tribunus Compute as a discrete compute island — a standalone backend with its own VRAM management, PCIe staging layer, CUDA stream scheduling, and multi-GPU topology support. The Tensor Core is the primary compute target.

### The Discrete Compute Island Model

A discrete GPU is a separate compute island with:

- **Isolated memory:** Device-local VRAM not visible to the CPU. All data crosses a PCIe bus.
- **Explicit transfers:** Every host-to-device and device-to-host transfer is an explicit cudaMemcpyAsync.
- **Command isolation:** CUDA streams provide independent command sequences per inference request.
- **Independent scheduling:** The GPU scheduler manages warps independently of the CPU scheduler.

The compute island model means a complete inference DAG should be dispatched to the GPU with minimal CPU round-trips between ops. CUDA Graphs enable this exactly.

### Layer 1: CUDA FFI Bridge

C FFI layer (bridge/cuda_exec.c) wrapping the CUDA Driver API:

- Device discovery: cuDeviceGet / cuDeviceGetCount
- Context management: cuCtxCreate / cuCtxDestroy (one per GPU)
- Memory: cuMemAlloc / cuMemFree / cuMemcpyAsync (HTOD / DTOH)
- Kernel loading: cuModuleLoad / cuModuleGetFunction
- Kernel dispatch: cuLaunchKernel
- Timing: cuEventCreate / cuEventRecord / cuEventSynchronize
- CUDA Graphs: cuGraphCreate / cuGraphInstantiate / cuGraphLaunch
- Tensor Core wrappers via CUTLASS or inline PTX: quantized matmul via WMMA INT8/FP16 tiles

**cuda_bridge.rs:** Rust FFI exposing these as safe async functions on tokio::task::spawn_blocking.

### Layer 2: Tensor Core Dispatch

Three API levels for Tensor Core programming:

1. **cuBLAS Lt** (cublasLtMatmul): For large matmuls (M > 1024) — picks the best Tensor Core kernel automatically
2. **CUTLASS** template kernels: For fused operations (matmul + bias + activation in one kernel)
3. **WMMA inline** (nvcuda::wmma): For small tiles in custom fused kernels (M <= 128)

Fallback to CUDA core (non-Tensor) operations when Tensor Cores don't support the requested dtype or tile config.

### Layer 3: CUDA Graphs for DAG Dispatch

CUDA Graphs (cuGraph) eliminate CPU dispatch overhead between kernels:

1. The fusion planner produces a fused operation DAG
2. The CUDA backend records the DAG into a cuGraph via cuStreamBeginCapture
3. cuGraphInstantiate compiles the graph (driver optimizes kernel scheduling)
4. Each forward pass calls cuGraphLaunch instead of individual kernel dispatches

For a 7B model with ~200 kernel dispatches per forward pass, this saves 1-3 ms and significantly reduces CPU utilization.

### Layer 4: VRAM Management

The VRAM manager (vram_manager.rs) tracks:

- **Weight residency:** Model weights allocated once in VRAM, persistent across calls
- **Scratch arena:** Pre-allocated peak-activation buffer for intermediates
- **Staging buffers:** Host-pinned (cudaHostAlloc) for async input/output transfer
- **Device-to-device:** NVLink or PCIe P2P for multi-GPU

VRAM capacity by GPU:

| GPU | VRAM | Max model (Q4) |
|---|---|---|
| RTX 4060 | 8-16 GB | 7B-13B |
| RTX 4090 | 24 GB | 34B |
| RTX 5090 | 32 GB | 70B Q2 |
| A100 / H100 | 40-80 GB | 70B |
| B200 | 192 GB | 200B+ |

### Layer 5: Multi-GPU Topology

- **NVLink (H100, A100, B100, B200):** 900 GB/s GPU-to-GPU. Tensor parallelism with near-linear scaling.
- **PCIe P2P (RTX 4090, 5090):** 32-64 GB/s. Pipeline parallelism, not tensor parallelism at scale.
- **NCCL:** Collective communications for all multi-GPU topologies.

The topology query runs at startup and selects the partitioning strategy automatically.

### Performance Projections

| GPU | 7B Q4 (single) | 7B Q4 (batch 32) | Max model |
|---|---|---|---|
| RTX 4090 | 80-120 tok/s | 600-1000 tok/s | 34B Q4 |
| RTX 5090 | 100-150 tok/s | 800-1200 tok/s | 70B Q2 |
| A100 80 GB | 100-140 tok/s | 700-1100 tok/s | 70B Q4 |
| H100 | 200-300 tok/s | 1500-2500 tok/s | 70B Q4 |
| B200 | 400-600 tok/s | 3000-5000 tok/s | 200B Q4 |

### Porting Strategy

1. First: cuBLAS-based matmul and quantized matmul (80/20 path)
2. Second: CUTLASS fused kernels (absorb activation, bias, norm into matmul)
3. Third: CUDA Graphs integration for DAG dispatch
4. Fourth: Multi-GPU tensor parallelism via NCCL
5. Fifth: FP8/FP4 Tensor Core paths (deferred until quantization pipeline supports these formats)

### Risk and Mitigation

- **Dynamic shapes:** CUDA Graphs are per-shape. Use Hopper+ conditional nodes or re-record with LRU cache.
- **VRAM fragmentation:** Allocate weights at startup, keep resident. Pre-size scratch arena.
- **NVLink vs PCIe:** Topology query selects parallelism strategy automatically.
- **CUDA driver version:** Compile kernels for multiple SM targets, select at runtime.
- **FP4 (Blackwell):** Deferred until the quantization pipeline supports FP4.

### Non-Goals

- Not for integrated GPU (NVIDIA no longer produces iGPUs for desktop)
- Not for Tegra or Jetson (different memory model — unified memory)
- Not for multi-node inference until multi-GPU single-node is production-verified

## Consequences

### Positive

- Highest per-GPU inference throughput (Tensor Cores)
- CUDA Graphs directly supports Tribunus DAG dispatch
- Massive VRAM capacity (12 GB to 192 GB)
- Near-linear multi-GPU scaling via NVLink
- Wrapping production-grade libraries (cuBLAS, CUTLASS, NCCL)
- Cheap development hardware ($300 RTX 4060)

### Negative

- Proprietary stack (CUDA, drivers, libraries)
- PCIe staging adds 10-50 microseconds per request
- No speculative decode split (no separate NPU)
- VRAM fragmentation on consumer GPUs over long-running services
- Complex version compatibility between CUDA, cuBLAS, CUTLASS, NCCL, TensorRT

### Architecture vs Integrated GPUs

| Property | Integrated (ADRs 0029, 0031) | Discrete (0032) |
|---|---|---|
| Memory | Unified / shared | Device-local, explicit staging |
| Dispatch | Individual kernels | CUDA Graphs (batched DAG) |
| Power | 15-30W (shared CPU) | 150-450W (independent) |
| Multi-GPU | Not applicable | NVLink / PCIe topology |
| Model ceiling | 13B Q4 (64 GB AMD) | 200B+ Q4 (B200) |

### Estimated Effort

6-9 weeks (single developer).

### Hardware Recommendation

Minimum: RTX 3060 (12 GB, $250). Recommended: RTX 4090 (24 GB, $1,600). Multi-GPU: 2x RTX 4090 + NVLink bridge or 2x RTX 5090 (PCIe P2P).
