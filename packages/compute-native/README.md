# Tribunus Compute Native

This package contains the native computational kernels and engine for the Tribunus project.

## Linux Build Instructions and Feature Flags

On Linux, the compute backend utilizes a tiered selection architecture to provide maximum hardware compatibility while preserving portability. Backends are dynamically loaded at runtime, but compilation is controlled via Cargo features.

### Cargo Feature Flags

| Feature Flag | Purpose | Recommended Hardware |
| :--- | :--- | :--- |
| `linux` | Minimal build with guaranteed CPU fallback (AMX/AVX2). | Any CPU |
| `linux-vulkan` | Vulkan backend (via SPIR-V). | AMD GPUs (RDNA3, RX 6000+) |
| `linux-intel` | Level Zero and OpenVINO backend. | Intel Arc GPUs, Core Ultra NPUs |

### Building

To build the package, use Cargo with the desired features. For example, to build with all backends:

```bash
cargo build --features linux-vulkan,linux-intel
```

To run tests:
```bash
cargo test --features linux
```

### Dependencies

| Backend | Runtime Dependency |
| :--- | :--- |
| **CPU Fallback** | `libopenblas` |
| **Vulkan** | `mesa-vulkan-drivers` |
| **Intel Level Zero** | `intel-level-zero-gpu` |
| **Intel OpenVINO** | `openvino-2025.4` |

For more detailed information on specific backends, developer setup, and deployment, please refer to the documentation in the workspace root:
- [AMD Linux Backend Guide](../../docs/backends/LINUX-AMD.md)
- [Intel Linux Backend Guide](../../docs/backends/LINUX-INTEL.md)
- [Linux Build Guide](../../docs/backends/LINUX-BUILD.md)
- [Linux Deployment Guide](../../docs/backends/LINUX-DEPLOYMENT.md)
