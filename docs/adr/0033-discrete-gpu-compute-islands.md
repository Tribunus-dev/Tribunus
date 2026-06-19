# ADR 0033: Discrete GPU Compute Islands — Architectural Model for Independent GPU Backends Across Vendors

## Status
Proposed — June 2026

## Context

The preceding ADRs (0029-0032) define backends for specific hardware platforms, but a cross-cutting architectural pattern emerges: discrete GPUs are structurally different from integrated GPUs, and this difference transcends vendor boundaries.

Every discrete GPU — whether NVIDIA, AMD, or Intel — shares:
- Device-local VRAM, not system memory
- Explicit PCIe staging for all data movement
- Independent power domains (150-450W)
- Multi-GPU topologies (NVLink, PCIe P2P, Infinity Fabric)

Every integrated GPU shares:
- Unified memory with the CPU (zero-copy pointer sharing)
- Shared power domain (15-30W total with CPU)
- Single GPU per system

The TensorBackend trait currently does not distinguish between these two memory models. A backend written for unified memory (AMD iGPU via Vulkan) cannot be mechanically correct for a discrete GPU (AMD Radeon via ROCm) without overriding memory management hooks. This ADR formalizes the discrete compute island model as an architectural pattern.

## Decision

Define the discrete GPU compute island as a first-class architectural concept in Tribunus Compute, with explicit TensorBackend trait extensions for device-local memory management, PCIe staging, CUDA Graphs-style DAG dispatch, multi-GPU topology discovery, and power-aware routing.

### The Compute Island Abstraction

A compute island has four properties:
1. **Isolated memory domain**: Own physical memory, explicit transfers required
2. **Independent timing domain**: Own clock and scheduler, host events for sync
3. **Independent power domain**: Can be power-gated independently, transition latency in milliseconds
4. **Topological addressability**: Logical address in a discoverable topology

These apply to NVIDIA discrete GPUs, AMD Radeon GPUs, Intel Arc discrete GPUs, and Tenstorrent Blackhole cards. They do NOT apply to Apple Silicon GPU, AMD iGPU, Intel integrated GPU, CPU, or NPU.

### TensorBackend Trait Extensions

Eight new methods with default no-ops for unified memory backends:

- `is_compute_island()` — true for discrete GPUs
- `device_memory_capacity()` — VRAM in bytes
- `allocate_device_memory()` — allocate in VRAM
- `stage_to_device()` — host tensor to VRAM
- `stage_to_host()` — VRAM to host tensor
- `execute_graph()` — dispatch a pre-recorded DAG
- `topology()` — position in system topology
- `set_power_state()` — control GPU power domain

### Memory Model Differences

| Property | Unified Memory (iGPU) | Compute Island (dGPU) |
|---|---|---|
| Allocation | malloc / mmap | cuMemAlloc / hipMalloc |
| Transfer | Pointer sharing | cudaMemcpyAsync |
| Bandwidth | 100-200 GB/s DDR5 | 500-1000 GB/s GDDR6/HBM |
| Capacity | 16-64 GB | 12-192 GB |
| Multi-device | N/A | NVLink / PCIe P2P |

### DAG Dispatch vs. Sequential Dispatch

The most significant architectural difference:

- **Integrated GPU:** Dispatch overhead < 1 microsecond (CPU driver process handles command buffer). Sequential per-op dispatch is acceptable.
- **Discrete GPU:** Each kernel dispatch traverses the driver stack + PCIe bus (5-15 us). For a 200-kernel forward pass, this is 1-3 ms of overhead.

Therefore, discrete GPU backends MUST support graph-level dispatch (CUDA Graphs, HIP Graphs, Level Zero command list capture). The `execute_graph()` method is required.

### Multi-Compute-Island Topologies

The topology query runs at startup and classifies each GPU's interconnect:

| Topology | Bandwidth | Suited for |
|---|---|---|
| Same PCIe switch | 64 GB/s | Pipeline parallelism |
| NVLink | 900 GB/s | Tensor parallelism |
| NVSwitch fabric | 900 GB/s per link | Full sharded inference |
| QSFP-DD Ethernet | 100 GB/s | Pipeline parallelism |
| Infinity Fabric (AMD) | 200 GB/s | Tensor parallelism |

The execution planner selects the parallelism strategy based on the topology.

### Power-Aware Routing

Discrete GPU wake latency (30-50 ms) makes power-gated GPUs unsuitable for interactive single-batch inference. Routing strategies:

- **Always-on**: GPU in low-power active state (P8), 15-20W idle, no wake latency
- **Demand-based**: Full power only during inference, wake latency on cold start
- **NPU-first**: Small models route to NPU (< 1W idle), GPU reserved for large models

### Heterogeneous GPU Topologies

Systems may contain GPUs from different vendors. The topology discovery must handle mixed-vendor configurations.

**Per-vendor driver stacks:** Each vendor uses a completely separate driver stack. AMD + NVIDIA = ROCm/HIP + CUDA. These do not share contexts, events, or memory.

**Mixed-vendor routing rules:**
1. Each GPU is an independent compute island with its own memory domain and queue family.
2. Cross-vendor data must route through host memory (system RAM) — no NVLink between AMD and NVIDIA.
3. The planner minimizes cross-vendor transfers. Ideally the model runs entirely on one vendor\'s GPUs.
4. If cross-vendor is required, the compiler inserts host-staging copies at the boundary.
5. BackendRealizer (ADR 0037) selects per-phase kernels based on which vendor executes that phase.

**Same-vendor multi-GPU:** GPUs from the same vendor (e.g., 2x RTX 4090) can use PCIe P2P or NVLink.

**AMD CPU + Intel GPU:** CPU AMX handles small-batch decode (low latency), Intel Arc handles prefill (throughput).

**Heterogeneous VRAM:** GPUs with different capacities (24 GB + 12 GB) get proportional weight shards.

**Discovery order:** CUDA -> HIP/ROCm -> Level Zero -> Vulkan -> unified topology -> select primary coordinator -> assign secondary islands.

### Backend Mapping

| Vendor | File | API | Graph dispatch | ADR |
|---|---|---|---|---|
| NVIDIA | cuda_backend.rs | CUDA Driver API | CUDA Graphs | 0032 |
| AMD Radeon | hip_backend.rs | ROCm HIP | HIP Graphs | 0029 |
| Intel Arc discrete | arc_backend.rs | Level Zero | ZeCommandList capture | 0031 |
| Tenstorrent | tensix_backend.rs | TT-Metalium | Program-based (native) | 0030 |

Integrated GPU backends (vulkan_executor.rs, arc_integrated.rs) remain separate, using the unified memory defaults.

## Consequences

### Positive

- Clear architectural boundary with explicit trait methods
- Reusable staging, topology, power management across vendors
- Correctness guarantee — unified memory backends can't silently do the wrong thing
- Planner awareness of GPU selection, placement, and power states
- Standardized DAG dispatch across all discrete backends

### Negative

- Trait surface area grows by 8 methods
- Topology discovery is vendor-specific (NVML, rocm-smi, sysfs, Level Zero)
- DAG dispatch semantics vary (CUDA Graph conditionals, HIP Graph limitations)
- Power state abstraction may leak vendor-specific details

### Estimated Effort

1 week shared infrastructure (compute_island.rs, topology.rs, power.rs) + 3 days per discrete backend to wire vendor-specific discovery.

### Relation to Other ADRs

| ADR | Impact |
|---|---|
| 0029 (AMD64 iGPU) | Integrated RDNA3 stays on Vulkan. Discrete Radeon is new hip_backend.rs with compute island extensions. |
| 0031 (Intel Arc) | Covers both integrated and discrete Arc via same Level Zero API but different trait methods. |
| 0032 (NVIDIA) | Already a discrete compute island. Must implement all extension methods. |
| 0030 (Tenstorrent) | Always a compute island. Program-based dispatch is native graph-level dispatch. |
