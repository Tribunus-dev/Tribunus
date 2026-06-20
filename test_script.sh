#!/bin/bash
# A script to test our module specifically by creating a dummy Cargo project

mkdir -p /tmp/test-tt-metalium
cd /tmp/test-tt-metalium
cat << 'TOML' > Cargo.toml
[package]
name = "test-tt-metalium"
version = "0.1.0"
edition = "2021"

[dependencies]
TOML

mkdir -p src/backend/tt_metalium
cp -r /app/packages/compute-native/src/backend/tt_metalium/* src/backend/tt_metalium/
cat << 'SRC' > src/lib.rs
pub mod backend {
    pub mod tt_metalium;
}
SRC

cargo test
