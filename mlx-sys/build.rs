extern crate cmake;

use cmake::Config;
use std::{env, path::PathBuf};

fn build_and_link_mlx_c() {
    let mut config = Config::new("src/mlx-c");
    config.very_verbose(true);
    config.define("CMAKE_INSTALL_PREFIX", ".");

    #[cfg(debug_assertions)]
    {
        config.define("CMAKE_BUILD_TYPE", "Debug");
    }

    #[cfg(not(debug_assertions))]
    {
        config.define("CMAKE_BUILD_TYPE", "Release");
    }

    config.define("MLX_BUILD_METAL", "OFF");
    config.define("MLX_BUILD_ACCELERATE", "OFF");

    #[cfg(feature = "metal")]
    {
        config.define("MLX_BUILD_METAL", "ON");
    }

    #[cfg(feature = "accelerate")]
    {
        config.define("MLX_BUILD_ACCELERATE", "ON");
    }

    // build the mlx-c project
    let dst = config.build();

    println!("cargo:rustc-link-search=native={}/build/lib", dst.display());
    println!("cargo:rustc-link-lib=static=mlx");
    println!("cargo:rustc-link-lib=static=mlxc");

    println!("cargo:rustc-link-lib=c++");
    println!("cargo:rustc-link-lib=dylib=objc");
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "macos" || std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "ios" {
        println!("cargo:rustc-link-lib=framework=Foundation");
    }

    #[cfg(feature = "metal")]
    {
        if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "macos" || std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "ios" {
            println!("cargo:rustc-link-lib=framework=Metal");
        }
    }

    #[cfg(feature = "accelerate")]
    {
        if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "macos" || std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "ios" {
            println!("cargo:rustc-link-lib=framework=Accelerate");
        }
    }
}

fn main() {
    build_and_link_mlx_c();

    // generate bindings
    let bindings = bindgen::Builder::default()
        .rust_target("1.73.0".parse().expect("rust-version"))
        .header("src/mlx-c/mlx/c/mlx.h")
        .header("src/mlx-c/mlx/c/linalg.h")
        .header("src/mlx-c/mlx/c/error.h")
        .header("src/mlx-c/mlx/c/transforms_impl.h")
        .clang_arg("-Isrc/mlx-c")
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
        .generate()
        .expect("Unable to generate bindings");

    // Write the bindings to the $OUT_DIR/bindings.rs file.
    let out_path = PathBuf::from(env::var("OUT_DIR").unwrap());
    bindings
        .write_to_file(out_path.join("bindings.rs"))
        .expect("Couldn't write bindings!");

    // Emit build-generated version constants
    let mlx_c_version = std::fs::read_to_string("src/mlx-c/VERSION")
        .unwrap_or_else(|_| "0.6.0".to_string())
        .trim()
        .to_string();
    println!("cargo:rustc-env=MLX_C_VERSION={}", mlx_c_version);
    println!("cargo:rustc-env=MLX_CORE_TARGET=v0.31.2");
    println!("cargo:rustc-env=MLX_SYS_VERSION=0.6.0-tribunus.1");
    println!("cargo:rustc-env=MLX_RS_BASE_COMMIT=93ed8db");
}
