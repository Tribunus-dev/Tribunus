# Triton Multi-Vendor Kernel Compiler Status (June 2026)

## Executive Summary
Triton has crossed the threshold from CUDA-first experimental compiler to genuine multi-backend production system. NVIDIA remains reference (90-95% of hand-tuned). AMD ROCm/HIP is first-class (93% CI pass rate in vLLM). Intel XPU is the most rapidly accelerating backend (95-96% of expert-tuned kernel performance on Ponte Vecchio).

## Backend Status
| Feature | NVIDIA CUDA | AMD ROCm/HIP | Intel XPU |
|---|---|---|---|
| Status | Production | Production | Late beta |
| Matmul (tl.dot) | Supported, 90-95% | Supported, trailing rocBLAS | Supported, 95-96% of expert |
| Flash Attention | v3/v4 native | AOTriton pre-compiled | FA2 forward FP16 only |
| Paged Attention | Mature | HIP preferred 2x faster | In development |
| RMS Norm | Supported | Supported | Supported (H2 2025) |
| RoPE | Supported | Supported | Supported (H2 2025) |
| MoE Routing | Mature | Supported | In development |
| Quantization | FP8/INT8/INT4 | FP8/MXFP4 | FP16/BF16 solid, FP8 roadmap |
| Dynamic Shapes | Partial | Partial | Partial (cross-vendor gap) |
| Warp Specialization | Mature | Future direction | Missing |

## Known Gaps
- **Dynamic shapes**: Cross-vendor limitation. Grid lambda works; intra-kernel dynamic control flow has known issues
- **Intel FP16 atomics**: Emulated via 32-bit CAS spinlock — significant perf penalty
- **Warp specialization**: NVIDIA only; AMD/RDNA3 wavefront 64-thread vs NVIDIA 32-thread warps differ
- **Toolchain friction**: Intel requires specific DLE toolchain; AMD RDNA3 support beta quality

## Performance Gap vs Vendor Libraries
| Backend | Gap | Notes |
|---|---|---|
| NVIDIA | 5-10% | cuBLAS/cuDNN edge for extreme optimization |
| AMD | 5-60% | Varies by op; rocBLAS wins for GEMM, Triton for fusion |
| Intel | 4-5% | ML-Triton at 95-96%; Xe-Forge closing gap |

## Recommendation for Tribunus
Triton is the right "one source, many backends" kernel compiler for portable matmul/attention/norm/activation kernels. Use vendor libraries (cuBLASLt, rocBLAS, oneDNN) where Triton cannot match performance. Design the BackendRealizer to select between Triton-generated kernels and vendor library calls per phase.
