## MLX in the Tribunus Ecosystem

Apple's MLX is an array framework for machine learning on Apple Silicon, providing Metal-backed tensor computation with lazy evaluation and unified memory. Tribunus Compute has forked three MLX repositories (`mlx`, `mlx-c`, `mlx-rs`) to gain authority over evaluation scheduling, output placement, allocator behavior, compiled-kernel cache behavior, external IOSurface ownership, and receipt emission.

## Why Forking is Necessary

The required changes are below the public abstraction layer. MLX's lazy evaluation and Metal JIT behavior are the primary source of runtime waste. During inference, MLX should not be discovering graphs, lazily compiling kernels, or allocating surprise temporaries. The fork makes MLX obey the compute image's authority without becoming a long-term maintenance black hole.

## Fork Strategy

The fork remains narrow and disciplined:

| Repository | Upstream | Fork Purpose |
|---|---|---|
| `mlx-rs` | oxideai/mlx-rs | Memory module, quantization API, backend conformance |
| `mlx-c` | apple/mlx-c | C API layer, macOS 26.5 compatibility patches |
| `mlx-core` | apple/mlx | Core C++ runtime, allocator hooks, evaluation scheduling |

### What's Kept

- Metal kernel generation capability — the on-the-fly compiler of specialized Metal kernels
- Unified memory model — arrays live in the same memory space regardless of device
- Lazy evaluation — but gated by compute image compilation, not runtime discovery

### What's Controlled

- Evaluation scheduling — when and where arrays materialize
- Output placement — which device receives the result
- Allocator behavior — IOSurface-backed arenas instead of malloc
- Compiled-kernel cache — frozen into compute image at compile time
- Receipt emission — per-operation execution attestation