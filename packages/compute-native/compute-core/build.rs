fn forward(name: &str) {
    let value = std::env::var(name).unwrap_or_else(|_| format!("{name}_MISSING"));
    println!("cargo:rustc-env=TRIBUNUS_{name}={value}");
}

fn main() {
    // Forward git SHA and branch for artifact provenance.
    if std::env::var("VERGEN_GIT_SHA").is_err() {
        if let Ok(out) = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .output()
        {
            let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !sha.is_empty() {
                println!("cargo:rustc-env=VERGEN_GIT_SHA={}", sha);
            }
        }
    }
    if std::env::var("VERGEN_GIT_BRANCH").is_err() {
        if let Ok(out) = std::process::Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .output()
        {
            let branch = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !branch.is_empty() {
                println!("cargo:rustc-env=VERGEN_GIT_BRANCH={}", branch);
            }
        }
    }

    forward("PROFILE");
    forward("OPT_LEVEL");
    forward("TARGET");
    forward("DEBUG");

    // Record RUSTFLAGS
    if let Ok(flags) = std::env::var("RUSTFLAGS") {
        println!("cargo:rustc-env=TRIBUNUS_RUSTFLAGS={}", flags);
    }

    // Record linker if set
    if let Ok(ld) = std::env::var("RUSTC_LINKER") {
        println!("cargo:rustc-env=TRIBUNUS_LINKER={}", ld);
    }

    // Record host info
    println!("cargo:rustc-env=TRIBUNUS_HOST_OS={}", std::env::consts::OS);
    println!(
        "cargo:rustc-env=TRIBUNUS_HOST_ARCH={}",
        std::env::consts::ARCH
    );

    // MLX identity (fixed for this gate - pointing to the new published fork)
    println!("cargo:rustc-env=TRIBUNUS_MLX_IDENTITY=Tribunus-dev/mlx-rs-fork@main");

    // Compile the ObjC++ Core ML / IOSurface bridge.
    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("src/bridge/metal_iosurface.mm")
            .flag("-fobjc-arc")
            .flag("-std=c++17")
            .compile("metal_iosurface");
        cc::Build::new()
            .file("src/bridge/coreml_arena.mm")
            .flag("-fobjc-arc")
            .flag("-std=c++17")
            .compile("coreml_arena");
        cc::Build::new()
            .file("src/bridge/coreml_exec.mm")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .flag("-std=c++17")
            .compile("coreml_exec");
        cc::Build::new()
            .file("src/bridge/coreml_state.mm")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .flag("-std=c++17")
            .compile("coreml_state");
        cc::Build::new()
            .file("src/bridge/ane_private.mm")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .flag("-std=c++17")
            .compile("ane_private");
        println!("cargo:rustc-link-lib=framework=CoreML");
        println!("cargo:rustc-link-lib=framework=CoreVideo");
        println!("cargo:rustc-link-lib=framework=IOSurface");
    }
}
