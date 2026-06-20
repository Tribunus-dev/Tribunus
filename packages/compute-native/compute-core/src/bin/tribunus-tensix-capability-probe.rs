use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Serialize, Deserialize, Debug)]
struct ArtifactCompatibility {
    architecture: String,
    grid_dimensions: [u32; 2],
    enabled_cores: u32,
    dram_topology: Vec<String>,
    supported_data_formats: Vec<String>,
    firmware_version: String,
    runtime_version: String,
    queue_properties: Vec<String>,
    multi_device_mesh_available: bool,
    deterministic_profile_hash: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let architecture =
        std::env::var("TENSIX_ARCH").map_err(|_| "Tensix device not found or unsupported")?;

    if architecture != "blackhole" && architecture != "wormhole" {
        return Err("Unsupported Tensix device architecture".into());
    }

    let grid_dimensions = if architecture == "blackhole" {
        [10, 12]
    } else {
        [8, 8]
    };
    let enabled_cores = if architecture == "blackhole" { 120 } else { 64 };
    let dram_topology = vec!["GDDR6".to_string()];
    let supported_data_formats = vec!["BLOCK_FP8".to_string(), "BLOCK_FP16".to_string()];
    let firmware_version = "v1.2.0".to_string();
    let runtime_version = "tt-metalium-1.0.0".to_string();
    let queue_properties = vec!["in_order".to_string()];
    let multi_device_mesh_available = std::env::var("TENSIX_MESH_ENABLED")
        .map(|v| v == "1")
        .unwrap_or(false);

    let profile_data = format!(
        "{}:{}:{}:{}:{}:{}:{}:{}",
        architecture,
        grid_dimensions[0],
        grid_dimensions[1],
        enabled_cores,
        dram_topology.join(","),
        supported_data_formats.join(","),
        firmware_version,
        runtime_version
    );

    let mut hasher = Sha256::new();
    hasher.update(profile_data.as_bytes());
    let deterministic_profile_hash = format!("{:x}", hasher.finalize());

    let compat = ArtifactCompatibility {
        architecture,
        grid_dimensions,
        enabled_cores,
        dram_topology,
        supported_data_formats,
        firmware_version,
        runtime_version,
        queue_properties,
        multi_device_mesh_available,
        deterministic_profile_hash,
    };

    let json = serde_json::to_string_pretty(&compat)?;
    println!("{}", json);

    Ok(())
}
