# Intel Linux Backend Architecture Guide

## Hardware Requirements

- **dGPU**: Intel Arc Alchemist / Battlemage series
- **Integrated**: Core Ultra Meteor Lake / Lunar Lake (integrated Arc + NPU)

## Feature Flags

When building the backend on Linux, you can toggle specific backends with cargo features:

- `--features linux-intel`: Enables the Level Zero and OpenVINO backend for Intel GPUs and NPUs.

## Driver Installation

To run the compute backends effectively on Intel hardware, ensure the following are installed:

- **Level Zero**: `intel-level-zero-gpu` and `level-zero-dev` for the low-level API.
- **OpenCL**: `intel-opencl-icd` for fallback or alternate compute capabilities.

### Example (Ubuntu 24.04 / Debian)
```bash
sudo apt-get update
sudo apt-get install -y intel-level-zero-gpu level-zero-dev intel-opencl-icd
```

## OpenVINO

OpenVINO provides accelerated execution for neural networks, especially on Intel NPUs.

- **Version Requirement**: OpenVINO `2025.4+` is strictly required for robust NPU support.
- **Installation**: Install via the official Intel APT repository to ensure you get the latest features.

```bash
# Add the Intel repository (refer to official OpenVINO documentation for latest key/repo)
# Then install:
sudo apt-get install openvino-2025.4
```

## Known Limitations

- **XMX (Xe Matrix Extensions)**: Advanced AI matrix operations (XMX) are fully supported and required on Battlemage (Arc B580).
- **Alchemist GPUs**: Older Alchemist architectures may fall back to EU (Execution Unit) SIMD instructions only, which can limit peak throughput compared to XMX.

## Performance Tuning

For optimal performance on Intel Xe architectures:

- **Workgroup Sizes**: Tune workgroup sizes specifically for the Intel Xe-cores execution topology.
- **XMX Utilization**: Ensure models and data types are aligned to maximize XMX utilization where available, providing significant speedups for matrix multiplications.

## Developer Setup

The recommended developer setup for building and debugging Intel compute workloads:

1. Install the **Intel oneAPI base toolkit**. This includes the SYCL offline compiler and other essential development tools.
2. Follow Intel's official guide to add the oneAPI repository and install the base toolkit:

```bash
# Example for Ubuntu (always refer to the official oneAPI guide for up-to-date instructions)
sudo apt-get install intel-basekit
```

Ensure your environment variables are sourced correctly before building:
```bash
source /opt/intel/oneapi/setvars.sh
```
