# Intel GPU Backend Research (2025-2026)

## Triton XPU Backend
- Out-of-tree, Intel-maintained fork (github.com/intel/intel-xpu-backend-for-triton)
- 99% functional correctness on Data Center GPU Max Series
- Performance: trailing CUDA Triton by 30-50% on many kernels, but closing
- XMX/DPAS path fast (Tensor Descriptors + explicit accumulators)
- Non-XMX path falls back to SYCL vector engine — 2-5x slower

## Level Zero
- Immediate command lists becoming default (2025.3+ V2 adapter)
- Reduces latency for small-kernel-heavy workloads (LLM inference)
- Interop with oneDNN: share device/context for mixed library+custom paths

## Kernel Compilation Paths
| Kernel Family | Primary | Fallback |
|---|---|---|
| Matmul FP16/BF16 | Triton XPU (Tensor Descriptors) | oneDNN |
| Matmul INT8/INT4 | oneDNN (production quantized) | Triton |
| RMS Norm | oneDNN | Triton (H2 2025) |
| RoPE | SYCL custom (until Triton H2 2025) | oneDNN |
| Attention | oneDNN MHA | Triton FlexAttention |
| KV cache | Level Zero immediate commands | SYCL |
| MoE routing | Triton XPU + oneDNN expert GEMM | SYCL |

## Battlemage (Xe2) vs Alchemist (Xe1)
- Battlemage: doubled XMX width (2048-bit vs 1024-bit), TF32 new, 3-way co-issue
- 70% better perf/Xe-core, 50% better power efficiency
- Arc B580: 20 Xe2-cores, 160 XMX engines, 12 GB GDDR6

## Recommendation
Three-tier approach for Intel:
1. **Level Zero runtime** (non-negotiable hardware abstraction)
2. **oneDNN** (~80% of ops: matmul, norm, attention primitives with XMX)
3. **Triton XPU** (~20% custom/irregular operations)
4. **SYCL/DPC++** escape hatch for ops Triton doesn't support
