# Architecture

This document describes the high-level architecture of the Tribunus project.

## Linux Backend Architecture

Tribunus Compute on Linux is designed for maximum hardware compatibility and performance, utilizing a tiered backend selection mechanism.

### Backend Tiers

1. **Vulkan Backend**: The primary target for AMD GPUs (RDNA architecture) and general cross-vendor GPU support. It leverages SPIR-V compiled kernels.
2. **Intel Level Zero & OpenVINO**: Targeted specifically when Intel hardware (Arc GPUs or Core Ultra NPUs) is detected. This backend utilizes Intel XMX matrix extensions and specific NPU optimizations.
3. **CPU Fallback**: A guaranteed fallback utilizing `libopenblas` and AMX/AVX2 instructions. This ensures that even if no compatible GPU or NPU is found, all models and operations can execute successfully.

### Dynamic Loading and Detection

To avoid compile-time linker errors and ensure the generated binaries are portable across different Linux distributions, backend drivers are loaded dynamically at runtime via `dlopen`/`dlsym`. The system uses `/proc` filesystem checks and driver queries to determine hardware availability, never relying on strict linking to proprietary SDKs during the standard build process.

### Configuration and Feature Flags

The compilation of specific backends is opt-in via Cargo features:
- `--features linux-vulkan`
- `--features linux-intel`
- The default `--features linux` ensures the minimal CPU fallback compiles on any standard distribution.

For more details, see [ADR 0037: Linux Backend Architecture](docs/adr/0037-linux-backend-architecture.md) and the specific hardware guides:
- [AMD Linux Backend Guide](docs/backends/LINUX-AMD.md)
- [Intel Linux Backend Guide](docs/backends/LINUX-INTEL.md)
- [Linux Build Guide](docs/backends/LINUX-BUILD.md)
- [Linux Deployment Guide](docs/backends/LINUX-DEPLOYMENT.md)
