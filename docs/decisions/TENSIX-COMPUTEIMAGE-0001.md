# TENSIX-COMPUTEIMAGE-0001: Quantized Projection Feasibility Study and First Format

## Context
Tribunus requires a low-bit projection format to enable efficient inference on Tenstorrent hardware (TT-Metalium). The primary goal is to minimize memory bandwidth while maximizing the utilization of the Tensix matrix math engine.

## Analysis
The TT-Metalium architecture provides native support for Block Floating Point (BFP) formats, specifically BFP8, BFP4, and BFP2. Unlike standard INT4/INT8 quantization which requires separate scale and zero-point vectors, BFP shares an exponent across a block of elements (typically 16 or 32), with each element retaining its own mantissa.

Crucially, the Tensix matrix math engine can perform multiply-accumulate operations directly on BFP-encoded inputs. This bypasses the need for the vector/SIMD engine to dequantize the data back into BF16/FP16 before it is fed to the math engine.

Traditional INT4/INT8 group-quantized weights would require explicit pre-dequantization into BF16 in the SIMD engine prior to the matrix engine, establishing a bottleneck on the vector unit.

## Decision
We select **BFP8 (Block Floating Point 8-bit)** as the first low-bit projection format for Tribunus on TT-Metalium.

- **Declared ABI:** The format will use a block size of 16. Each block will consist of a shared 8-bit exponent and 16 x 8-bit elements (mantissas plus sign bits), yielding an effective 8.5 bits per element. We encode this as `Bfp8` in the `WeightCodec` with a block size parameter.
- **Path:** Native Tensix decode. The weights will be streamed directly to the matrix engine, avoiding pre-dequantization overhead.
- **CPU Differential Reference:** We implement software encode/decode routines in Rust to serve as a CPU differential reference, which converts from/to standard FP32/FP16.
- **Deferred:** Support for BFP4, traditional INT4/INT8, and AWQ/GPTQ scaling are deferred. While BFP4 is supported by TT-Metalium, BFP8 provides an easier initial path for validation and precision retention without requiring extensive re-calibration logic.

## Consequences
- Tribunus will implement `WeightCodec::Bfp8` alongside `GroupQuantized`.
- The CPU fallback for BFP8 will be functional but potentially slow, existing solely as a correctness reference.
- TT-Metalium integration will expect BFP8 formatted `.tribunus-exe` weights for optimized paths.
