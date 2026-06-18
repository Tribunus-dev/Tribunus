#!/bin/bash

# Idempotency check flag
if [ -f /tmp/.linux_deps_installed ]; then
    echo "Dependencies already installed. Skipping."
    # Use return if sourced, else do nothing further in block
else
    if [ -f /etc/debian_version ]; then
        echo "Detected Debian/Ubuntu system"
        sudo apt-get update
        sudo apt-get install -y \
            mesa-vulkan-drivers libvulkan-dev glslang-tools \
            level-zero-dev \
            libopenblas-dev libdnnl-dev pkg-config cmake python3 libclang-dev
            
        echo "Installing openvino-2025.4 and onnxruntime-xdna (if available)..."
        sudo apt-get install -y openvino-2025.4 onnxruntime-xdna || echo "Warning: openvino-2025.4 and/or onnxruntime-xdna not found in standard repos."

    elif [ -f /etc/redhat-release ]; then
        echo "Detected Fedora/RedHat system"
        sudo dnf install -y \
            vulkan-loader-devel vulkan-headers glslang \
            level-zero-devel \
            openblas-devel onednn-devel pkgconf-pkg-config cmake python3 clang-devel
        sudo dnf install -y openvino-2025.4 onnxruntime-xdna || echo "Warning: openvino-2025.4 and/or onnxruntime-xdna not found in standard repos."

    elif [ -f /etc/arch-release ]; then
        echo "Detected Arch Linux system"
        sudo pacman -Syu --noconfirm \
            vulkan-radeon vulkan-headers glslang \
            level-zero-headers \
            openblas onednn pkgconf cmake python clang
        sudo pacman -S --noconfirm openvino onnxruntime-xdna || echo "Warning: openvino and/or onnxruntime-xdna not found in standard repos."

    else
        echo "Unsupported distribution"
    fi

    touch /tmp/.linux_deps_installed
    echo "Linux dependencies installed successfully."
fi
