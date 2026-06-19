#!/bin/bash
cd packages/compute-native
rustc --edition 2021 src/runtime/pipeline_decode.rs --emit=metadata || true