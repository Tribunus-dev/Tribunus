# Memory Semantics and Dynamic Shape Research

## Systems Analyzed
- XLA (bounded dynamic shapes, SetDimensionSize, GetDimensionSize)
- TensorRT (optimization profiles, min/opt/max shapes, auto-tuner)
- MLX (lazy eval, device-specific stride support, transpose view vs copy)
- vLLM (PagedAttention, block table, virtual/physical blocks, CoW sharing)
- PyTorch (torch.compile, symbolic shapes, SymInts, ShapeEnv, guard system)

## Key Recommendations

### Shape Buckets
- Minimum viable: **3 buckets** (prefill L=128, decode L=2048, long-context L=32768)
- Practical set: **7 buckets** (32, 128, 512, 2048, 8192, 32768, 131072)
- Use TensorRT-style optimization profiles + XLA bounded dynamic dimensions

### Stride-Aware Operation Semantics
- Define per-backend stride capability predicates:
  - `contiguous_row`: backend requires row-contiguous layout (most GPU backends)
  - `contiguous_col`: backend requires column-contiguous (rare)
  - `negative_strides`: backend handles negative strides (MLX yes, CUDA no)
  - `max_vector_stride`: maximum stride for vectorized load/store
- Stride normalization pass: check strides per-op, insert to_contiguous() where backend requires it
- Views are free until materialization (MLX model); materialization is explicit across backend boundaries

### Aliasing Policy
- matmul: output must not alias inputs (all backends)
- elementwise: may alias inputs (GPU backends with barriers)
- in-place update: requires explicit barrier/fence after write
- scatter/gather: may have aliasing restrictions (check per backend)

### KV Cache Layout
- Paged KV with block_table indirection as default
- Contiguous KV for simple cases (small context, single token)
- Sliding window KV for infinite context approximation
- Non-contiguous block table enables virtual "append" without aliasing (vLLM model)

## Canonical Memory Semantics Schema
```yaml
tensor:
  shape: [int]          # dimensions
  strides: [int]        # byte strides (NOT element strides)
  dtype: dtype_enum
  materialized: bool    # false = view/alias of another tensor
  layout: contiguous | channel_last | block_sparse | paged
  residency: vram | host | shared | staging
  aliasing_restrictions: [no_input_alias, no_output_alias, allow_in_place]
```
