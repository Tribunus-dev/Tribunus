use coreml_proto::proto::mil_spec;
use sha2::{Digest, Sha256};
use std::fs;
pub enum CompileProfile {
    MlXOnly,
    MlXPlusCoreMlOptional,
    HybridRequired,
}
    mlpackage_path: &Path,
    output_dir: &Path,
    island_id: &str,
    compute_units: &str,
    if !mlpackage_path.is_dir() {
        return Err(format!("not found: {:?}", mlpackage_path));
    }
    let toolchain_base =
        ToolchainAttestation::probe().map_err(|e| format!("toolchain not available: {e}"))?;
        .output()
        .map_err(|e| format!("xcrun: {e}"))?;
    let compiled_hash =
        match crate::decode_attribution::artifact_hash::hash_directory_deterministic(&inner, &[]) {
            Ok(r) => r.digest,
            Err(_) => String::new(),
        };
        if depth > 4 {
            return None;
        }
                    if let Some(found) = walk(&e.path(), depth + 1) {
                        return Some(found);
                    }
    fs::read(path)
        .map(|d| format!("{:x}", Sha256::digest(&d)))
        .unwrap_or_default()
    if let Ok(read) = fs::read_dir(path) {
        for e in read.filter_map(|e| e.ok()) {
            entries.push(e.path());
        }
    }
        h.update(
            p.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .as_bytes(),
        );
        if p.is_dir() {
            h.update(dir_sha256(p).as_bytes());
        } else if let Ok(d) = fs::read(p) {
            h.update(&d);
        }
pub fn emit_coreml_profile(
    profile: CompileProfile,
    islands: &[CoreMlIslandReceipt],
) -> Result<(), String> {
        .output("matmul_1") // const_f32(w) takes ssa 0, matmul gets 1
        outputs: vec![(
            "matmul_1".to_string(),
            vec![input_shape[0], weight_shape[1]],
        )],
            toolchain.coremlcompiler_version, toolchain.xcode_build_version
            .output("matmul_1") // const_f32(w) takes ssa 0, matmul gets 1
        assert!(pkg_path
            .join("Data/com.apple.CoreML/model.mlmodel")
            .exists());
        let receipt = compile_mlpackage(
            &pkg_path,
            tmp.path(),
            "known-answer",
            "cpuAndGPU",
            "CoreML9",
        )
        .expect("coremlcompiler must accept .mlpackage");
            let pkg_path = mlpackage::write_mlpackage(prog, tmp.path(), &meta).expect("write");
            let model = coreml_proto::proto::Model::decode(model_bytes.as_slice()).expect("decode");
        assert_eq!(
            manifest_a, manifest_b,
            "manifest JSON must be byte-identical"
        );
