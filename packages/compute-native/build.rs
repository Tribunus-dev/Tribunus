fn forward(name: &str) {
    let value = std::env::var(name).unwrap_or_else(|_| format!("{name}_MISSING"));
    println!("cargo:rustc-env=TRIBUNUS_{name}={value}");
}

fn main() {
    forward("PROFILE");
    forward("OPT_LEVEL");
    forward("TARGET");
    forward("DEBUG");

    napi_build::setup();
    // Run DPC++ build pipeline
    let compile_script = std::path::Path::new("../../build/kernels/compile.sh");
    if compile_script.exists() {
        let status = std::process::Command::new("bash")
            .arg(compile_script)
            .status()
            .expect("Failed to run kernel compile script");
        if !status.success() {
            println!("cargo:warning=Kernel compilation failed or gracefully degraded.");
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Probe pkg-config for openblas and level-zero
        let pkg_config_openblas = std::process::Command::new("pkg-config")
            .arg("--exists")
            .arg("openblas")
            .status();
        if let Ok(status) = pkg_config_openblas {
            if status.success() {
                println!("cargo:rustc-cfg=has_openblas");
            }
        }
        
        let pkg_config_level_zero = std::process::Command::new("pkg-config")
            .arg("--exists")
            .arg("libze_loader")
            .status();
        if let Ok(status) = pkg_config_level_zero {
            if status.success() {
                println!("cargo:rustc-cfg=has_level_zero");
            }
        }
        
        // Vulkan check via library existence as fallback, or pkg-config
        let pkg_config_vulkan = std::process::Command::new("pkg-config")
            .arg("--exists")
            .arg("vulkan")
            .status();
        if let Ok(status) = pkg_config_vulkan {
            if status.success() {
                println!("cargo:rustc-cfg=has_vulkan");
            }
        } else if std::path::Path::new("/usr/lib/x86_64-linux-gnu/libvulkan.so").exists() || std::path::Path::new("/usr/lib/libvulkan.so").exists() {
            println!("cargo:rustc-cfg=has_vulkan");
        }
    }

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-undefined,dynamic_lookup");
    }
    }


    
