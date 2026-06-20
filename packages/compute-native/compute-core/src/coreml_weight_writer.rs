//! External weight file management for Core ML ANE artifacts.
//! Persists weight data (via [`WeightProvider`]) to the Core ML `.mlpackage`
//! external weight directory and writes a weights manifest.

use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

use crate::compiler::ane::weight::{WeightProvider, WeightReference};

/// Write external weight files to `output_dir/weights/` and produce a
/// Write external weight files to `output_dir/weights/` and produce a
/// `weights_manifest.json`.
///
/// For each `WeightReference`:
/// 1. Calls `provider.materialize()` to obtain the raw bytes.
/// 2. Verifies the byte count matches `reference.byte_length`.
/// 3. Verifies the SHA-256 digest matches `reference.sha256`.
/// 4. Writes the file: first 8 bytes = `byte_length` as u64 LE, then the raw bytes.
///
/// Returns debug print of SHA-256 hex for each written file on success.
pub fn write_external_weights(
    output_dir: &Path,
    weights: &[WeightReference],
    provider: &dyn WeightProvider,
) -> Result<(), String> {
    let weights_dir = output_dir.join("weights");
    fs::create_dir_all(&weights_dir)
        .map_err(|e| format!("mkdir {}: {}", weights_dir.display(), e))?;

    let mut written_entries: Vec<serde_json::Value> = Vec::new();

    for w in weights {
        let data = provider
            .materialize(w)
            .map_err(|e| format!("materialize '{}': {}", w.tensor_name, e))?;

        // Validate byte count.
        let actual_len = data.len() as u64;
        if actual_len != w.byte_length {
            return Err(format!(
                "weight '{}': expected {} bytes, got {}",
                w.tensor_name, w.byte_length, actual_len
            ));
        }

        // Validate SHA-256.
        let actual_hash = format!("{:x}", Sha256::digest(&data));
        if actual_hash != w.sha256 {
            return Err(format!(
                "weight '{}': sha256 mismatch (expected {}, got {})",
                w.tensor_name, w.sha256, actual_hash
            ));
        }

        // Write file: [u64 LE byte_length][raw bytes].
        let file_name = Path::new(&w.relative_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&w.tensor_name);
        let file_path = weights_dir.join(format!("{}.bin", file_name));

        let mut file_content = Vec::with_capacity(8 + data.len());
        file_content.extend_from_slice(&w.byte_length.to_le_bytes());
        file_content.extend_from_slice(&data);

        fs::write(&file_path, &file_content)
            .map_err(|e| format!("write {}: {}", file_path.display(), e))?;

        eprintln!(
            "  wrote weight '{}' -> {} ({} bytes, sha256: {})",
            w.tensor_name,
            file_path.display(),
            actual_len,
            actual_hash
        );

        written_entries.push(serde_json::json!({
            "tensor_name": w.tensor_name,
            "dtype": w.dtype,
            "shape": w.shape,
            "byte_length": w.byte_length,
            "sha256": w.sha256,
            "relative_path": format!("weights/{}.bin", file_name),
        }));
    }

    // Write the manifest.
    let manifest = serde_json::json!({
        "format_version": "1.0.0",
        "weight_count": weights.len(),
        "weights": written_entries,
    });
    let manifest_path = output_dir.join("weights_manifest.json");
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .map_err(|e| format!("write {}: {}", manifest_path.display(), e))?;

    Ok(())
}
