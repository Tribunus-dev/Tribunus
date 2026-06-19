#!/bin/bash

set -e

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
SYCL_SRC="$REPO_ROOT/packages/compute-native/src/kernels/sycl/kernels.cpp"
OUT_DIR="$REPO_ROOT/packages/compute-native/src/kernels/sycl"

mkdir -p "$OUT_DIR"

if command -v icpx &> /dev/null; then
    echo "Found icpx, compiling SYCL kernels..."
    icpx -fsycl -fsycl-targets=spir64 -O3 "$SYCL_SRC" -o "$OUT_DIR/kernels.spv"
# Try clang++ SYCL, gracefully degrade if clang++ doesn't truly support SYCL targets
elif command -v clang++ &> /dev/null && clang++ -fsycl -fsycl-targets=spir64 -v &> /dev/null; then
    echo "Found clang++ with true SYCL spir64 support, compiling SYCL kernels..."
    clang++ -fsycl -fsycl-targets=spir64 -O3 "$SYCL_SRC" -o "$OUT_DIR/kernels.spv"
else
    echo "Warning: SYCL compiler (icpx or true clang++ -fsycl) not found. Touching dummy .spv file."
    touch "$OUT_DIR/kernels.spv"
fi

echo "Kernel compilation step completed."
