FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl \
    git \
    sudo \
    build-essential \
    mesa-vulkan-drivers libvulkan-dev glslang-tools \
    libopenblas-dev libdnnl-dev \
    pkg-config cmake python3 libclang-dev \
    && rm -rf /var/lib/apt/lists/*

# Level Zero dev dependencies
RUN curl -L https://github.com/intel/compute-runtime/releases/download/23.35.27191.9/intel-level-zero-gpu_1.3.27191.9_amd64.deb -o intel-level-zero-gpu.deb && \
    dpkg -i intel-level-zero-gpu.deb && rm intel-level-zero-gpu.deb

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /workspace
