# AMD GPU Backend Research (2025-2026)

## Triton HIP Backend
- Production-capable for Instinct (MI300X/MI350); beta for RDNA3 (RX 7900 XTX)
- Dedicated ROCm CI pipeline in vLLM — 93% pass rate (Jan 2026)
- ROCm 7.0: 3.5x inference improvement over ROCm 6; AOTriton for pre-compiled FlashAttention
- Triton prefill + HIP paged-attention decode: 10% throughput gain over custom HIP

## rocBLAS vs cuBLAS
- MI300X: 192 GB HBM3 at 5.3 TB/s vs H100: 80 GB at 3.35 TB/s — 2.4x memory advantage for large-batch decode
- rocBLAS on RDNA3: hand-optimized matmul 60% faster than rocBLAS (50 vs 31 TFLOPS)
- hipBLASLt grouped GEMM: competitive, batched GEMM regression on gfx1200 known

## ROCm vs Vulkan for Consumer
- Vulkan consistently provides 20-50% higher LLM inference throughput than ROCm on RDNA3
- Vulkan advantages: simpler install (no kernel module), broader compatibility, fewer dependencies
- Recommendation: Vulkan for consumer ROCm for Instinct/HPC

## Recommended Compilation Paths
| Kernel Family | Recommended Path | Fallback |
|---|---|---|
| Standard GEMM | rocBLAS/hipBLASLt | Triton HIP for odd shapes |
| Fused matmul+bias+act | Triton HIP | CK hand-written |
| Flash Attention | CK SDPA or AOTriton | rocBLAS-based attention |
| Consumer GPU matmul | Vulkan SPIR-V | rocBLAS if ROCm installed |
| Consumer GPU attention | Vulkan subgroup | Triton HIP |
| MoE routing | Triton HIP | CPU + rocBLAS expert matmul |
| KV cache compression | Triton HIP custom | Vulkan shader |

## Hardware Roadmap
| Generation | Launched | Memory | Compute |
|---|---|---|---|
| MI300X | Production | 192 GB HBM3, 5.3 TB/s | 1.3 PFLOPS FP16 |
| MI350X | Q3 2025 | 288 GB HBM3E, 8 TB/s | 20 PFLOPS FP4 |
| MI400 | 2026 | 432 GB HBM4, 19.6 TB/s | 40 PFLOPS FP4 |
