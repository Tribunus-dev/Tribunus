# Linux Build and Installation Guide

This guide details the prerequisites and commands required to build and test the compute backends on Linux.

## Prerequisites Table

| Target Architecture | Required System Packages | Toolchains | Cargo Features |
| :--- | :--- | :--- | :--- |
| **Minimal / CPU-only** | `libopenblas-dev`, `build-essential` | standard Rust | `linux` |
| **AMD GPU (Vulkan)** | `mesa-vulkan-drivers`, `vulkan-tools` | standard Rust | `linux-vulkan` |
| **Intel GPU / NPU** | `intel-level-zero-gpu`, `openvino-2025.4` | Intel oneAPI SYCL compiler | `linux-intel` |
| **All Backends** | All of the above | oneAPI + standard Rust | `linux-vulkan,linux-intel` |

## Cargo Build Commands

Depending on your target environment, you can compile the project using different feature combinations:

### Minimal Build (CPU Fallback)
Produces a minimal binary with guaranteed CPU fallback for every operation. This build compiles on almost any Linux distribution without requiring specialized GPU headers.
```bash
cargo build --features linux
```

### AMD GPU Build (Vulkan)
Enables the Vulkan backend targeting AMD RDNA3 and similar architectures.
```bash
cargo build --features linux-vulkan
```

### Intel GPU + NPU Build (Level Zero / OpenVINO)
Enables Intel-specific optimizations and NPU support via Level Zero and OpenVINO.
```bash
cargo build --features linux-intel
```

### Universal Build (All Backends)
Compiles all backends. At runtime, the system uses a tiered backend selection (Vulkan > Level Zero > CPU).
```bash
cargo build --features linux-vulkan,linux-intel
```

## Testing

To run the test suite on Linux, ensuring you specify the base linux feature. You can append the GPU-specific features if testing on compatible hardware.

```bash
cargo test --features linux
```
*(Tests requiring a specific backend will be skipped or fallback to CPU if the hardware/driver is missing).*

## Docker Dev Container

We provide a Dockerfile for an isolated development environment that pre-installs all necessary dependencies for both Intel and AMD builds.

**Using the Dev Container:**

1. Build the Docker image:
   ```bash
   docker build -t tribunus-linux-dev -f scripts/docker-linux-dev.Dockerfile .
   ```
2. Run the container interactively, ensuring GPU passthrough is enabled:
   ```bash
   # Example with all GPUs passed through:
   docker run -it --gpus all --device /dev/dri -v $(pwd):/workspace tribunus-linux-dev
   ```
   *(Note: Adjust `--device /dev/dri` and `--gpus` depending on your container runtime and host drivers).*

## CI Pipelines Explained

Our Continuous Integration (CI) pipelines automatically verify builds across different configurations:

- **Baseline Linux**: Compiles `cargo build --features linux` to ensure the CPU fallback is never broken.
- **Vulkan / AMD**: Runs compilation with `--features linux-vulkan` inside an environment with Vulkan headers to catch API breaks.
- **Intel / SYCL**: Uses an Intel oneAPI container to verify that `--features linux-intel` and OpenVINO integrations compile successfully.

All backend detection works dynamically at runtime via `dlopen/dlsym` and `/proc` filesystem checks, avoiding compile-time linker errors and ensuring the generated binaries are portable.
