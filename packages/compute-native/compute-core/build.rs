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

    // Compile the ObjC++ Core ML / IOSurface bridge.
    #[cfg(target_os = "macos")]
    {
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
