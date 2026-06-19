# Tenstorrent Tensix Backend Research (2025-2026)

## Architecture
- Blackhole: 120 Tensix cores, 180 MB SRAM, 32 GB GDDR6, 664 TFLOPS BLOCK FP8
- Wormhole: 80 Tensix cores, 120 MB SRAM, 12 GB GDDR6
- Each Tensix core: 5 RISC-V CPUs (2x data movement, unpack, math, pack), 1.5 MB SRAM
- 32x32 tile native compute unit; tilized tensors mandatory
- Two independent NoCs (NoC0/NoC1) in opposite directions on 2D torus

## Software Stack Layers
1. **TT-Metalium**: C++ low-level kernel programming (reader/compute/writer + circular buffers)
2. **TT-NN**: Python/C++ network operator library (~200+ ops: matmul, softmax, norm, attention, RoPE)
3. **TT-MLIR**: MLIR compiler (StableHLO -> TTIR -> TTNN -> TTKernel -> TTMetal)
4. **TT-Forge**: umbrella compiler (TT-XLA for PyTorch/JAX, TT-Forge-ONNX via TVM)

## Inference Mapping (10 Canonical Phases to TT-NN/Metalium)
| Phase | Path | Strategy |
|---|---|---|
| Embedding | TT-NN | ttnn.embedding |
| Prefill Attention | TT-NN | ttnn.transformer.scaled_dot_product_attention, causal=True |
| Decode Attention | TT-NN | ttnn.transformer.scaled_dot_product_attention_decode, paged KV |
| RoPE | TT-NN | ttnn.experimental.rotary_embedding_llama |
| KV Cache Update | TT-NN | ttnn.experimental.paged_update_cache |
| RMS Norm | TT-NN | ttnn.rms_norm (distributed variant) |
| MLP | TT-NN | DRAM-sharded matmuls for decode, 2D multicast for prefill |
| MoE Routing | TT-Metalium | Custom NoC multicast read/write for token-to-expert routing |
| LM Head | TT-NN | ttnn.linear over sharded weights |
| Speculative Decode | TT-Metalium | Custom tree-attention kernel with shared KV cache |

## Key Insights
- **Prefill vs Decode** is the single most important dispatch decision (different TT-NN program configs)
- **Tensor parallelism is native**: experts on cores, NoC communication. CCL ops handle cross-device
- **L1 residency is the superweapon**: keep data across ops without DRAM round-trips
- **Metal Trace** = CUDA Graphs equivalent: record, replay for steady-state decode
- **TT-Lang** emerging path for custom kernels without raw C++ Metalium
