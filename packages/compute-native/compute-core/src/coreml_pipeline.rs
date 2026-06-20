//! Core ML profile compilation pipeline — direct xcrun coremlcompiler
//! invocation from Rust, with pure-Rust MIL program construction.
//! No Python dependency.

use coreml_proto::proto::mil_spec;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::mil_builder::MilBuilder;
use crate::mlpackage::{self, ModelMeta};
use crate::coreml_weight_writer::write_external_weights;
use crate::compute_graph::{self, build_mlp_graph};
use crate::accelerate_artifacts::{build_rmsnorm_artifact, build_residual_add_artifact, CpuImplementation};
use crate::compiler::ane::build::AneSubgraphBuild;
use crate::compute_image::{CoreMlArtifactEntry, CoreMlArtifactReceipt, CoreMlProvenance};
use crate::toolchain_attest::ToolchainAttestation;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompileProfile {
    MlXOnly,
    MlXPlusCoreMlOptional,
    HybridRequired,
}

/// Compilation receipt that binds source artifact identity,
/// compiled artifact identity, and toolchain provenance.
#[derive(Debug, Clone)]
pub struct CoreMlIslandReceipt {
    pub island_id: String,
    pub model_hash: String,
    pub compiled_hash: String,
    pub compute_units: String,
    pub parity_passed: bool,
    pub compiled_modelc_path: String,
    /// MIL opset used for this artifact (e.g. "CoreML9", "ios18").
    pub opset: String,
    /// Full toolchain identity — Xcode version, coremlcompiler path,
    /// target platform, invocation args, stdout/stderr digests.
    pub toolchain: ToolchainAttestation,
}

/// Compile a source .mlpackage directory via xcrun coremlcompiler.
/// Returns receipt with source/compiled hashes, compile duration, and
/// full toolchain attestation.
pub fn compile_mlpackage(
    mlpackage_path: &Path,
    output_dir: &Path,
    island_id: &str,
    compute_units: &str,
    opset: &str,
) -> Result<CoreMlIslandReceipt, String> {
    let start = std::time::Instant::now();
    if !mlpackage_path.is_dir() {
        return Err(format!("not found: {:?}", mlpackage_path));
    }
    let model_hash = dir_sha256(mlpackage_path);
    let dest = output_dir.join(format!("{}.modelc", island_id));
    let _ = fs::create_dir_all(output_dir);

    let toolchain_base =
        ToolchainAttestation::probe().map_err(|e| format!("toolchain not available: {e}"))?;

    let src_path = mlpackage_path.to_string_lossy().to_string();
    let dest_path = dest.to_string_lossy().to_string();
    let compile_args = ["compile", src_path.as_str(), dest_path.as_str()];

    let result = Command::new("xcrun")
        .arg("coremlcompiler")
        .args(&compile_args)
        .output()
        .map_err(|e| format!("xcrun: {e}"))?;

    let compile_ns = start.elapsed().as_nanos() as u64;
    let toolchain = toolchain_base.with_compile_result(&compile_args, &result, compile_ns);

    if !result.status.success() {
        return Err(format!(
            "coremlcompiler failed: {}",
            String::from_utf8_lossy(&result.stderr)
        ));
    }

    let inner = find_model_dir(&dest).ok_or_else(|| format!("no metadata.json in {:?}", dest))?;
    let compiled_hash =
        match crate::decode_attribution::artifact_hash::hash_directory_deterministic(&inner, &[]) {
            Ok(r) => r.digest,
            Err(_) => String::new(),
        };

    Ok(CoreMlIslandReceipt {
        island_id: island_id.to_string(),
        model_hash,
        compiled_hash,
        compute_units: compute_units.to_string(),
        parity_passed: false,
        compiled_modelc_path: inner.to_string_lossy().to_string(),
        opset: opset.to_string(),
        toolchain,
    })
}

fn find_model_dir(mlmodelc_path: &Path) -> Option<PathBuf> {
    fn walk(dir: &Path, depth: u32) -> Option<PathBuf> {
        if depth > 4 {
            return None;
        }
        if dir.join("metadata.json").exists() && dir.join("model.mil").exists() {
            return Some(dir.to_path_buf());
        }
        if let Ok(entries) = fs::read_dir(dir) {
            for e in entries.filter_map(|e| e.ok()) {
                if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    if let Some(found) = walk(&e.path(), depth + 1) {
                        return Some(found);
                    }
                }
            }
        }
        None
    }
    walk(mlmodelc_path, 0)
}

fn file_sha256(path: &Path) -> String {
    fs::read(path)
        .map(|d| format!("{:x}", Sha256::digest(&d)))
        .unwrap_or_default()
}

fn dir_sha256(path: &Path) -> String {
    let mut h = Sha256::new();
    let mut entries: Vec<PathBuf> = Vec::new();
    if let Ok(read) = fs::read_dir(path) {
        for e in read.filter_map(|e| e.ok()) {
            entries.push(e.path());
        }
    }
    entries.sort();
    for p in &entries {
        h.update(
            p.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .as_bytes(),
        );
        if p.is_dir() {
            h.update(dir_sha256(p).as_bytes());
        } else {
            h.update(file_sha256(p).as_bytes());
        }
    }
    format!("{:x}", h.finalize())
}

pub fn emit_coreml_profile(
    profile: CompileProfile,
    islands: &[CoreMlIslandReceipt],
) -> Result<(), String> {
    if matches!(profile, CompileProfile::HybridRequired) && islands.is_empty() {
        return Err("HybridRequired requires at least one island".into());
    }
    Ok(())
}

/// Build and compile a simple F32 matmul region.
///
/// Constructs the MIL program in pure Rust (no Python), writes the
/// `.mlpackage`, and compiles via `xcrun coremlcompiler`.
///
/// `weight_values` is interpreted as row-major f32 data with the given `weight_shape`.
pub fn build_matmul_region(
    input_name: &str,
    input_shape: &[i64],
    weight_name: &str,
    weight_values: &[f32],
    weight_shape: &[i64],
    output_dir: &Path,
    region_id: &str,
) -> Result<CoreMlIslandReceipt, String> {
    let prog = MilBuilder::new("main")
        .input(input_name, mil_spec::DataType::Float32, input_shape)
        .const_f32(weight_name, weight_values, weight_shape)
        .matmul(input_name, &format!("{}_0", weight_name))
        .output("matmul_1") // const_f32(w) takes ssa 0, matmul gets 1
        .build()
        .expect("MIL builder error");

    let meta = ModelMeta {
        model_name: region_id.to_string(),
        function_name: "main".into(),
        inputs: vec![(input_name.to_string(), input_shape.to_vec())],
        outputs: vec![(
            "matmul_1".to_string(),
            vec![input_shape[0], weight_shape[1]],
        )],
        output_name: "matmul_1".into(),
        ..Default::default()
    };

    let tmp = tempfile::tempdir().map_err(|e| format!("tempdir: {}", e))?;
    let pkg_path = mlpackage::write_mlpackage(prog, tmp.path(), &meta)?;
    compile_mlpackage(&pkg_path, output_dir, region_id, "cpuAndGPU", "CoreML9")
}

/// Build, write, and compile a MIL program from a pre-built [`mil_spec::Program`].
pub fn build_and_compile(
    program: mil_spec::Program,
    meta: &ModelMeta,
    output_dir: &Path,
    region_id: &str,
    compute_units: &str,
) -> Result<CoreMlIslandReceipt, String> {
    let tmp = tempfile::tempdir().map_err(|e| format!("tempdir: {}", e))?;
    let pkg_path = mlpackage::write_mlpackage(program, tmp.path(), meta)?;
    compile_mlpackage(&pkg_path, output_dir, region_id, compute_units, "CoreML9")
}

/// write .mlpackage, compile via `coremlcompiler`, and return the sealed
/// artifact entry.
///
/// The output directory layout is:
/// ```text
/// output/<segment_id>/
///   model.mlpackage/
///     Manifest.json
///     Data/com.apple.CoreML/
///       model.mlmodel
///       weights/  (external weight files)
///   compiled.mlmodelc/
///   artifact.json
/// ```
pub fn compile_ane_subgraph(
    build: &AneSubgraphBuild,
    output_dir: &Path,
) -> Result<CoreMlArtifactEntry, String> {
    let segment_dir = output_dir.join(&build.segment_id);
    fs::create_dir_all(&segment_dir)
        .map_err(|e| format!("mkdir {}: {}", segment_dir.display(), e))?;

    // ── 1. Build MIL program ────────────────────────────────────────
    let input_name = build
        .canonical_input_ids
        .first()
        .cloned()
        .unwrap_or_else(|| "x".to_string());
    let output_name = build
        .canonical_output_ids
        .first()
        .cloned()
        .unwrap_or_else(|| "out".to_string());

    // Build MIL: input → const_weight_ref (for each weight) → matmul → output
    // For a standard x @ W matmul, x shape is [M, K], W shape is [K, N].
    let mut builder = MilBuilder::new("main");
    builder = builder.set_opset(&build.opset);

    // Register input with f32 dtype (ANE input convention).
    let input_dtype = mil_spec::DataType::Float32;
    builder = builder.input(&input_name, input_dtype, &build.shape_contract);

    // Register each weight as a const op referencing its external file.
    let mut weight_ssa_names: Vec<String> = Vec::new();
    for w in &build.weight_references {
        builder = builder.const_weight_ref(&w.tensor_name, w);
        weight_ssa_names.push(format!("{}_0", w.tensor_name));
    }

    // Add matmul: main_input × weight[0].
    if let Some(w_name) = weight_ssa_names.first() {
        builder = builder.matmul(&input_name, w_name);
        builder = builder.output("matmul_1");
    } else {
        // No weights, pass-through.
        builder = builder.output(&input_name);
    }

    let output_shape = if let Some(w) = build.weight_references.first() {
        let n = w.shape.last().copied().unwrap_or(256);
        let m = build.shape_contract.first().copied().unwrap_or(1);
        vec![m, n]
    } else {
        build.shape_contract.clone()
    };

    let program = builder
        .build()
        .map_err(|e| format!("MilBuilder::build: {}", e))?;

    // ── 2. Write .mlpackage ──────────────────────────────────────────
    let mut input_features: Vec<(String, Vec<i64>)> = build
        .canonical_input_ids
        .iter()
        .map(|n| (n.clone(), build.shape_contract.clone()))
        .collect();
    if input_features.is_empty() {
        input_features = vec![(input_name.clone(), build.shape_contract.clone())];
    }

    let mut output_features: Vec<(String, Vec<i64>)> = vec![(
        output_name.clone(),
        output_shape.clone(),
    )];

    let meta = ModelMeta {
        model_name: build.segment_id.clone(),
        function_name: "main".into(),
        inputs: input_features.clone(),
        outputs: output_features.clone(),
        output_name: output_name.clone(),
        ..Default::default()
    };

    let pkg_path = mlpackage::write_mlpackage(program, &segment_dir, &meta)?;

    // ── 3. Write external weight files into the package ──────────────
    let pkg_weights_dir = pkg_path.join("Data/com.apple.CoreML");
    write_external_weights(&pkg_weights_dir, &build.weight_references, &*build.weight_provider)?;

    // ── 4. Compile via coremlcompiler ────────────────────────────────
    let receipt = compile_mlpackage(
        &pkg_path,
        &segment_dir,
        &build.segment_id,
        &build.compute_units,
        &build.opset,
    )?;

    let compiled_path = Path::new(&receipt.compiled_modelc_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| segment_dir.join(format!("{}.modelc", &build.segment_id)));

    // ── 5. Write artifact.json ───────────────────────────────────────
    let input_dtypes: Vec<String> = build
        .canonical_input_ids
        .iter()
        .map(|_| "float32".to_string())
        .collect();
    let output_dtypes: Vec<String> = vec!["float32".to_string()];

    // Build compute graph before constructing entry.
    let graph_entry = CoreMlArtifactEntry {
        segment_id: build.segment_id.clone(),
        artifact_hash: receipt.compiled_hash.clone(),
        package_path: pkg_path.to_string_lossy().to_string(),
        compiled_path: compiled_path.to_string_lossy().to_string(),
        compiler_version: receipt.toolchain.coremlcompiler_version.clone(),
        compute_unit_policy: build.compute_units.clone(),
        input_feature_names: build.canonical_input_ids.clone(),
        output_feature_names: vec![output_name.clone()],
        input_shapes: vec![build.shape_contract.clone()],
        output_shapes: vec![output_shape.clone()],
        input_dtypes: vec!["float32".to_string()],
        output_dtypes: vec!["float32".to_string()],
        weight_references: build.weight_references.clone(),
        canonical_provenance: CoreMlProvenance {
            source_tensor_ids: build.canonical_input_ids.clone(),
            image_hash: receipt.model_hash.clone(),
        },
        validation_receipt: CoreMlArtifactReceipt {
            compiled: true, loaded: false, warmup_passed: false, numerical_parity: None,
        },
        graph: None,
    };
    let graph = build_mlp_graph(&graph_entry, "decode_1");

    let entry = CoreMlArtifactEntry {
        segment_id: build.segment_id.clone(),
        artifact_hash: receipt.compiled_hash.clone(),
        package_path: pkg_path.to_string_lossy().to_string(),
        compiled_path: compiled_path.to_string_lossy().to_string(),
        compiler_version: receipt.toolchain.coremlcompiler_version.clone(),
        compute_unit_policy: build.compute_units.clone(),
        input_feature_names: build.canonical_input_ids.clone(),
        output_feature_names: vec![output_name.clone()],
        input_shapes: vec![build.shape_contract.clone()],
        output_shapes: vec![output_shape.clone()],
        input_dtypes,
        output_dtypes,
        weight_references: build.weight_references.clone(),
        canonical_provenance: CoreMlProvenance {
            source_tensor_ids: build.canonical_input_ids.clone(),
            image_hash: receipt.model_hash.clone(),
        },
        validation_receipt: CoreMlArtifactReceipt {
            compiled: true,
            loaded: false,
            warmup_passed: false,
            numerical_parity: None,
        },
        graph: Some(graph),
    };

    let artifact_path = segment_dir.join("artifact.json");
    fs::write(
        &artifact_path,
        serde_json::to_string_pretty(&entry).map_err(|e| format!("serde: {}", e))?,
    )
    .map_err(|e| format!("write {}: {}", artifact_path.display(), e))?;

    Ok(entry)
}

/// Emit a three-node heterogeneous layer MLP graph:
///   Accelerate RMSNorm → Core ML MLP → Accelerate residual-add
///
/// Returns the two CPU artifacts (with content hashes) and the compute graph.
/// The MLP artifact is already compiled and present in `mlp_entry`.
/// The caller is responsible for embedding artifacts and graph into the manifest.
pub fn emit_layer_mlp_graph(
    mlp_entry: &CoreMlArtifactEntry,
    hidden_size: i64,
) -> (Vec<crate::accelerate_artifacts::AccelerateArtifact>, crate::compute_graph::ComputeGraph) {
    use crate::accelerate_artifacts::AccelerateArtifact;
    use crate::compute_graph::{
        BufferRegion, GraphNode, LaneAffinity, FailurePolicy, Residency, Ownership,
    };

    // Build RMSNorm artifact with content hash.
    let mut rmsnorm = build_rmsnorm_artifact(
        &format!("cpu:{}:rmsnorm", mlp_entry.segment_id),
        hidden_size,
    );
    let rmsnorm_json = serde_json::to_string(&rmsnorm).unwrap_or_default();
    rmsnorm.artifact_hash = format!("{:x}", Sha256::digest(rmsnorm_json.as_bytes()));

    // Build residual-add artifact with content hash.
    let mut residual_add = build_residual_add_artifact(
        &format!("cpu:{}:residual_add", mlp_entry.segment_id),
        hidden_size,
    );
    let add_json = serde_json::to_string(&residual_add).unwrap_or_default();
    residual_add.artifact_hash = format!("{:x}", Sha256::digest(add_json.as_bytes()));

    // Upgrade to vDSP implementation.
    rmsnorm.implementation = CpuImplementation::AccelerateVdsp;
    rmsnorm.framework_contract.routine = "vdsp".into();
    rmsnorm.framework_contract.vectorization_policy = "contract".into();

    residual_add.implementation = CpuImplementation::AccelerateVdsp;
    residual_add.framework_contract.routine = "vdsp".into();
    residual_add.framework_contract.vectorization_policy = "contract".into();

    // Graph variant ID uses copy variant (persistent variant requires qualification).
    let graph_id = format!("mlp:{}:{}:copy:v1", mlp_entry.segment_id, "decode_1");

    // Region map:
    //   0 — hidden activation (input)
    //   1 — norm weight (image-owned, persistent)
    //   2 — normed activation
    //   3 — MLP output
    //   4 — residual output
    //
    // Nodes:
    //   0 — Dispatch { artifact: RMSNorm, lane: Cpu, deps: [] }
    //   1 — Dispatch { artifact: MLP, lane: Ane, deps: [0] }
    //   2 — Dispatch { artifact: residual-add, lane: Cpu, deps: [0, 1] }
    let graph = crate::compute_graph::ComputeGraph {
        graph_id: graph_id.clone(),
        graph_version: "0.1.0".to_string(),
        shape_key: "decode_1".to_string(),
        nodes: vec![
            GraphNode::Dispatch {
                node_id: 0,
                artifact_id: rmsnorm.artifact_id.clone(),
                artifact_hash: rmsnorm.artifact_hash.clone(),
                input_bindings: vec![("x".into(), 0), ("w".into(), 1)],
                output_bindings: vec![("out".into(), 2)],
                dependency_ids: vec![],
                lane: LaneAffinity::Cpu,
                failure_policy: FailurePolicy::Degrade,
            },
            GraphNode::Dispatch {
                node_id: 1,
                artifact_id: mlp_entry.segment_id.clone(),
                artifact_hash: mlp_entry.artifact_hash.clone(),
                input_bindings: vec![(
                    mlp_entry.input_feature_names.first().cloned().unwrap_or_else(|| "x".into()), 2)],
                output_bindings: vec![(
                    mlp_entry.output_feature_names.first().cloned().unwrap_or_else(|| "out".into()), 3)],
                dependency_ids: vec![0],
                lane: LaneAffinity::Ane,
                failure_policy: FailurePolicy::Degrade,
            },
            GraphNode::Dispatch {
                node_id: 2,
                artifact_id: residual_add.artifact_id.clone(),
                artifact_hash: residual_add.artifact_hash.clone(),
                input_bindings: vec![("a".into(), 3), ("b".into(), 0)],
                output_bindings: vec![("out".into(), 4)],
                dependency_ids: vec![1],
                lane: LaneAffinity::Cpu,
                failure_policy: FailurePolicy::Degrade,
            },
        ],
        regions: vec![
            BufferRegion {
                region_id: 0,
                logical_dtype: "float32".into(),
                logical_shape: vec![1, hidden_size],
                byte_length: (hidden_size as u64) * 4,
                alignment: 64,
                residency: Residency::Host,
                ownership: Ownership::Request,
                alias_group: None,
            },
            BufferRegion {
                region_id: 1,
                logical_dtype: "float32".into(),
                logical_shape: vec![hidden_size],
                byte_length: (hidden_size as u64) * 4,
                alignment: 64,
                residency: Residency::Shared,
                ownership: Ownership::Image,
                alias_group: None,
            },
            BufferRegion {
                region_id: 2,
                logical_dtype: "float32".into(),
                logical_shape: vec![1, hidden_size],
                byte_length: (hidden_size as u64) * 4,
                alignment: 64,
                residency: Residency::Host,
                ownership: Ownership::Request,
                alias_group: None,
            },
            BufferRegion {
                region_id: 3,
                logical_dtype: "float32".into(),
                logical_shape: vec![1, hidden_size],
                byte_length: (hidden_size as u64) * 4,
                alignment: 64,
                residency: Residency::CoreMlCompatible,
                ownership: Ownership::Request,
                alias_group: None,
            },
            BufferRegion {
                region_id: 4,
                logical_dtype: "float32".into(),
                logical_shape: vec![1, hidden_size],
                byte_length: (hidden_size as u64) * 4,
                alignment: 64,
                residency: Residency::Host,
                ownership: Ownership::Request,
                alias_group: None,
            },
        ],
        entry_node_ids: vec![0],
        output_node_ids: vec![2],
    };

    (vec![rmsnorm, residual_add], graph)
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message;

    /// End-to-end Apple acceptance gate: build MIL program, write .mlpackage,
    /// compile via xcrun coremlcompiler, verify .mlmodelc exists.
    ///
    /// Skips if no Xcode toolchain is available.
    #[test]
    fn known_answer_f32_matmul_compiles() {
        let toolchain = match ToolchainAttestation::probe() {
            Ok(t) => t,
            Err(e) => {
                eprintln!("SKIP: toolchain not available: {e}");
                return;
            }
        };
        eprintln!(
            "compiler: {} ({})",
            toolchain.coremlcompiler_version, toolchain.xcode_build_version
        );

        let prog = MilBuilder::new("main")
            .input("x", mil_spec::DataType::Float32, &[1, 4])
            .const_f32("w", &[1.0_f32, 2.0, 3.0, 4.0], &[4, 1])
            .matmul("x", "w_0")
            .output("matmul_1") // const_f32(w) takes ssa 0, matmul gets 1
            .build()
            .expect("MIL builder error");

        let meta = ModelMeta {
            model_name: "known-answer-matmul".into(),
            inputs: vec![("x".into(), vec![1, 4])],
            outputs: vec![("matmul_1".into(), vec![1, 1])],
            output_name: "matmul_1".into(),
            ..Default::default()
        };

        let tmp = tempfile::tempdir().expect("tempdir");
        let pkg_path =
            mlpackage::write_mlpackage(prog, tmp.path(), &meta).expect("write mlpackage");
        assert!(pkg_path.join("Manifest.json").exists());
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

        let modelc = Path::new(&receipt.compiled_modelc_path);
        assert!(modelc.is_dir(), "compiled modelc dir missing");
        assert!(modelc.join("metadata.json").exists());
        assert!(modelc.join("model.mil").exists());
        assert!(!receipt.compiled_hash.is_empty());
        assert!(!receipt.model_hash.is_empty());
        assert_eq!(receipt.island_id, "known-answer");
        assert_eq!(receipt.opset, "CoreML9");
        assert!(receipt.toolchain.compile_duration_ns > 0);
        assert_eq!(receipt.toolchain.exit_status, 0);

        eprintln!(
            "PASS: model_hash={} compiled_hash={} compile_ns={}",
            &receipt.model_hash[..16],
            &receipt.compiled_hash[..16],
            receipt.toolchain.compile_duration_ns
        );
    }

    /// Determinism: verifies that manifest JSON is byte-identical on repeated
    /// builds and that the protobuf decodes to the same logical content.
    ///
    /// Full byte-identical directory hashes are not yet guaranteed because
    /// prost-generated `HashMap` fields (e.g. `Operation.inputs`,
    /// `block_specializations`) have non-deterministic wire-format iteration.
    /// This is a known prost limitation — a future fix would use `IndexMap`
    /// or sorted encoding.
    #[test]
    fn deterministic_manifest_and_proto_roundtrip() {
        let build = || {
            let prog = MilBuilder::new("main")
                .input("a", mil_spec::DataType::Float32, &[2, 2])
                .input("b", mil_spec::DataType::Float32, &[2, 2])
                .add("a", "b")
                .mul("add_0", "add_0")
                .output("mul_1")
                .build()
                .expect("MIL builder error");
            let meta = ModelMeta {
                model_name: "det".into(),
                inputs: vec![("a".into(), vec![2, 2]), ("b".into(), vec![2, 2])],
                outputs: vec![("output".into(), vec![2, 2])],
                output_name: "output".into(),
                ..Default::default()
            };
            let tmp = tempfile::tempdir().expect("tempdir");
            let pkg_path = mlpackage::write_mlpackage(prog, tmp.path(), &meta).expect("write");

            // Manifest JSON must be byte-identical
            let manifest = fs::read(pkg_path.join("Manifest.json")).expect("read");
            let manifest_hash = format!("{:x}", Sha256::digest(&manifest));

            // Protobuf must decode to consistent logical structure
            let model_bytes =
                fs::read(pkg_path.join("Data/com.apple.CoreML/model.mlmodel")).expect("read");
            let model = coreml_proto::proto::Model::decode(model_bytes.as_slice()).expect("decode");
            assert_eq!(model.specification_version, 9);

            // Extract operation types in order (deterministic — stored as Vec)
            let ops: Vec<String> = match model.r#type {
                Some(coreml_proto::proto::model::Type::MlProgram(ref p)) => {
                    let f = p.functions.get("main").expect("main function");
                    let b = f.block_specializations.get(&f.opset).expect("block");
                    b.operations.iter().map(|o| o.r#type.clone()).collect()
                }
                _ => panic!("expected MlProgram"),
            };

            (manifest_hash, ops)
        };

        let (manifest_a, ops_a) = build();
        let (manifest_b, ops_b) = build();
        assert_eq!(
            manifest_a, manifest_b,
            "manifest JSON must be byte-identical"
        );
        assert_eq!(ops_a, ops_b, "operation sequence must be deterministic");
        assert_eq!(ops_a, vec!["add", "mul"], "expected add then mul");
    }
}
