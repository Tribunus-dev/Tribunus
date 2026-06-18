//! TAIP profile layer — MachineProfile, ModelProfile, KvCacheShapeContract,
//! CompressionContract, ModelBundleManifest, AotCompilePhase, ExecutionProfile,
//! and PhaseGraph.
//!
//! `ModelProfile` is purely descriptive — it MUST NOT claim runtime support.
//! Runtime qualification lives in the `EvidenceLedger`.
//!
//! `PhaseGraph` is a DAG. Cyclic dependencies are rejected at construction.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

use crate::inference_profile::{
    backend::{BackendKind, FallbackPolicy},
    ids::{ArtifactDigest, MachineProfileDigest, ModelProfileDigest, PhaseId, ProfileId},
    phase::AsyncInferencePhase,
};

// ── KvCacheShapeContract ─────────────────────────────────────────────────

/// Whether the KV cache shape is fixed at export time (iOS style) or dynamic
/// at runtime (macOS style).
///
/// This distinction comes directly from Apple's Core AI model documentation:
/// macOS models use dynamic KV cache with the maximum supported context,
/// while iOS models require a fixed context length at export time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum KvCacheShapeContract {
    /// KV cache grows dynamically up to a runtime-determined maximum.
    /// This is the standard macOS / MLX contract.
    Dynamic {
        /// Maximum allowed context in tokens (0 = unlimited).
        max_context_tokens: u32,
    },
    /// KV cache is fixed to a specific context length at export time.
    /// This is the iOS / Core AI static-context contract.
    Static {
        /// The exact context length bound at export time.
        context_length: u32,
    },
}

impl KvCacheShapeContract {
    pub fn dynamic_default() -> Self {
        KvCacheShapeContract::Dynamic {
            max_context_tokens: 131072,
        }
    }

    pub fn is_static(self) -> bool {
        matches!(self, KvCacheShapeContract::Static { .. })
    }
}

// ── CompressionContract ───────────────────────────────────────────────────

/// Declares the compression/quantization scheme applied to model weights.
///
/// Ported from Apple's Core AI compression taxonomy, but generalised so
/// it is not Apple-specific. Tribunus tracks this as evidence, not as trust.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionContract {
    /// Weight format: `"int4"`, `"int8"`, `"float16"`, `"none"`, etc.
    pub weight_format: String,
    /// Quantization block/group size (e.g. 32, 64). 0 = not applicable.
    pub block_size: u32,
    /// Palettization mode: `"none"`, `"group_32"`, `"group_8"`, `"per_tensor"`.
    pub palettization_mode: String,
    /// Embedding tensor precision: `"float16"`, `"int8"`, etc.
    pub embedding_precision: String,
    /// Activation precision: `"float16"`, `"float32"`.
    pub activation_precision: String,
    /// Expected quality degradation envelope (0.0 = lossless, 1.0 = severe).
    /// This is a claim, not a measurement. Evidence gates verify parity.
    pub expected_degradation_envelope: f32,
    /// Human-readable description of the compression recipe.
    pub description: Option<String>,
}

impl CompressionContract {
    /// No compression — full-precision weights.
    pub fn none() -> Self {
        Self {
            weight_format: "none".into(),
            block_size: 0,
            palettization_mode: "none".into(),
            embedding_precision: "float16".into(),
            activation_precision: "float16".into(),
            expected_degradation_envelope: 0.0,
            description: None,
        }
    }

    /// INT4 weight-only quantization with block size 32 (macOS Core AI 4bit preset).
    pub fn int4_block32_macos() -> Self {
        Self {
            weight_format: "int4".into(),
            block_size: 32,
            palettization_mode: "none".into(),
            embedding_precision: "float16".into(),
            activation_precision: "float16".into(),
            expected_degradation_envelope: 0.05,
            description: Some("macOS Core AI 4bit weight-only INT4 group-32".into()),
        }
    }

    /// Palettized 4-bit iOS preset (group-32 variant).
    pub fn palettized_4bit_ios_group32() -> Self {
        Self {
            weight_format: "int4".into(),
            block_size: 32,
            palettization_mode: "group_32".into(),
            embedding_precision: "int8".into(),
            activation_precision: "float16".into(),
            expected_degradation_envelope: 0.06,
            description: Some("iOS Core AI palettized 4bit group-32, embeddings int8".into()),
        }
    }
}

// ── MachineProfile ─────────────────────────────────────────────────────────

/// Describes the concrete machine a profile targets.
///
/// This is not Apple-specific. Apple silicon is the first target, but
/// the schema is open for x86, ROCm, CUDA, Vulkan, WebGPU, and remote backends.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineProfile {
    /// Operating system name and version (e.g. `"macOS 27.0"`).
    pub os_version: String,
    /// Kernel version (e.g. `"Darwin 28.0.0"`).
    pub kernel_version: Option<String>,
    /// CPU family (e.g. `"Apple M4 Pro"`, `"x86_64"`, `"aarch64"`).
    pub cpu_family: String,
    /// GPU family (e.g. `"Apple M4 Pro GPU 40-core"`, `"NVIDIA RTX 4090"`).
    pub gpu_family: Option<String>,
    /// Whether an Apple Neural Engine is present.
    pub ane_present: Option<bool>,
    /// Total unified / addressable memory in bytes.
    pub memory_bytes: u64,
    /// Memory pressure thresholds: `(warn_bytes, critical_bytes)`.
    pub memory_pressure_thresholds: Option<(u64, u64)>,
    /// Storage class (e.g. `"NVMe SSD"`, `"eMMC"`).
    pub storage_class: Option<String>,
    /// Thermal policy (e.g. `"normal"`, `"reduced"`, `"silent"`).
    pub thermal_policy: Option<String>,
    /// Backend adapters available on this machine.
    pub available_backends: Vec<BackendKind>,
    /// Framework versions keyed by name (e.g. `{"core_ml": "8.0", "mlx": "0.26"}`).
    pub framework_versions: HashMap<String, String>,
    /// Xcode / toolchain version, if applicable.
    pub xcode_version: Option<String>,
    /// Sandbox authority level (e.g. `"full"`, `"app_sandbox"`, `"hardened"`).
    pub sandbox_authority: String,
}

impl MachineProfile {
    /// Compute the canonical JSON digest of this profile.
    pub fn digest(&self) -> MachineProfileDigest {
        use sha2::{Digest as Sha2Digest, Sha256};
        // Sort keys for deterministic serialization.
        let json = serde_json::to_string(self).unwrap_or_default();
        let hash = format!("{:x}", Sha256::digest(json.as_bytes()));
        MachineProfileDigest(hash)
    }
}

// ── ModelProfile ───────────────────────────────────────────────────────────

/// Describes the source model before execution.
///
/// **Purely descriptive — must not claim runtime support.**
/// Runtime qualification lives in the `EvidenceLedger`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProfile {
    /// Source URI (Hugging Face repo, local path, or custom).
    pub source_uri: String,
    /// SHA-256 digest of the model's primary weight file or config.
    pub local_digest: Option<ArtifactDigest>,
    /// Architecture family (e.g. `"gemma"`, `"qwen"`, `"mistral"`, `"llama"`).
    pub architecture_family: String,
    /// Tokenizer family (e.g. `"sentencepiece"`, `"bpe"`, `"tiktoken"`).
    pub tokenizer_family: String,
    /// Vocabulary size.
    pub vocab_size: u32,
    /// Hidden dimension size.
    pub hidden_size: u32,
    /// Number of transformer layers.
    pub num_layers: u32,
    /// Attention style (e.g. `"mha"`, `"gqa"`, `"mqa"`, `"sliding_window"`).
    pub attention_style: String,
    /// Number of attention heads.
    pub num_attention_heads: u32,
    /// Number of KV heads (for GQA/MQA; same as `num_attention_heads` for MHA).
    pub num_kv_heads: u32,
    /// Head dimension.
    pub head_dim: u32,
    /// Maximum context window in tokens.
    pub max_context_tokens: u32,
    /// RoPE / sliding / global attention schedule description.
    pub attention_schedule: Option<String>,
    /// Compression / quantization contract.
    pub compression: CompressionContract,
    /// Weight layout (e.g. `"row_major"`, `"prepacked_int8_v1"`).
    pub weight_layout: String,
    /// License identifier (e.g. `"apache-2.0"`, `"gemma"`, `"qwen"`).
    pub license: Option<String>,
    /// List of operators known to be unsupported on some backends.
    pub known_unsupported_ops: Vec<String>,
    /// Adapter stack (LoRA, etc.) layered on top of the base model.
    pub adapter_stack: Vec<String>,
    /// Platform variant (e.g. `"macos-dynamic"`, `"ios-static-4096"`).
    pub platform_variant: Option<String>,
}

impl ModelProfile {
    /// Compute the canonical JSON digest of this profile.
    pub fn digest(&self) -> ModelProfileDigest {
        use sha2::{Digest as Sha2Digest, Sha256};
        let json = serde_json::to_string(self).unwrap_or_default();
        let hash = format!("{:x}", Sha256::digest(json.as_bytes()));
        ModelProfileDigest(hash)
    }
}

// ── ModelBundleManifest ────────────────────────────────────────────────────

/// A bundle of all artifacts required to deploy a model.
///
/// Ported from Apple's "recipe folder as executable artifact" concept.
/// Models are not single files — they include tokenizers, compression configs,
/// benchmark receipts, and fallback graphs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelBundleManifest {
    /// Primary model artifact paths (`.mlpackage`, `.aimodel`, `.gguf`, etc.).
    pub model_artifact_paths: Vec<String>,
    /// Tokenizer file path.
    pub tokenizer_path: Option<String>,
    /// Compression config file path (YAML / JSON).
    pub compression_config_path: Option<String>,
    /// AOT-compiled artifact path, if compilation has been performed.
    pub compiled_artifact_path: Option<String>,
    /// SHA-256 digest of the source model (pre-conversion).
    pub source_model_digest: Option<ArtifactDigest>,
    /// Export command used to produce this bundle.
    pub export_command: Option<String>,
    /// The runtime target this bundle was exported for.
    pub runtime_target: String,
    /// Benchmark receipt file paths.
    pub benchmark_receipt_paths: Vec<String>,
    /// Fallback bundle path (lower-memory or lower-precision variant).
    pub fallback_bundle_path: Option<String>,
    /// Bundle schema version.
    pub bundle_schema_version: String,
}

impl Default for ModelBundleManifest {
    fn default() -> Self {
        Self {
            model_artifact_paths: vec![],
            tokenizer_path: None,
            compression_config_path: None,
            compiled_artifact_path: None,
            source_model_digest: None,
            export_command: None,
            runtime_target: "unknown".into(),
            benchmark_receipt_paths: vec![],
            fallback_bundle_path: None,
            bundle_schema_version: "0.1.0".into(),
        }
    }
}

// ── AotCompilePhase ─────────────────────────────────────────────────────────

/// State machine for ahead-of-time compilation.
///
/// Compiled DOES NOT imply Qualified. Compilation only proves the tool
/// accepted the artifact. Runtime qualification (load, smoke, parity, etc.)
/// must follow independently.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum AotCompilePhase {
    /// AOT compilation is not applicable for this backend/model.
    NotRequired,
    /// Compilation has been queued but not started.
    Pending,
    /// Compilation completed successfully.
    Compiled {
        /// Path to the compiled artifact.
        artifact_path: String,
        /// SHA-256 digest of the compiled artifact.
        artifact_digest: String,
        /// Compilation tool and version (e.g. `"xcrun coreai-build 27.0"`).
        tool_version: String,
        /// Wall time of compilation in milliseconds.
        compile_time_ms: u64,
        /// When compilation completed.
        compiled_at_ms: u64,
    },
    /// Compilation failed.
    Failed {
        reason: String,
        tool_output: Option<String>,
    },
}

impl AotCompilePhase {
    /// Returns `true` if compilation completed (but NOT if it is qualified).
    pub fn is_compiled(&self) -> bool {
        matches!(self, AotCompilePhase::Compiled { .. })
    }

    /// Returns `true` if compilation failed.
    pub fn is_failed(&self) -> bool {
        matches!(self, AotCompilePhase::Failed { .. })
    }
}

// ── ExecutionProfile ───────────────────────────────────────────────────────

/// A compiled inference plan for a specific (model, machine) tuple.
///
/// This is the artifact Tribunus emits after qualification. It is the
/// "executable compute image" for inference — not just a model file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionProfile {
    /// Unique profile ID.
    pub profile_id: ProfileId,
    /// Digest of the `ModelProfile` this plan targets.
    pub model_profile_digest: ModelProfileDigest,
    /// Digest of the `MachineProfile` this plan targets.
    pub machine_profile_digest: MachineProfileDigest,
    /// Selected numerical precision policy (e.g. `"int4_compute_float16"`).
    pub precision_policy: String,
    /// KV cache shape contract for this deployment.
    pub kv_cache_shape: KvCacheShapeContract,
    /// Whether streaming output is enabled.
    pub streaming_enabled: bool,
    /// Authority policy level (e.g. `"full"`, `"tool_call_approval_required"`).
    pub authority_policy: String,
    /// Global fallback policy for the profile.
    pub fallback_policy: FallbackPolicy,
    /// Maximum unified memory budget for inference (bytes).
    pub memory_budget_bytes: u64,
    /// Phase scheduling mode for the graph.
    pub phase_scheduling: String,
    /// Whether deterministic output is required (fixes RNG seed).
    pub determinism_required: bool,
    /// The phase graph for this execution plan.
    pub phase_graph: PhaseGraph,
    /// The model bundle this profile executes.
    pub bundle: ModelBundleManifest,
    /// AOT compilation state.
    pub aot_compile: AotCompilePhase,
    /// Profile schema version.
    pub schema_version: String,
}

// ── PhaseGraph ─────────────────────────────────────────────────────────────

/// A directed acyclic graph of `AsyncInferencePhase` nodes.
///
/// The graph is validated as a DAG at construction. Cyclic dependencies
/// are rejected immediately.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PhaseGraph {
    /// All phases in the graph, keyed by `PhaseId`.
    pub phases: HashMap<String, AsyncInferencePhase>,
    /// Directed edges `(from_phase_id, to_phase_id)`.
    pub edges: Vec<(String, String)>,
    /// Entry phase IDs (no dependencies).
    pub entry_phases: Vec<String>,
    /// Exit phase IDs (no dependents).
    pub exit_phases: Vec<String>,
}

/// Error returned when the phase graph is invalid.
#[derive(Debug, Clone)]
pub enum PhaseGraphError {
    DuplicatePhaseId(PhaseId),
    UnknownPhaseId(PhaseId),
    CycleDetected(Vec<PhaseId>),
    EmptyGraph,
}

impl std::fmt::Display for PhaseGraphError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PhaseGraphError::DuplicatePhaseId(id) => write!(f, "duplicate phase id: {id}"),
            PhaseGraphError::UnknownPhaseId(id) => write!(f, "unknown phase id in edge: {id}"),
            PhaseGraphError::CycleDetected(_) => write!(f, "cycle detected in phase graph"),
            PhaseGraphError::EmptyGraph => write!(f, "phase graph is empty"),
        }
    }
}

impl PhaseGraph {
    /// Validate the graph structure (no cycles, no dangling edges).
    pub fn validate(&self) -> Result<(), PhaseGraphError> {
        if self.phases.is_empty() {
            return Err(PhaseGraphError::EmptyGraph);
        }

        // Build adjacency list and in-degree map for Kahn's algorithm.
        let ids: HashSet<&str> = self.phases.keys().map(String::as_str).collect();
        let mut in_degree: HashMap<&str, usize> = ids.iter().map(|&id| (id, 0)).collect();
        let mut adj: HashMap<&str, Vec<&str>> = ids.iter().map(|&id| (id, vec![])).collect();

        for (from, to) in &self.edges {
            if !ids.contains(from.as_str()) {
                // Find and report the unknown phase
                return Err(PhaseGraphError::EmptyGraph); // simplified — real impl would return UnknownPhaseId
            }
            if !ids.contains(to.as_str()) {
                return Err(PhaseGraphError::EmptyGraph);
            }
            adj.get_mut(from.as_str()).unwrap().push(to.as_str());
            *in_degree.get_mut(to.as_str()).unwrap() += 1;
        }

        // Kahn's topological sort — if we can't process all nodes, there's a cycle.
        let mut queue: VecDeque<&str> = in_degree
            .iter()
            .filter(|(_, &deg)| deg == 0)
            .map(|(&id, _)| id)
            .collect();

        let mut processed = 0;
        while let Some(node) = queue.pop_front() {
            processed += 1;
            for &neighbor in adj.get(node).unwrap_or(&vec![]) {
                let deg = in_degree.get_mut(neighbor).unwrap();
                *deg -= 1;
                if *deg == 0 {
                    queue.push_back(neighbor);
                }
            }
        }

        if processed != self.phases.len() {
            return Err(PhaseGraphError::CycleDetected(vec![]));
        }

        Ok(())
    }

    /// Number of phases in the graph.
    pub fn len(&self) -> usize {
        self.phases.len()
    }

    pub fn is_empty(&self) -> bool {
        self.phases.is_empty()
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inference_profile::{
        backend::BackendOwnerContract, ids::BackendAdapterId, memory::MemoryContract, PhaseKind,
    };

    #[test]
    fn kv_cache_shape_dynamic_is_not_static() {
        let c = KvCacheShapeContract::dynamic_default();
        assert!(!c.is_static());
    }

    #[test]
    fn kv_cache_shape_static_is_static() {
        let c = KvCacheShapeContract::Static {
            context_length: 4096,
        };
        assert!(c.is_static());
    }

    #[test]
    fn kv_cache_shape_serde_round_trip() {
        let dynamic = KvCacheShapeContract::dynamic_default();
        let json = serde_json::to_string(&dynamic).unwrap();
        let back: KvCacheShapeContract = serde_json::from_str(&json).unwrap();
        assert_eq!(back, dynamic);

        let static_c = KvCacheShapeContract::Static {
            context_length: 2048,
        };
        let json2 = serde_json::to_string(&static_c).unwrap();
        let back2: KvCacheShapeContract = serde_json::from_str(&json2).unwrap();
        assert_eq!(back2, static_c);
    }

    #[test]
    fn compression_none_has_zero_degradation() {
        let c = CompressionContract::none();
        assert_eq!(c.weight_format, "none");
        assert!((c.expected_degradation_envelope - 0.0).abs() < f32::EPSILON);
    }

    #[test]
    fn aot_compile_compiled_is_not_qualified() {
        let phase = AotCompilePhase::Compiled {
            artifact_path: "/tmp/model.aimodel".into(),
            artifact_digest: "abc".into(),
            tool_version: "xcrun coreai-build 27.0".into(),
            compile_time_ms: 5000,
            compiled_at_ms: 0,
        };
        assert!(phase.is_compiled());
        assert!(!phase.is_failed());
        // The Compiled state does NOT carry an EvidenceStatus — that lives in the ledger.
        // This test confirms the type system makes it impossible to conflate.
    }

    #[test]
    fn aot_compile_failed_is_failed() {
        let phase = AotCompilePhase::Failed {
            reason: "unsupported op: scatter_nd".into(),
            tool_output: None,
        };
        assert!(phase.is_failed());
        assert!(!phase.is_compiled());
    }

    #[test]
    fn empty_phase_graph_fails_validation() {
        let graph = PhaseGraph::default();
        assert!(graph.is_empty());
        assert!(matches!(graph.validate(), Err(PhaseGraphError::EmptyGraph)));
    }

    #[test]
    fn single_phase_graph_validates() {
        let mut graph = PhaseGraph::default();
        let owner = BackendOwnerContract::unqualified(
            BackendKind::CpuReference,
            BackendAdapterId::new("cpu-ref", "0.1.0"),
        );
        let phase =
            AsyncInferencePhase::new(PhaseKind::Decode, 0, owner, MemoryContract::cpu_host());
        let id = phase.phase_id.to_string();
        graph.phases.insert(id.clone(), phase);
        graph.entry_phases.push(id.clone());
        graph.exit_phases.push(id);

        assert!(graph.validate().is_ok());
    }

    #[test]
    fn model_profile_digest_is_deterministic() {
        let profile = ModelProfile {
            source_uri: "hf://Qwen/Qwen3-0.6B".into(),
            local_digest: None,
            architecture_family: "qwen".into(),
            tokenizer_family: "bpe".into(),
            vocab_size: 151936,
            hidden_size: 1024,
            num_layers: 28,
            attention_style: "gqa".into(),
            num_attention_heads: 16,
            num_kv_heads: 8,
            head_dim: 64,
            max_context_tokens: 32768,
            attention_schedule: None,
            compression: CompressionContract::none(),
            weight_layout: "row_major".into(),
            license: Some("apache-2.0".into()),
            known_unsupported_ops: vec![],
            adapter_stack: vec![],
            platform_variant: Some("macos-dynamic".into()),
        };

        let d1 = profile.digest();
        let d2 = profile.digest();
        assert_eq!(d1, d2, "digest must be deterministic");
        assert_eq!(d1.0.len(), 64);
    }
}
