# Backend Realization Contract Research

## Systems Analyzed
- CUDA Graphs (cuGraphInstantiateWithParams, graph node capabilities)
- Vulkan (VkPhysicalDeviceFeatures2, VkPhysicalDeviceProperties2)
- Intel Level Zero (zeDeviceGetProperties, zeDeviceGetComputeProperties)
- OpenVINO (ov::Core::get_property, supported ops API)
- ONNX Runtime (IExecutionProvider::GetCapability)
- Apache TVM (OpStrategy, FTVMStrategy, BYOC framework)
- TensorRT / XLA (optimization profiles, execution engines)

## Key Finding
**No existing system provides a complete backend contract across all 8 dimensions.** Each system covers a subset. The unified BackendCapability schema must capture: operation support matrix, dtype support, layout capabilities, aliasing model, dynamic shape regime, KV-cache mutation semantics, numerical tolerance profile, and async execution semantics.

## Unified Schema (BackendCapability)
- **identity**: kind (CPU/GPU/NPU/FPGA/DSP), vendor, architecture, driver_version_min
- **memory_model**: max_allocation_size, page_size, supports_unified_memory, supports_host_pinned, supports_device_mapped_host, supports_peer_access, cache_line_bytes, memory_types[]
- **dtype_support**: native_dtypes[], quantized_dtypes[] (per dtype: symmetric, per_channel_supported), tf32_fallback, bf16_native, fp8_variants[]
- **operation_catalog**: operations[] with per-op variants[] containing input_dtypes, rank_range, min_alignment, max_shared_memory, roofline_flops
- **aliasing_contract**: output_may_alias_input, in_place_supported[], aliasing_barrier_required, automatic_copy_insertion
- **shape_contract**: static_only, fully_dynamic, bounded_dynamic, dynamic_axes[] (min/opt/max per axis), requires_shape_recompile, supports_symbolic_shape_inference
- **mutation_contract**: supports_buffer_append, supports_buffer_resize, append_semantics (block_table/contiguous_growth/copy_reallocate), supports_paged_attention, page_size, max_pages
- **numerical_contract**: default_precision, minimum_precision, ulp_error_bound per (op, dtype), deterministic_across_workgroups
- **async_contract**: supports_streams, max_concurrent_kernels, supports_memcpy_compute_overlap, command_list_model (immediate/batched/graph), max_pending_launches
- **graph_contract**: supports_graph_capture, graph_update_supported, graph_replay_overhead_us, capturable_node_types[]

## Dimension Comparison Summary
| Dimension | Best in class | Gap |
|---|---|---|
| Op support | OpenVINO (explicit per-device tables) | CUDA/Vulkan/Level Zero: implicit |
| Dtype support | Vulkan (per-feature boolean flags) | No system provides per-op dtype tables |
| Layout | TVM (first-class layout IR, auto-conversion) | CUDA: raw memory only |
| Aliasing | CUDA Graphs (strict no-aliasing) | Most systems: user-managed |
| Dynamic shapes | ONNX Runtime / OpenVINO (fully dynamic symbolic) | CUDA Graphs: fully static |
| KV mutation | vLLM PagedAttention (block table, non-contiguous) | Most: user-managed buffers |
| Numerical tolerance | **Universally absent** as formal contract | No system provides accuracy guarantees |
| Async execution | CUDA (streams, graphs, events) | Compiler-level contracts mostly fire-and-forget |
