# MLX Graph Interception Design

## Minimal Interception Surface
6 C API additions to mlx-c for graph introspection:
1. `mlx_graph_get_current()` — get handle to current lazy graph
2. `mlx_graph_node_count()` — count nodes in graph
3. `mlx_graph_get_node(graph, index)` — get node by index with metadata
4. `mlx_node_get_op(node)` — operation type (matmul, add, etc.)
5. `mlx_node_get_inputs(node)` — input array handles
6. `mlx_node_get_metadata(node)` — dtype, shape, strides, device, constants, view status

## Per-Op Metadata Contract
```rust
enum OpParams {
    Matmul { transpose_a: bool, transpose_b: bool },
    Add, Sub, Mul, Div,
    Softmax { axis: i32 },
    RmsNorm { axis: i32, eps: f32 },
    RoPE { dims: i32, traditional: bool },
    Reshape { shape: Vec<i32> },
    Transpose { axes: Vec<i32> },
    Slice { starts: Vec<i32>, ends: Vec<i32> },
    // ~20+ more
}
```

## Canonicalization Map
~80 MLX primitives map to PhaseIR ops:
- matmul, add, multiply, divide, subtract -> matmul, add, mul, div, sub
- rms_norm, layer_norm -> rms_norm, layer_norm
- softmax, log_softmax -> softmax, log_softmax
- silu, gelu, relu, tanh, sigmoid -> activation(silu/gelu/relu/tanh/sigmoid)
- rope, rotary_embedding -> rope
- reshape, transpose, slice -> reshape, transpose, slice
- scatter, gather, sort -> external_region (no PhaseIR equivalent — fall back to CPU)

## Composite Pattern Recognition
Identify multi-op patterns that become single PhaseIR phases:
- rms_norm = rsqrt(mean(square(x))) * x * w -> rms_norm
- rope = cos/sin table lookup + split + rotate + concat -> rope
- layer_norm = mean + variance + normalize + scale -> layer_norm
- gelu = 0.5 * x * (1 + tanh(0.7978845 * (x + 0.044715 * x^3))) -> activation(gelu)

## Hybrid Execution Model
- Captured PhaseIR regions execute on MLX's Metal JIT (Apple path)
- PhaseIR also feeds the compute-image compiler for other backends
- External regions (scatter, gather, sort) fall back to MLX eval or CPU
