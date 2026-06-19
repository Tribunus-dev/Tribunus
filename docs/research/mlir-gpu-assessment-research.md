# MLIR GPU Backend Assessment

## Recommendation
**Do NOT adopt MLIR as canonical IR.** PhaseIR is the right representation for Tribunus' domain. Use MLIR as a per-backend lowering library via thin Rust→MLIR C API bridges.

## Assessment Per Dialect
| Dialect | Assessment | Recommendation |
|---|---|---|
| gpu | Reference MLIR GPU dialect | Use as compilation target from PhaseIR |
| nvgpu/nvvm | CUDA codegen | Generate NVVM IR from PhaseIR for CUDA path |
| rocdl | AMD ROCm codegen | Generate ROCDL IR for AMD HIP path |
| spirv | Vulkan/SPIR-V codegen | Generate SPIR-V for Vulkan path |
| mps | Metal (weakest link) | Skip — stick with MLX fork + MSL for v1 |
| tosa | Standard opset | Not needed — PhaseIR is the domain-specific IR |
| IREE runtime | Architectural mismatch | Use compilation passes only, not runtime |

## Key Finding
Generate target dialects directly (NVVM for CUDA, SPIR-V for Vulkan) rather than using full TOSA→Linalg→Vector→GPU progressive lowering pipeline. The Metal path is MLIR's weakest link — MLX fork + hand-tuned MSL is correct for v1. IREE's runtime is architecturally mismatched (it owns scheduling, which Tribunus' LaneManager/ControlLane already does). CIRCT/Calyx not relevant until FPGA acceleration is a concrete requirement.
