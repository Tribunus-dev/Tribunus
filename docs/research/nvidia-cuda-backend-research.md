# NVIDIA CUDA Backend Research

## CUDA Graphs Decode-Phase Replay
Three patterns:
1. **Monolithic**: Capture entire forward pass as one graph. Replay every token. Simple but cannot handle dynamic shapes within graph.
2. **Piecewise**: Capture subgraphs for each phase (attention, MLP, norm). Compose at runtime. More flexible, supports shape changes between phases.
3. **Conditional Nodes** (Hopper+): cuGraphConditionalHandle with IF/WHILE nodes. Variable sequence length within a single graph — eliminates re-capture cost.

## cuBLASLt Fused Epilogue Matrix Multiplication
- Supports fused epilogue types: GELU_BIAS, BIAS, RELU_BIAS, GELU, RELU, SILU
- FP8 support via cuBLASLtMatmulDesc with epilogue type
- Use for fused matmul+bias+activation — eliminates separate kernel launch

## CUTLASS Fused Multi-Head Attention (Hopper SM90)
- Uses TMA (Tensor Memory Accelerator) for async data movement
- WGMMA (Warp Group MMA) for tile-level matmul
- EVT (Epilogue Visitor Tiles) for custom epilogue chains
- Supports fused multi-head attention with bias, scale, optional softmax

## Two-Track Plan
### Track A: Minimal (3-4 weeks)
- cuBLASLt matmul with fused epilogue
- Triton-generated attention kernels (portable, works across backends)
- Monolithic CUDA Graph capture for decode phase
- Custom CUDA kernels for KV cache ops (append, gather, page table update)

### Track B: Optimal (8-12 weeks after Track A)
- CUTLASS fused attention kernels (TMA+WGMMA)
- Piecewise CUDA Graphs with shape-adaptive subgraphs
- NCCL for multi-GPU tensor parallelism
- Custom CUDA kernels for speculative tree attention
- CUDA Graph conditional nodes for dynamic decode length
